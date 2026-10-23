// End-to-end: a script whose /gen hits the host's permission gate must
// surface the translated Korean toast, not the raw PERMISSION_DENIED string.
// backend.ts registers itself on the `spindle` global at import time, like the
// real worker — so the fake must exist before the import. The specifier is a
// literal, but a static import would evaluate backend.ts before the global is
// installed; this is a deliberate module-loading-boundary test.

import { describe, expect, test } from 'bun:test';

const toasts: Array<{ kind: string; text: string }> = [];

// Resolved by the run's finally block (running:false) — deterministic.
const finished = Promise.withResolvers<void>();

let handler: ((payload: unknown, userId: string, sessionId?: string) => void) | null = null;

(globalThis as Record<string, unknown>).spindle = {
  log: { info() {}, warn() {}, error() {}, debug() {} },
  onFrontendMessage(fn: typeof handler) {
    handler = fn;
  },
  sendToFrontend(payload: { type: string; running?: boolean }) {
    if (payload.type === 'running' && payload.running === false) finished.resolve();
  },
  toast: {
    info: (text: string) => toasts.push({ kind: 'info', text }),
    warning: (text: string) => toasts.push({ kind: 'warning', text }),
    error: (text: string) => toasts.push({ kind: 'error', text }),
    success: (text: string) => toasts.push({ kind: 'success', text }),
  },
  userStorage: {
    async getJson() {
      return {
        settings: {},
        sets: [
          {
            id: 'set1',
            name: '테스트',
            color: '',
            disableSend: false,
            injectInput: false,
            placeBeforeInput: false,
            qrs: [{ id: 'qr1', message: '/gen 지시', label: '검색기록', title: '', isInsert: false }],
          },
        ],
      };
    },
    async setJson() {},
  },
  macros: {
    async resolve(text: string) {
      return { text };
    },
  },
  prompt: { async input() { return { value: null, cancelled: true }; } },
  variables: {
    local: { async get() { return ''; }, async set() {}, async has() { return false; }, async delete() {} },
    global: { async get() { return ''; }, async set() {}, async has() { return false; }, async delete() {} },
  },
  chat: {
    async appendMessage() { return { id: 'm1' }; },
    async setMessageHidden() {},
  },
  generate: {
    async dryRun() {
      throw new Error('PERMISSION_DENIED: generation — Generation permission not granted');
    },
    async quiet() {
      throw new Error('PERMISSION_DENIED: generation — Generation permission not granted');
    },
  },
};

// Dynamic import: the global above must exist before backend.ts is evaluated.
const mod = await import('../src/backend');
void mod;

describe('run with a denied generation permission', () => {
  test('the toast is the translated Korean message, never raw PERMISSION_DENIED', async () => {
    expect(handler).not.toBeNull();
    handler!({ type: 'run', setId: 'set1', qrId: 'qr1', chatId: 'chat1' }, 'user1', 's1');
    await finished.promise;
    const errs = toasts.filter((t) => t.kind === 'error');
    expect(errs.length).toBe(1);
    expect(errs[0]!.text).toContain('생성');
    expect(errs[0]!.text).toContain('권한');
    expect(errs[0]!.text).toContain('관리자');
    expect(errs[0]!.text).not.toContain('PERMISSION_DENIED');
  });
});
