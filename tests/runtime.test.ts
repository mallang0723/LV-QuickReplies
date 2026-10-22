import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParseError, parseScript } from '../src/stscript/parser';
import { type Host, type MessageKind, runScript, ScriptAbort, ScriptError } from '../src/stscript/runtime';

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8'));

interface Log {
  inputs: string[];
  toasts: Array<[string, string]>;
  gens: Array<{ prompt: string; as: string }>;
  messages: Array<[MessageKind, string]>;
  vars: Map<string, string>;
}

function fakeHost(inputAnswer: string | null, genAnswer = 'GENERATED'): { host: Host; log: Log } {
  const log: Log = { inputs: [], toasts: [], gens: [], messages: [], vars: new Map() };
  const key = (scope: string, k: string) => `${scope}:${k}`;
  const host: Host = {
    // Minimal macro engine: {{char}}, {{user}}, {{getvar::x}}. Unknown macros stay as-is.
    async resolveMacros(text) {
      return text
        .replace(/\{\{char\}\}/g, 'Alice')
        .replace(/\{\{user\}\}/g, 'Bob')
        .replace(/\{\{getvar::([^}]+)\}\}/g, (_, k) => log.vars.get(key('local', k)) ?? '');
    },
    async input(prompt) {
      log.inputs.push(prompt);
      return inputAnswer;
    },
    toast(kind, text) {
      log.toasts.push([kind, text]);
    },
    async getVar(scope, k) {
      return log.vars.get(key(scope, k)) ?? '';
    },
    async setVar(scope, k, v) {
      log.vars.set(key(scope, k), v);
    },
    async hasVar(scope, k) {
      return log.vars.has(key(scope, k));
    },
    async deleteVar(scope, k) {
      log.vars.delete(key(scope, k));
    },
    async gen(prompt, options) {
      log.gens.push({ prompt, as: options.as });
      return genAnswer;
    },
    async genRaw(prompt) {
      log.gens.push({ prompt, as: 'raw' });
      return genAnswer;
    },
    async appendMessage(kind, text) {
      log.messages.push([kind, text]);
    },
    async setInput() {},
    async trigger() {},
    async findQuickReply() {
      return null;
    },
    async sleep() {},
  };
  return { host, log };
}

describe('sample Quick Reply: 모험 일지 (/gen | /sendas)', () => {
  const qr = fixture('sample-adventure.qr.json');

  test('parses into input, setvar, if, gen, sendas', () => {
    const script = parseScript(qr.message);
    expect(script.commands.map((c) => c.name)).toEqual(['input', 'setvar', 'if', 'gen', 'sendas']);
    const ifCmd = script.commands[2]!;
    expect(ifCmd.named.map((a) => a.name)).toEqual(['left', 'right', 'rule']);
    // "||" after /setvar and /if: the next command gets no injected pipe
    expect(script.commands[2]!.injectPipe).toBe(false);
    expect(script.commands[3]!.injectPipe).toBe(false);
    expect(script.commands[4]!.injectPipe).toBe(true);
  });

  test('topic entered: generates with the topic and posts as the character', async () => {
    const { host, log } = fakeHost('비 오는 날의 데이트', 'RESULT TEXT');
    await runScript(qr.message, host);
    expect(log.inputs).toEqual(['어떤 모험을 기록할까요?']);
    expect(log.vars.get('local:trip_theme')).toBe('비 오는 날의 데이트');
    expect(log.gens).toHaveLength(1);
    const prompt = log.gens[0]!.prompt;
    expect(prompt.startsWith('<System>')).toBe(true);
    expect(prompt.endsWith('</System>')).toBe(true);
    expect(prompt).toContain('Theme: "비 오는 날의 데이트"');
    expect(prompt).toContain('adventure journal kept by Alice');
    expect(prompt).not.toContain('{{getvar::trip_theme}}');
    expect(log.gens[0]!.as).toBe('system');
    expect(log.messages).toEqual([['char', 'RESULT TEXT']]);
    expect(log.toasts).toEqual([]);
  });

  test('cancelled input: shows the cancel toast and stops before /gen', async () => {
    const { host, log } = fakeHost(null);
    const err = await runScript(qr.message, host).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptAbort);
    expect(log.toasts).toEqual([['info', '모험 일지 작성을 그만둡니다.']]);
    expect(log.gens).toHaveLength(0);
    expect(log.messages).toHaveLength(0);
  });
});

describe('sample Quick Reply: 짧은 대본 (/gen | /comment)', () => {
  const qr = fixture('sample-script.qr.json');

  test('topic entered: generates and posts the result as a hidden comment', async () => {
    const { host, log } = fakeHost('첫 만남', 'SCRIPT');
    await runScript(qr.message, host);
    expect(log.vars.get('local:소재')).toBe('첫 만남');
    expect(log.gens).toHaveLength(1);
    expect(log.gens[0]!.prompt).toContain('Subject: [첫 만남]');
    expect(log.messages).toEqual([['comment', 'SCRIPT']]);
  });

  test('cancelled input: shows the cancel toast and stops', async () => {
    const { host, log } = fakeHost(null);
    await expect(runScript(qr.message, host)).rejects.toBeInstanceOf(ScriptAbort);
    expect(log.toasts).toEqual([['info', '대본 작성을 취소했어요.']]);
    expect(log.gens).toHaveLength(0);
  });
});

describe('parser rules', () => {
  test('pipe inside macro braces does not split commands', () => {
    const s = parseScript('/echo {{random::a|b}} | /pass x');
    expect(s.commands.map((c) => c.name)).toEqual(['echo', 'pass']);
    expect(s.commands[0]!.unnamed).toBe('{{random::a|b}}');
  });

  test('escaped pipe stays in the text', () => {
    const s = parseScript('/echo a \\| b');
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0]!.unnamed).toBe('a | b');
  });

  test('leading quoted unnamed argument loses its quotes', () => {
    const s = parseScript('/echo "hello world"');
    expect(s.commands[0]!.unnamed).toBe('hello world');
  });

  test('comments are skipped', () => {
    const s = parseScript('// note | /pass a');
    expect(s.commands.map((c) => c.name)).toEqual(['pass']);
  });

  test('unclosed closure is a parse error', () => {
    expect(() => parseScript('/if left=a right=a {: /echo x')).toThrow(ParseError);
  });
});

describe('runtime rules', () => {
  test('previous result is injected only when the unnamed argument is missing', async () => {
    const { host, log } = fakeHost('');
    expect(await runScript('/pass abc | /setvar key=x', host)).toBe('abc');
    expect(log.vars.get('local:x')).toBe('abc');
  });

  test('"||" blocks injection but {{pipe}} still works', async () => {
    const { host, log } = fakeHost('');
    await runScript('/pass abc || /setvar key=x', host);
    expect(log.vars.get('local:x')).toBe('');
    await runScript('/pass abc || /setvar key=y {{pipe}}', host);
    expect(log.vars.get('local:y')).toBe('abc');
  });

  test('pipe content is not macro-resolved', async () => {
    const { host } = fakeHost('{{char}}');
    expect(await runScript('/input q | /pass [{{pipe}}]', host)).toBe('[{{char}}]');
  });

  test('/if else branch and numeric compare', async () => {
    const { host } = fakeHost('');
    expect(await runScript('/if left=10 right=9 rule=gt {: /pass big :}', host)).toBe('big');
    expect(await runScript('/if left=1 right=9 rule=gt else={: /pass small :} {: /pass big :}', host)).toBe('small');
  });

  test('/if operand naming an existing variable uses its value', async () => {
    const { host } = fakeHost('');
    expect(await runScript('/setvar key=hp 5 | /if left=hp right=5 {: /pass yes :}', host)).toBe('yes');
  });

  test('unsupported commands are reported before anything runs', async () => {
    const { host, log } = fakeHost('');
    const err = await runScript('/setvar key=a 1 | /popup hi', host).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptError);
    expect(String(err.message)).toContain('/popup');
    expect(log.vars.size).toBe(0);
  });

  test('/abort with quiet=false keeps the reason', async () => {
    const { host } = fakeHost('');
    const err = await runScript('/abort quiet=false 그만', host).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptAbort);
    expect(err.reason).toBe('그만');
    expect(err.quiet).toBe(false);
  });

  test('stop signal aborts between commands', async () => {
    const { host, log } = fakeHost('');
    const controller = new AbortController();
    host.sleep = async () => controller.abort();
    await expect(runScript('/delay 10 | /setvar key=after 1', host, { signal: controller.signal })).rejects.toBeInstanceOf(ScriptAbort);
    expect(log.vars.has('local:after')).toBe(false);
  });
});
