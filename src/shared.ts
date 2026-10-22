// Types and messages shared by the backend and frontend.

export interface QuickReply {
  id: string;
  label: string;
  title: string;
  message: string;
  /** Hidden from the button bar; still runnable with /run. */
  isHidden: boolean;
}

export interface QuickReplySet {
  id: string;
  name: string;
  enabled: boolean;
  /** SillyTavern set options, kept for plain-text replies. */
  disableSend: boolean;
  placeBeforeInput: boolean;
  injectInput: boolean;
  color: string | null;
  qrs: QuickReply[];
}

export interface Settings {
  showBar: boolean;
  /** Role of the /gen instruction appended to the assembled prompt. */
  genRole: 'system' | 'user';
}

export interface Store {
  version: 1;
  sets: QuickReplySet[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = { showBar: true, genRole: 'system' };

export function emptyStore(): Store {
  return { version: 1, sets: [], settings: { ...DEFAULT_SETTINGS } };
}

/** What the frontend must do with a plain-text (non-script) reply. */
export interface PlainAction {
  text: string;
  send: boolean;
  injectInput: boolean;
  placeBeforeInput: boolean;
}

// frontend -> backend
export type ToBackend =
  | { type: 'load' }
  | { type: 'import'; files: Array<{ name: string; text: string }> }
  | { type: 'save_store'; store: Store }
  | { type: 'run'; setId: string; qrId: string; chatId: string | null; input: string }
  | { type: 'stop' }
  | { type: 'notify'; kind: 'info' | 'warning' | 'error'; text: string }
  | { type: 'composer_result'; reqId: string; ok: boolean; error?: string };

// backend -> frontend
export type ToFrontend =
  | { type: 'store'; store: Store }
  | { type: 'import_result'; added: number; errors: string[] }
  | { type: 'running'; running: boolean; label?: string }
  | { type: 'plain'; action: PlainAction }
  | { type: 'composer'; reqId: string; action: 'set' | 'trigger'; text?: string };
