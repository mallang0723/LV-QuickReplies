import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importQuickReplies } from '../src/qr-import';

const raw = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('importQuickReplies', () => {
  test('single Quick Reply exports become loose replies', () => {
    const r = importQuickReplies('a.qr.json', raw('sample-adventure.qr.json'));
    expect(r.errors).toEqual([]);
    expect(r.sets).toEqual([]);
    expect(r.loose).toHaveLength(1);
    expect(r.loose[0]!.label).toBe('🧑‍🚀 모험 일지');
    expect(r.loose[0]!.message.startsWith('/input ')).toBe(true);
  });

  test('set export keeps the set name, options and order', () => {
    const set = {
      version: 2,
      name: 'My Set',
      disableSend: true,
      placeBeforeInput: false,
      injectInput: true,
      color: 'transparent',
      onlyBorderColor: false,
      qrList: [JSON.parse(raw('sample-script.qr.json')), { id: 2, label: 'Hi', message: 'hello', isHidden: true }],
      idIndex: 3,
    };
    const r = importQuickReplies('set.json', JSON.stringify(set));
    expect(r.errors).toEqual([]);
    expect(r.sets).toHaveLength(1);
    const s = r.sets[0]!;
    expect(s.name).toBe('My Set');
    expect(s.disableSend).toBe(true);
    expect(s.injectInput).toBe(true);
    expect(s.qrs.map((q) => q.label)).toEqual(['📝 짧은 대본', 'Hi']);
    expect(s.qrs[1]!.isHidden).toBe(true);
  });

  test('broken JSON and foreign objects are reported, not imported', () => {
    expect(importQuickReplies('x.json', '{oops').errors[0]).toContain('JSON 형식이 아닙니다');
    const r = importQuickReplies('y.json', JSON.stringify({ foo: 1 }));
    expect(r.sets).toEqual([]);
    expect(r.loose).toEqual([]);
    expect(r.errors[0]).toContain('SillyTavern Quick Reply 형식이 아닙니다');
  });

  test('byte order mark is accepted', () => {
    const r = importQuickReplies('bom.json', '\uFEFF' + raw('sample-script.qr.json'));
    expect(r.errors).toEqual([]);
    expect(r.loose).toHaveLength(1);
  });
});
