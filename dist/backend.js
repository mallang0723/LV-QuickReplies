// @bun
// src/qr-import.ts
var LOOSE_SET_NAME = "\uAC00\uC838\uC628 QR";
function newSet(name, qrs) {
  return {
    id: newId("set"),
    name,
    enabled: true,
    disableSend: false,
    placeBeforeInput: false,
    injectInput: false,
    color: null,
    qrs
  };
}
var counter = 0;
function newId(prefix) {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function text(v) {
  return typeof v === "string" ? v : "";
}
function toQuickReply(raw) {
  const message = text(raw.message);
  const label = text(raw.label).trim() || text(raw.title).trim();
  if (!message.trim() && !label)
    return null;
  return {
    id: newId("qr"),
    label: label || "(\uC774\uB984 \uC5C6\uC74C)",
    title: text(raw.title),
    message,
    isHidden: raw.isHidden === true
  };
}
function baseName(fileName) {
  return fileName.replace(/\.json$/i, "").replace(/\.qr$/i, "").trim() || "\uAC00\uC838\uC628 QR";
}
function importQuickReplies(fileName, rawText) {
  const errors = [];
  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/^\uFEFF/, ""));
  } catch (e) {
    return { sets: [], loose: [], errors: [`${fileName}: JSON \uD615\uC2DD\uC774 \uC544\uB2D9\uB2C8\uB2E4 (${e.message}).`] };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const sets = [];
  const loose = [];
  items.forEach((item, index) => {
    if (!isObject(item)) {
      errors.push(`${fileName} #${index + 1}: Quick Reply \uAC1D\uCCB4\uAC00 \uC544\uB2D9\uB2C8\uB2E4.`);
      return;
    }
    if (Array.isArray(item.qrList)) {
      const qrs = item.qrList.filter(isObject).map(toQuickReply).filter((q) => !!q);
      sets.push({
        id: newId("set"),
        name: text(item.name).trim() || baseName(fileName),
        enabled: true,
        disableSend: item.disableSend === true,
        placeBeforeInput: item.placeBeforeInput === true,
        injectInput: item.injectInput === true,
        color: typeof item.color === "string" ? item.color : null,
        qrs
      });
      if (!qrs.length)
        errors.push(`${fileName}: \uC138\uD2B8 "${text(item.name)}" \uC5D0 Quick Reply\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.`);
      return;
    }
    if (typeof item.message === "string" || typeof item.label === "string") {
      const qr = toQuickReply(item);
      if (qr)
        loose.push(qr);
      else
        errors.push(`${fileName} #${index + 1}: \uC774\uB984\uACFC \uB0B4\uC6A9\uC774 \uBAA8\uB450 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.`);
      return;
    }
    errors.push(`${fileName} #${index + 1}: SillyTavern Quick Reply \uD615\uC2DD\uC774 \uC544\uB2D9\uB2C8\uB2E4 (label/message \uB610\uB294 qrList \uC5C6\uC74C).`);
  });
  return { sets, loose, errors };
}

// src/shared.ts
var DEFAULT_SETTINGS = { showBar: true, genRole: "system" };
function emptyStore() {
  return { version: 1, sets: [], settings: { ...DEFAULT_SETTINGS } };
}

// src/stscript/parser.ts
class ParseError extends Error {
  index;
  constructor(message, index) {
    super(message);
    this.index = index;
    this.name = "ParseError";
  }
}
function parseScript(text) {
  const p = new Parser(text);
  const closure = p.parseBody(true);
  return closure;
}
function isClosure(v) {
  return !!v && typeof v === "object" && v.kind === "closure";
}
function commandNames(closure) {
  const out = [];
  const walk = (c) => {
    for (const cmd of c.commands) {
      out.push(cmd.name);
      for (const a of cmd.named)
        if (isClosure(a.value))
          walk(a.value);
      if (isClosure(cmd.unnamed))
        walk(cmd.unnamed);
    }
  };
  walk(closure);
  return out;
}
var NAMED_ARG = /^([A-Za-z_][\w-]*)=/;
var ESCAPABLE = new Set(["|", "\\", "{", "}", ":", '"']);

class Parser {
  text;
  i = 0;
  constructor(text) {
    this.text = text;
  }
  get ch() {
    return this.text[this.i] ?? "";
  }
  test(s) {
    return this.text.startsWith(s, this.i);
  }
  eof() {
    return this.i >= this.text.length;
  }
  skipWhitespace() {
    while (!this.eof() && /\s/.test(this.ch))
      this.i++;
  }
  parseBody(isRoot) {
    const start = this.i;
    const commands = [];
    let injectPipe = true;
    this.skipWhitespace();
    while (!this.eof()) {
      if (!isRoot && this.test(":}"))
        break;
      if (this.test("/")) {
        const cmd = this.parseCommand(injectPipe);
        if (cmd)
          commands.push(cmd);
        injectPipe = true;
      } else if (this.test("|")) {} else {
        while (!this.eof() && !this.test("|") && !(!isRoot && this.test(":}")))
          this.i++;
      }
      this.skipWhitespace();
      if (this.test("|")) {
        this.i++;
        if (this.test("|")) {
          injectPipe = false;
          this.i++;
        }
      }
      this.skipWhitespace();
    }
    if (!isRoot) {
      if (!this.test(":}"))
        throw new ParseError("\uD074\uB85C\uC800 {: \uAC00 :} \uB85C \uB2EB\uD788\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", start);
    }
    return { kind: "closure", commands, source: this.text.slice(start, this.i) };
  }
  parseClosure() {
    const start = this.i;
    this.i += 2;
    const body = this.parseBody(false);
    if (!this.test(":}"))
      throw new ParseError("\uD074\uB85C\uC800 {: \uAC00 :} \uB85C \uB2EB\uD788\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", start);
    this.i += 2;
    return body;
  }
  parseCommand(injectPipe) {
    const start = this.i;
    this.i++;
    if (this.test("/") || this.test("#")) {
      this.readRawUntilCommandEnd();
      return null;
    }
    let name = "";
    if (this.test(":")) {
      this.i++;
      name = "run";
    } else {
      while (!this.eof() && !/\s/.test(this.ch) && !this.test("|") && !this.test(":}")) {
        name += this.ch;
        this.i++;
      }
    }
    if (!name)
      throw new ParseError("\uBA85\uB839\uC5B4 \uC774\uB984\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.", start);
    const named = [];
    this.skipInlineWhitespace();
    while (!this.eof()) {
      const m = NAMED_ARG.exec(this.text.slice(this.i, this.i + 64));
      if (!m)
        break;
      this.i += m[0].length;
      const { value, quoted } = this.parseNamedValue();
      named.push({ name: m[1], value, quoted });
      this.skipInlineWhitespace();
    }
    const { value: unnamed, quoted: unnamedQuoted } = this.parseUnnamed();
    return { name: name.toLowerCase(), named, unnamed, unnamedQuoted, injectPipe, start };
  }
  skipInlineWhitespace() {
    while (!this.eof() && /\s/.test(this.ch))
      this.i++;
  }
  parseQuoted() {
    const start = this.i;
    this.i++;
    let out = "";
    while (!this.eof()) {
      if (this.ch === "\\" && this.text[this.i + 1] === '"') {
        out += '"';
        this.i += 2;
        continue;
      }
      if (this.ch === '"') {
        this.i++;
        return out;
      }
      out += this.ch;
      this.i++;
    }
    throw new ParseError("\uB530\uC634\uD45C\uAC00 \uB2EB\uD788\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.", start);
  }
  parseNamedValue() {
    if (this.test("{:"))
      return { value: this.parseClosure(), quoted: false };
    if (this.test('"'))
      return { value: this.parseQuoted(), quoted: true };
    const from = this.i;
    let depth = 0;
    while (!this.eof()) {
      if (this.test("{{")) {
        depth++;
        this.i += 2;
        continue;
      }
      if (this.test("}}") && depth > 0) {
        depth--;
        this.i += 2;
        continue;
      }
      if (depth === 0 && (this.test("|") || this.test(":}") || /\s/.test(this.ch)))
        break;
      this.i++;
    }
    return { value: this.text.slice(from, this.i), quoted: false };
  }
  readRawUntilCommandEnd() {
    let out = "";
    let depth = 0;
    while (!this.eof()) {
      if (this.ch === "\\" && ESCAPABLE.has(this.text[this.i + 1] ?? "")) {
        out += this.text[this.i + 1];
        this.i += 2;
        continue;
      }
      if (this.test("{{")) {
        depth++;
        out += "{{";
        this.i += 2;
        continue;
      }
      if (this.test("}}") && depth > 0) {
        depth--;
        out += "}}";
        this.i += 2;
        continue;
      }
      if (depth === 0 && (this.test("|") || this.test(":}")))
        break;
      if (this.test("{:"))
        throw new ParseError("\uC778\uC790 \uC911\uAC04\uC758 \uD074\uB85C\uC800\uB294 \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.", this.i);
      out += this.ch;
      this.i++;
    }
    return out;
  }
  parseUnnamed() {
    if (this.eof() || this.test("|") || this.test(":}"))
      return { value: null, quoted: false };
    if (this.test("{:")) {
      const closure = this.parseClosure();
      this.skipInlineWhitespace();
      if (!this.eof() && !this.test("|") && !this.test(":}")) {
        throw new ParseError("\uD074\uB85C\uC800 \uB4A4\uC5D0 \uB2E4\uB978 \uC778\uC790\uAC00 \uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.", this.i);
      }
      return { value: closure, quoted: false };
    }
    let quoted = false;
    let head = "";
    if (this.test('"')) {
      head = this.parseQuoted();
      quoted = true;
    }
    const rest = this.readRawUntilCommandEnd();
    let value = quoted ? head + rest.trimEnd() : rest.trim();
    if (quoted && rest.trim() === "")
      value = head;
    if (!quoted && value === "")
      return { value: null, quoted: false };
    return { value, quoted };
  }
}

// src/stscript/runtime.ts
class ScriptAbort extends Error {
  reason;
  quiet;
  constructor(reason, quiet) {
    super(reason || "aborted");
    this.reason = reason;
    this.quiet = quiet;
    this.name = "ScriptAbort";
  }
}

class ScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScriptError";
  }
}
var SUPPORTED_COMMANDS = [
  "input",
  "setvar",
  "getvar",
  "addvar",
  "incvar",
  "decvar",
  "flushvar",
  "setglobalvar",
  "getglobalvar",
  "addglobalvar",
  "incglobalvar",
  "decglobalvar",
  "flushglobalvar",
  "if",
  "abort",
  "echo",
  "gen",
  "genraw",
  "sendas",
  "sys",
  "comment",
  "send",
  "trigger",
  "setinput",
  "pass",
  "return",
  "run",
  "delay",
  "trim",
  "len"
];
function unsupportedCommands(script) {
  const known = new Set(SUPPORTED_COMMANDS);
  return [...new Set(commandNames(script).filter((n) => !known.has(n)))];
}
async function runScript(source, host, options = {}) {
  const script = parseScript(source);
  const missing = unsupportedCommands(script);
  if (missing.length) {
    throw new ScriptError(`\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBA85\uB839\uC5B4\uAC00 \uC788\uC5B4 \uC2E4\uD589\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4: ${missing.map((n) => "/" + n).join(", ")}`);
  }
  const ctx = { host, signal: options.signal, depth: 0 };
  try {
    return (await runClosure(ctx, script, options.pipe ?? "")).pipe;
  } catch (e) {
    if (e instanceof ReturnSignal)
      return e.value;
    throw e;
  }
}

class ReturnSignal {
  value;
  constructor(value) {
    this.value = value;
  }
}
async function runClosure(ctx, closure, pipe) {
  let current = pipe;
  for (let index = 0;index < closure.commands.length; index++) {
    if (ctx.signal?.aborted)
      throw new ScriptAbort("\uC0AC\uC6A9\uC790\uAC00 \uC911\uC9C0\uD588\uC2B5\uB2C8\uB2E4.", false);
    const cmd = closure.commands[index];
    const handler = HANDLERS[cmd.name];
    if (!handler)
      throw new ScriptError(`\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBA85\uB839\uC5B4: /${cmd.name}`);
    const args = {};
    for (const a of cmd.named) {
      args[a.name] = isClosure(a.value) ? a.value : await substitute(ctx, a.value, current);
    }
    let unnamed;
    if (cmd.unnamed === null) {
      unnamed = cmd.injectPipe && index > 0 ? current : null;
    } else if (isClosure(cmd.unnamed)) {
      unnamed = cmd.unnamed;
    } else {
      unnamed = await substitute(ctx, cmd.unnamed, current);
    }
    current = await handler(ctx, args, unnamed, cmd) ?? "";
  }
  return { pipe: current };
}
var VAR_MACRO = /\{\{(getvar|getglobalvar|var)::([^{}]+?)\}\}/gi;
var TOKEN = /\uE000(\d+)\uE000/g;
async function substitute(ctx, text, pipe) {
  if (!text.includes("{{"))
    return text;
  const values = [];
  const token = (value) => {
    values.push(value);
    return `\uE000${values.length - 1}\uE000`;
  };
  let out = text.replace(/\{\{pipe\}\}/gi, () => token(pipe));
  const keys = [...out.matchAll(VAR_MACRO)].map((m) => ({ scope: m[1].toLowerCase() === "getglobalvar" ? "global" : "local", key: m[2].trim() }));
  const read = await Promise.all(keys.map((k) => ctx.host.getVar(k.scope, k.key)));
  let i = 0;
  out = out.replace(VAR_MACRO, () => token(read[i++] ?? ""));
  if (out.includes("{{"))
    out = await ctx.host.resolveMacros(out);
  return out.replace(TOKEN, (_m, n) => values[Number(n)] ?? "");
}
function str(v) {
  if (v === null || v === undefined)
    return "";
  if (isClosure(v))
    throw new ScriptError("\uC774 \uC790\uB9AC\uC5D0\uB294 \uD074\uB85C\uC800 {: :} \uB97C \uC4F8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return v;
}
function bool(v, fallback) {
  if (v === undefined)
    return fallback;
  const s = str(v).trim().toLowerCase();
  if (["true", "on", "1", "yes"].includes(s))
    return true;
  if (["false", "off", "0", "no"].includes(s))
    return false;
  return fallback;
}
function num(s) {
  if (s.trim() === "")
    return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
async function runValue(ctx, v, pipe) {
  if (v === null)
    return "";
  if (!isClosure(v))
    return v;
  try {
    return (await runClosure(ctx, v, pipe)).pipe;
  } catch (e) {
    if (e instanceof ReturnSignal)
      return e.value;
    throw e;
  }
}
function varKey(args, unnamed) {
  const key = args.key !== undefined ? str(args.key) : args.name !== undefined ? str(args.name) : str(unnamed);
  if (!key.trim())
    throw new ScriptError("\uBCC0\uC218 \uC774\uB984(key=)\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
  return key.trim();
}
function varHandlers(scope) {
  const p = scope === "local" ? "" : "global";
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
      const next = (a !== null || cur === "") && b !== null ? String((a ?? 0) + b) : cur + add;
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
      return "";
    }
  };
}
async function operand(ctx, cmd, name, value) {
  if (value === undefined)
    return "";
  const s = str(value);
  const rawArg = cmd.named.find((a) => a.name === name);
  const literal = rawArg?.quoted || typeof rawArg?.value === "string" && rawArg.value.includes("{{");
  if (!literal && s.trim() && /^[\w.-]+$/.test(s.trim())) {
    if (await ctx.host.hasVar("local", s.trim()))
      return ctx.host.getVar("local", s.trim());
    if (await ctx.host.hasVar("global", s.trim()))
      return ctx.host.getVar("global", s.trim());
  }
  return s;
}
function compare(rule, left, right) {
  const ln = num(left);
  const rn = num(right);
  const numeric = ln !== null && rn !== null;
  switch (rule) {
    case "eq":
      return numeric ? ln === rn : left === right;
    case "neq":
      return numeric ? ln !== rn : left !== right;
    case "lt":
      return numeric ? ln < rn : left < right;
    case "gt":
      return numeric ? ln > rn : left > right;
    case "lte":
      return numeric ? ln <= rn : left <= right;
    case "gte":
      return numeric ? ln >= rn : left >= right;
    case "not":
      return !truthy(left);
    case "in":
      return left.toLowerCase().includes(right.toLowerCase());
    case "nin":
      return !left.toLowerCase().includes(right.toLowerCase());
    default:
      throw new ScriptError(`/if \uC5D0\uC11C \uC54C \uC218 \uC5C6\uB294 rule: ${rule}`);
  }
}
function truthy(s) {
  const t = s.trim().toLowerCase();
  return !(t === "" || t === "false" || t === "0" || t === "off" || t === "null" || t === "undefined");
}
var TOAST_SEVERITY = { info: "info", success: "success", warning: "warning", error: "error" };
var HANDLERS = {
  ...varHandlers("local"),
  ...varHandlers("global"),
  input: async (ctx, args, unnamed) => {
    const value = await ctx.host.input(str(unnamed), args.default !== undefined ? str(args.default) : "");
    return value ?? "";
  },
  if: async (ctx, args, unnamed, cmd) => {
    const left = await operand(ctx, cmd, "left", args.left);
    const right = await operand(ctx, cmd, "right", args.right);
    const rule = args.rule !== undefined ? str(args.rule).trim().toLowerCase() : "eq";
    const branch = compare(rule, left, right) ? unnamed : args.else ?? null;
    if (typeof branch === "string" && branch.trim().startsWith("/")) {
      const sub = parseScript(branch);
      const missing = unsupportedCommands(sub);
      if (missing.length)
        throw new ScriptError(`/if: \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBA85\uB839\uC5B4 ${missing.map((n) => "/" + n).join(", ")}`);
      return runValue(ctx, sub, "");
    }
    return runValue(ctx, branch, "");
  },
  abort: async (_ctx, args, unnamed) => {
    throw new ScriptAbort(str(unnamed), bool(args.quiet, true));
  },
  echo: async (ctx, args, unnamed) => {
    const text = str(unnamed);
    const kind = TOAST_SEVERITY[args.severity !== undefined ? str(args.severity).trim() : "info"] ?? "info";
    ctx.host.toast(kind, text);
    return text;
  },
  gen: async (ctx, args, unnamed) => {
    const as = args.as !== undefined && str(args.as).trim() === "char" ? "char" : "system";
    return ctx.host.gen(str(unnamed), { as });
  },
  genraw: async (ctx, args, unnamed) => {
    return ctx.host.genRaw(str(unnamed), { systemPrompt: args.system !== undefined ? str(args.system) : "" });
  },
  sendas: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim())
      await ctx.host.appendMessage("char", text);
    return text;
  },
  sys: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim())
      await ctx.host.appendMessage("system", text);
    return text;
  },
  comment: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim())
      await ctx.host.appendMessage("comment", text);
    return text;
  },
  send: async (ctx, _args, unnamed) => {
    const text = str(unnamed);
    if (text.trim())
      await ctx.host.appendMessage("user", text);
    return text;
  },
  trigger: async (ctx) => {
    await ctx.host.trigger();
    return "";
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
    await ctx.host.sleep(Math.max(0, Math.min(ms, 600000)));
    return "";
  },
  run: async (ctx, _args, unnamed) => {
    if (ctx.depth >= 10)
      throw new ScriptError("/run \uC774 \uB108\uBB34 \uAE4A\uAC8C \uC911\uCCA9\uB418\uC5C8\uC2B5\uB2C8\uB2E4 (10\uB2E8\uACC4 \uC81C\uD55C).");
    if (isClosure(unnamed))
      return runValue(ctx, unnamed, "");
    const target = str(unnamed).trim();
    let set = null;
    let label = target;
    const dot = target.indexOf(".");
    if (dot > 0) {
      set = target.slice(0, dot);
      label = target.slice(dot + 1);
    }
    const source = await ctx.host.findQuickReply(label, set);
    if (source === null)
      throw new ScriptError(`/run: Quick Reply "${target}" \uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.`);
    const script = parseScript(source);
    const missing = unsupportedCommands(script);
    if (missing.length)
      throw new ScriptError(`/run ${target}: \uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uBA85\uB839\uC5B4 ${missing.map((n) => "/" + n).join(", ")}`);
    try {
      return (await runClosure({ ...ctx, depth: ctx.depth + 1 }, script, "")).pipe;
    } catch (e) {
      if (e instanceof ReturnSignal)
        return e.value;
      throw e;
    }
  }
};

// src/backend.ts
var STORE_PATH = "quick-replies.json";
var COMPOSER_TIMEOUT_MS = 15000;
var running = new Map;
var pendingComposer = new Map;
var reqCounter = 0;
function send(payload, userId, frontendSessionId) {
  spindle.sendToFrontend(payload, userId, frontendSessionId ? { frontendSessionId } : undefined);
}
function normalizeSettings(v) {
  const s = v && typeof v === "object" ? v : {};
  return {
    showBar: typeof s.showBar === "boolean" ? s.showBar : DEFAULT_SETTINGS.showBar,
    genRole: s.genRole === "user" ? "user" : "system"
  };
}
function normalizeQr(v) {
  if (!v || typeof v !== "object")
    return null;
  const q = v;
  if (typeof q.id !== "string" || typeof q.message !== "string")
    return null;
  return {
    id: q.id,
    label: typeof q.label === "string" ? q.label : "",
    title: typeof q.title === "string" ? q.title : "",
    message: q.message,
    isHidden: q.isHidden === true
  };
}
function normalizeStore(v) {
  if (!v || typeof v !== "object")
    return emptyStore();
  const raw = v;
  const sets = [];
  for (const s of Array.isArray(raw.sets) ? raw.sets : []) {
    if (!s || typeof s !== "object" || typeof s.id !== "string")
      continue;
    sets.push({
      id: s.id,
      name: typeof s.name === "string" ? s.name : "",
      enabled: s.enabled !== false,
      disableSend: s.disableSend === true,
      placeBeforeInput: s.placeBeforeInput === true,
      injectInput: s.injectInput === true,
      color: typeof s.color === "string" ? s.color : null,
      qrs: (Array.isArray(s.qrs) ? s.qrs : []).map(normalizeQr).filter((q) => !!q)
    });
  }
  return { version: 1, sets, settings: normalizeSettings(raw.settings) };
}
async function loadStore(userId) {
  const raw = await spindle.userStorage.getJson(STORE_PATH, { fallback: null, userId });
  return normalizeStore(raw);
}
async function saveStore(userId, store) {
  const clean = normalizeStore(store);
  await spindle.userStorage.setJson(STORE_PATH, clean, { indent: 2, userId });
  return clean;
}
function lastText(result) {
  if (result && typeof result === "object" && typeof result.content === "string") {
    return result.content;
  }
  if (typeof result === "string")
    return result;
  return "";
}
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
function composerRequest(userId, sessionId, action, text) {
  const reqId = `c${++reqCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingComposer.delete(reqId);
      reject(new ScriptError("\uC785\uB825\uCC3D\uC774 \uC751\uB2F5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uCC44\uD305 \uD654\uBA74\uC774 \uC5F4\uB824 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694."));
    }, COMPOSER_TIMEOUT_MS);
    pendingComposer.set(reqId, { resolve, reject, timer });
    send({ type: "composer", reqId, action, text }, userId, sessionId);
  });
}
function makeHost(userId, chatId, sessionId, store, signal) {
  const needChat = () => {
    if (!chatId)
      throw new ScriptError("\uC5F4\uB824 \uC788\uB294 \uCC44\uD305\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uCC44\uD305\uC744 \uC5F0 \uB4A4 \uC2E4\uD589\uD558\uC138\uC694.");
    return chatId;
  };
  return {
    async resolveMacros(text) {
      const { text: out } = await spindle.macros.resolve(text, { chatId: chatId ?? undefined, userId });
      return out;
    },
    async input(prompt, defaultValue) {
      const short = prompt.trim().length > 0 && prompt.length <= 80 && !prompt.includes(`
`);
      const { value, cancelled } = await spindle.prompt.input({
        title: short ? prompt.trim() : "Quick Reply \uC785\uB825",
        message: short ? undefined : prompt,
        defaultValue,
        userId
      });
      return cancelled ? null : value ?? "";
    },
    toast(kind, text) {
      spindle.toast[kind](text, { userId });
    },
    async getVar(scope, key) {
      return scope === "local" ? spindle.variables.local.get(needChat(), key) : spindle.variables.global.get(key, userId);
    },
    async setVar(scope, key, value) {
      if (scope === "local")
        await spindle.variables.local.set(needChat(), key, value);
      else
        await spindle.variables.global.set(key, value, userId);
    },
    async hasVar(scope, key) {
      return scope === "local" ? spindle.variables.local.has(needChat(), key) : spindle.variables.global.has(key, userId);
    },
    async deleteVar(scope, key) {
      if (scope === "local")
        await spindle.variables.local.delete(needChat(), key);
      else
        await spindle.variables.global.delete(key, userId);
    },
    async gen(prompt, options) {
      const assembled = await spindle.generate.dryRun({ chatId: needChat() }, userId);
      const role = options.as === "char" ? "assistant" : store.settings.genRole;
      const messages = [...assembled.messages, { role, content: prompt }];
      const result = await spindle.generate.quiet({ type: "quiet", messages, userId, signal });
      const text = lastText(result);
      if (!text.trim())
        throw new ScriptError("/gen \uACB0\uACFC\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4. \uC5F0\uACB0 \uC124\uC815\uC774\uB098 \uBAA8\uB378 \uC751\uB2F5\uC744 \uD655\uC778\uD558\uC138\uC694.");
      return text;
    },
    async genRaw(prompt, options) {
      const messages = [
        ...options.systemPrompt ? [{ role: "system", content: options.systemPrompt }] : [],
        { role: "user", content: prompt }
      ];
      const text = lastText(await spindle.generate.quiet({ type: "quiet", messages, userId, signal }));
      if (!text.trim())
        throw new ScriptError("/genraw \uACB0\uACFC\uAC00 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.");
      return text;
    },
    async appendMessage(kind, text) {
      const id = needChat();
      const role = kind === "char" ? "assistant" : kind === "user" ? "user" : "system";
      const { id: messageId } = await spindle.chat.appendMessage(id, { role, content: text, metadata: { source: "st_quick_replies", kind } });
      if (kind === "comment")
        await spindle.chat.setMessageHidden(id, messageId, true);
    },
    async setInput(text) {
      await composerRequest(userId, sessionId, "set", text);
    },
    async trigger() {
      await composerRequest(userId, sessionId, "trigger");
    },
    async findQuickReply(label, setName) {
      for (const s of store.sets) {
        if (setName !== null && s.name !== setName)
          continue;
        const qr = s.qrs.find((q) => q.label === label);
        if (qr)
          return qr.message;
      }
      return null;
    },
    sleep: (ms) => sleep(ms, signal)
  };
}
function isScript(qr, set) {
  return qr.message.trimStart().startsWith("/") && !set.disableSend;
}
async function run(userId, sessionId, msg) {
  if (running.has(userId)) {
    spindle.toast.warning(`"${running.get(userId).label}" \uC2E4\uD589\uC774 \uB05D\uB09C \uB4A4 \uB2E4\uC2DC \uB20C\uB7EC \uC8FC\uC138\uC694.`, { userId });
    return;
  }
  const store = await loadStore(userId);
  const set = store.sets.find((s) => s.id === msg.setId);
  const qr = set?.qrs.find((q) => q.id === msg.qrId);
  if (!set || !qr) {
    spindle.toast.error("Quick Reply\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uBAA9\uB85D\uC744 \uC0C8\uB85C \uACE0\uCCD0 \uC8FC\uC138\uC694.", { userId });
    return;
  }
  if (!isScript(qr, set)) {
    const { text } = await spindle.macros.resolve(qr.message, { chatId: msg.chatId ?? undefined, userId });
    send({ type: "plain", action: { text, send: !set.disableSend, injectInput: set.injectInput, placeBeforeInput: set.placeBeforeInput } }, userId, sessionId);
    return;
  }
  const controller = new AbortController;
  const label = qr.label || qr.title || "Quick Reply";
  running.set(userId, { controller, label });
  send({ type: "running", running: true, label }, userId);
  try {
    const host = makeHost(userId, msg.chatId, sessionId, store, controller.signal);
    await runScript(qr.message, host, { signal: controller.signal });
  } catch (e) {
    if (e instanceof ScriptAbort) {
      if (!e.quiet && e.reason)
        spindle.toast.warning(e.reason, { userId });
      else if (controller.signal.aborted)
        spindle.toast.info("\uC2E4\uD589\uC744 \uC911\uC9C0\uD588\uC2B5\uB2C8\uB2E4.", { userId });
    } else if (controller.signal.aborted || e instanceof Error && e.name === "AbortError") {
      spindle.toast.info("\uC2E4\uD589\uC744 \uC911\uC9C0\uD588\uC2B5\uB2C8\uB2E4.", { userId });
    } else if (e instanceof ParseError) {
      spindle.toast.error(`\uC2A4\uD06C\uB9BD\uD2B8 \uBB38\uBC95 \uC624\uB958 (${e.index}\uBC88\uC9F8 \uAE00\uC790 \uADFC\uCC98): ${e.message}`, { userId, title: label });
    } else if (e instanceof ScriptError) {
      spindle.toast.error(e.message, { userId, title: label });
    } else {
      spindle.toast.error(e instanceof Error ? e.message : String(e), { userId, title: label });
      spindle.log.error(`[st-qr] ${label}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
  } finally {
    running.delete(userId);
    send({ type: "running", running: false }, userId);
  }
}
async function handle(payload, userId, sessionId) {
  switch (payload.type) {
    case "load": {
      send({ type: "store", store: await loadStore(userId) }, userId, sessionId);
      const r = running.get(userId);
      if (r)
        send({ type: "running", running: true, label: r.label }, userId, sessionId);
      return;
    }
    case "import": {
      const store = await loadStore(userId);
      const errors = [];
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
      send({ type: "store", store: await saveStore(userId, store) }, userId);
      send({ type: "import_result", added, errors }, userId, sessionId);
      return;
    }
    case "save_store":
      send({ type: "store", store: await saveStore(userId, payload.store) }, userId);
      return;
    case "run":
      await run(userId, sessionId, payload);
      return;
    case "stop":
      running.get(userId)?.controller.abort();
      return;
    case "notify":
      if (payload.kind === "info" || payload.kind === "warning" || payload.kind === "error") {
        spindle.toast[payload.kind](String(payload.text).slice(0, 500), { userId });
      }
      return;
    case "composer_result": {
      const p = pendingComposer.get(payload.reqId);
      if (!p)
        return;
      clearTimeout(p.timer);
      pendingComposer.delete(payload.reqId);
      if (payload.ok)
        p.resolve();
      else
        p.reject(new ScriptError(payload.error || "\uC785\uB825\uCC3D \uC791\uC5C5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."));
      return;
    }
  }
}
spindle.onFrontendMessage((payload, userId, frontendSessionId) => {
  if (!payload || typeof payload !== "object" || typeof payload.type !== "string")
    return;
  handle(payload, userId, frontendSessionId).catch((e) => {
    spindle.log.error(`[st-qr] ${payload.type}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    spindle.toast.error(e instanceof Error ? e.message : String(e), { userId });
  });
});
