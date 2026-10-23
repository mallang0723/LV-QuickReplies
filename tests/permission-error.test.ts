// Host-side permission gate regressions.
//
// `generation` is a privileged permission: the host never auto-grants it on
// install (manager.service.ts PRIVILEGED_PERMISSIONS — an admin must approve
// it), so a fresh install gets "PERMISSION_DENIED: generation" on every /gen
// QR. The backend must turn that raw error into an actionable toast.

import { describe, expect, test } from 'bun:test';

import { describeHostError } from '../src/host-errors';

describe('describeHostError', () => {
  test('translates a generation permission denial into a Korean toast', () => {
    const msg = describeHostError(
      new Error('PERMISSION_DENIED: generation — Generation permission not granted'),
    );
    expect(msg).toContain('생성');
    expect(msg).toContain('권한');
    expect(msg).toContain('관리자');
    expect(msg).not.toContain('PERMISSION_DENIED');
  });

  test('names other denied permissions', () => {
    expect(describeHostError(new Error('PERMISSION_DENIED: chat_mutation — nope'))).toContain('채팅 수정');
  });

  test('keeps the raw message for non-permission errors', () => {
    expect(describeHostError(new Error('boom'))).toBe('boom');
    expect(describeHostError('just a string')).toBe('just a string');
  });
});
