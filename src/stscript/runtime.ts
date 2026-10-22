// STscript interpreter. Lumiverse access goes through the `Host` interface so the
// runtime can be tested without a Lumiverse server.

import { type ArgValue, type Closure, type Command, commandNames, isClosure, parseScript } from './parser';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export type MessageKind = 'char' | 'system' | 'comment' | 'user';

export interface Host {
  /** Resolve Lumiverse macros ({{char}}, {{user}}, {{getvar::x}} ...) in the active chat. */
  resolveMacros(text: string): Promise<string>;
  /** Text input dialog. Resolves `null` when cancelled. */
  input(prompt: string, defaultValue: string): Promise<string | null>;
  toast(kind: ToastKind, text: string): void;
  getVar(scope: 'local' | 'global', key: string): Promise<string>;
  setVar(scope: 'local' | 'global', key: string, value: string): Promise<void>;
  hasVar(scope: 'local' | 'global', key: string): Promise<boolean>;
  deleteVar(scope: 'local' | 'global', key: string): Promise<void>;
  /** Generation with the full chat prompt plus `prompt` appended (STscript /gen). */
  gen(prompt: string, options: { as: 'system' | 'char' }): Promise<string>;
  /** Generation with only `prompt` (STscript /genraw). */
  genRaw(prompt: string, options: { systemPrompt: string }): Promise<string>;
  appendMessage(kind: MessageKind, text: string): Promise<void>;
  setInput(text: string): Promise<void>;
  /** Start a normal reply, like pressing Send on an empty input. */
  trigger(): Promise<void>;
  /** Script source of another Quick Reply, for /run. `null` when not found. */
  findQuickReply(label: string, set: string | null): Promise<string | null>;
  sleep(ms: number): Promise<void>;
}

export class ScriptAbort extends Error {
  constructor(public readonly reason: string, public readonly quiet: boolean) {
    super(reason || 'aborted');
    this.name = 'ScriptAbort';
  }
}

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

interface Ctx {
  host: Host;
  signal?: AbortSignal;
  depth: number;
}

interface CommandResult {
  pipe: string;
}

type Handler = (ctx: Ctx, args: Record<string, ArgValue>, unnamed: ArgValue | null, raw: Command) => Promise<string>;

export const SUPPORTED_COMMANDS = [
  'input', 'setvar', 'getvar', 'addvar', 'incvar', 'decvar', 'flushvar',
  'setglobalvar', 'getglobalvar', 'addglobalvar', 'incglobalvar', 'decglobalvar', 'flushglobalvar',
  'if', 'abort', 'echo', 'gen', 'genraw', 'sendas', 'sys', 'comment', 'send', 'trigger',
  'setinput', 'pass', 'return', 'run', 'delay', 'trim', 'len',
] as const;

/** Commands in the script that this runtime cannot run. */
export function unsupportedCommands(script: Closure): string[] {
  const known = new Set<string>(SUPPORTED_COMMANDS);
  return [...new Set(commandNames(script).filter((n) => !known.has(n)))];
}

export async function runScript(source: string, host: Host, options: { signal?: AbortSignal; pipe?: string } = {}): Promise<string> {
  const script = parseScript(source);
  const missing = unsupportedCommands(script);
  if (missing.length) {
    throw new ScriptError(`지원하지 않는 명령어가 있어 실행하지 않았습니다: ${missing.map((n) => '/' + n).join(', ')}`);
  }
  const ctx: Ctx = { host, signal: options.signal, depth: 0 };
  try {
    return (await runClosure(ctx, script, options.pipe ?? '')).pipe;
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

class ReturnSignal {
  constructor(public readonly value: string) {}
}

async function runClosure(ctx: Ctx, closure: Closure, pipe: string): Promise<CommandResult> {
  let current = pipe;
  for (let index = 0; index < closure.commands.length; index++) {
    if (ctx.signal?.aborted) throw new ScriptAbort('사용자가 중지했습니다.', false);
    const cmd = closure.commands[index]!;
    const handler = HANDLERS[cmd.name];
    if (!handler) throw new ScriptError(`지원하지 않는 명령어: /${cmd.name}`);
    const args: Record<string, ArgValue> = {};
    for (const a of cmd.named) {
      args[a.name] = isClosure(a.value) ? a.value : await substitute(ctx, a.value, current);
    }
    let unnamed: ArgValue | null;
    if (cmd.unnamed === null) {
      unnamed = cmd.injectPipe && index > 0 ? current : null;
    } else if (isClosure(cmd.unnamed)) {
      unnamed = cmd.unnamed;
    } else {
      unnamed = await substitute(ctx, cmd.unnamed, current);
    }
    current = (await handler(ctx, args, unnamed, cmd)) ?? '';
  }
  return { pipe: current };
}

const VAR_MACRO = /\{\{(getvar|getglobalvar|var)::([^{}]+?)\}\}/gi;
const TOKEN = /\uE000(\d+)\uE000/g;

/**
 * Replace {{pipe}} and the variable macros, then resolve the remaining Lumiverse macros.
 * Variable macros are read here because Lumiverse's macro engine starts every evaluation
 * with empty local variables, so it cannot see values written by /setvar.
 * Inserted values are not macro-resolved again.
 */
async function substitute(ctx: Ctx, text: string, pipe: string): Promise<string> {
  if (!text.includes('{{')) return text;
  const values: string[] = [];
  const token = (value: string) => {
    values.push(value);
    return `\uE000${values.length - 1}\uE000`;
  };
  let out = text.replace(/\{\{pipe\}\}/gi, () => token(pipe));
  const keys = [...out.matchAll(VAR_MACRO)].map((m) => ({ scope: m[1]!.toLowerCase() === 'getglobalvar' ? 'global' as const : 'local' as const, key: m[2]!.trim() }));
  const read = await Promise.all(keys.map((k) => ctx.host.getVar(k.scope, k.key)));
  let i = 0;
  out = out.replace(VAR_MACRO, () => token(read[i++] ?? ''));
  if (out.includes('{{')) out = await ctx.host.resolveMacros(out);
  return out.replace(TOKEN, (_m, n: string) => values[Number(n)] ?? '');
}

function str(v: ArgValue | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (isClosure(v)) throw new ScriptError('이 자리에는 클로저 {: :} 를 쓸 수 없습니다.');
  return v;
}

function bool(v: ArgValue | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const s = str(v).trim().toLowerCase();
  if (['true', 'on', '1', 'yes'].includes(s)) return true;
  if (['false', 'off', '0', 'no'].includes(s)) return false;
  return fallback;
}

function num(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function runValue(ctx: Ctx, v: ArgValue | null, pipe: string): Promise<string> {
  if (v === null) return '';
  if (!isClosure(v)) return v;
  try {
    return (await runClosure(ctx, v, pipe)).pipe;
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

function varKey(args: Record<string, ArgValue>, unnamed: ArgValue | null): string {
  const key = args.key !== undefined ? str(args.key) : args.name !== undefined ? str(args.name) : str(unnamed);
  if (!key.trim()) throw new ScriptError('변수 이름(key=)이 비어 있습니다.');
  return key.trim();
}

function varHandlers(scope: 'local' | 'global'): Record<string, Handler> {
  const p = scope === 'local' ? '' : 'global';
  return {
    [`set${p}var`]: async (ctx, args, unnamed) => {
      const key = varKey(args, null);
      const value = str(unnamed);
      await ctx.host.setVar(scope, key, value);
      return value;
    },
    [`get${p}var`]: async (ctx, args, unnamed) => ctx.host.getVar(scope, varKey(args, unnamed)),
    [`add${p}var`]: async (ctx, args, unnamed) => {
      const key = varKey(args, null);
      const cur = await ctx.host.getVar(scope, key);
      const add = str(unnamed);
      const a = num(cur);
      const b = num(add);
      const next = (a !== null || cur === '') && b !== null ? String((a ?? 0) + b) : cur + add;
      await ctx.host.setVar(scope, key, next);
      return next;
    },
    [`inc${p}var`]: async (ctx, args, unnamed) => {
      const key = varKey(args, unnamed);
      const next = String((num(await ctx.host.getVar(scope, key)) ?? 0) + 1);
      await ctx.host.setVar(scope, key, next);
      return next;
    },
    [`dec${p}var`]: async (ctx, args, unnamed) => {
      const key = varKey(args, unnamed);
      const next = String((num(await ctx.host.getVar(scope, key)) ?? 0) - 1);
      await ctx.host.setVar(scope, key, next);
      return next;
    },
    [`flush${p}var`]: async (ctx, args, unnamed) => {
      await ctx.host.deleteVar(scope, varKey(args, unnamed));
      return '';
    },
  };
}

/** SillyTavern /if: an operand that names an existing variable is replaced by its value. */
async function operand(ctx: Ctx, cmd: Command, name: string, value: ArgValue | undefined): Promise<string> {
  if (value === undefined) return '';
  const s = str(value);
  const rawArg = cmd.named.find((a) => a.name === name);
  const literal = rawArg?.quoted || (typeof rawArg?.value === 'string' && rawArg.value.includes('{{'));
  if (!literal && s.trim() && /^[\w.-]+$/.test(s.trim())) {
    if (await ctx.host.hasVar('local', s.trim())) return ctx.host.getVar('local', s.trim());
    if (await ctx.host.hasVar('global', s.trim())) return ctx.host.getVar('global', s.trim());
  }
  return s;
}

function compare(rule: string, left: string, right: string): boolean {
  const ln = num(left);
  const rn = num(right);
  const numeric = ln !== null && rn !== null;
  switch (rule) {
    case 'eq':
      return numeric ? ln === rn : left === right;
    case 'neq':
      return numeric ? ln !== rn : left !== right;
    case 'lt':
      return numeric ? ln! < rn! : left < right;
    case 'gt':
      return numeric ? ln! > rn! : left > right;
    case 'lte':
      return numeric ? ln! <= rn! : left <= right;
    case 'gte':
      return numeric ? ln! >= rn! : left >= right;
    case 'not':
      return !truthy(left);
    case 'in':
      return left.toLowerCase().includes(right.toLowerCase());
    case 'nin':
      return !left.toLowerCase().includes(right.toLowerCase());
    default:
      throw new ScriptError(`/if 에서 알 수 없는 rule: ${rule}`);
  }
}

function truthy(s: string): boolean {
  const t = s.trim().toLowerCase();
  return !(t === '' || t === 'false' || t === '0' || t === 'off' || t === 'null' || t === 'undefined');
}

const TOAST_SEVERITY: Record<string, ToastKind> = { info: 'info', success: 'success', warning: 'warning', error: 'error' };

const HANDLERS: Record<string, Handler> = {
  ...varHandlers('local'),
  ...varHandlers('global'),

  input: async (ctx, args, unnamed) => {
    const value = await ctx.host.input(str(unnamed), args.default !== undefined ? str(args.default) : '');
    return value ?? '';
  },

  if: async (ctx, args, unnamed, cmd) => {
    const left = await operand(ctx, cmd, 'left', args.left);
    const right = await operand(ctx, cmd, 'right', args.right);
    const rule = args.rule !== undefined ? str(args.rule).trim().toLowerCase() : 'eq';
    const branch = compare(rule, left, right) ? unnamed : (args.else ?? null);
    if (typeof branch === 'string' && branch.trim().startsWith('/')) {
      // Legacy form: the branch is command text instead of a closure.
      const sub = parseScript(branch);
      const missing = unsupportedCommands(sub);
      if (missing.length) throw new ScriptError(`/if: 지원하지 않는 명령어 ${missing.map((n) => '/' + n).join(', ')}`);
      return runValue(ctx, sub, '');
    }
    return runValue(ctx, branch, '');
  },

  abort: async (_ctx, args, unnamed) => {
    throw new ScriptAbort(str(unnamed), bool(args.quiet, true));
  },

  echo: async (ctx, args, unnamed) => {
    const text = str(unnamed);
    const kind = TOAST_SEVERITY[args.severity !== undefined ? str(args.severity).trim() : 'info'] ?? 'info';
    ctx.host.toast(kind, text);
    return text;
  },

  gen: async (ctx, args, unnamed) => {
    const as = args.as !== undefined && str(args.as).trim() === 'char' ? 'char' : 'system';
    return ctx.host.gen(str(unnamed), { as });
  },

  genraw: async (ctx, args, unnamed) => {
    return ctx.host.genRaw(str(unnamed), { systemPrompt: args.system !== undefined ? str(args.system) : '' });
  },

  sendas: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim()) await ctx.host.appendMessage('char', text);
    return text;
  },

  sys: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim()) await ctx.host.appendMessage('system', text);
    return text;
  },

  comment: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim()) await ctx.host.appendMessage('comment', text);
    return text;
  },

  send: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim()) await ctx.host.appendMessage('user', text);
    return text;
  },

  trigger: async (ctx) => {
    await ctx.host.trigger();
    return '';
  },

  setinput: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    await ctx.host.setInput(text);
    return text;
  },

  pass: async (_ctx, _args, unnamed) => str(unnamed),

  return: async (_ctx, _args, unnamed) => {
    throw new ReturnSignal(str(unnamed));
  },

  trim: async (_ctx, _args, unnamed) => str(unnamed).trim(),

  len: async (_ctx, _args, unnamed) => String([...str(unnamed)].length),

  delay: async (ctx, _args, unnamed) => {
    const ms = num(str(unnamed)) ?? 0;
    await ctx.host.sleep(Math.max(0, Math.min(ms, 600_000)));
    return '';
  },

  run: async (ctx, _args, unnamed) => {
    if (ctx.depth >= 10) throw new ScriptError('/run 이 너무 깊게 중첩되었습니다 (10단계 제한).');
    if (isClosure(unnamed)) return runValue(ctx, unnamed, '');
    const target = str(unnamed).trim();
    let set: string | null = null;
    let label = target;
    const dot = target.indexOf('.');
    if (dot > 0) {
      set = target.slice(0, dot);
      label = target.slice(dot + 1);
    }
    const source = await ctx.host.findQuickReply(label, set);
    if (source === null) throw new ScriptError(`/run: Quick Reply "${target}" 를 찾지 못했습니다.`);
    const script = parseScript(source);
    const missing = unsupportedCommands(script);
    if (missing.length) throw new ScriptError(`/run ${target}: 지원하지 않는 명령어 ${missing.map((n) => '/' + n).join(', ')}`);
    try {
      return (await runClosure({ ...ctx, depth: ctx.depth + 1 }, script, '')).pipe;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  },
};
