// Backend worker: stores Quick Reply sets per user and runs STscript against Lumiverse.

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import { importQuickReplies, LOOSE_SET_NAME, newSet } from './qr-import';
import { emptyStore, type QuickReply, type QuickReplySet, type Settings, type Store, type ToBackend, type ToFrontend, DEFAULT_SETTINGS } from './shared';
import { ParseError } from './stscript/parser';
import { type Host, type MessageKind, runScript, ScriptAbort, ScriptError } from './stscript/runtime';

const STORE_PATH = 'quick-replies.json';
const COMPOSER_TIMEOUT_MS = 15_000;

interface Running {
  controller: AbortController;
  label: string;
}

const running = new Map<string, Running>();
const pendingComposer = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let reqCounter = 0;

function send(payload: ToFrontend, userId: string, frontendSessionId?: string): void {
  spindle.sendToFrontend(payload, userId, frontendSessionId ? { frontendSessionId } : undefined);
}

// ---- store ----

function normalizeSettings(v: unknown): Settings {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<Settings>;
  return {
    showBar: typeof s.showBar === 'boolean' ? s.showBar : DEFAULT_SETTINGS.showBar,
    genRole: s.genRole === 'user' ? 'user' : 'system',
  };
}

function normalizeQr(v: unknown): QuickReply | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Partial<QuickReply>;
  if (typeof q.id !== 'string' || typeof q.message !== 'string') return null;
  return {
    id: q.id,
    label: typeof q.label === 'string' ? q.label : '',
    title: typeof q.title === 'string' ? q.title : '',
    message: q.message,
    isHidden: q.isHidden === true,
  };
}

function normalizeStore(v: unknown): Store {
  if (!v || typeof v !== 'object') return emptyStore();
  const raw = v as Partial<Store>;
  const sets: QuickReplySet[] = [];
  for (const s of Array.isArray(raw.sets) ? raw.sets : []) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
    sets.push({
      id: s.id,
      name: typeof s.name === 'string' ? s.name : '',
      enabled: s.enabled !== false,
      disableSend: s.disableSend === true,
      placeBeforeInput: s.placeBeforeInput === true,
      injectInput: s.injectInput === true,
      color: typeof s.color === 'string' ? s.color : null,
      qrs: (Array.isArray(s.qrs) ? s.qrs : []).map(normalizeQr).filter((q): q is QuickReply => !!q),
    });
  }
  return { version: 1, sets, settings: normalizeSettings(raw.settings) };
}

async function loadStore(userId: string): Promise<Store> {
  const raw = await spindle.userStorage.getJson<unknown>(STORE_PATH, { fallback: null, userId });
  return normalizeStore(raw);
}

async function saveStore(userId: string, store: Store): Promise<Store> {
  const clean = normalizeStore(store);
  await spindle.userStorage.setJson(STORE_PATH, clean, { indent: 2, userId });
  return clean;
}

// ---- host binding ----

function lastText(result: unknown): string {
  if (result && typeof result === 'object' && typeof (result as { content?: unknown }).content === 'string') {
    return (result as { content: string }).content;
  }
  if (typeof result === 'string') return result;
  return '';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function composerRequest(userId: string, sessionId: string | undefined, action: 'set' | 'trigger', text?: string): Promise<void> {
  const reqId = `c${++reqCounter}`;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingComposer.delete(reqId);
      reject(new ScriptError('입력창이 응답하지 않습니다. 채팅 화면이 열려 있는지 확인하세요.'));
    }, COMPOSER_TIMEOUT_MS);
    pendingComposer.set(reqId, { resolve, reject, timer });
    send({ type: 'composer', reqId, action, text }, userId, sessionId);
  });
}

function makeHost(userId: string, chatId: string | null, sessionId: string | undefined, store: Store, signal: AbortSignal): Host {
  const needChat = (): string => {
    if (!chatId) throw new ScriptError('열려 있는 채팅이 없습니다. 채팅을 연 뒤 실행하세요.');
    return chatId;
  };
  return {
    async resolveMacros(text) {
      const { text: out } = await spindle.macros.resolve(text, { chatId: chatId ?? undefined, userId });
      return out;
    },
    async input(prompt, defaultValue) {
      const short = prompt.trim().length > 0 && prompt.length <= 80 && !prompt.includes('\n');
      const { value, cancelled } = await spindle.prompt.input({
        title: short ? prompt.trim() : 'Quick Reply 입력',
        message: short ? undefined : prompt,
        defaultValue,
        userId,
      });
      return cancelled ? null : (value ?? '');
    },
    toast(kind, text) {
      spindle.toast[kind](text, { userId });
    },
    async getVar(scope, key) {
      return scope === 'local' ? spindle.variables.local.get(needChat(), key) : spindle.variables.global.get(key, userId);
    },
    async setVar(scope, key, value) {
      if (scope === 'local') await spindle.variables.local.set(needChat(), key, value);
      else await spindle.variables.global.set(key, value, userId);
    },
    async hasVar(scope, key) {
      return scope === 'local' ? spindle.variables.local.has(needChat(), key) : spindle.variables.global.has(key, userId);
    },
    async deleteVar(scope, key) {
      if (scope === 'local') await spindle.variables.local.delete(needChat(), key);
      else await spindle.variables.global.delete(key, userId);
    },
    async gen(prompt, options) {
      // SillyTavern /gen: the normal chat prompt (character, history, world info, preset)
      // with the instruction appended at the end.
      const assembled = await spindle.generate.dryRun({ chatId: needChat() }, userId);
      const role = options.as === 'char' ? 'assistant' : store.settings.genRole;
      const messages = [...assembled.messages, { role, content: prompt } as const];
      const result = await spindle.generate.quiet({ type: 'quiet', messages, userId, signal });
      const text = lastText(result);
      if (!text.trim()) throw new ScriptError('/gen 결과가 비어 있습니다. 연결 설정이나 모델 응답을 확인하세요.');
      return text;
    },
    async genRaw(prompt, options) {
      const messages = [
        ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
        { role: 'user' as const, content: prompt },
      ];
      const text = lastText(await spindle.generate.quiet({ type: 'quiet', messages, userId, signal }));
      if (!text.trim()) throw new ScriptError('/genraw 결과가 비어 있습니다.');
      return text;
    },
    async appendMessage(kind: MessageKind, text) {
      const id = needChat();
      const role = kind === 'char' ? 'assistant' : kind === 'user' ? 'user' : 'system';
      const { id: messageId } = await spindle.chat.appendMessage(id, { role, content: text, metadata: { source: 'st_quick_replies', kind } });
      // SillyTavern comments are not sent to the AI; hidden messages are skipped in prompt assembly.
      if (kind === 'comment') await spindle.chat.setMessageHidden(id, messageId, true);
    },
    async setInput(text) {
      await composerRequest(userId, sessionId, 'set', text);
    },
    async trigger() {
      await composerRequest(userId, sessionId, 'trigger');
    },
    async findQuickReply(label, setName) {
      for (const s of store.sets) {
        if (setName !== null && s.name !== setName) continue;
        const qr = s.qrs.find((q) => q.label === label);
        if (qr) return qr.message;
      }
      return null;
    },
    sleep: (ms) => sleep(ms, signal),
  };
}

// ---- run ----

function isScript(qr: QuickReply, set: QuickReplySet): boolean {
  return qr.message.trimStart().startsWith('/') && !set.disableSend;
}

async function run(userId: string, sessionId: string | undefined, msg: Extract<ToBackend, { type: 'run' }>): Promise<void> {
  if (running.has(userId)) {
    spindle.toast.warning(`"${running.get(userId)!.label}" 실행이 끝난 뒤 다시 눌러 주세요.`, { userId });
    return;
  }
  const store = await loadStore(userId);
  const set = store.sets.find((s) => s.id === msg.setId);
  const qr = set?.qrs.find((q) => q.id === msg.qrId);
  if (!set || !qr) {
    spindle.toast.error('Quick Reply를 찾지 못했습니다. 목록을 새로 고쳐 주세요.', { userId });
    return;
  }

  if (!isScript(qr, set)) {
    // Plain text: SillyTavern resolves macros, then puts it in the input and sends it.
    const { text } = await spindle.macros.resolve(qr.message, { chatId: msg.chatId ?? undefined, userId });
    send({ type: 'plain', action: { text, send: !set.disableSend, injectInput: set.injectInput, placeBeforeInput: set.placeBeforeInput } }, userId, sessionId);
    return;
  }

  const controller = new AbortController();
  const label = qr.label || qr.title || 'Quick Reply';
  running.set(userId, { controller, label });
  send({ type: 'running', running: true, label }, userId);
  try {
    const host = makeHost(userId, msg.chatId, sessionId, store, controller.signal);
    await runScript(qr.message, host, { signal: controller.signal });
  } catch (e) {
    if (e instanceof ScriptAbort) {
      if (!e.quiet && e.reason) spindle.toast.warning(e.reason, { userId });
      else if (controller.signal.aborted) spindle.toast.info('실행을 중지했습니다.', { userId });
    } else if (controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      spindle.toast.info('실행을 중지했습니다.', { userId });
    } else if (e instanceof ParseError) {
      spindle.toast.error(`스크립트 문법 오류 (${e.index}번째 글자 근처): ${e.message}`, { userId, title: label });
    } else if (e instanceof ScriptError) {
      spindle.toast.error(e.message, { userId, title: label });
    } else {
      spindle.toast.error(e instanceof Error ? e.message : String(e), { userId, title: label });
      spindle.log.error(`[st-qr] ${label}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  } finally {
    running.delete(userId);
    send({ type: 'running', running: false }, userId);
  }
}

// ---- messages ----

async function handle(payload: ToBackend, userId: string, sessionId?: string): Promise<void> {
  switch (payload.type) {
    case 'load': {
      send({ type: 'store', store: await loadStore(userId) }, userId, sessionId);
      const r = running.get(userId);
      if (r) send({ type: 'running', running: true, label: r.label }, userId, sessionId);
      return;
    }
    case 'import': {
      const store = await loadStore(userId);
      const errors: string[] = [];
      let added = 0;
      for (const f of payload.files) {
        const r = importQuickReplies(f.name, f.text);
        errors.push(...r.errors);
        for (const s of r.sets) {
          store.sets.push(s);
          added += s.qrs.length;
        }
        if (r.loose.length) {
          let target = store.sets.find((s) => s.name === LOOSE_SET_NAME);
          if (!target) {
            target = newSet(LOOSE_SET_NAME, []);
            store.sets.push(target);
          }
          target.qrs.push(...r.loose);
          added += r.loose.length;
        }
      }
      send({ type: 'store', store: await saveStore(userId, store) }, userId);
      send({ type: 'import_result', added, errors }, userId, sessionId);
      return;
    }
    case 'save_store':
      send({ type: 'store', store: await saveStore(userId, payload.store) }, userId);
      return;
    case 'run':
      await run(userId, sessionId, payload);
      return;
    case 'stop':
      running.get(userId)?.controller.abort();
      return;
    case 'notify':
      // The frontend has no toast API of its own.
      if (payload.kind === 'info' || payload.kind === 'warning' || payload.kind === 'error') {
        spindle.toast[payload.kind](String(payload.text).slice(0, 500), { userId });
      }
      return;
    case 'composer_result': {
      const p = pendingComposer.get(payload.reqId);
      if (!p) return;
      clearTimeout(p.timer);
      pendingComposer.delete(payload.reqId);
      if (payload.ok) p.resolve();
      else p.reject(new ScriptError(payload.error || '입력창 작업에 실패했습니다.'));
      return;
    }
  }
}

spindle.onFrontendMessage((payload, userId, frontendSessionId) => {
  if (!payload || typeof payload !== 'object' || typeof (payload as { type?: unknown }).type !== 'string') return;
  handle(payload as ToBackend, userId, frontendSessionId).catch((e) => {
    spindle.log.error(`[st-qr] ${(payload as { type: string }).type}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    spindle.toast.error(e instanceof Error ? e.message : String(e), { userId });
  });
});
