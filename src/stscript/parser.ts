// STscript parser — the subset SillyTavern Quick Replies use.
// Follows SillyTavern's SlashCommandParser rules:
//   - commands start with "/" and are separated by "|"
//   - "||" separates commands without injecting the previous result into the next command
//   - named arguments come first (key=value, key="quoted", key={: closure :})
//   - the unnamed argument runs until an unescaped "|" (outside {{macro}} braces) or ":}"
//   - a leading "quoted value" in the unnamed argument loses its quotes
//   - "{: ... :}" is a closure, executed later by the command that receives it
//   - "//" and "/#" are comments
// Text is kept raw here; macros are resolved when each command runs.

export interface Closure {
  kind: 'closure';
  commands: Command[];
  source: string;
}

export type ArgValue = string | Closure;

export interface NamedArg {
  name: string;
  value: ArgValue;
  quoted: boolean;
}

export interface Command {
  name: string;
  named: NamedArg[];
  /** Unnamed argument. `null` when the command had none (pipe injection applies). */
  unnamed: ArgValue | null;
  unnamedQuoted: boolean;
  /** Whether the previous result is injected when the unnamed argument is missing. */
  injectPipe: boolean;
  /** Offset in the script, for error messages. */
  start: number;
}

export class ParseError extends Error {
  constructor(message: string, public readonly index: number) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parseScript(text: string): Closure {
  const p = new Parser(text);
  const closure = p.parseBody(true);
  return closure;
}

export function isClosure(v: unknown): v is Closure {
  return !!v && typeof v === 'object' && (v as Closure).kind === 'closure';
}

/** Collects every command name in the script, including those inside closures. */
export function commandNames(closure: Closure): string[] {
  const out: string[] = [];
  const walk = (c: Closure) => {
    for (const cmd of c.commands) {
      out.push(cmd.name);
      for (const a of cmd.named) if (isClosure(a.value)) walk(a.value);
      if (isClosure(cmd.unnamed)) walk(cmd.unnamed);
    }
  };
  walk(closure);
  return out;
}

const NAMED_ARG = /^([A-Za-z_][\w-]*)=/;
const ESCAPABLE = new Set(['|', '\\', '{', '}', ':', '"']);

class Parser {
  i = 0;
  constructor(private readonly text: string) {}

  private get ch(): string {
    return this.text[this.i] ?? '';
  }

  private test(s: string): boolean {
    return this.text.startsWith(s, this.i);
  }

  private eof(): boolean {
    return this.i >= this.text.length;
  }

  private skipWhitespace(): void {
    while (!this.eof() && /\s/.test(this.ch)) this.i++;
  }

  parseBody(isRoot: boolean): Closure {
    const start = this.i;
    const commands: Command[] = [];
    let injectPipe = true;
    this.skipWhitespace();
    while (!this.eof()) {
      if (!isRoot && this.test(':}')) break;
      if (this.test('/')) {
        const cmd = this.parseCommand(injectPipe);
        if (cmd) commands.push(cmd);
        injectPipe = true;
      } else if (this.test('|')) {
        // empty segment
      } else {
        // Plain text between commands is discarded, like SillyTavern does.
        while (!this.eof() && !this.test('|') && !(!isRoot && this.test(':}'))) this.i++;
      }
      this.skipWhitespace();
      if (this.test('|')) {
        this.i++;
        if (this.test('|')) {
          injectPipe = false;
          this.i++;
        }
      }
      this.skipWhitespace();
    }
    if (!isRoot) {
      if (!this.test(':}')) throw new ParseError('클로저 {: 가 :} 로 닫히지 않았습니다.', start);
    }
    return { kind: 'closure', commands, source: this.text.slice(start, this.i) };
  }

  private parseClosure(): Closure {
    const start = this.i;
    this.i += 2; // {:
    const body = this.parseBody(false);
    if (!this.test(':}')) throw new ParseError('클로저 {: 가 :} 로 닫히지 않았습니다.', start);
    this.i += 2; // :}
    return body;
  }

  private parseCommand(injectPipe: boolean): Command | null {
    const start = this.i;
    this.i++; // "/"
    // Comments: "//" and "/#" run to the end of the command.
    if (this.test('/') || this.test('#')) {
      this.readRawUntilCommandEnd();
      return null;
    }
    let name = '';
    // "/:label" is shorthand for /run label
    if (this.test(':')) {
      this.i++;
      name = 'run';
    } else {
      while (!this.eof() && !/\s/.test(this.ch) && !this.test('|') && !this.test(':}')) {
        name += this.ch;
        this.i++;
      }
    }
    if (!name) throw new ParseError('명령어 이름이 비어 있습니다.', start);
    const named: NamedArg[] = [];
    this.skipInlineWhitespace();
    while (!this.eof()) {
      const m = NAMED_ARG.exec(this.text.slice(this.i, this.i + 64));
      if (!m) break;
      this.i += m[0].length;
      const { value, quoted } = this.parseNamedValue();
      named.push({ name: m[1]!, value, quoted });
      this.skipInlineWhitespace();
    }
    const { value: unnamed, quoted: unnamedQuoted } = this.parseUnnamed();
    return { name: name.toLowerCase(), named, unnamed, unnamedQuoted, injectPipe, start };
  }

  private skipInlineWhitespace(): void {
    while (!this.eof() && /\s/.test(this.ch)) this.i++;
  }

  private parseQuoted(): string {
    const start = this.i;
    this.i++; // opening quote
    let out = '';
    while (!this.eof()) {
      if (this.ch === '\\' && this.text[this.i + 1] === '"') {
        out += '"';
        this.i += 2;
        continue;
      }
      if (this.ch === '"') {
        this.i++;
        return out;
      }
      out += this.ch;
      this.i++;
    }
    throw new ParseError('따옴표가 닫히지 않았습니다.', start);
  }

  private parseNamedValue(): { value: ArgValue; quoted: boolean } {
    if (this.test('{:')) return { value: this.parseClosure(), quoted: false };
    if (this.test('"')) return { value: this.parseQuoted(), quoted: true };
    const from = this.i;
    let depth = 0;
    while (!this.eof()) {
      if (this.test('{{')) {
        depth++;
        this.i += 2;
        continue;
      }
      if (this.test('}}') && depth > 0) {
        depth--;
        this.i += 2;
        continue;
      }
      if (depth === 0 && (this.test('|') || this.test(':}') || /\s/.test(this.ch))) break;
      this.i++;
    }
    return { value: this.text.slice(from, this.i), quoted: false };
  }

  private readRawUntilCommandEnd(): string {
    let out = '';
    let depth = 0;
    while (!this.eof()) {
      if (this.ch === '\\' && ESCAPABLE.has(this.text[this.i + 1] ?? '')) {
        out += this.text[this.i + 1];
        this.i += 2;
        continue;
      }
      if (this.test('{{')) {
        depth++;
        out += '{{';
        this.i += 2;
        continue;
      }
      if (this.test('}}') && depth > 0) {
        depth--;
        out += '}}';
        this.i += 2;
        continue;
      }
      if (depth === 0 && (this.test('|') || this.test(':}'))) break;
      if (this.test('{:')) throw new ParseError('인자 중간의 클로저는 지원하지 않습니다.', this.i);
      out += this.ch;
      this.i++;
    }
    return out;
  }

  private parseUnnamed(): { value: ArgValue | null; quoted: boolean } {
    if (this.eof() || this.test('|') || this.test(':}')) return { value: null, quoted: false };
    if (this.test('{:')) {
      const closure = this.parseClosure();
      this.skipInlineWhitespace();
      if (!this.eof() && !this.test('|') && !this.test(':}')) {
        throw new ParseError('클로저 뒤에 다른 인자가 올 수 없습니다.', this.i);
      }
      return { value: closure, quoted: false };
    }
    let quoted = false;
    let head = '';
    if (this.test('"')) {
      head = this.parseQuoted();
      quoted = true;
    }
    const rest = this.readRawUntilCommandEnd();
    let value = quoted ? head + rest.trimEnd() : rest.trim();
    if (quoted && rest.trim() === '') value = head;
    if (!quoted && value === '') return { value: null, quoted: false };
    return { value, quoted };
  }
}
