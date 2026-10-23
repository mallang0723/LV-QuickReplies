// Translation of host-side permission-gate errors.
//
// The host's gates throw "PERMISSION_DENIED: <perm> — <detail>". Privileged
// permissions (generation, chat_mutation, ...) are never auto-granted on
// install — an admin must approve them — so a fresh install hits these on the
// first /gen. Translate the raw English error into an actionable message.

const PERMISSION_LABELS: Record<string, string> = {
  generation: '생성(generation)',
  chat_mutation: '채팅 수정(chat_mutation)',
  chats: '채팅 관리(chats)',
  characters: '캐릭터(characters)',
  personas: '페르소나(personas)',
  presets: '프리셋(presets)',
  world_books: '월드북(world_books)',
  ui_panels: 'UI 패널(ui_panels)',
  cors_proxy: '외부 웹 가져오기(cors_proxy)',
};

export function describeHostError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /^PERMISSION_DENIED:\s*([\w.-]+)/.exec(raw);
  if (!m) return raw;
  const perm = m[1]!;
  const label = PERMISSION_LABELS[perm] ?? perm;
  return `호스트 권한이 허용되지 않았습니다: ${label}. 확장 관리 화면에서 이 권한을 승인해 주세요 (generation, chat_mutation 등은 관리자 승인 필요).`;
}

export function isPermissionError(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)).startsWith('PERMISSION_DENIED:');
}
