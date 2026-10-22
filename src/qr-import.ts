// Converts SillyTavern Quick Reply exports into this extension's sets.
// Accepted shapes:
//   - a set export: { version: 2, name, qrList: [...], disableSend, ... }
//   - a single Quick Reply export: { id, label, message, ... }
//   - an array of either

import type { QuickReply, QuickReplySet } from './shared';

export interface ImportResult {
  /** Set exports, one set each. */
  sets: QuickReplySet[];
  /** Single Quick Reply exports; the caller files them into one shared set. */
  loose: QuickReply[];
  errors: string[];
}

export const LOOSE_SET_NAME = '가져온 QR';

export function newSet(name: string, qrs: QuickReply[]): QuickReplySet {
  return {
    id: newId('set'),
    name,
    enabled: true,
    disableSend: false,
    placeBeforeInput: false,
    injectInput: false,
    color: null,
    qrs,
  };
}

type Json = Record<string, unknown>;

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isObject(v: unknown): v is Json {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toQuickReply(raw: Json): QuickReply | null {
  const message = text(raw.message);
  const label = text(raw.label).trim() || text(raw.title).trim();
  if (!message.trim() && !label) return null;
  return {
    id: newId('qr'),
    label: label || '(이름 없음)',
    title: text(raw.title),
    message,
    isHidden: raw.isHidden === true,
  };
}

function baseName(fileName: string): string {
  return fileName.replace(/\.json$/i, '').replace(/\.qr$/i, '').trim() || '가져온 QR';
}

export function importQuickReplies(fileName: string, rawText: string): ImportResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.replace(/^\uFEFF/, ''));
  } catch (e) {
    return { sets: [], loose: [], errors: [`${fileName}: JSON 형식이 아닙니다 (${(e as Error).message}).`] };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const sets: QuickReplySet[] = [];
  const loose: QuickReply[] = [];
  items.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`${fileName} #${index + 1}: Quick Reply 객체가 아닙니다.`);
      return;
    }
    if (Array.isArray(item.qrList)) {
      const qrs = item.qrList.filter(isObject).map(toQuickReply).filter((q): q is QuickReply => !!q);
      sets.push({
        id: newId('set'),
        name: text(item.name).trim() || baseName(fileName),
        enabled: true,
        disableSend: item.disableSend === true,
        placeBeforeInput: item.placeBeforeInput === true,
        injectInput: item.injectInput === true,
        color: typeof item.color === 'string' ? item.color : null,
        qrs,
      });
      if (!qrs.length) errors.push(`${fileName}: 세트 "${text(item.name)}" 에 Quick Reply가 없습니다.`);
      return;
    }
    if (typeof item.message === 'string' || typeof item.label === 'string') {
      const qr = toQuickReply(item);
      if (qr) loose.push(qr);
      else errors.push(`${fileName} #${index + 1}: 이름과 내용이 모두 비어 있습니다.`);
      return;
    }
    errors.push(`${fileName} #${index + 1}: SillyTavern Quick Reply 형식이 아닙니다 (label/message 또는 qrList 없음).`);
  });
  return { sets, loose, errors };
}
