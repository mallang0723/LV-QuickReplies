// src/qr-import.ts
var counter = 0;
function newId(prefix) {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// src/shared.ts
var DEFAULT_SETTINGS = { showBar: true, genRole: "system" };
function emptyStore() {
  return { version: 1, sets: [], settings: { ...DEFAULT_SETTINGS } };
}

// src/frontend.ts
var CSS = `
.stqr-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 6px; }
.stqr-bar:empty { display: none; }
.stqr-btn {
  font: inherit; font-size: 0.85em; line-height: 1.2; cursor: pointer;
  padding: 3px 9px; border-radius: var(--lumiverse-radius-sm, 6px);
  color: var(--lumiverse-text, inherit);
  background: var(--lumiverse-fill-subtle, rgba(127,127,127,0.12));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3));
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stqr-btn:hover:not(:disabled) { border-color: var(--lumiverse-primary, currentColor); }
.stqr-btn:disabled { opacity: 0.5; cursor: default; }
.stqr-btn.stqr-primary { background: var(--lumiverse-primary-015, rgba(100,140,255,0.15)); border-color: var(--lumiverse-primary, currentColor); }
.stqr-btn.stqr-danger { color: var(--lumiverse-danger, #d55); border-color: var(--lumiverse-danger, #d55); }
.stqr-btn.stqr-stop { background: var(--lumiverse-danger-015, rgba(220,80,80,0.15)); border-color: var(--lumiverse-danger, #d55); }
.stqr-panel { display: flex; flex-direction: column; gap: 10px; padding: 10px; color: var(--lumiverse-text, inherit); }
.stqr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.stqr-muted { color: var(--lumiverse-text-muted, inherit); opacity: 0.85; font-size: 0.85em; }
.stqr-set { border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: var(--lumiverse-radius, 8px); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.stqr-set-name { flex: 1 1 120px; min-width: 0; font: inherit; font-weight: 600; padding: 3px 6px; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 4px; }
.stqr-set-name:focus { border-color: var(--lumiverse-border, rgba(127,127,127,0.4)); outline: none; }
.stqr-qr { display: flex; align-items: center; gap: 6px; }
.stqr-qr-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stqr-status { font-size: 0.85em; white-space: pre-wrap; }
.stqr-field { display: flex; flex-direction: column; gap: 4px; }
.stqr-field input, .stqr-field textarea, .stqr-panel select {
  font: inherit; color: inherit; background: var(--lumiverse-fill-subtle, rgba(127,127,127,0.08));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: 4px; padding: 5px 7px; box-sizing: border-box; width: 100%;
}
.stqr-panel select { width: auto; }
.stqr-field textarea { min-height: 260px; resize: vertical; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em; }
.stqr-edit { display: flex; flex-direction: column; gap: 10px; padding: 4px; }
`;
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false)
      continue;
    if (k === "class")
      node.className = String(v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node)
      node[k] = v;
    else
      node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false)
      continue;
    node.append(c);
  }
  return node;
}
function button(label, onClick, cls = "", title) {
  return el("button", { type: "button", class: `stqr-btn ${cls}`.trim(), title: title ?? label, onClick }, [label]);
}
var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
function setup(ctx) {
  let store = emptyStore();
  let runningLabel = null;
  let status = "";
  const toBackend = (msg) => ctx.sendToBackend(msg);
  const notify = (kind, text) => toBackend({ type: "notify", kind, text });
  const removeStyle = ctx.dom.addStyle(CSS);
  const composer = () => ctx.composer?.getState().mounted ? ctx.composer : null;
  const textarea = () => document.querySelector('textarea[name="chat-message"]');
  const sendButton = () => document.querySelector('button[class*="_sendBtn_"]');
  const tick = () => new Promise((r) => setTimeout(r, 60));
  function currentChatId() {
    const c = composer();
    if (c)
      return c.getState().chatId;
    const m = /^\/chat\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function inputText() {
    return composer()?.getState().text ?? textarea()?.value ?? "";
  }
  function setInputText(text) {
    const c = composer();
    if (c) {
      c.setText(text);
      c.focus();
      return;
    }
    const ta = textarea();
    if (!ta)
      throw new Error("입력창을 찾지 못했습니다. 채팅 화면에서 실행하세요.");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
  }
  async function pressSend() {
    const c = composer();
    if (c) {
      await Promise.race([c.send(), new Promise((r) => setTimeout(r, 1500))]);
      return;
    }
    await tick();
    const b = sendButton();
    if (!b)
      throw new Error("전송 버튼을 찾지 못했습니다.");
    if (b.disabled)
      throw new Error("답변 생성 중이라 전송할 수 없습니다.");
    b.click();
  }
  async function applyPlain(action) {
    try {
      const current = inputText();
      let text = action.text;
      if (action.injectInput && current.length > 0) {
        text = action.placeBeforeInput ? `${action.text} ${current}` : `${current} ${action.text}`;
      }
      setInputText(text);
      if (action.send)
        await pressSend();
    } catch (e) {
      notify("error", `Quick Reply 전송 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async function composerAction(reqId, action, text) {
    try {
      if (action === "set") {
        setInputText(text ?? "");
      } else {
        if (inputText().trim())
          throw new Error("입력창에 작성 중인 글이 있어 /trigger 를 실행하지 않았습니다.");
        await pressSend();
      }
      toBackend({ type: "composer_result", reqId, ok: true });
    } catch (e) {
      toBackend({ type: "composer_result", reqId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  function runQr(set, qr) {
    if (runningLabel)
      return;
    toBackend({ type: "run", setId: set.id, qrId: qr.id, chatId: currentChatId(), input: inputText() });
  }
  function save() {
    toBackend({ type: "save_store", store });
  }
  const barRoot = ctx.ui.mount("chat_composer_above");
  const bar = el("div", { class: "stqr-bar" });
  barRoot.replaceChildren(bar);
  function renderBar() {
    bar.replaceChildren();
    if (!store.settings.showBar)
      return;
    if (runningLabel) {
      bar.append(button(`■ 중지 · ${runningLabel}`, () => toBackend({ type: "stop" }), "stqr-stop", "실행 중인 Quick Reply를 중지합니다"));
    }
    for (const set of store.sets) {
      if (!set.enabled)
        continue;
      for (const qr of set.qrs) {
        if (qr.isHidden)
          continue;
        const b = button(qr.label || qr.title || "(이름 없음)", () => runQr(set, qr), "", qr.title || qr.label);
        b.disabled = !!runningLabel;
        bar.append(b);
      }
    }
  }
  const tab = ctx.ui.registerDrawerTab({
    id: "quick-replies",
    title: "ST Quick Replies",
    shortName: "QR",
    description: "SillyTavern Quick Reply 가져오기·실행",
    keywords: ["quick reply", "qr", "sillytavern", "stscript", "퀵리플"],
    headerTitle: "Quick Replies",
    iconSvg: ICON
  });
  const panel = el("div", { class: "stqr-panel" });
  tab.root.replaceChildren(panel);
  async function importFiles() {
    try {
      const files = await ctx.uploads.pickFile({ accept: [".json", "application/json"], multiple: true, maxSizeBytes: 5 * 1024 * 1024 });
      if (!files.length)
        return;
      status = "가져오는 중…";
      renderPanel();
      toBackend({ type: "import", files: files.map((f) => ({ name: f.name, text: new TextDecoder().decode(f.bytes) })) });
    } catch (e) {
      status = `파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
      renderPanel();
    }
  }
  function editQr(set, qr) {
    const draft = qr ? { ...qr } : { id: newId("qr"), label: "", title: "", message: "", isHidden: false };
    const modal = ctx.ui.showModal({ title: qr ? "Quick Reply 편집" : "새 Quick Reply", width: 640, maxHeight: 760, persistent: true });
    const label = el("input", { type: "text", value: draft.label, placeholder: "버튼 이름" });
    const title = el("input", { type: "text", value: draft.title, placeholder: "마우스를 올렸을 때 보일 설명 (선택)" });
    const message = el("textarea", { value: draft.message, placeholder: "/echo 안녕 | ...  또는 그냥 보낼 문장", spellcheck: false });
    const hidden = el("input", { type: "checkbox", checked: draft.isHidden });
    modal.root.replaceChildren(el("div", { class: "stqr-edit" }, [
      el("label", { class: "stqr-field" }, ["이름", label]),
      el("label", { class: "stqr-field" }, ["설명", title]),
      el("label", { class: "stqr-field" }, ["내용 (STscript 또는 일반 문장)", message]),
      el("label", { class: "stqr-row" }, [hidden, "버튼 줄에서 숨기기 (/run 으로는 실행 가능)"]),
      el("div", { class: "stqr-row" }, [
        button("저장", () => {
          draft.label = label.value.trim();
          draft.title = title.value;
          draft.message = message.value;
          draft.isHidden = hidden.checked;
          if (!draft.label && !draft.message.trim()) {
            notify("warning", "이름이나 내용을 입력하세요.");
            return;
          }
          const target = store.sets.find((s) => s.id === set.id);
          if (!target)
            return;
          const i = target.qrs.findIndex((q) => q.id === draft.id);
          if (i >= 0)
            target.qrs[i] = draft;
          else
            target.qrs.push(draft);
          save();
          modal.dismiss();
        }, "stqr-primary"),
        button("취소", () => modal.dismiss())
      ])
    ]));
    label.focus();
  }
  async function confirmDelete(what) {
    const { confirmed } = await ctx.ui.showConfirm({ title: "삭제", message: `${what} 을(를) 삭제할까요? 되돌릴 수 없습니다.`, variant: "danger", confirmLabel: "삭제" });
    return confirmed;
  }
  function renderSet(set) {
    const name = el("input", { class: "stqr-set-name", type: "text", value: set.name, title: "세트 이름 (클릭해서 수정)" });
    name.addEventListener("change", () => {
      set.name = name.value.trim() || set.name;
      save();
    });
    const enabled = el("input", { type: "checkbox", checked: set.enabled, title: "버튼 줄에 표시" });
    enabled.addEventListener("change", () => {
      set.enabled = enabled.checked;
      save();
    });
    const rows = set.qrs.map((qr) => el("div", { class: "stqr-qr" }, [
      button("▶", () => runQr(set, qr), "stqr-primary", "실행"),
      el("span", { class: "stqr-qr-label", title: qr.title || qr.label }, [qr.label || "(이름 없음)", qr.isHidden ? el("span", { class: "stqr-muted" }, [" · 숨김"]) : null]),
      button("편집", () => editQr(set, qr)),
      button("삭제", async () => {
        if (!await confirmDelete(`"${qr.label}"`))
          return;
        set.qrs = set.qrs.filter((q) => q.id !== qr.id);
        save();
      }, "stqr-danger")
    ]));
    return el("div", { class: "stqr-set" }, [
      el("div", { class: "stqr-row" }, [
        el("label", { class: "stqr-row", title: "버튼 줄에 표시" }, [enabled]),
        name,
        button("+ QR", () => editQr(set, null)),
        button("세트 삭제", async () => {
          if (!await confirmDelete(`세트 "${set.name}" 와 안의 Quick Reply ${set.qrs.length}개`))
            return;
          store.sets = store.sets.filter((s) => s.id !== set.id);
          save();
        }, "stqr-danger")
      ]),
      set.disableSend || set.injectInput ? el("div", { class: "stqr-muted" }, [
        [set.disableSend ? "자동 전송 끔" : "", set.injectInput ? set.placeBeforeInput ? "입력창 글 앞에 붙이기" : "입력창 글 뒤에 붙이기" : ""].filter(Boolean).join(" · ")
      ]) : null,
      ...rows.length ? rows : [el("div", { class: "stqr-muted" }, ["Quick Reply가 없습니다."])]
    ]);
  }
  function renderPanel() {
    const showBar = el("input", { type: "checkbox", checked: store.settings.showBar });
    showBar.addEventListener("change", () => {
      store.settings.showBar = showBar.checked;
      save();
    });
    const genRole = el("select", {}, [
      el("option", { value: "system", selected: store.settings.genRole === "system" }, ["system (SillyTavern 기본)"]),
      el("option", { value: "user", selected: store.settings.genRole === "user" }, ["user"])
    ]);
    genRole.addEventListener("change", () => {
      store.settings.genRole = genRole.value === "user" ? "user" : "system";
      save();
    });
    const total = store.sets.reduce((n, s) => n + s.qrs.length, 0);
    const children = [
      el("div", { class: "stqr-row" }, [
        button("SillyTavern QR 가져오기 (.json)", () => void importFiles(), "stqr-primary"),
        button("+ 새 세트", () => {
          store.sets.push({ id: newId("set"), name: "새 세트", enabled: true, disableSend: false, placeBeforeInput: false, injectInput: false, color: null, qrs: [] });
          save();
        })
      ]),
      el("div", { class: "stqr-muted" }, ["세트 내보내기 파일(qrList 포함)과 Quick Reply 하나짜리 내보내기 파일을 모두 받습니다. 여러 파일을 한 번에 고를 수 있습니다."]),
      status ? el("div", { class: "stqr-status" }, [status]) : null,
      runningLabel ? el("div", { class: "stqr-row" }, [el("span", {}, [`실행 중: ${runningLabel}`]), button("중지", () => toBackend({ type: "stop" }), "stqr-stop")]) : null,
      el("label", { class: "stqr-row" }, [showBar, "입력창 위에 버튼 줄 표시"]),
      el("label", { class: "stqr-row" }, ["/gen 지시문 역할", genRole]),
      el("div", { class: "stqr-muted" }, [`세트 ${store.sets.length}개 · Quick Reply ${total}개`]),
      ...store.sets.map(renderSet)
    ];
    panel.replaceChildren(...children.filter((c) => c !== null));
  }
  function render() {
    renderBar();
    renderPanel();
  }
  const action = ctx.ui.registerInputBarAction({ id: "open-quick-replies", label: "Quick Replies 관리" });
  const offAction = action.onClick(() => tab.activate());
  const offBackend = ctx.onBackendMessage((raw) => {
    const msg = raw;
    switch (msg?.type) {
      case "store":
        store = msg.store;
        render();
        return;
      case "import_result":
        status = `${msg.added}개를 가져왔습니다.` + (msg.errors.length ? `
문제 ${msg.errors.length}건:
- ${msg.errors.join(`
- `)}` : "");
        renderPanel();
        return;
      case "running":
        runningLabel = msg.running ? msg.label ?? "Quick Reply" : null;
        render();
        return;
      case "plain":
        applyPlain(msg.action);
        return;
      case "composer":
        composerAction(msg.reqId, msg.action, msg.text);
        return;
    }
  });
  render();
  toBackend({ type: "load" });
  return () => {
    offBackend();
    offAction();
    action.destroy();
    tab.destroy();
    removeStyle();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
