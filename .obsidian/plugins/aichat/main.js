{
// _preamble.js


"use strict";
const obsidian = require("obsidian");

let __registeredInitCalls = [];
let __initRuntimeLog = [];
let __pendingInitEntries = [];
let __registeredInitsFlushed = false;
let __seenInitFns = /* @__PURE__ */ new Set();
let __ranInitFns = /* @__PURE__ */ new Set();
let __initEntryByName = /* @__PURE__ */ new Map();
let __aichatStartupComplete = false;
let AICHAT_STARTUP_LOG_PATH = "aichat/start.log";
let AICHAT_RUNTIME_ERROR_LOG_PATH = "aichat/lastErr.log";
let AICHAT_SCROLL_DEBUG_LOG_PATH = "aichat/scrollDebug.log";
let __vsCodeBottomMarginSmokeTargetStyles = /* @__PURE__ */ new WeakMap();
let __vsCodeBottomMarginSmokeHostStyles = /* @__PURE__ */ new WeakMap();
let __vsCodeBottomMarginSmokeChildStyles = /* @__PURE__ */ new WeakMap();
let __lastVsCodeScrollDebugSignature = "";
let __monacoDirectChildrenLogScheduled = false;
let __monacoDirectChildrenLogged = false;


async function appendStartupLogLine(line) {
  try {
    const app = typeof window !== "undefined" ? window.app : null;
    const adapter = app?.vault?.adapter;
    if (!adapter) return;
    if (typeof adapter.append === "function") {
      await adapter.append(AICHAT_STARTUP_LOG_PATH, `${line}\n`);
      return;
    }
    const exists = typeof adapter.exists === "function" ? await adapter.exists(AICHAT_STARTUP_LOG_PATH) : false;
    const prior = exists && typeof adapter.read === "function" ? await adapter.read(AICHAT_STARTUP_LOG_PATH) : "";
    await adapter.write(AICHAT_STARTUP_LOG_PATH, `${prior}${line}\n`);
  } catch {
  }
}

async function appendScrollDebugLogLine(line) {
  try {
    const app = typeof window !== "undefined" ? window.app : null;
    const adapter = app?.vault?.adapter;
    if (!adapter) return;
    if (typeof adapter.append === "function") {
      await adapter.append(AICHAT_SCROLL_DEBUG_LOG_PATH, `${line}\n`);
      return;
    }
    const exists = typeof adapter.exists === "function" ? await adapter.exists(AICHAT_SCROLL_DEBUG_LOG_PATH) : false;
    const prior = exists && typeof adapter.read === "function" ? await adapter.read(AICHAT_SCROLL_DEBUG_LOG_PATH) : "";
    await adapter.write(AICHAT_SCROLL_DEBUG_LOG_PATH, `${prior}${line}\n`);
  } catch {
  }
}

async function resetScrollDebugLog() {
  try {
    const app = typeof window !== "undefined" ? window.app : null;
    const adapter = app?.vault?.adapter;
    if (!adapter || typeof adapter.write !== "function") return;
    await adapter.write(AICHAT_SCROLL_DEBUG_LOG_PATH, `[${(/* @__PURE__ */ new Date()).toISOString()}] scroll debug reset\n`);
  } catch {
  }
}

function setAichatStartupComplete(value = true) {
  __aichatStartupComplete = value === true;
}

async function writeLatestRuntimeError(line) {
  try {
    const app = typeof window !== "undefined" ? window.app : null;
    const adapter = app?.vault?.adapter;
    if (!adapter) return;
    await adapter.write(AICHAT_RUNTIME_ERROR_LOG_PATH, `${line}\n`);
  } catch {
  }
}

function formatRuntimeErrorLine(message, context = "runtime") {
  const text = typeof message === "string" ? message : String(message || "unknown error");
  return `[${(/* @__PURE__ */ new Date()).toISOString()}] ${context} | ${text}`;
}

function routeAichatRuntimeError(message, context = "runtime") {
  const line = formatRuntimeErrorLine(message, context);
  if (__aichatStartupComplete) {
    void writeLatestRuntimeError(line);
  } else {
    void appendStartupLogLine(line);
  }
}

function __logInit(message) {
  const line = `[init] ${message}`;
  __initRuntimeLog.push(line);
  void appendStartupLogLine(line);
  try {
    console.log(line);
  } catch {
  }
}

function __normalizeInitName(rawName, initFn) {
  const explicit = typeof rawName === "string" ? rawName.trim() : "";
  if (explicit) return explicit;
  const inferred = typeof initFn?.name === "string" ? initFn.name.trim() : "";
  return inferred || "(anonymous init)";
}

function __normalizeInitDeps(rawDeps, selfName) {
  if (!Array.isArray(rawDeps)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const dep of rawDeps) {
    if (typeof dep !== "string") continue;
    const name = dep.trim();
    if (!name || name === selfName || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function __normalizeInitRegistration(a, b, c) {
  let initFn = null;
  let name = "";
  let deps = [];

  if (typeof a === "function") {
    initFn = a;
  } else if (typeof a === "string" && typeof b === "function") {
    initFn = b;
    name = a;
    deps = c;
  }

  if (typeof initFn !== "function") return null;
  const normalizedName = __normalizeInitName(name, initFn);
  return {
    initFn,
    name: normalizedName,
    deps: __normalizeInitDeps(deps, normalizedName)
  };
}

function __indexInitEntry(entry) {
  if (!entry?.name || entry.name === "(anonymous init)") return;
  const existing = __initEntryByName.get(entry.name);
  if (!existing) {
    __initEntryByName.set(entry.name, entry);
    return;
  }
  if (existing.initFn !== entry.initFn) {
    throw new Error(`registerInit duplicate name "${entry.name}" for different init functions.`);
  }
}

function __runInitEntry(entry, stack) {
  if (!entry || typeof entry.initFn !== "function") return;
  if (__ranInitFns.has(entry.initFn)) return;

  const name = entry.name || __normalizeInitName("", entry.initFn);
  if (stack.includes(name)) {
    const cycle = [...stack, name].join(" -> ");
    throw new Error(`registerInit dependency cycle detected: ${cycle}`);
  }

  const nextStack = [...stack, name];
  for (const depName of entry.deps) {
    const depEntry = __initEntryByName.get(depName);
    if (!depEntry) {
      throw new Error(`registerInit dependency "${depName}" for "${name}" was not registered.`);
    }
    __runInitEntry(depEntry, nextStack);
  }

  const depSuffix = entry.deps.length > 0 ? ` deps=[${entry.deps.join(", ")}]` : "";
  __logInit(`before unit \"${name}\"${depSuffix}`);
  __ranInitFns.add(entry.initFn);
  try {
    __logInit(`during unit \"${name}\" (invoking)`);
    entry.initFn();
    __logInit(`after unit \"${name}\" (ok)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    __logInit(`after unit \"${name}\" (error: ${msg})`);
    throw error;
  }
}

function __orderInitEntries(entries) {
  const ordered = [];
  const temp = /* @__PURE__ */ new Set();
  const done = /* @__PURE__ */ new Set();

  function visit(entry, stack) {
    if (!entry || typeof entry.initFn !== "function") return;
    const fn = entry.initFn;
    if (done.has(fn)) return;
    if (temp.has(fn)) {
      const name = entry.name || __normalizeInitName("", fn);
      const cycle = [...stack, name].join(" -> ");
      throw new Error(`registerInit dependency cycle detected: ${cycle}`);
    }

    const name = entry.name || __normalizeInitName("", fn);
    temp.add(fn);
    const nextStack = [...stack, name];
    for (const depName of entry.deps) {
      const depEntry = __initEntryByName.get(depName);
      if (!depEntry) {
        throw new Error(`registerInit dependency "${depName}" for "${name}" was not registered.`);
      }
      visit(depEntry, nextStack);
    }
    temp.delete(fn);
    done.add(fn);
    ordered.push(entry);
  }

  for (const entry of entries) {
    visit(entry, []);
  }

  return ordered;
}

function registerInit(a, b, c) {
  const entry = __normalizeInitRegistration(a, b, c);
  if (!entry) return;
  if (__seenInitFns.has(entry.initFn)) return;

  __seenInitFns.add(entry.initFn);
  __indexInitEntry(entry);

  const depSuffix = entry.deps.length > 0 ? ` deps=[${entry.deps.join(", ")}]` : "";
  const callLabel = `${entry.name}${depSuffix}`;
  __registeredInitCalls.push(callLabel);
  __logInit(`registered ${callLabel}`);

  if (__registeredInitsFlushed) {
    __logInit(`flush already complete; running immediately ${entry.name}`);
    return __runInitEntry(entry, []);
  }
  __pendingInitEntries.push(entry);
}

function runRegisteredInits() {
  if (__registeredInitsFlushed) return;
  __registeredInitsFlushed = true;
  const entries = __pendingInitEntries.slice();
  __pendingInitEntries.length = 0;
  __logInit(`runRegisteredInits start pending=${entries.length}`);
  const ordered = __orderInitEntries(entries);
  __logInit(`runRegisteredInits ordered=${ordered.map((e) => e.name).join(", ")}`);
  for (const entry of ordered) {
    __runInitEntry(entry, []);
  }
  __logInit("runRegisteredInits done");
}

function __findVsCodeEditorPaneTarget() {
  if (typeof document === "undefined") return null;
  const selectors = [
    ".monaco-editor .overflow-guard"
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return { element, selector };
    }
  }
  return null;
}

function __findVsCodeScrollHost(element) {
  let node = element?.parentElement || null;
  while (node) {
    if (node.classList?.contains("view-content")) return node;
    node = node.parentElement;
  }
  return null;
}

function __describeElementForScrollDebug(element) {
  if (!element) return "(null)";
  const tag = String(element.tagName || "?").toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.isArray(element.className?.split?.(" "))
    ? element.className.split(" ").map((x) => x.trim()).filter(Boolean).slice(0, 3).join(".")
    : "";
  const classPart = classes ? `.${classes}` : "";
  return `${tag}${id}${classPart}`;
}

function __logMonacoDirectDivChildren(target) {
  // logging disabled temporarily
}

function __collectVsCodeScrollAncestors(element) {
  if (!element || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return [];
  const rows = [];
  let node = element;
  let depth = 0;

  while (node && depth < 14) {
    const style = window.getComputedStyle(node);
    const overflowY = style?.overflowY || "";
    const overflow = style?.overflow || "";
    const scrollHeight = Number(node.scrollHeight || 0);
    const clientHeight = Number(node.clientHeight || 0);
    const delta = scrollHeight - clientHeight;
    const allowsScroll = /auto|scroll|overlay/.test(`${overflowY} ${overflow}`);
    const hasVerticalOverflow = delta > 1;

    rows.push({
      depth,
      element: node,
      label: __describeElementForScrollDebug(node),
      overflowY,
      overflow,
      scrollHeight,
      clientHeight,
      delta,
      allowsScroll,
      hasVerticalOverflow
    });

    node = node.parentElement;
    depth += 1;
  }

  const scrolling = document.scrollingElement;
  if (scrolling && rows.every((x) => x.element !== scrolling)) {
    const style = window.getComputedStyle(scrolling);
    const overflowY = style?.overflowY || "";
    const overflow = style?.overflow || "";
    const scrollHeight = Number(scrolling.scrollHeight || 0);
    const clientHeight = Number(scrolling.clientHeight || 0);
    const delta = scrollHeight - clientHeight;
    const allowsScroll = /auto|scroll|overlay/.test(`${overflowY} ${overflow}`);
    const hasVerticalOverflow = delta > 1;
    rows.push({
      depth: rows.length,
      element: scrolling,
      label: __describeElementForScrollDebug(scrolling),
      overflowY,
      overflow,
      scrollHeight,
      clientHeight,
      delta,
      allowsScroll,
      hasVerticalOverflow
    });
  }

  return rows;
}

function __logVsCodeScrollDebug(target, phaseLabel) {
  // logging disabled temporarily
}

function __rememberVsCodeSmokeTargetStyles(element) {
  if (!element || __vsCodeBottomMarginSmokeTargetStyles.has(element)) return;
  __vsCodeBottomMarginSmokeTargetStyles.set(element, {
    marginBottom: element.style.marginBottom,
    overflowY: element.style.getPropertyValue("overflow-y"),
    overflowYPriority: element.style.getPropertyPriority("overflow-y")
  });
}

function __restoreVsCodeSmokeTargetStyles(element) {
  if (!element) return;
  const prior = __vsCodeBottomMarginSmokeTargetStyles.get(element);
  if (prior) {
    element.style.marginBottom = prior.marginBottom || "";
    element.style.setProperty("overflow-y", prior.overflowY || "", prior.overflowYPriority || "");
    __vsCodeBottomMarginSmokeTargetStyles.delete(element);
    return;
  }
  element.style.marginBottom = "";
  element.style.removeProperty("overflow-y");
}

function __rememberVsCodeSmokeHostStyles(element) {
  if (!element || __vsCodeBottomMarginSmokeHostStyles.has(element)) return;
  __vsCodeBottomMarginSmokeHostStyles.set(element, {
    overflowY: element.style.getPropertyValue("overflow-y"),
    overflowYPriority: element.style.getPropertyPriority("overflow-y")
  });
}

function __restoreVsCodeSmokeHostStyles(element) {
  if (!element) return;
  const prior = __vsCodeBottomMarginSmokeHostStyles.get(element);
  if (prior) {
    element.style.setProperty("overflow-y", prior.overflowY || "", prior.overflowYPriority || "");
    __vsCodeBottomMarginSmokeHostStyles.delete(element);
    return;
  }
  element.style.removeProperty("overflow-y");
}

function __rememberVsCodeSmokeChildStyles(children) {
  for (const child of children || []) {
    if (!child || __vsCodeBottomMarginSmokeChildStyles.has(child)) continue;
    __vsCodeBottomMarginSmokeChildStyles.set(child, {
      marginBottom: child.style.marginBottom
    });
  }
}

function __restoreVsCodeSmokeChildStyles(children) {
  for (const child of children || []) {
    if (!child) continue;
    const prior = __vsCodeBottomMarginSmokeChildStyles.get(child);
    if (prior) {
      child.style.marginBottom = prior.marginBottom || "";
      __vsCodeBottomMarginSmokeChildStyles.delete(child);
      continue;
    }
    child.style.marginBottom = "";
  }
}

function stopVsCodeBottomMarginSmokeTest() {
  const handle = globalThis.__vsCodeBottomMarginSmokeTestHandle;
  if (handle) {
    clearInterval(handle);
    globalThis.__vsCodeBottomMarginSmokeTestHandle = null;
  }

  const childLogTimeout = globalThis.__vsCodeMonacoChildLogTimeoutHandle;
  if (childLogTimeout) {
    clearTimeout(childLogTimeout);
    globalThis.__vsCodeMonacoChildLogTimeoutHandle = null;
  }
  __monacoDirectChildrenLogScheduled = false;

  const target = __findVsCodeEditorPaneTarget();
  if (target?.element) {
    const children = Array.from(target.element.children || []);
    __restoreVsCodeSmokeChildStyles(children);
    __restoreVsCodeSmokeTargetStyles(target.element);
    const host = __findVsCodeScrollHost(target.element);
    if (host) __restoreVsCodeSmokeHostStyles(host);
  }

  // console logging disabled temporarily
}

function startVsCodeBottomMarginSmokeTest() {
  stopVsCodeBottomMarginSmokeTest();
  __lastVsCodeScrollDebugSignature = "";
  __monacoDirectChildrenLogged = false;
  __monacoDirectChildrenLogScheduled = false;
  void resetScrollDebugLog();
  let on = false;

  const safeSetInterval = typeof window !== "undefined" && typeof window.setInterval === "function" ? window.setInterval.bind(window) : null;
  const safeSetTimeout = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout.bind(window) : null;
  if (!safeSetInterval) return;

  const handle = safeSetInterval(() => {
    const target = __findVsCodeEditorPaneTarget();
    if (!target?.element) {
      return;
    }

    if (!__monacoDirectChildrenLogged && !__monacoDirectChildrenLogScheduled && safeSetTimeout) {
      __monacoDirectChildrenLogScheduled = true;
      globalThis.__vsCodeMonacoChildLogTimeoutHandle = safeSetTimeout(() => {
        const currentTarget = __findVsCodeEditorPaneTarget();
        if (currentTarget?.element) {
          __logMonacoDirectDivChildren(currentTarget);
        } else {
          // logging disabled temporarily
        }
        __monacoDirectChildrenLogged = true;
        __monacoDirectChildrenLogScheduled = false;
        globalThis.__vsCodeMonacoChildLogTimeoutHandle = null;
      }, 5000);
    }

    __rememberVsCodeSmokeTargetStyles(target.element);
    target.element.style.setProperty("overflow-y", "hidden", "important");

    const host = __findVsCodeScrollHost(target.element);
    if (host) {
      __rememberVsCodeSmokeHostStyles(host);
      host.style.setProperty("overflow-y", "hidden", "important");
    }

    on = !on;
    // target.element.style.marginBottom = on ? "180px" : "0px";

    const children = Array.from(target.element.children || []);
    __rememberVsCodeSmokeChildStyles(children);
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!child) continue;
      // child.style.marginBottom = on ? `${20 + i * 25}px` : "0px";
    }

    // logging disabled temporarily
  }, 1000);

  globalThis.__vsCodeBottomMarginSmokeTestHandle = handle;
  globalThis.__stopVsCodeBottomMarginSmokeTest = stopVsCodeBottomMarginSmokeTest;
}

// startVsCodeBottomMarginSmokeTest();




function declareExports(symbols) {
  if (!symbols || typeof symbols !== "object") {
    throw new Error("declareExports expected an object map of exports.");
  }

  for (const [symbolName, symbol] of Object.entries(symbols)) {
    globalThis[symbolName] = symbol;
  }
}

function declareNamespace(namespaceName) {
  const name = String(namespaceName || "").trim();
  if (!name) {
    throw new Error("declareNamespace expected a non-empty namespace name.");
  }

  const existing = globalThis[name];

  // Fail hard if the symbol already exists but is not a namespace object.
  if (existing !== undefined && (typeof existing !== "object" || existing === null)) {
    throw new Error(`declareNamespace collision: global "${name}" already exists and is not an object.`);
  }

  const ns = existing || {};
  if (existing === undefined) {
    globalThis[name] = ns;
  }

  // Keep one reserved member: export.
  if (ns.export !== undefined && typeof ns.export !== "function") {
    throw new Error(`declareNamespace collision: "${name}.export" already exists and is not a function.`);
  }

  ns.__name = name;

  ns.export = function(symbol) {
    if (typeof symbol !== "function") {
      throw new Error("namespace.export expected a named function or class.");
    }
    const symbolName = String(symbol.name || "").trim();
    if (!symbolName) {
      throw new Error("namespace.export expected a named function or class.");
    }
    ns[symbolName] = symbol;
    return symbol;
  };

  return ns;
}



declareExports({
  obsidian,
  appendStartupLogLine,
  setAichatStartupComplete,
  routeAichatRuntimeError,
  registerInit,
  runRegisteredInits,
  startVsCodeBottomMarginSmokeTest,
  stopVsCodeBottomMarginSmokeTest,
  declareExports,
  declareNamespace
});

}

{
// src/agent/ChatPayload.js
class ChatPayload {
  constructor(bodyObj, provider = "", model = "") {
    this.bodyObj = bodyObj;
    this.bodyJson = JSON.stringify(bodyObj ?? {});
    this.provider = String(provider || "");
    this.model = String(model || "");
  }

  get charCount() {
    return this.bodyJson.length;
  }

  get byteCount() {
    try {
      return new TextEncoder().encode(this.bodyJson).length;
    } catch {
      return 0;
    }
  }
}

declareExports({
  ChatPayload
});

}

{
// src/agent/chatFileCache.js
function isRecordCfc(value) {
  return typeof value === "object" && value !== null;
}

class ChatFileCache {
  constructor() {
    this.entriesByPath = new Map();
    this.invalidatedPaths = new Set();
  }

  has(path) {
    return this.entriesByPath.has(path);
  }

  get(path) {
    return this.entriesByPath.get(path) || null;
  }

  set(path, entry) {
    if (!path) return;
    const normalizedPath = obsidian.normalizePath(String(path).trim());
    if (!normalizedPath) return;
    this.entriesByPath.set(normalizedPath, entry || null);
    this.invalidatedPaths.delete(normalizedPath);
  }

  remove(path) {
    if (!path) return false;
    const normalizedPath = obsidian.normalizePath(String(path).trim());
    if (!normalizedPath) return false;
    this.invalidatedPaths.add(normalizedPath);
    return this.entriesByPath.delete(normalizedPath);
  }

  clear() {
    this.entriesByPath.clear();
    this.invalidatedPaths.clear();
  }

  clearInvalidations() {
    this.invalidatedPaths.clear();
  }

  listPaths() {
    return Array.from(this.entriesByPath.keys());
  }

  truncateUtf8ToBytes(value, maxBytes) {
    const raw = String(value || "");
    if (maxBytes <= 0 || raw.length === 0) return "";
    const enc = new TextEncoder();
    if (enc.encode(raw).length <= maxBytes) return raw;
    let out = raw;
    while (out.length > 0 && enc.encode(out).length > maxBytes) {
      out = out.slice(0, Math.max(0, out.length - 1));
    }
    return out;
  }

  buildSystemMessagesFromEntries(entries, options = {}) {
    const truncateBytes = typeof options.truncateBytes === "number" ? options.truncateBytes : 0;
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return [];
    const out = [];
    for (const entry of list) {
      if (!isRecordCfc(entry)) continue;
      const filename = typeof entry.filename === "string" ? entry.filename.trim() : "";
      if (!filename) continue;
      const rawContent = typeof entry.content === "string" ? entry.content : "";
      const content = truncateBytes > 0
        ? this.truncateUtf8ToBytes(rawContent, truncateBytes)
        : rawContent;
      const escapedPath = filename.replace(/"/g, "&quot;");
      out.push({
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: `<cached_file path="${escapedPath}">\n${content}\n</cached_file>`
          }
        ]
      });
    }
    return out;
  }


  isReadFileElidedPayload(content) {
    if (typeof content !== "string" || !content) return false;
    try {
      const parsed = JSON.parse(content);
      return isRecordCfc(parsed) && parsed.type === "read_file_elided";
    } catch {
      return false;
    }
  }

  extractWrappedReadFilePath(content) {
    const text = typeof content === "string" ? content : "";
    if (!text.startsWith("[read_file]")) return "";
    const match = text.match(/^path:\s*(.+)$/m);
    return match && typeof match[1] === "string" ? match[1].trim() : "";
  }

  extractWrappedReadFileContent(content) {
    const text = typeof content === "string" ? content : "";
    if (!text.startsWith("[read_file]")) return "";
    const splitAt = text.indexOf("\n\n");
    if (splitAt === -1) return "";
    return text.slice(splitAt + 2);
  }

  async buildEntriesForRequest(messages, maxAgeTurns = 0, app = null) {
    const entries = [];
    const invalidated = this.invalidatedPaths;
    for (const [path, value] of this.entriesByPath.entries()) {
      if (invalidated.has(path)) continue;
      if (!isRecordCfc(value)) continue;
      const filename = typeof path === "string" ? obsidian.normalizePath(path.trim()) : "";
      if (!filename) continue;
      if (!app || !app.vault || typeof app.vault.getAbstractFileByPath !== "function" || typeof app.vault.cachedRead !== "function") continue;
      try {
        let content = typeof value.payload === "string" ? value.payload : "";
        if (!content) {
          const file = app.vault.getAbstractFileByPath(filename);
          if (!(file instanceof obsidian.TFile)) continue;
          content = String(await app.vault.cachedRead(file) || "");
        }
        entries.push({ filename, content });
      } catch {
      }
    }
    return entries;
  }

  buildCurrentPathSet(messages, maxAgeTurns = 0) {
    const out = new Set();
    const invalidated = this.invalidatedPaths;
    for (const [path, value] of this.entriesByPath.entries()) {
      if (!path || !isRecordCfc(value)) continue;
      const normalizedPath = obsidian.normalizePath(path);
      if (invalidated.has(normalizedPath)) continue;
      out.add(normalizedPath);
    }
    return out;
  }

  async applyExternalMutationInvalidationGuard(app, onRemoveEntry) {
    let scanned = 0;
    let invalidated = 0;
    for (const [path, value] of this.entriesByPath.entries()) {
      if (!path || !isRecordCfc(value)) continue;
      scanned += 1;
      const normalizedPath = obsidian.normalizePath(path);
      const observedMtimeMs = typeof value.observedMtimeMs === "number" ? value.observedMtimeMs : NaN;
      const observedSize = typeof value.observedSize === "number" ? value.observedSize : NaN;
      try {
        const stat = await app.vault.adapter.stat(normalizedPath);
        const currentMtimeMs = typeof stat?.mtime === "number" ? stat.mtime : NaN;
        const currentSize = typeof stat?.size === "number" ? stat.size : NaN;
        if (Number.isFinite(observedMtimeMs) && Number.isFinite(observedSize) && Number.isFinite(currentMtimeMs) && Number.isFinite(currentSize)) {
          if (observedMtimeMs !== currentMtimeMs || observedSize !== currentSize) {
            if (typeof onRemoveEntry === "function") {
              onRemoveEntry(normalizedPath, "external_mutation");
            }
            invalidated += 1;
          }
        } else {
          this.entriesByPath.set(normalizedPath, {
            ...value,
            observedMtimeMs: Number.isFinite(currentMtimeMs) ? currentMtimeMs : null,
            observedSize: Number.isFinite(currentSize) ? currentSize : null
          });
        }
      } catch {
        if (typeof onRemoveEntry === "function") {
          onRemoveEntry(normalizedPath, "external_mutation");
        }
        invalidated += 1;
      }
    }
    return { scanned, invalidated };
  }

  async refreshPath(app, path, userTurnIndex) {
    const normalized = typeof path === "string" ? obsidian.normalizePath(path.trim()) : "";
    if (!normalized) return false;
    try {
      const file = app.vault.getFileByPath(normalized);
      if (!file) return false;
      const raw = await app.vault.cachedRead(file);
      const stat = await app.vault.adapter.stat(normalized);
      const observedMtimeMs = typeof stat?.mtime === "number" ? stat.mtime : null;
      const observedSize = typeof stat?.size === "number" ? stat.size : null;
      this.entriesByPath.set(normalized, {
        payload: String(raw || ""),
        lastSeenTurn: userTurnIndex,
        observedMtimeMs,
        observedSize
      });
      this.invalidatedPaths.delete(normalized);
      return true;
    } catch {
      return false;
    }
  }

  resolveEditToolPath(app, stepInput, getActiveFilePath) {
    if (isRecordCfc(stepInput) && typeof stepInput.path === "string" && stepInput.path.trim()) {
      return obsidian.normalizePath(stepInput.path.trim());
    }
    return typeof getActiveFilePath === "function" ? String(getActiveFilePath(app) || "") : "";
  }

  withEditPrecondition(app, stepInput, getActiveFilePath) {
    if (!isRecordCfc(stepInput)) return stepInput;
    const targetPath = this.resolveEditToolPath(app, stepInput, getActiveFilePath);
    if (!targetPath) return stepInput;
    if (this.invalidatedPaths.has(targetPath)) return stepInput;

    const cacheEntry = this.entriesByPath.get(targetPath);
    if (!isRecordCfc(cacheEntry)) return stepInput;

    const observedMtimeMs = typeof cacheEntry.observedMtimeMs === "number" ? cacheEntry.observedMtimeMs : NaN;
    const observedSize = typeof cacheEntry.observedSize === "number" ? cacheEntry.observedSize : NaN;
    if (!Number.isFinite(observedMtimeMs) || !Number.isFinite(observedSize)) return stepInput;

    return {
      ...stepInput,
      __cfc_precondition: {
        path: targetPath,
        observedMtimeMs,
        observedSize
      }
    };
  }
}

declareExports({
  ChatFileCache
});
}

{
// src/agent/context.js

function buildContext(app) {
  const activeFile = app.workspace.getActiveFile();
  let activeFileContent = null;
  let selection = null;
  const editor = app.workspace.activeEditor?.editor;
  if (editor) {
    const sel = editor.getSelection();
    if (sel && sel.length > 0) {
      selection = sel;
    }
  }
  return {
    activeFile: activeFile?.path ?? null,
    activeFileContent,
    // Populated lazily by the loop if needed
    selection,
    vaultName: app.vault.getName(),
    fileCount: app.vault.getMarkdownFiles().length
  };
}

declareExports({
  buildContext
});


}

{
// src/agent/efficiencyLog.js
class EfficiencyLog {
  static safeJsonLength(value) {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  static get PATH() {
    return "aichat/efficiency.log";
  }

  static get MAX_BYTES() {
    return 32768;
  }

  static get TRIM_TO_BYTES() {
    return 28672;
  }

  static summarizeToolInput(toolName, input) {
    const summary = {
      inputChars: EfficiencyLog.safeJsonLength(input)
    };
    if (!isRecord6(input)) return summary;

    if (typeof input.path === "string" && input.path) {
      summary.path = input.path;
    }
    if (typeof input.new_path === "string" && input.new_path) {
      summary.newPath = input.new_path;
    }
    if (typeof input.content === "string") {
      summary.contentChars = input.content.length;
    }
    if (typeof input.query === "string") {
      summary.queryChars = input.query.length;
      summary.query = input.query;
    }
    if (typeof input.match === "string") {
      summary.match = input.match;
    }
    if (typeof input.extract === "string") {
      summary.extract = input.extract;
    }
    if (Array.isArray(input.commands)) {
      summary.commandCount = input.commands.length;
    }
    if (typeof input.command === "string") {
      summary.commandChars = input.command.length;
    }
    if (toolName === "flush") {
      summary.flushAll = input.all === true;
    }

    return summary;
  }

  static summarizeToolResult(toolName, stepInput, result) {
    const summary = {
      isError: !!result?.isError
    };
    const resultText = typeof result?.result === "string" ? result.result : JSON.stringify(result?.result ?? "");
    summary.resultChars = typeof resultText === "string" ? resultText.length : 0;

    if (toolName === "read_file" || toolName === "search_read" || toolName === "snippets") {
      const path = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
      if (path) summary.path = path;
      summary.readBytes = typeof resultText === "string" ? new TextEncoder().encode(resultText).length : 0;
    }

    if (toolName === "edit_file" || toolName === "create_file") {
      const contentChars = isRecord6(stepInput) && typeof stepInput.content === "string" ? stepInput.content.length : 0;
      summary.writeChars = contentChars;
    }

    if (toolName === "rename_file") {
      if (isRecord6(stepInput) && typeof stepInput.path === "string") summary.path = stepInput.path;
      if (isRecord6(stepInput) && typeof stepInput.new_path === "string") summary.newPath = stepInput.new_path;
    }

    return summary;
  }

  static tailByUtf8Bytes(text, maxBytes) {
    const raw = String(text || "");
    if (maxBytes <= 0 || !raw) return "";
    let out = raw;
    while (out && new TextEncoder().encode(out).length > maxBytes) {
      out = out.slice(Math.ceil(out.length * 0.5));
    }
    return out;
  }

  static async trim(app) {
    try {
      const adapter = app.vault.adapter;
      const raw = await adapter.read(EfficiencyLog.PATH);
      const bytes = new TextEncoder().encode(raw).length;
      if (bytes <= EfficiencyLog.MAX_BYTES) return;

      let trimmed = EfficiencyLog.tailByUtf8Bytes(raw, EfficiencyLog.TRIM_TO_BYTES);
      const firstNewline = trimmed.indexOf("\n");
      if (firstNewline >= 0 && firstNewline < trimmed.length - 1) {
        trimmed = trimmed.slice(firstNewline + 1);
      }
      await adapter.write(EfficiencyLog.PATH, trimmed);
    } catch {
    }
  }

  static async append(app, entry) {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        ...entry
      };
      await app.vault.adapter.append(EfficiencyLog.PATH, `${JSON.stringify(payload)}\n`);
    } catch {
    }
  }

  static init() {
    "use strict";
  }
}

registerInit("efficiency", EfficiencyLog.init);

declareExports({
  EfficiencyLog
});


}

{
// src/agent/includer.js
const AGENTS_CONTEXT_MAX_CHARS = 120000;


class Includer {
  constructor(app, options = {}) {
    this.app = app;
    this.maxChars = typeof options.maxChars === "number" && options.maxChars > 0
      ? options.maxChars
      : AGENTS_CONTEXT_MAX_CHARS;
  }

  static async loadAgentsContext(app) {
    const includer = new Includer(app);
    return await includer.loadAgentsContext();
  }

  normalizeHeadingLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  parseIncludeSpec(spec) {
    const raw = String(spec || "").trim();
    if (!raw) return { path: "", heading: "" };
    const hashIdx = raw.indexOf("#");
    if (hashIdx === -1) return { path: raw, heading: "" };
    return {
      path: raw.substring(0, hashIdx).trim(),
      heading: raw.substring(hashIdx + 1).trim()
    };
  }

  resolveIncludePath(targetPath, fromPath, vaultName) {
    let p = String(targetPath || "").trim();
    if (!p) return "";
    if (p.startsWith("/")) {
      const marker = `/${vaultName}/`;
      const idx = p.indexOf(marker);
      if (idx !== -1) {
        p = p.substring(idx + marker.length);
      } else {
        p = p.replace(/^\/+/, "");
      }
      return obsidian.normalizePath(p);
    }
    const from = obsidian.normalizePath(fromPath || "");
    const slash = from.lastIndexOf("/");
    const baseDir = slash === -1 ? "" : from.substring(0, slash);
    return obsidian.normalizePath(baseDir ? `${baseDir}/${p}` : p);
  }

  extractMarkdownHeadingSection(content, headingLabel) {
    const target = this.normalizeHeadingLabel(headingLabel);
    if (!target) return null;
    const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (!m) continue;
      if (this.normalizeHeadingLabel(m[2]) === target) {
        start = i;
        level = m[1].length;
        break;
      }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+/);
      if (!m) continue;
      if (m[1].length <= level) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }

  async expandIncludes(content, fromPath, stack) {
    const adapter = this.app.vault.adapter;
    const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    for (const line of lines) {
      const m = line.match(/^\s*\{#(?:include|incude)\s+(.+?)\}\s*$/i);
      if (!m) {
        out.push(line);
        continue;
      }

      const parsed = this.parseIncludeSpec(m[1]);
      const includePath = this.resolveIncludePath(parsed.path, fromPath, this.app.vault.getName());
      if (!includePath) {
        out.push("[AGENTS include error: missing include path]");
        continue;
      }
      if (stack.includes(includePath)) {
        out.push(`[AGENTS include skipped: recursive include ${includePath}]`);
        continue;
      }

      let included = "";
      try {
        included = await adapter.read(includePath);
      } catch {
        out.push(`[AGENTS include error: could not read ${includePath}]`);
        continue;
      }

      if (parsed.heading) {
        const section = this.extractMarkdownHeadingSection(included, parsed.heading);
        if (!section) {
          out.push(`[AGENTS include error: heading not found in ${includePath}: ${parsed.heading}]`);
          continue;
        }
        included = section;
      }

      const nested = await this.expandIncludes(included, includePath, [...stack, includePath]);
      out.push(nested);
    }
    return out.join("\n");
  }

  async loadAgentsContext() {
    const adapter = this.app.vault.adapter;
    const pathFile = `${this.app.vault.configDir}/plugins/aichat/agents-path.txt`;
    let configuredPath = "";
    try {
      configuredPath = (await adapter.read(pathFile)).trim();
    } catch {
      configuredPath = "";
    }
    if (!configuredPath) return "";

    try {
      const content = await adapter.read(configuredPath);
      if (!content || content.trim().length === 0) return "";

      let expanded = await this.expandIncludes(content, configuredPath, [configuredPath]);
      if (expanded.length > this.maxChars) {
        expanded = `${expanded.slice(0, this.maxChars)}\n[AGENTS include note: content truncated to ${this.maxChars} chars]`;
      }
      return [
        `[Project instructions loaded from ${configuredPath}]`,
        expanded,
        `[End project instructions]`
      ].join("\n");
    } catch {
      return "";
    }
  }
}

declareExports({
  Includer
});

}

{
// src/agent/loop.js
registerInit("client", init_client, ["anthropic", "openai", "chatgpt_oauth"]);
registerInit("openai", init_openai);
registerInit("chatgpt_oauth", init_chatgpt_oauth, ["types", "chatgptOAuth"]);

const MAX_CONVERSATION_LENGTH = 40;
const KEEP_RECENT = 30;

// src/agent/loop.ts
let AgentLoop = class {
  messages = [];
  app;
  settings;
  includer;
  aborted = false;
  cfc = new ChatFileCache();
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.includer = new Includer(app);
    void loadSystemPrompt(app);
  }
  cfcRemoveEntry(entryName, reason, callbacks = null) {
    const rawName = typeof entryName === "string" ? entryName.trim() : "";
    if (!rawName) return false;

    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText) {
      throw new Error("cfcRemoveEntry requires a non-empty reason");
    }

    const normalizedName = obsidian.normalizePath(rawName);
    const existed = this.cfc.remove(normalizedName);

    if (callbacks && typeof callbacks.onResponse === "function") {
      callbacks.onResponse(`\\-&nbsp;${normalizedName}`);
    }
    return existed;
  }

  cfcRemoveAll(reason, callbacks = null) {
    const reasonText = typeof reason === "string" ? reason.trim() : "";
    if (!reasonText) {
      throw new Error("cfcRemoveAll requires a non-empty reason");
    }

    const names = this.cfc.listPaths();
    for (const name of names) {
      this.cfcRemoveEntry(name, reasonText, callbacks);
    }
    this.cfc.clearInvalidations();
  }

  clearCfc(reason = "other", callbacks = null) {
    this.cfcRemoveAll(reason, callbacks);
    let reasonText = "for an internal reset";
    if (reason === "flush") {
      reasonText = "by a flush command";
    } else if (reason === "auto") {
      reasonText = "automatically due to cache policy";
    } else if (typeof reason === "string" && reason.trim().length > 0 && reason !== "other") {
      reasonText = `by something else (${reason.trim()})`;
    }
    if (callbacks && typeof callbacks.onResponse === "function") {
      callbacks.onResponse(`CFC cleared ${reasonText}.`);
    }
  }

  onTurnEnd(reason, callbacks = null, options = {}) {
    if (reason) {
      this.cfcRemoveAll(reason, callbacks);
    }
    if (options?.clearOpenAIState === true && this.settings.provider === "openai") {
      clearOpenAIState();
    }
  }
  /** Abort a running loop (e.g. user navigates away) */
  abort() {
    this.aborted = true;
    if (this.settings.provider === "openai") {
      clearOpenAIState();
    }
  }
  /** Clear conversation history */
  clear() {
    this.messages = [];
    this.aborted = false;
    this.clearCfc("clear");
    clearOpenAIState();
    clearChatGPTOAuthState();
  }
  /** Export API messages for persistence */
  exportMessages() {
    return this.messages;
  }
  /** Restore API messages from persistence */
  importMessages(messages) {
    this.messages = messages;
  }
  /** Export the full conversation as a readable markdown transcript */
  exportTranscript() {
    const systemPrompt = buildSystemPrompt();
    const parts = [
      `# AI Chat Transcript`,
      ``,
      `**Date:** ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `**Provider:** ${this.settings.provider}`,
      `**Model:** ${this.settings.model}`,
      ``,
      `## System Prompt`,
      ``,
      "```",
      systemPrompt,
      "```",
      ``,
      `## Conversation`,
      ``
    ];
    for (const msg of this.messages) {
      if (typeof msg.content === "string") {
        parts.push(`### ${msg.role === "user" ? "User" : "Assistant"}`);
        parts.push(``);
        parts.push(msg.content);
        parts.push(``);
      } else {
        for (const block2 of msg.content) {
          if (block2.type === "text" && block2.text) {
            parts.push(`### Assistant`);
            parts.push(``);
            parts.push(block2.text);
            parts.push(``);
          } else if (block2.type === "tool_use") {
            parts.push(`### Tool Call: \`${block2.name}\``);
            parts.push(``);
            parts.push("```json");
            parts.push(JSON.stringify(block2.input, null, 2));
            parts.push("```");
            parts.push(``);
          } else if (block2.type === "tool_result") {
            parts.push(`### Tool Result ${block2.is_error ? "(ERROR)" : ""}`);
            parts.push(``);
            parts.push("```");
            parts.push(block2.content || "(empty)");
            parts.push("```");
            parts.push(``);
          }
        }
      }
    }
    return parts.join("\n");
  }
  /** Run one user turn through the agentic loop */
  async run(userMessage, callbacks, selection) {
    this.aborted = false;
    await EfficiencyLog.trim(this.app);
    if (this.settings.provider === "openai" && hasOpenAIPendingToolContinuation(this.messages)) {
      const reconnectReason = describeOpenAIPendingContinuation(this.messages);
      clearOpenAIState();
      callbacks.onResponse(`AiChat reconnecting to OpenAI: ${reconnectReason}`);
    }
    const context = buildContext(this.app);
    const contextPrefix = buildContextMessage(context);
    const agentsContext = await this.includer.loadAgentsContext();
    const invalidationGuardStats = await this.cfc.applyExternalMutationInvalidationGuard(
      this.app,
      (entryName, reason) => this.cfcRemoveEntry(entryName, reason, callbacks)
    );
    if (invalidationGuardStats && typeof invalidationGuardStats.invalidated === "number" && invalidationGuardStats.invalidated > 0) {
      callbacks.onResponse(`CFC invalidation guard removed ${invalidationGuardStats.invalidated} entr${invalidationGuardStats.invalidated === 1 ? "y" : "ies"}.`);
    }
    let fullMessage;
    if (selection) {
      const selectionParts = [
        contextPrefix,
        "",
        `[Selection scope: The user has selected text in ${selection.filePath}. Work only within this selection. When using edit_file, use find_replace with text from within this selection. Do not modify text outside the selection.]`,
        "",
        `Selected text:`,
        `> ${selection.text}`,
        "",
        userMessage
      ];
      fullMessage = selectionParts.join("\n");
    } else {
      const normalParts = [contextPrefix, "", userMessage];
      fullMessage = normalParts.join("\n");
    }
    this.messages.push({ role: "user", content: fullMessage });
    this.pruneHistory();
    const currentUserTurnIndex = this.messages.reduce((count, msg) => {
      return count + (msg?.role === "user" && typeof msg?.content === "string" ? 1 : 0);
    }, 0);
    const baseSystemPrompt = await loadSystemPrompt(this.app);
    const systemPrompt = agentsContext ? `${baseSystemPrompt}\n\n${agentsContext}` : baseSystemPrompt;
    debugLog(this.app, "USER_MESSAGE", { userMessage, hasSelection: !!selection });
    const maxIterations = this.settings.maxIterations || 20;
    for (let i = 0; i < maxIterations; i++) {
      if (this.aborted) return;
      callbacks.onThinking();
      const cfcFilenames = this.cfc.listPaths().map((entryPath) => {
        const parts = entryPath.split(/[\\/]/);
        return parts[parts.length - 1] || entryPath;
      }).filter((name) => !!name).sort((a, b) => a.localeCompare(b));
      const cfcInline = cfcFilenames.length > 0 ? cfcFilenames.join(", ") : "(empty)";
      let response;
      try {
        response = await sendMessage(
          this.settings,
          this.messages,
          TOOL_DEFINITIONS,
          systemPrompt,
          this.cfc,
          this.app
        );
        const exactCharsSent = Number(response?.charsSent);
        if (!Number.isFinite(exactCharsSent) || exactCharsSent <= 0) {
          throw new Error("AI response telemetry missing valid charsSent");
        }
        const exactBytesSent = Number(response?.bytesSent);
        if (!Number.isFinite(exactBytesSent) || exactBytesSent <= 0) {
          throw new Error("AI response telemetry missing valid bytesSent");
        }
        const bytesSentForTelemetry = exactBytesSent;
        callbacks.onResponse(`CFC: ${cfcInline}`);
        if (this.settings.provider === "openai") {
          const inputTokens = typeof response?.usage?.inputTokens === "number" ? response.usage.inputTokens : 0;
          const outputTokens = typeof response?.usage?.outputTokens === "number" ? response.usage.outputTokens : 0;
          const totalTokens = typeof response?.usage?.totalTokens === "number" ? response.usage.totalTokens : (inputTokens + outputTokens);
          callbacks.onResponse(`${inputTokens}+${outputTokens}=${totalTokens}`);
          const recoveryNotes = consumeOpenAIRecoveryNotes();
          for (const note of recoveryNotes) {
            callbacks.onResponse(note);
          }
        }
      } catch (e) {
        if (this.settings.provider === "openai") {
          const recoveryNotes = consumeOpenAIRecoveryNotes();
          for (const note of recoveryNotes) {
            callbacks.onResponse(note);
          }
        }
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        const stack = e instanceof Error ? (e.stack || `${e.name}: ${e.message}`) : String(e);
        const telemetry = isRecord6(e?.aichatTelemetry) ? e.aichatTelemetry : null;
        const technical = telemetry
          ? `${msg}\nTelemetry: ${JSON.stringify(telemetry)}\nStack:\n${stack}`
          : `${msg}\nStack:\n${stack}`;
        debugLog(this.app, "API_ERROR", {
          error: msg,
          technical,
          telemetry,
          model: this.settings.model,
          provider: this.settings.provider
        });
        routeAichatRuntimeError(technical, "agent.run.api_error");
        this.onTurnEnd("api_error", callbacks, { clearOpenAIState: true });
        callbacks.onError(technical);
        return;
      }
      debugLog(this.app, "API_RESPONSE", { stopReason: response.stopReason, contentTypes: response.content.map((b) => b.type), usage: response.usage });
      if (this.aborted) return;
      const toolCalls = [];
      const textParts = [];
      for (const block2 of response.content) {
        if (block2.type === "text" && block2.text) {
          textParts.push(block2.text);
        } else if (block2.type === "tool_use") {
          toolCalls.push(block2);
        }
      }
      const hasAskUser = toolCalls.some((tc) => tc.name === "ask_user");
      if (textParts.length > 0 && toolCalls.length > 0 && !hasAskUser) {
        callbacks.onResponse(textParts.join(""));
      }
      this.messages.push({ role: "assistant", content: response.content });
      this.pruneHistory();
      if (toolCalls.length === 0) {
        if (textParts.length > 0) {
          callbacks.onResponse(textParts.join(""));
        }
        this.onTurnEnd("turn_completed_without_tool_calls", callbacks);
        return;
      }
      const resultBlocks = [];
      let stopAfterEndTurn = false;
      const chainPolicy = buildCommandChainExecutionPolicy(toolCalls);
      const chainObserve = {
        startedAt: Date.now(),
        stepsExecuted: 0,
        consecutiveNoChange: 0,
        sawNoProgressEligibleStep: false,
        hadToolErrors: false,
        firstExecutionStopReason: "",
        firstErrorCause: ""
      };
      const chainStepResults = /* @__PURE__ */ new Map();
      let stopAfterExecutionPolicy = false;
      let executionStopReason = "";

      for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
          const tc = toolCalls[toolIndex];
          if (this.aborted) return;

          if (Date.now() - chainObserve.startedAt >= chainPolicy.overallTimeoutMs) {
            stopAfterExecutionPolicy = true;
            executionStopReason = "blocked_on_error";
            const elapsedMs = Date.now() - chainObserve.startedAt;
            if (!chainObserve.firstErrorCause) {
              chainObserve.firstErrorCause = `command-chain overall timeout after ${elapsedMs}ms (limit ${chainPolicy.overallTimeoutMs}ms) while preparing ${tc.name}`;
            }
            const timeoutResult = {
              result: `Skipped due to command-chain stop: blocked_on_error (overall timeout ${chainPolicy.overallTimeoutMs}ms reached).`,
              isError: true
            };
            let sawBlockingError = false;
            for (let j = toolIndex; j < toolCalls.length; j++) {
              const skippedTc = toolCalls[j];
              const isSnippetsAlwaysNonError = skippedTc.name === "snippets";
              const isNonFatalToolOutcome = isSnippetsAlwaysNonError;
              const skippedIsEndTurn = skippedTc.name === "talkAndEndTurn" || skippedTc.name === "endturn";
              if (!skippedIsEndTurn) {
                callbacks.onToolResult(skippedTc.name, timeoutResult);
              }
              resultBlocks.push({
                type: "tool_result",
                tool_use_id: skippedTc.id,
                content: timeoutResult.result,
                is_error: !isNonFatalToolOutcome
              });
              if (!isNonFatalToolOutcome) {
                sawBlockingError = true;
              }
            }
            if (sawBlockingError) {
              chainObserve.hadToolErrors = true;
              if (!chainObserve.firstExecutionStopReason) chainObserve.firstExecutionStopReason = "blocked_on_error";
              if (!chainObserve.firstErrorCause) {
                chainObserve.firstErrorCause = `command-chain overall timeout after ${elapsedMs}ms (limit ${chainPolicy.overallTimeoutMs}ms) while preparing ${tc.name}`;
              }
            }
            break;
          }

          const split = splitTopLevelToolInput(tc.input, toolIndex);
          let stepInput = split.input;
          if (tc.name === "edit_file") {
            stepInput = this.cfc.withEditPrecondition(this.app, stepInput, getActiveFilePath);
          }
          const cfcPathsBeforeTool = this.cfc.buildCurrentPathSet(this.messages, CHAT_STREAM_CACHE_MAX_AGE_TURNS);
          if (tc.name === "read_file") {
            const requestedPath = isRecord6(stepInput) && typeof stepInput.path === "string" ? obsidian.normalizePath(stepInput.path) : "";
            if (requestedPath && cfcPathsBeforeTool.has(requestedPath)) {
              emitCfcMissNotice(callbacks, "read_file", [requestedPath]);
            }
          }
          const stepMeta = split.step;
          const isTalkTool = tc.name === "talk" || tc.name === "talkAndEndTurn";
          const isEndTurnTool = tc.name === "talkAndEndTurn" || tc.name === "endturn";
          const toolInputSummary = EfficiencyLog.summarizeToolInput(tc.name, stepInput);
          void EfficiencyLog.append(this.app, {
            type: "tool_call",
            phase: "run",
            scope: "top",
            tool: tc.name,
            ...toolInputSummary
          });

          if (!isTalkTool && !isEndTurnTool) {
            callbacks.onToolCall(tc.name, stepInput);
          }

          const policyRunResult = await executeTopLevelToolWithPolicy(
            this.app,
            tc.name,
            stepInput,
            stepMeta,
            callbacks.onAskUser,
            (event) => {
              if (!event || typeof event !== "object") return;
              const toolName = typeof event.tool === "string" ? event.tool : "";
              if (!toolName) return;
              const nestedName = `M ${toolName}`;
              if (event.type === "tool_call") {
                const nestedInput = event.input || {};
                const nestedInputSummary = EfficiencyLog.summarizeToolInput(toolName, nestedInput);
                void EfficiencyLog.append(this.app, {
                  type: "tool_call",
                  phase: "run",
                  scope: "nested",
                  tool: toolName,
                  ...nestedInputSummary
                });
                if (toolName !== "talk" && toolName !== "talkAndEndTurn" && toolName !== "endturn") {
                  callbacks.onToolCall(nestedName, nestedInput);
                }
              } else if (event.type === "tool_result") {
                const nestedResult = event.result || { result: "", isError: false };
                const nestedResultSummary = EfficiencyLog.summarizeToolResult(toolName, {}, nestedResult);
                void EfficiencyLog.append(this.app, {
                  type: "tool_result",
                  phase: "run",
                  scope: "nested",
                  tool: toolName,
                  ...nestedResultSummary
                });
                if ((toolName === "talk" || toolName === "talkAndEndTurn") && !nestedResult.isError) {
                  const nestedText = typeof nestedResult.result === "string" ? nestedResult.result : String(nestedResult.result || "");
                  callbacks.onResponse(
                    toolName === "talkAndEndTurn" ? ensureTalkAndEndTurnPrefix(nestedText) : ensureTalkPrefix(nestedText)
                  );
                } else if (toolName !== "talkAndEndTurn" && toolName !== "endturn") {
                  if ((toolName === "read_file" || toolName === "search_read") && !nestedResult.isError && typeof nestedResult.result === "string") {
                    const nestedPathFromInput = isRecord6(nestedInput) && typeof nestedInput.path === "string" ? nestedInput.path : "";
                    const nestedPathFromResult = isRecord6(nestedResult) && typeof nestedResult.path === "string" ? nestedResult.path : "";
                    const nestedPath = nestedPathFromInput || nestedPathFromResult;
                    const nestedBytes = new TextEncoder().encode(nestedResult.result).length;
                    callbacks.onToolResult(nestedName, {
                      ...nestedResult,
                      result: JSON.stringify({
                        type: `${toolName}_cached`,
                        path: nestedPath,
                        bytes: nestedBytes,
                        cfcUpdated: true,
                        message: `${toolName} content omitted from tool_result. Look in Chat File Cache (CFC) for fetched file content.`
                      })
                    });
                  } else {
                    callbacks.onToolResult(nestedName, nestedResult);
                  }
                }
              }
            }
          );

          const result = policyRunResult.result || { result: "Unknown step failure.", isError: true };

          if (!result.isError && tc.name === "search_read") {
            const entryPaths = extractSearchReadEntryPaths(result);
            const missed = [];
            for (const path of entryPaths) {
              if (cfcPathsBeforeTool.has(path)) missed.push(path);
            }
            emitCfcMissNotice(callbacks, "search_read", missed);
          }

          if (tc.name === "flush" && !result.isError) {
            const flushTargetPath = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
            const flushAll = isRecord6(stepInput) && stepInput.all === true;
            const flushStats = await flushReadPayloadsFromHistory(this.messages, {
              path: flushTargetPath,
              all: flushAll
            });
            if (flushStats.mode === "all") {
              this.clearCfc("flush", callbacks);
            } else if (flushStats.path) {
              this.cfcRemoveEntry(flushStats.path, "flush", callbacks);
            }
            result.result = JSON.stringify({
              action: "flush",
              ...flushStats
            }, null, 2);
          }

          if (!result.isError) {
            if (tc.name === "rename_file") {
              const oldPath = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
              const newPath = isRecord6(stepInput) && typeof stepInput.new_path === "string" ? stepInput.new_path : "";
              if (oldPath) {
                this.cfcRemoveEntry(oldPath, "rename_file", callbacks);
              }
              if (newPath) {
                await this.cfc.refreshPath(this.app, newPath, currentUserTurnIndex);
              }
            } else if (tc.name === "delete_file") {
              const deletedPath = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
              if (deletedPath) {
                this.cfcRemoveEntry(deletedPath, "delete_file", callbacks);
              }
            } else {
              const seeded = seedCfcFromToolResult(this.cfc, tc.name, stepInput, result, currentUserTurnIndex);
              if (!seeded) {
                const refreshPaths = collectCacheRefreshPaths(this.app, tc.name, stepInput, result);
                for (const cachePath of refreshPaths) {
                  await this.cfc.refreshPath(this.app, cachePath, currentUserTurnIndex);
                }
              }
            }
          }

          const toolResultSummary = EfficiencyLog.summarizeToolResult(tc.name, stepInput, result);
          void EfficiencyLog.append(this.app, {
            type: "tool_result",
            phase: "run",
            scope: "top",
            tool: tc.name,
            ...toolResultSummary
          });

          let cfcOnlyToolResultText = "";
          if (!result.isError && (tc.name === "read_file" || tc.name === "search_read") && typeof result.result === "string") {
            cfcOnlyToolResultText = await buildCfcOnlyReadToolResult(tc.name, stepInput, result, callbacks);
          }

          if (isTalkTool && !result.isError) {
            const talkText = typeof result.result === "string" ? result.result : String(result.result || "");
            callbacks.onResponse(
              tc.name === "talkAndEndTurn" ? ensureTalkAndEndTurnPrefix(talkText) : ensureTalkPrefix(talkText)
            );
          } else if (!isEndTurnTool) {
            if (cfcOnlyToolResultText) {
              callbacks.onToolResult(tc.name, {
                ...result,
                result: cfcOnlyToolResultText
              });
            } else {
              callbacks.onToolResult(tc.name, result);
            }
          }

          let toolResultContent = cfcOnlyToolResultText || result.result;
          if (policyRunResult.attempts > 1) {
            const baseText = typeof toolResultContent === "string" ? toolResultContent : JSON.stringify(toolResultContent);
            toolResultContent = `[policy: ${policyRunResult.policyApplied}; attempts: ${policyRunResult.attempts}]\n${baseText}`;
          }
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: tc.id,
            content: toolResultContent,
            is_error: result.isError
          });

          chainStepResults.set(stepMeta.id, {
            resultText: typeof result.result === "string" ? result.result : JSON.stringify(result.result),
            ok: !result.isError,
            changed: inferCommandChainChanged(tc.name, stepInput, result)
          });

          const noProgressSignal = inferCommandChainNoProgressSignal(tc.name, stepInput, result);
          chainObserve.stepsExecuted += 1;
          if (noProgressSignal === "progress") {
            chainObserve.sawNoProgressEligibleStep = true;
            chainObserve.consecutiveNoChange = 0;
          } else if (noProgressSignal === "stalled") {
            chainObserve.sawNoProgressEligibleStep = true;
            chainObserve.consecutiveNoChange += 1;
          }
          if (result.isError) {
            chainObserve.hadToolErrors = true;
          }

          if (!result.isError && isEndTurnTool) {
            stopAfterEndTurn = true;
          }

          if (result.isError) {
            stopAfterExecutionPolicy = true;
            executionStopReason = "blocked_on_error";
            if (!chainObserve.firstExecutionStopReason) chainObserve.firstExecutionStopReason = "blocked_on_error";
          }

          const computedExecutionStop = shouldStopCommandChainForExecutionPolicy(chainPolicy, chainObserve, result.isError);
          if (computedExecutionStop && !chainObserve.firstExecutionStopReason) {
            chainObserve.firstExecutionStopReason = computedExecutionStop;
          }
          const effectiveExecutionStop = computedExecutionStop === "max_steps_reached" || computedExecutionStop === "no_progress" ? "" : computedExecutionStop;
          if (!stopAfterExecutionPolicy && effectiveExecutionStop) {
            stopAfterExecutionPolicy = true;
            executionStopReason = effectiveExecutionStop;
          }

          if (stopAfterEndTurn || stopAfterExecutionPolicy) {
            if (!stopAfterEndTurn && stopAfterExecutionPolicy && toolIndex < toolCalls.length - 1) {
              const computedReason = executionStopReason || "blocked_on_error";
              const computedCause = computedReason === "blocked_on_error"
                ? (
                  chainObserve.firstErrorCause
                    || (
                      Date.now() - chainObserve.startedAt >= chainPolicy.overallTimeoutMs
                        ? `command-chain overall timeout after ${Date.now() - chainObserve.startedAt}ms (limit ${chainPolicy.overallTimeoutMs}ms)`
                        : "command-chain stopped due to a prior error"
                    )
                )
                : "";
              for (let j = toolIndex + 1; j < toolCalls.length; j++) {
                const skippedTc = toolCalls[j];
                const skippedResult = buildSkippedCommandChainToolResult(computedReason, computedReason !== "criteria_met", computedCause);
                const skippedIsEndTurn = skippedTc.name === "talkAndEndTurn" || skippedTc.name === "endturn";
                if (!skippedIsEndTurn) {
                  callbacks.onToolResult(skippedTc.name, skippedResult);
                }
                resultBlocks.push({
                  type: "tool_result",
                  tool_use_id: skippedTc.id,
                  content: skippedResult.result,
                  is_error: computedReason !== "criteria_met"
                });
              }
            }
            break;
          }
        }
      debugLog(this.app, "COMMAND_CHAIN_EXECUTION_POLICY", {
        goal: chainPolicy.goal,
        policy: chainPolicy,
        observed: {
          stepsExecuted: chainObserve.stepsExecuted,
          consecutiveNoChange: chainObserve.consecutiveNoChange,
          hadToolErrors: chainObserve.hadToolErrors,
          firstExecutionStopReason: chainObserve.firstExecutionStopReason || "none",
          enforcedStop: stopAfterExecutionPolicy,
          enforcedStopReason: executionStopReason || "none"
        }
      });
      this.messages.push({ role: "user", content: resultBlocks });
      this.pruneHistory();
      if (stopAfterEndTurn) {
        this.onTurnEnd("turn_closed_after_talkAndEndTurn", callbacks, { clearOpenAIState: true });
        return;
      }
      if (stopAfterExecutionPolicy) {
        callbacks.onResponse("Stopped on error");
      }
    }
    this.onTurnEnd("max_iterations_reached", callbacks, { clearOpenAIState: true });
    callbacks.onError(
      `Reached maximum iterations (${maxIterations}). The task may be too complex for a single conversation turn.`
    );
  }

  /** Drop oldest messages when conversation gets too long, keeping recent context */
  pruneHistory() {
    if (this.messages.length > MAX_CONVERSATION_LENGTH) {
      this.messages = this.messages.slice(-KEEP_RECENT);
    }
  }
};

declareExports({
  AgentLoop
});

}

{
// src/agent/loopHelpers.js
// src/agent/loopHelpers.ts
let MAX_CONVERSATION_LENGTH = 50;
let KEEP_RECENT = 40;
let DEBUG = true;
let CHAT_STREAM_CACHE_MAX_AGE_TURNS = 0;

function debugLog(app, label, data) {
  if (!DEBUG) return;
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const entry = `\n--- ${label} [${timestamp}] ---\n${JSON.stringify(data, null, 2)}\n`;
    void app.vault.adapter.append(`${app.vault.configDir}/plugins/aichat/debug.log`, entry);
  } catch {
  }
}

function ensureTalkPrefix(text) {
  const raw = String(text || "");
  if (/^\s*talk\s*:/i.test(raw)) return raw;
  return `Talk: ${raw}`;
}

function ensureTalkAndEndTurnPrefix(text) {
  const raw = String(text || "");
  if (/^\s*talkandendturn\s*:/i.test(raw)) return raw;
  return `TalkAndEndTurn: ${raw}`;
}

function isRecord6(value) {
  return typeof value === "object" && value !== null;
}

function truncateUtf8ToBytes(value, maxBytes) {
  const raw = String(value || "");
  if (maxBytes <= 0 || raw.length === 0) return "";
  const enc = new TextEncoder();
  if (enc.encode(raw).length <= maxBytes) return raw;
  let out = raw;
  while (out.length > 0 && enc.encode(out).length > maxBytes) {
    out = out.slice(0, Math.max(0, out.length - 1));
  }
  return out;
}

function buildCfcSystemMessageText(filename, content) {
  return ["Chat File Cache (CFC):", `filename: ${filename}`, "content:", content].join("\n").trim();
}

function buildCfcSystemMessagesFromEntries(entries, options = {}) {
  const truncateBytes = typeof options.truncateBytes === "number" ? options.truncateBytes : 0;
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return [];
  const out = [];
  for (const entry of list) {
    if (!isRecord6(entry)) continue;
    const filename = typeof entry.filename === "string" ? entry.filename.trim() : "";
    if (!filename) continue;
    const rawContent = typeof entry.content === "string" ? entry.content : "";
    const content = truncateBytes > 0 ? truncateUtf8ToBytes(rawContent, truncateBytes) : rawContent;
    out.push({ type: "message", role: "system", content: buildCfcSystemMessageText(filename, content) });
  }
  return out;
}

function parseCfcSystemMessageContent(text) {
  const raw = String(text || "");
  const prefix = "Chat File Cache (CFC):\nfilename: ";
  const marker = "\ncontent:\n";
  if (!raw.startsWith(prefix)) return null;
  const markerIdx = raw.indexOf(marker, prefix.length);
  if (markerIdx === -1) return null;
  const filename = raw.substring(prefix.length, markerIdx).trim();
  if (!filename) return null;
  const content = raw.substring(markerIdx + marker.length);
  return { filename, content };
}

function isCfcMessageContent(text) {
  return parseCfcSystemMessageContent(text) !== null;
}

async function hashTextSha256(content, filepath = "", callbacks = null) {
  const text = String(content || "");
  if (callbacks && typeof callbacks.onResponse === "function" && filepath) {
    // callbacks.onResponse("Hash on " + filepath);
  }
  try {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
  }
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isRecord7(value) {
  return typeof value === "object" && value !== null;
}

function isSearchReadFullExtract(stepInput, parsedResult) {
  const extractFromInput = isRecord6(stepInput) && typeof stepInput.extract === "string" ? stepInput.extract : "";
  if (extractFromInput.length > 0) return extractFromInput === "full";
  const extractFromResult = isRecord6(parsedResult) && typeof parsedResult.extract === "string" ? parsedResult.extract : "";
  if (extractFromResult.length > 0) return extractFromResult === "full";
  return true;
}

async function buildCfcOnlyReadToolResult(toolName, stepInput, result, callbacks = null) {
  const resultText = typeof result?.result === "string" ? result.result : "";
  const pathFromInput = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
  const pathFromResult = isRecord6(result) && typeof result.path === "string" ? result.path : "";
  const path = pathFromInput || pathFromResult;
  const bytes = new TextEncoder().encode(resultText).length;
  const sha256 = await hashTextSha256(resultText, path, callbacks);

  if (toolName === "read_file") {
    return JSON.stringify({
      type: "read_file_cached",
      path,
      bytes,
      sha256,
      cfcUpdated: true,
      message: "read_file content omitted from tool_result. Look in Chat File Cache (CFC) for the fetched file content."
    });
  }

  let parsed = null;
  try {
    parsed = JSON.parse(resultText);
  } catch {
    parsed = null;
  }

  if (toolName === "search_read" && !isSearchReadFullExtract(stepInput, parsed)) {
    return null;
  }

  const selectors = Array.isArray(parsed?.entries)
    ? parsed.entries
        .map((entry, entryIndex) => {
          if (!isRecord7(entry) || typeof entry.path !== "string") return "";
          const contentMeta = isRecord7(entry.content) ? entry.content : null;
          const selector = {
            entryIndex,
            path: entry.path,
            bytes: typeof entry.bytes === "number" ? entry.bytes : null,
            sha256: typeof entry.sha256 === "string" ? entry.sha256 : "",
            truncated: entry.truncated === true,
            cfcLocator: {
              filename: entry.path,
              authority: "CFC"
            }
          };
          if (contentMeta && typeof contentMeta.lineStart === "number" && typeof contentMeta.lineEnd === "number") {
            selector.snippetSelector = {
              lineStart: contentMeta.lineStart,
              lineEnd: contentMeta.lineEnd,
              preview: typeof contentMeta.snippet === "string" ? contentMeta.snippet : ""
            };
          }
          return selector;
        })
        .filter((s) => !!s && typeof s.path === "string" && s.path.length > 0)
    : [];

  return JSON.stringify({
    type: "search_read_cached",
    path,
    query: isRecord6(parsed) && typeof parsed.query === "string" ? parsed.query : isRecord6(stepInput) && typeof stepInput.query === "string" ? stepInput.query : "",
    match: isRecord6(parsed) && typeof parsed.match === "string" ? parsed.match : isRecord6(stepInput) && typeof stepInput.match === "string" ? stepInput.match : "",
    extract: isRecord6(parsed) && typeof parsed.extract === "string" ? parsed.extract : isRecord6(stepInput) && typeof stepInput.extract === "string" ? stepInput.extract : "",
    totalMatches: isRecord6(parsed) && typeof parsed.totalMatches === "number" ? parsed.totalMatches : null,
    selectedCount: isRecord6(parsed) && typeof parsed.selectedCount === "number" ? parsed.selectedCount : selectors.length,
    selectors,
    entryPaths: selectors.map((s) => s.path),
    bytes,
    sha256,
    cfcUpdated: true,
    message: "search_read(full) content omitted from tool_result. CFC contains full-file content; snippet/frontmatter modes remain in tool_result only. Use selectors for path/line metadata."
  });
}

function buildReadFileDedupeStub(path, bytes, sha256) {
  return [
    "[read_file deduped]",
    `path: ${path}`,
    `bytes: ${bytes}`,
    `sha256: ${sha256}`,
    "summary: duplicate payload elided; newest identical read_file result is kept inline"
  ].join("\n");
}

function buildReadFileTooLargeStub(path, bytes, sha256) {
  return JSON.stringify({
    type: "read_file_elided",
    path,
    bytes,
    sha256,
    message: `this file is ${bytes} bytes long. If you need it issue a new read_file command.`,
    refetch_instruction: "issue a new read_file command"
  });
}

function isReadFileElidedPayload(content) {
  if (typeof content !== "string" || !content) return false;
  try {
    const parsed = JSON.parse(content);
    return isRecord7(parsed) && parsed.type === "read_file_elided";
  } catch {
    return false;
  }
}

function extractWrappedReadFilePath(content) {
  const text = typeof content === "string" ? content : "";
  if (!text.startsWith("[read_file]")) return "";
  const match = text.match(/^path:\s*(.+)$/m);
  return match && typeof match[1] === "string" ? match[1].trim() : "";
}

function extractWrappedReadFileContent(content) {
  const text = typeof content === "string" ? content : "";
  if (!text.startsWith("[read_file]")) return "";
  const splitAt = text.indexOf("\n\n");
  if (splitAt === -1) return "";
  return text.slice(splitAt + 2);
}

function addCachePath(out, path) {
  const raw = typeof path === "string" ? path.trim() : "";
  if (!raw) return;
  out.add(obsidian.normalizePath(raw));
}

function extractSearchReadEntryPaths(result) {
  const out = /* @__PURE__ */ new Set();
  const raw = isRecord6(result) && typeof result.result === "string" ? result.result : "";
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord7(parsed)) return out;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const entry of entries) {
      if (!isRecord7(entry) || typeof entry.path !== "string") continue;
      addCachePath(out, entry.path);
    }
  } catch {
  }
  return out;
}

function emitCfcMissNotice(callbacks, toolName, paths) {
  const unique = Array.from(new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p.length > 0))).sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) return;
}

function buildReadFileFlushedStub(path, bytes, sha256) {
  return JSON.stringify({
    type: "read_file_elided",
    reason: "manual_flush",
    path,
    bytes,
    sha256,
    message: `payload flushed from history for ${path || "(unknown path)"}. If needed, issue a new read_file command.`,
    refetch_instruction: "issue a new read_file command"
  });
}

function getActiveFilePath(app) {
  try {
    const file = app.workspace.getActiveFile();
    return file?.path ? obsidian.normalizePath(file.path) : "";
  } catch {
    return "";
  }
}

function inferCommandChainChanged(tool, input, result) {
  if (result?.isError) return false;
  return tool === "edit_file" || tool === "create_file" || tool === "rename_file" || tool === "delete_file" || tool === "set_properties" || tool === "revert_edit";
}

function inferCommandChainNoProgressSignal(tool, input, result) {
  if (inferCommandChainChanged(tool, input, result)) return "progress";
  if (tool === "edit_file" || tool === "create_file" || tool === "rename_file" || tool === "delete_file" || tool === "set_properties" || tool === "revert_edit") {
    return "stalled";
  }
  return "neutral";
}

function requiredChainString(value) {
  return typeof value === "string" ? value : "";
}

function pickChainEnvelope(toolCalls) {
  const first = Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls[0] : null;
  const rawInput = isRecord6(first?.input) ? first.input : {};
  if (isRecord6(rawInput.command_chain)) return rawInput.command_chain;
  return {};
}

function buildCommandChainExecutionPolicy(toolCalls) {
  const envelope = pickChainEnvelope(toolCalls);
  const stepsPlanned = Array.isArray(toolCalls) ? toolCalls.length : 0;
  return {
    goal: requiredChainString(envelope.goal) || "command-chain-execution-policy",
    maxSteps: 20,
    noProgressLimit: 2,
    overallTimeoutMs: 240000,
    maxStepsDisabled: true,
    stepsPlanned
  };
}

function splitTopLevelToolInput(rawInput, stepIndex) {
  const source = isRecord6(rawInput) ? rawInput : {};
  const base = { ...source };
  const stepSource = isRecord6(source.step) ? source.step : {};

  const stepId = requiredChainString(stepSource.id || source.id) || `step-${stepIndex + 1}`;
  const timeoutMs = 60000;

  delete base.step;
  delete base.id;
  delete base.onError;
  delete base.timeoutMs;
  delete base.command_chain;
  delete base.goal;
  delete base.maxSteps;
  delete base.noProgressLimit;
  delete base.overallTimeoutMs;
  delete base.stopWhen;

  return {
    input: base,
    step: {
      id: stepId,
      timeoutMs
    }
  };
}

function buildSkippedCommandChainToolResult(reason, isError = true, cause) {
  const detail = typeof cause === "string" && cause.trim().length > 0 ? ` Skipping command due to error: ${cause}` : "";
  return {
    result: `Skipped due to command-chain stop: ${reason}.${detail}`,
    reason,
    cause,
    isError
  };
}

async function executeTopLevelToolOnceWithTimeout(app, toolName, input, onAskUser, onMultiStepEvent, timeoutMs) {
  const toolPromise = executeTool(app, toolName, input, onAskUser, onMultiStepEvent);
  const timeoutPromise = new Promise((resolve) => {
    window.setTimeout(() => resolve({ result: `Tool ${toolName} failed: timeout after ${timeoutMs}ms`, isError: true }), timeoutMs);
  });
  return await Promise.race([toolPromise, timeoutPromise]);
}

async function executeTopLevelToolWithPolicy(app, toolName, stepInput, stepMeta, onAskUser, onMultiStepEvent) {
  const result = await executeTopLevelToolOnceWithTimeout(app, toolName, stepInput, onAskUser, onMultiStepEvent, stepMeta.timeoutMs);
  return {
    result,
    attempts: 1,
    policyApplied: "stop"
  };
}

function shouldStopCommandChainForExecutionPolicy(policy, observe, lastResultIsError) {
  if (Date.now() - observe.startedAt >= policy.overallTimeoutMs) {
    return "blocked_on_error";
  }
  if (lastResultIsError || observe.hadToolErrors) {
    return "blocked_on_error";
  }
  if (observe.sawNoProgressEligibleStep && observe.consecutiveNoChange >= policy.noProgressLimit) {
    return "no_progress";
  }
  return "";
}

declareExports({
  MAX_CONVERSATION_LENGTH,
  KEEP_RECENT,
  DEBUG,
  CHAT_STREAM_CACHE_MAX_AGE_TURNS,
  debugLog,
  ensureTalkPrefix,
  ensureTalkAndEndTurnPrefix,
  isRecord6,
  truncateUtf8ToBytes,
  buildCfcSystemMessageText,
  buildCfcSystemMessagesFromEntries,
  parseCfcSystemMessageContent,
  isCfcMessageContent,
  hashTextSha256,
  buildCfcOnlyReadToolResult,
  isRecord7,
  isSearchReadFullExtract,
  buildReadFileDedupeStub,
  buildReadFileTooLargeStub,
  isReadFileElidedPayload,
  extractWrappedReadFilePath,
  extractWrappedReadFileContent,
  addCachePath,
  extractSearchReadEntryPaths,
  emitCfcMissNotice,
  buildReadFileFlushedStub,
  getActiveFilePath,
  inferCommandChainChanged,
  inferCommandChainNoProgressSignal,
  requiredChainString,
  pickChainEnvelope,
  buildCommandChainExecutionPolicy,
  splitTopLevelToolInput,
  buildSkippedCommandChainToolResult,
  executeTopLevelToolOnceWithTimeout,
  executeTopLevelToolWithPolicy,
  shouldStopCommandChainForExecutionPolicy
});


function extractSearchReadPaths(stepInput, result) {
  const out = /* @__PURE__ */ new Set();
  if (isRecord6(stepInput) && typeof stepInput.path === "string") {
    addCachePath(out, stepInput.path);
  }
  if (isRecord6(result) && typeof result.path === "string") {
    addCachePath(out, result.path);
  }
  const raw = isRecord6(result) && typeof result.result === "string" ? result.result : "";
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord7(parsed)) return out;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    for (const entry of entries) {
      if (!isRecord7(entry)) continue;
      if (typeof entry.path === "string") addCachePath(out, entry.path);
    }
  } catch {
  }
  return out;
}

function collectCacheRefreshPaths(app, toolName, stepInput, result) {
  const out = /* @__PURE__ */ new Set();
  if (toolName === "search_read") {
    let parsed = null;
    try {
      const resultText = typeof result?.result === "string" ? result.result : "";
      parsed = resultText.length > 0 ? JSON.parse(resultText) : null;
    } catch {
      parsed = null;
    }
    if (isSearchReadFullExtract(stepInput, parsed)) {
      const searchReadPaths = extractSearchReadPaths(stepInput, result);
      for (const path of searchReadPaths) out.add(path);
    }
    return out;
  }
  if (toolName === "read_file" || toolName === "create_file") {
    if (isRecord6(stepInput) && typeof stepInput.path === "string") addCachePath(out, stepInput.path);
    return out;
  }
  if (toolName === "edit_file" || toolName === "set_properties" || toolName === "get_properties" || toolName === "get_backlinks" || toolName === "open_document") {
    if (isRecord6(stepInput) && typeof stepInput.path === "string") {
      addCachePath(out, stepInput.path);
    } else {
      addCachePath(out, getActiveFilePath(app));
    }
    return out;
  }
  if (toolName === "revert_edit") {
    if (isRecord6(stepInput) && typeof stepInput.path === "string") {
      addCachePath(out, stepInput.path);
    }
    if (out.size === 0) {
      const text = isRecord6(result) && typeof result.result === "string" ? result.result : "";
      const m = text.match(/^Reverted\s+(.+?)\s+using\s+journal\s+entry\b/);
      if (m && typeof m[1] === "string") {
        addCachePath(out, m[1]);
      }
    }
    if (out.size === 0) addCachePath(out, getActiveFilePath(app));
    return out;
  }
  return out;
}

function seedCfcFromToolResult(cfc, toolName, stepInput, result, userTurnIndex) {
  if (!cfc || result?.isError) return false;

  if (toolName === "read_file") {
    const path = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : isRecord6(result) && typeof result.path === "string" ? result.path : "";
    const payload = typeof result.result === "string" ? result.result : "";
    if (!path || !payload) return false;
    cfc.set(path, {
      payload,
      lastSeenTurn: userTurnIndex,
      observedMtimeMs: null,
      observedSize: null
    });
    return true;
  }

  if (toolName === "create_file") {
    const path = isRecord6(stepInput) && typeof stepInput.path === "string" ? stepInput.path : "";
    const payload = isRecord6(stepInput) && typeof stepInput.content === "string" ? stepInput.content : "";
    if (!path) return false;
    cfc.set(path, {
      payload,
      lastSeenTurn: userTurnIndex,
      observedMtimeMs: null,
      observedSize: null
    });
    return true;
  }

  if (toolName === "search_read") {
    let parsed = null;
    try {
      const resultText = typeof result?.result === "string" ? result.result : "";
      parsed = resultText.length > 0 ? JSON.parse(resultText) : null;
    } catch {
      parsed = null;
    }
    if (!isSearchReadFullExtract(stepInput, parsed) || !isRecord6(parsed)) return false;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    let seeded = 0;
    for (const entry of entries) {
      if (!isRecord6(entry)) continue;
      const path = typeof entry.path === "string" ? entry.path : "";
      const payload = typeof entry.content === "string" ? entry.content : "";
      if (!path || !payload) continue;
      cfc.set(path, {
        payload,
        lastSeenTurn: userTurnIndex,
        observedMtimeMs: null,
        observedSize: null
      });
      seeded += 1;
    }
    return seeded > 0;
  }

  return false;
}

async function flushReadPayloadsFromHistory(messages, options) {
  const normalizedTarget = typeof options?.path === "string" ? options.path.trim() : "";
  const flushAll = options?.all === true || !normalizedTarget;
  const targetLower = normalizedTarget.toLowerCase();

  let scanned = 0;
  let flushed = 0;
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    const blocks = Array.isArray(msg?.content) ? msg.content : null;
    if (!blocks) continue;
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      if (!isRecord7(block) || block.type !== "tool_result" || block.is_error) continue;
      const content = typeof block.content === "string" ? block.content : "";
      if (!content || isReadFileElidedPayload(content)) continue;
      const path = extractWrappedReadFilePath(content);
      if (!path) continue;
      scanned += 1;
      if (!flushAll && path.toLowerCase() !== targetLower) continue;
      const bytes = new TextEncoder().encode(content).length;
      const sha256 = await hashTextSha256(content);
      block.content = buildReadFileFlushedStub(path, bytes, sha256);
      flushed += 1;
    }
  }

  return {
    scanned,
    flushed,
    mode: flushAll ? "all" : "path",
    path: flushAll ? "" : normalizedTarget
  };
}

function isClosedEndTurnBoundary(messages, lastUserMessage) {
  if (!lastUserMessage || lastUserMessage.role !== "user" || !Array.isArray(lastUserMessage.content)) return false;
  const toolResults = lastUserMessage.content.filter((b) => isRecord7(b) && b.type === "tool_result");
  if (toolResults.length === 0) return false;
  const prev = messages[messages.length - 2];
  if (!prev || prev.role !== "assistant" || !Array.isArray(prev.content)) return false;
  const toolNameById = new Map();
  for (const b of prev.content) {
    if (!isRecord7(b) || b.type !== "tool_use") continue;
    const id = typeof b.id === "string" ? b.id : "";
    const name = typeof b.name === "string" ? b.name : "";
    if (id && name) {
      toolNameById.set(id, name);
    }
  }
  if (toolNameById.size === 0) return false;
  let hasTurnBoundary = false;
  for (const result of toolResults) {
    const toolUseId = typeof result.tool_use_id === "string" ? result.tool_use_id : "";
    const toolName = toolUseId ? toolNameById.get(toolUseId) || "" : "";
    if (!toolName) return false;
    if (toolName === "talkAndEndTurn" || toolName === "endturn") {
      hasTurnBoundary = true;
      continue;
    }
    if (toolName !== "talk") {
      return false;
    }
  }
  return hasTurnBoundary;
}

function hasOpenAIPendingToolContinuation(messages) {
  const last = messages[messages.length - 1];
  if (!last || !Array.isArray(last.content)) return false;
  if (last.role === "user") {
    if (isClosedEndTurnBoundary(messages, last)) {
      return false;
    }
    return last.content.some((b) => isRecord7(b) && b.type === "tool_result");
  }
  if (last.role === "assistant") {
    return last.content.some((b) => isRecord7(b) && b.type === "tool_use");
  }
  return false;
}

function describeOpenAIPendingContinuation(messages) {
  const last = messages[messages.length - 1];
  if (!last || !Array.isArray(last.content)) {
    return "pending continuation boundary detected";
  }

  if (last.role === "assistant") {
    const pendingTools = last.content.filter((b) => isRecord7(b) && b.type === "tool_use").map((b) => typeof b.name === "string" ? b.name : "").filter((name) => name.length > 0);
    if (pendingTools.length > 0) {
      const label = pendingTools.slice(0, 3).join(", ");
      const suffix = pendingTools.length > 3 ? ` (+${pendingTools.length - 3} more)` : "";
      return `previous assistant turn ended with pending tool call(s): ${label}${suffix}`;
    }
  }

  if (last.role === "user") {
    if (isClosedEndTurnBoundary(messages, last)) {
      return "turn boundary is already closed";
    }
    const pendingResults = last.content.filter((b) => isRecord7(b) && b.type === "tool_result");
    if (pendingResults.length > 0) {
      const prev = messages[messages.length - 2];
      const toolNameById = new Map();
      if (prev && prev.role === "assistant" && Array.isArray(prev.content)) {
        for (const b of prev.content) {
          if (!isRecord7(b) || b.type !== "tool_use") continue;
          const id = typeof b.id === "string" ? b.id : "";
          const name = typeof b.name === "string" ? b.name : "";
          if (id && name) toolNameById.set(id, name);
        }
      }
      const pendingNames = [];
      for (const result of pendingResults) {
        const toolUseId = typeof result.tool_use_id === "string" ? result.tool_use_id : "";
        const toolName = toolUseId ? toolNameById.get(toolUseId) || "" : "";
        if (toolName) pendingNames.push(toolName);
      }
      if (pendingNames.length > 0) {
        const label = pendingNames.slice(0, 3).join(", ");
        const suffix = pendingNames.length > 3 ? ` (+${pendingNames.length - 3} more)` : "";
        return `previous user tool result block(s) (${pendingResults.length}) were awaiting assistant continuation for tool(s): ${label}${suffix}`;
      }
      return `previous user tool result block(s) (${pendingResults.length}) were awaiting assistant continuation`;
    }
  }

  return "pending continuation boundary detected";
}



declareExports({
  extractSearchReadPaths,
  collectCacheRefreshPaths,
  seedCfcFromToolResult,
  flushReadPayloadsFromHistory,
  isClosedEndTurnBoundary,
  hasOpenAIPendingToolContinuation,
  describeOpenAIPendingContinuation
});

}

{
// src/agent/sentLog.js
// src/agent/sentLog.ts
class SentLog {
  static async writeLatestSentLog(app, payloadOrBody) {
    try {
      const effectiveApp = app || (typeof window !== "undefined" ? window.app : null);
      if (!effectiveApp?.vault?.adapter) return;

      const raw = payloadOrBody?.bodyJson;
      const bodyObj = payloadOrBody?.bodyObj;
      let textToWrite = "";

      if (typeof raw === "string" && raw.length > 0) {
        textToWrite = JSON.stringify(JSON.parse(raw), null, 4);
      } else if (bodyObj && typeof bodyObj === "object") {
        textToWrite = JSON.stringify(bodyObj, null, 4);
      } else {
        textToWrite = JSON.stringify(payloadOrBody ?? null, null, 2);
      }

      await effectiveApp.vault.adapter.write("aichat/sent.log", textToWrite);
    } catch {
    }
  }
}

declareExports({
  SentLog
});
}

{
// src/agent/system-prompt.js

let SYSTEM_PROMPT_PATH = "aichat/SystemPrompt.md";
let loadedSystemPrompt = "System prompt unavailable: aichat/SystemPrompt.md has not been loaded yet.";
function buildSystemPromptLoadError(reason) {
  return `System prompt unavailable: ${reason}. Required source: ${SYSTEM_PROMPT_PATH}.`;
}
async function loadSystemPrompt(app) {
  try {
    const raw = await app.vault.adapter.read(SYSTEM_PROMPT_PATH);
    const text = String(raw || "").trim();
    if (text.length === 0) {
      loadedSystemPrompt = buildSystemPromptLoadError("aichat/SystemPrompt.md is empty");
      return loadedSystemPrompt;
    }
    loadedSystemPrompt = text;
    return loadedSystemPrompt;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e || "read failed");
    loadedSystemPrompt = buildSystemPromptLoadError(`failed to read aichat/SystemPrompt.md (${msg})`);
    return loadedSystemPrompt;
  }
}
function buildSystemPrompt() {
  return loadedSystemPrompt;
}
function buildContextMessage(context) {
  const parts = [
    `[Context: Vault "${context.vaultName}" with ${context.fileCount} markdown files.`
  ];
  if (context.activeFile) {
    parts.push(`Active document: ${context.activeFile}.`);
  }
  if (context.selection) {
    const truncated = context.selection.substring(0, 200);
    parts.push(`Selected text: "${truncated}${context.selection.length > 200 ? "..." : ""}".`);
  }
  parts.push("]");
  return parts.join(" ");
}

declareExports({
  loadSystemPrompt,
  buildSystemPrompt,
  buildContextMessage
});


}

{
// src/api/anthropic.js

registerInit("anthropic", init_anthropic);
async function sendAnthropicMessage(settings, messages, tools, systemPrompt) {
  const model = settings.model || "claude-sonnet-4-6";
  const body = {
    model,
    max_tokens: 16384,
    // System prompt as a content block with cache_control breakpoint.
    // Anthropic caches everything up to the breakpoint across requests.
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: messages.map(toAnthropicMessage)
  };
  const is46Model = model.includes("4-6") || model.includes("4.6");
  const supportsThinking = model.includes("claude-sonnet-4") || model.includes("claude-opus") || model.includes("claude-sonnet-3-7");
  if (is46Model) {
    body.thinking = { type: "adaptive" };
  } else if (supportsThinking) {
    body.thinking = { type: "enabled", budget_tokens: 8192 };
  }
  if (tools.length > 0 || settings.enableWebSearch) {
    const apiTools = tools.map((t, i, arr) => {
      const tool = {
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      };
      if (i === arr.length - 1 && !settings.enableWebSearch) {
        tool.cache_control = { type: "ephemeral" };
      }
      return tool;
    });
    if (settings.enableWebSearch) {
      apiTools.push({
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
        cache_control: { type: "ephemeral" }
      });
    }
    body.tools = apiTools;
  }
  const payload = new ChatPayload(body, "anthropic", model);
  void SentLog.writeLatestSentLog(null, payload);
  const serializedBody = payload.bodyJson;
  const charsSent = payload.charCount;
  const bytesSent = payload.byteCount;
  let response;
  try {
    response = await (0, obsidian.requestUrl)({
      url: ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: serializedBody,
      throw: false
    });
  } catch (e) {
    const err = asRecord(e);
    const status = typeof err.status === "number" ? err.status : "unknown";
    const apiMsg = getNestedString(err, ["json", "error", "message"]);
    if (apiMsg) {
      const err2 = new Error(`Anthropic API error (${status}): ${apiMsg}`);
      err2.aichatTelemetry = { charsSent, bytesSent, sentLogBytes: 0 };
      throw err2;
    }
    if (e instanceof Error) {
      e.aichatTelemetry = { charsSent, bytesSent, sentLogBytes: 0 };
      throw e;
    }
    const err2 = new Error(String(e));
    err2.aichatTelemetry = { charsSent, bytesSent, sentLogBytes: 0 };
    throw err2;
  }
  if (response.status !== 200) {
    const responseJson = response.json;
    const errorText = getNestedString(responseJson, ["error", "message"]) ?? `HTTP ${response.status}`;
    const err2 = new Error(`Anthropic API error (${response.status}): ${errorText}`);
    err2.aichatTelemetry = { charsSent, bytesSent, sentLogBytes: 0 };
    throw err2;
  }
  const data = parseAnthropicResponse(response.json);
  return {
    content: data.content.map(fromAnthropicBlock).filter((b) => b !== null),
    stopReason: normalizeStopReason(data.stop_reason),
    usage: data.usage ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 } : void 0,
    charsSent,
    bytesSent,
    sentLogBytes: 0
  };
}
function parseAnthropicResponse(value) {
  if (!isRecord(value)) return { content: [] };
  const content = Array.isArray(value.content) ? value.content.filter(isRecord).map(toAnthropicContentBlock) : [];
  const usage = isRecord(value.usage) ? {
    input_tokens: typeof value.usage.input_tokens === "number" ? value.usage.input_tokens : 0,
    output_tokens: typeof value.usage.output_tokens === "number" ? value.usage.output_tokens : 0
  } : void 0;
  return {
    content,
    stop_reason: typeof value.stop_reason === "string" ? value.stop_reason : void 0,
    usage
  };
}
function toAnthropicContentBlock(value) {
  return {
    type: isAnthropicBlockType(value.type) ? value.type : "text",
    text: typeof value.text === "string" ? value.text : void 0,
    thinking: typeof value.thinking === "string" ? value.thinking : void 0,
    id: typeof value.id === "string" ? value.id : void 0,
    name: typeof value.name === "string" ? value.name : void 0,
    input: isRecord(value.input) ? value.input : void 0,
    search_results: Array.isArray(value.search_results) ? value.search_results.filter(isSearchResult) : void 0
  };
}
function isAnthropicBlockType(value) {
  return value === "text" || value === "tool_use" || value === "web_search_tool_result" || value === "server_tool_use" || value === "thinking";
}
function isSearchResult(value) {
  return isRecord(value) && typeof value.title === "string" && typeof value.url === "string" && typeof value.snippet === "string";
}
function normalizeStopReason(value) {
  if (value === "tool_use" || value === "max_tokens" || value === "stop") return value;
  return "end_turn";
}
function getNestedString(value, path) {
  let current = value;
  for (const key2 of path) {
    if (!isRecord(current)) return void 0;
    current = current[key2];
  }
  return typeof current === "string" ? current : void 0;
}
function asRecord(value) {
  return isRecord(value) ? value : {};
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function toAnthropicMessage(msg) {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  const blocks = msg.content.map((block2) => {
    if (block2.type === "tool_result") {
      return {
        type: "tool_result",
        tool_use_id: block2.tool_use_id,
        content: block2.content,
        is_error: block2.is_error || false
      };
    }
    if (block2.type === "tool_use") {
      return {
        type: "tool_use",
        id: block2.id,
        name: block2.name,
        input: block2.input
      };
    }
    return { type: "text", text: block2.text };
  }).filter((b) => !(b.type === "text" && !b.text));
  return { role: msg.role, content: blocks };
}
function fromAnthropicBlock(block2) {
  if (block2.type === "tool_use") {
    return {
      type: "tool_use",
      id: block2.id,
      name: block2.name,
      input: block2.input
    };
  }
  if (block2.type === "web_search_tool_result" && block2.search_results) {
    const formatted = block2.search_results.map((r2) => `**${r2.title}**
${r2.url}
${r2.snippet}`).join("\n\n");
    return { type: "text", text: formatted };
  }
  if (block2.type === "thinking" || block2.type === "server_tool_use") {
    return null;
  }
  if (!block2.text) {
    return null;
  }
  return { type: "text", text: block2.text };
}
let ANTHROPIC_API_URL;
function init_anthropic() {
  "use strict";
  ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
}


declareExports({
  sendAnthropicMessage
});


}

{
// src/api/chatgpt-oauth.js

registerInit("chatgpt_oauth", init_chatgpt_oauth, ["types", "chatgptOAuth"]);
function setChatGPTOAuthService(service) {
  oauthService = service;
}
function clearChatGPTOAuthState() {
}
let chatgptIncomingSeq = 0;
async function appendChatIncomingLogLine(line) {
  const app = typeof window !== "undefined" ? window.app : null;
  if (!app?.vault?.adapter) {
    throw new Error("chatIncoming.log unavailable: vault adapter missing");
  }
  const path = "chatIncoming.log";
  if (typeof app.vault.adapter.append === "function") {
    await app.vault.adapter.append(path, `${line}\n`);
    return;
  }
  const exists = typeof app.vault.adapter.exists === "function" ? await app.vault.adapter.exists(path) : false;
  const prior = exists && typeof app.vault.adapter.read === "function" ? await app.vault.adapter.read(path) : "";
  await app.vault.adapter.write(path, `${prior}${line}\n`);
}
async function logChatGPTOAuthIncomingEvent(eventType, payload, meta) {
  chatgptIncomingSeq += 1;
  const entry = {
    v: 1,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    provider: "chatgpt-oauth",
    sessionId: meta?.sessionId ?? "default",
    turnId: meta?.turnId ?? "unknown",
    seq: chatgptIncomingSeq,
    eventType,
    call_id: meta?.call_id ?? null,
    payload
  };
  await appendChatIncomingLogLine(JSON.stringify(entry));
}
async function scanChatGPTOAuthWalForReplayMap(sessionId) {
  const app = typeof window !== "undefined" ? window.app : null;
  if (!app?.vault?.adapter) {
    return { totalCalls: 0, totalResults: 0, pairedCount: 0, orphanCount: 0, replayItems: [] };
  }
  const path = "chatIncoming.log";
  if (!(await app.vault.adapter.exists(path))) {
    return { totalCalls: 0, totalResults: 0, pairedCount: 0, orphanCount: 0, replayItems: [] };
  }
  const raw = await app.vault.adapter.read(path);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const replayById = /* @__PURE__ */ new Map();
  for (const line of lines) {
    let rec = null;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || rec.provider !== "chatgpt-oauth") {
      continue;
    }
    if (sessionId && rec.sessionId !== sessionId) {
      continue;
    }
    const callId = typeof rec.call_id === "string" ? rec.call_id : null;
    if (!callId) {
      continue;
    }
    const eventType = typeof rec.eventType === "string" ? rec.eventType : "";
    const seq = Number.isFinite(rec.seq) ? rec.seq : Number.MAX_SAFE_INTEGER;
    let slot = replayById.get(callId);
    if (!slot) {
      slot = { call_id: callId, firstSeq: seq, callEventType: null, callPayload: null, resultEventTypes: [], resultPayloads: [] };
      replayById.set(callId, slot);
    }
    if (seq < slot.firstSeq) {
      slot.firstSeq = seq;
    }
    if (!slot.callPayload && (eventType.includes("tool_call") || eventType.includes("function_call") || eventType.includes("tool_use"))) {
      slot.callEventType = eventType;
      slot.callPayload = rec.payload ?? null;
      continue;
    }
    if (eventType.includes("tool_result") || eventType.includes("function_call_output")) {
      slot.resultEventTypes.push(eventType);
      slot.resultPayloads.push(rec.payload ?? null);
    }
  }
  const replayItems = Array.from(replayById.values()).sort((a, b) => a.firstSeq - b.firstSeq || a.call_id.localeCompare(b.call_id));
  let totalCalls = 0;
  let totalResults = 0;
  let pairedCount = 0;
  let orphanCount = 0;
  for (const item of replayItems) {
    const hasCall = !!item.callPayload;
    const hasResult = item.resultPayloads.length > 0;
    if (hasCall) totalCalls += 1;
    if (hasResult) totalResults += item.resultPayloads.length;
    if (hasCall && hasResult) pairedCount += 1;
    if (!hasCall && hasResult) orphanCount += 1;
  }
  return { totalCalls, totalResults, pairedCount, orphanCount, replayItems };
}
async function sendChatGPTOAuthMessage(settings, messages, tools, systemPrompt) {
  const turnId = `chatgpt-oauth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = "default";
  const walReplay = await scanChatGPTOAuthWalForReplayMap(sessionId);
  if (walReplay.orphanCount > 0 || walReplay.pairedCount > 0) {
    await logChatGPTOAuthIncomingEvent("wal.scan", {
      walOrphanCount: walReplay.orphanCount,
      walPairedCount: walReplay.pairedCount,
      walTotalCalls: walReplay.totalCalls,
      walTotalResults: walReplay.totalResults
    }, { sessionId, turnId });
  }
  if (!oauthService) {
    throw new ChatGPTOAuthError(
      "ChatGPT OAuth service is not initialized. Reload the plugin."
    );
  }
  let credential;
  try {
    credential = await oauthService.getUsableCredential();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ChatGPTOAuthError(
      `ChatGPT OAuth session expired and refresh failed. Please reconnect your ChatGPT account in settings. (${msg})`
    );
  }
  if (!credential) {
    throw new ChatGPTOAuthError(
      "ChatGPT OAuth is not connected. Open Settings -> AI Chat -> Connect ChatGPT."
    );
  }
  const model = settings.model || CHATGPT_OAUTH_DEFAULT_MODEL;
  const baseBody = {
    model,
    // Replay the full conversation each turn — Codex's `store:false` mode
    // makes server-side `previous_response_id` chaining unavailable.
    input: buildFullHistoryInput(messages),
    instructions: systemPrompt,
    // Required by the Codex backend; omitting it returns
    // 400 {"detail":"Store must be set to false"}.
    store: false,
    // Match the request shape used by other working Codex-via-OAuth clients
    // (verified against the OpenAI Codex CLI and external references). These
    // fields aren't strictly documented as required, but Codex's response
    // pipeline expects them and at least one is required for reasoning models.
    parallel_tool_calls: true
  };
  if (/^o\d/.test(model) || /^gpt-5/.test(model) || /codex/i.test(model)) {
    baseBody.reasoning = { effort: "medium", summary: "auto" };
    baseBody.include = ["reasoning.encrypted_content"];
  }
  const apiTools = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
    // Codex backend (and the OpenAI Responses API generally) accepts
    // `strict` on function tools. Setting `false` matches what the
    // official Codex CLI / other working OAuth-Codex clients send and
    // avoids unintended structured-output validation on free-form tools.
    strict: false
  }));
  if (settings.enableWebSearch) {
    apiTools.push({ type: "web_search" });
  }
  if (apiTools.length > 0) {
    baseBody.tools = apiTools;
  }
  const requestBody = { ...baseBody, stream: true };
  const payload = new ChatPayload(requestBody, "chatgpt-oauth", model);
  void SentLog.writeLatestSentLog(null, payload);
  return sendOnce(
    payload,
    credential.accessToken,
    credential.accountId,
    sessionId,
    turnId,
    { charsSent: payload.charCount, bytesSent: payload.byteCount, sentLogBytes: 0 }
  );
}
async function sendOnce(payload, accessToken, accountId, sessionId, turnId, telemetry) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream, application/json",
    "User-Agent": USER_AGENT2,
    originator: ORIGINATOR
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }
  let response;
  try {
    response = await (0, obsidian.requestUrl)({
      url: CODEX_RESPONSES_URL,
      method: "POST",
      headers,
      body: payload.bodyJson,
      throw: false
    });
  } catch (e) {
    const err = asRecord3(e);
    const status = typeof err.status === "number" || typeof err.status === "string" ? String(err.status) : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    const out = new ChatGPTOAuthError(
      `ChatGPT OAuth request failed (${status}): ${message}`
    );
    out.aichatTelemetry = { ...(telemetry || { charsSent: 0, bytesSent: 0, sentLogBytes: 0 }) };
    throw out;
  }
  if (response.status === 401 || response.status === 403) {
    const out = new ChatGPTOAuthError(
      `ChatGPT OAuth session rejected by the server (HTTP ${response.status}). Please reconnect your ChatGPT account in settings.`
    );
    out.aichatTelemetry = { ...(telemetry || { charsSent: 0, bytesSent: 0, sentLogBytes: 0 }) };
    throw out;
  }
  if (response.status < 200 || response.status >= 300) {
    let json;
    try {
      json = asOptionalRecord(response.json);
    } catch {
      json = void 0;
    }
    const detail = json?.detail;
    const detailText = typeof detail === "string" ? detail : getNestedString3(detail, ["message"]);
    const apiMsg = detailText ?? getNestedString3(json, ["error", "message"]) ?? response.text?.slice(0, 300) ?? `HTTP ${response.status}`;
    const err = new ChatGPTOAuthError(
      `ChatGPT OAuth request failed (${response.status}): ${apiMsg}. The Codex backend may not accept the selected model or request format. Try reconnecting, picking a different model, or switching to OpenAI API Key.`
    );
    err.status = response.status;
    err.aichatTelemetry = { ...(telemetry || { charsSent: 0, bytesSent: 0, sentLogBytes: 0 }) };
    throw err;
  }
  const data = await parseResponseBody(response, sessionId, turnId);
  const parsed = fromResponsesOutput2(data);
  const charsSent = Number(telemetry?.charsSent);
  if (!Number.isFinite(charsSent) || charsSent <= 0) {
    throw new ChatGPTOAuthError("ChatGPT OAuth telemetry missing valid charsSent");
  }
  const bytesSent = Number(telemetry?.bytesSent);
  if (!Number.isFinite(bytesSent) || bytesSent <= 0) {
    throw new ChatGPTOAuthError("ChatGPT OAuth telemetry missing valid bytesSent");
  }
  const sentLogBytes = Number(telemetry?.sentLogBytes);
  return {
    ...parsed,
    charsSent,
    bytesSent,
    sentLogBytes: Number.isFinite(sentLogBytes) && sentLogBytes >= 0 ? sentLogBytes : 0
  };
}
async function parseResponseBody(response, sessionId, turnId) {
  let jsonObj;
  try {
    jsonObj = asOptionalRecord(response.json);
  } catch {
    jsonObj = void 0;
  }
  if (jsonObj && (jsonObj.output || jsonObj.id)) {
    return jsonObj;
  }
  const text2 = response.text ?? "";
  if (!text2) {
    throw new ChatGPTOAuthError("ChatGPT OAuth response was empty.");
  }
  const events = parseSSE(text2);
  const itemByIndex = /* @__PURE__ */ new Map();
  let completedResponse = null;
  let failureMessage = null;
  for (const evt of events) {
    const evtType = stringValue2(evt.type) || "event";
    const evtCallId = stringValue2(evt.call_id) || stringValue2(evt.item?.call_id) || stringValue2(evt.item?.id) || null;
    await logChatGPTOAuthIncomingEvent(evtType, evt, { sessionId, turnId, call_id: evtCallId });
    const type = stringValue2(evt.type);
    if (type === "response.output_item.done") {
      const item = asOptionalRecord(evt.item);
      if (item) {
        const key2 = outputKey(evt.output_index) ?? (stringValue2(item.id) || itemByIndex.size);
        itemByIndex.set(key2, item);
      }
    } else if (type === "response.completed") {
      completedResponse = asOptionalRecord(evt.response) ?? {};
    } else if (type === "response.incomplete") {
      completedResponse = asOptionalRecord(evt.response) ?? {};
    } else if (type === "response.failed") {
      failureMessage = getNestedString3(evt.response, ["error", "message"]) ?? "ChatGPT OAuth response failed";
    } else if (type === "error" && typeof evt.message === "string") {
      failureMessage = evt.message;
    }
  }
  if (failureMessage) throw new ChatGPTOAuthError(failureMessage);
  if (completedResponse || itemByIndex.size > 0) {
    const synthesized = {
      ...completedResponse ?? {},
      output: Array.from(itemByIndex.values())
    };
    return synthesized;
  }
  throw new ChatGPTOAuthError(
    "ChatGPT OAuth stream ended without a completed response."
  );
}
function parseSSE(text2) {
  const events = [];
  const blocks = text2.split(/\r?\n\r?\n/);
  for (const block2 of blocks) {
    if (!block2.trim()) continue;
    const lines = block2.split(/\r?\n/);
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") continue;
    try {
      const event2 = JSON.parse(payload);
      if (isRecord3(event2)) events.push(event2);
    } catch {
    }
  }
  return events;
}
function buildFullHistoryInput(messages) {
  const items = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    if (typeof msg.content === "string") {
      items.push({ type: "message", role, content: msg.content });
      continue;
    }
    for (const block2 of msg.content) {
      if (block2.type === "text" && block2.text) {
        items.push({ type: "message", role, content: block2.text });
      } else if (block2.type === "tool_use" && block2.name && block2.id) {
        items.push({
          type: "function_call",
          call_id: block2.id,
          name: block2.name,
          arguments: JSON.stringify(block2.input ?? {})
        });
      } else if (block2.type === "tool_result" && block2.tool_use_id) {
        const hasMatchingCall = items.some((it) => it?.type === "function_call" && it?.call_id === block2.tool_use_id);
        if (hasMatchingCall) {
          items.push({
            type: "function_call_output",
            call_id: block2.tool_use_id,
            output: block2.content ?? ""
          });
        } else {
          items.push({
            type: "function_call",
            call_id: block2.tool_use_id,
            name: "__orphaned_tool_result__",
            arguments: JSON.stringify({
              cause: "no_matching_function_call",
              source: "history_replay"
            })
          });
          items.push({
            type: "function_call_output",
            call_id: block2.tool_use_id,
            output: block2.content ?? ""
          });
        }
      }
    }
  }
  return items;
}
function fromResponsesOutput2(data) {
  const output = Array.isArray(data.output) ? data.output.filter(isRecord3) : [];
  const content = [];
  let hasToolCalls = false;
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content.filter(isRecord3)) {
        if (part.type === "output_text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      hasToolCalls = true;
      let input = {};
      try {
        const parsed = JSON.parse(typeof item.arguments === "string" ? item.arguments : "{}");
        input = isRecord3(parsed) ? parsed : { _raw: parsed };
      } catch {
        input = { _raw: item.arguments };
      }
      content.push({
        type: "tool_use",
        id: stringValue2(item.call_id) || stringValue2(item.id),
        name: stringValue2(item.name),
        input
      });
    }
  }
  const stopReason = hasToolCalls ? "tool_use" : "end_turn";
  const usage = isRecord3(data.usage) ? data.usage : void 0;
  return {
    content,
    stopReason,
    usage: usage ? { inputTokens: numberValue2(usage.input_tokens), outputTokens: numberValue2(usage.output_tokens) } : void 0
  };
}
function numberValue2(value) {
  return typeof value === "number" ? value : 0;
}
function stringValue2(value) {
  return typeof value === "string" ? value : "";
}
function outputKey(value) {
  return typeof value === "string" || typeof value === "number" ? value : void 0;
}
function getNestedString3(value, path) {
  let current = value;
  for (const key2 of path) {
    if (!isRecord3(current)) return void 0;
    current = current[key2];
  }
  return typeof current === "string" ? current : void 0;
}
function asRecord3(value) {
  return isRecord3(value) ? value : {};
}
function asOptionalRecord(value) {
  return isRecord3(value) ? value : void 0;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}
let CODEX_RESPONSES_URL, ORIGINATOR, USER_AGENT2, oauthService;
function init_chatgpt_oauth() {
  "use strict";
  CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
  ORIGINATOR = "opencode";
  USER_AGENT2 = "OpenAI/JS 4.x aichat/0.1";
  oauthService = null;
}


declareExports({
  sendChatGPTOAuthMessage,
  setChatGPTOAuthService,
  clearChatGPTOAuthState
});


}

{
// src/api/client.js
registerInit("client", init_client, ["anthropic", "openai", "chatgpt_oauth"]);

function summarizeTelemetryPayload(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  if (Array.isArray(value)) return `array(len=${value.length})`;
  if (typeof value === "object") {
    try {
      const keys = Object.keys(value);
      return `object(keys=${keys.join(",") || "(none)"})`;
    } catch {
      return "object(uninspectable)";
    }
  }
  return `${typeof value}(${String(value)})`;
}

function readAichatTelemetry(value, context = "unknown") {
  if (typeof value !== "object" || value === null) {
    throw new Error(`AI response telemetry missing object payload (${context}); got ${summarizeTelemetryPayload(value)}`);
  }
  const charsSent = value.charsSent;
  if (typeof charsSent !== "number" || !Number.isFinite(charsSent) || charsSent <= 0) {
    throw new Error(`AI response telemetry missing valid charsSent (${context}); got ${summarizeTelemetryPayload(charsSent)}`);
  }
  const bytesSent = value.bytesSent;
  if (typeof bytesSent !== "number" || !Number.isFinite(bytesSent) || bytesSent <= 0) {
    throw new Error(`AI response telemetry missing valid bytesSent (${context}); got ${summarizeTelemetryPayload(bytesSent)}`);
  }
  return { charsSent, bytesSent };
}

function rethrowWithTelemetryDiagnostics(error, telemetryPayload, context, diagnosticsCause = null) {
  const baseError = error instanceof Error ? error : new Error(String(error));
  const baseStack = baseError.stack || `${baseError.name}: ${baseError.message}`;
  const payloadSummary = summarizeTelemetryPayload(telemetryPayload);
  const diagnosticsMessage = diagnosticsCause instanceof Error
    ? diagnosticsCause.message
    : String(diagnosticsCause || "(none)");

  const loud = new Error(
    [
      `AI response telemetry validation failed in ${context}.`,
      `telemetryPayload=${payloadSummary}`,
      `originalError=${baseError.name}: ${baseError.message}`,
      `telemetryValidationError=${diagnosticsMessage}`,
      `originalStack:\n${baseStack}`
    ].join("\n")
  );
  loud.name = "AichatTelemetryError";
  loud.aichatTelemetry = { charsSent: 0, bytesSent: 0 };
  loud.cause = baseError;
  throw loud;
}

function applyAichatTelemetry(target, totals) {
  target.charsSent = totals.charsSent;
  target.bytesSent = totals.bytesSent;
}

async function sendMessage(settings, messages, tools, systemPrompt, chatFileCache, app = null) {
  const doSend = () => {
    if (settings.provider === "anthropic") {
      return sendAnthropicMessage(settings, messages, tools, systemPrompt, chatFileCache);
    }
    if (settings.provider === "chatgpt-oauth") {
      return sendChatGPTOAuthMessage(settings, messages, tools, systemPrompt, chatFileCache);
    }
    return sendOpenAIMessage(settings, messages, tools, systemPrompt, chatFileCache, app);
  };

  const totals = { charsSent: 0, bytesSent: 0 };
  const runAttempt = async () => {
    const response = await doSend();
    const t = readAichatTelemetry(response, "sendMessage.runAttempt.response");
    totals.charsSent += t.charsSent;
    totals.bytesSent += t.bytesSent;
    applyAichatTelemetry(response, totals);
    return response;
  };

  try {
    return await runAttempt();
  } catch (e) {
    let first;
    try {
      first = readAichatTelemetry(e?.aichatTelemetry, "sendMessage.firstCatch.errorTelemetry");
    } catch (telemetryErr) {
      rethrowWithTelemetryDiagnostics(e, e?.aichatTelemetry, "sendMessage.firstCatch", telemetryErr);
    }
    totals.charsSent += first.charsSent;
    totals.bytesSent += first.bytesSent;

    if (isRateLimitError(e)) {
      const retryAfter = extractRetryAfter(e);
      const delay = retryAfter ? retryAfter * 1e3 : 5e3;
      await sleep2(Math.min(delay, 3e4));
      try {
        return await runAttempt();
      } catch (retryError) {
        let retryTelemetry;
        try {
          retryTelemetry = readAichatTelemetry(retryError?.aichatTelemetry, "sendMessage.retryCatch.errorTelemetry");
        } catch (retryTelemetryErr) {
          rethrowWithTelemetryDiagnostics(retryError, retryError?.aichatTelemetry, "sendMessage.retryCatch", retryTelemetryErr);
        }
        totals.charsSent += retryTelemetry.charsSent;
        totals.bytesSent += retryTelemetry.bytesSent;
        if (retryError instanceof Error) {
          retryError.aichatTelemetry = { ...totals };
          throw retryError;
        }
        const wrapped = new Error(String(retryError));
        wrapped.aichatTelemetry = { ...totals };
        throw wrapped;
      }
    }

    if (e instanceof Error) {
      e.aichatTelemetry = { ...totals };
      throw e;
    }
    const wrapped = new Error(String(e));
    wrapped.aichatTelemetry = { ...totals };
    throw wrapped;
  }
}
function isRateLimitError(e) {
  if (e instanceof Error) {
    return e.message.includes("429") || e.message.toLowerCase().includes("rate limit");
  }
  return false;
}
function extractRetryAfter(e) {
  if (e instanceof Error) {
    const match = e.message.match(/retry.after[:\s]*(\d+)/i);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}
function sleep2(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function init_client() {
  "use strict";
}

declareExports({
  sendMessage
});

}

{
// src/api/openai.js

registerInit("openai", init_openai);
function clearOpenAIState() {
  previousResponseId = null;
}
function noteOpenAIRecoveryAttempt(note) {
  if (!note) return;
  openaiRecoveryNotes.push(String(note));
}
function consumeOpenAIRecoveryNotes() {
  const out = openaiRecoveryNotes.slice();
  openaiRecoveryNotes.length = 0;
  return out;
}
let openAIIncomingSeq = 0;
async function appendChatIncomingLogLine(line) {
  const app = typeof window !== "undefined" ? window.app : null;
  if (!app?.vault?.adapter) {
    throw new Error("chatIncoming.log unavailable: vault adapter missing");
  }
  const path = "chatIncoming.log";
  if (typeof app.vault.adapter.append === "function") {
    await app.vault.adapter.append(path, `${line}\n`);
    return;
  }
  const exists = typeof app.vault.adapter.exists === "function" ? await app.vault.adapter.exists(path) : false;
  const prior = exists && typeof app.vault.adapter.read === "function" ? await app.vault.adapter.read(path) : "";
  await app.vault.adapter.write(path, `${prior}${line}\n`);
}
async function logOpenAIIncomingEvent(eventType, payload, meta) {
  openAIIncomingSeq += 1;
  const entry = {
    v: 1,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    provider: "openai",
    sessionId: meta?.sessionId ?? "default",
    turnId: meta?.turnId ?? "unknown",
    seq: openAIIncomingSeq,
    eventType,
    call_id: meta?.call_id ?? null,
    payload
  };
  await appendChatIncomingLogLine(JSON.stringify(entry));
}
async function logOpenAIInboundResponse(data, meta) {
  const output = Array.isArray(data.output) ? data.output.filter(isRecord2) : [];
  for (const item of output) {
    const type = stringValue2(item.type) || "output_item";
    const callId = typeof item.call_id === "string" ? item.call_id : null;
    await logOpenAIIncomingEvent(`response.${type}`, item, { ...meta, call_id: callId });
  }
}
async function scanOpenAIWalForReplayMap(sessionId) {
  const app = typeof window !== "undefined" ? window.app : null;
  if (!app?.vault?.adapter) {
    return { totalCalls: 0, totalResults: 0, pairedCount: 0, orphanCount: 0, replayItems: [] };
  }
  const path = "chatIncoming.log";
  if (!(await app.vault.adapter.exists(path))) {
    return { totalCalls: 0, totalResults: 0, pairedCount: 0, orphanCount: 0, replayItems: [] };
  }
  const raw = await app.vault.adapter.read(path);
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const replayById = /* @__PURE__ */ new Map();
  for (const line of lines) {
    let rec = null;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || rec.provider !== "openai") {
      continue;
    }
    if (sessionId && rec.sessionId !== sessionId) {
      continue;
    }
    const callId = typeof rec.call_id === "string" ? rec.call_id : null;
    if (!callId) {
      continue;
    }
    const eventType = typeof rec.eventType === "string" ? rec.eventType : "";
    const seq = Number.isFinite(rec.seq) ? rec.seq : Number.MAX_SAFE_INTEGER;
    let slot = replayById.get(callId);
    if (!slot) {
      slot = { call_id: callId, firstSeq: seq, callEventType: null, callPayload: null, resultEventTypes: [], resultPayloads: [] };
      replayById.set(callId, slot);
    }
    if (seq < slot.firstSeq) {
      slot.firstSeq = seq;
    }
    if (!slot.callPayload && (eventType.includes("function_call") || eventType.includes("tool_call"))) {
      slot.callEventType = eventType;
      slot.callPayload = rec.payload ?? null;
      continue;
    }
    if (eventType.includes("function_call_output") || eventType.includes("tool_result")) {
      slot.resultEventTypes.push(eventType);
      slot.resultPayloads.push(rec.payload ?? null);
    }
  }
  const replayItems = Array.from(replayById.values()).sort((a, b) => a.firstSeq - b.firstSeq || a.call_id.localeCompare(b.call_id));
  let totalCalls = 0;
  let totalResults = 0;
  let pairedCount = 0;
  let orphanCount = 0;
  for (const item of replayItems) {
    const hasCall = !!item.callPayload;
    const hasResult = item.resultPayloads.length > 0;
    if (hasCall) totalCalls += 1;
    if (hasResult) totalResults += item.resultPayloads.length;
    if (hasCall && hasResult) pairedCount += 1;
    if (!hasCall && hasResult) orphanCount += 1;
  }
  return { totalCalls, totalResults, pairedCount, orphanCount, replayItems };
}
async function sendOpenAIMessage(settings, messages, tools, systemPrompt, chatFileCache, app = null) {
  return sendOpenAIMessageAttempt(settings, messages, tools, systemPrompt, chatFileCache, true, app);
}
async function sendOpenAIMessageAttempt(settings, messages, tools, systemPrompt, chatFileCache, allowChainResetRetry, app = null) {
  const turnId = `openai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = "default";
  const walReplay = await scanOpenAIWalForReplayMap(sessionId);
  if (walReplay.orphanCount > 0 || walReplay.pairedCount > 0) {
    noteOpenAIRecoveryAttempt(`WAL scan: ${walReplay.pairedCount} paired call_id group${walReplay.pairedCount === 1 ? "" : "s"}, ${walReplay.orphanCount} orphan tool_result group${walReplay.orphanCount === 1 ? "" : "s"}.`);
    await logOpenAIIncomingEvent("wal.scan", {
      walOrphanCount: walReplay.orphanCount,
      walPairedCount: walReplay.pairedCount,
      walTotalCalls: walReplay.totalCalls,
      walTotalResults: walReplay.totalResults
    }, { sessionId, turnId });
  }
  const baseUrl = DEFAULT_OPENAI_URL;
  const model = settings.model || "gpt-5.3-codex";
  const input = await buildCurrentTurnInput(messages, systemPrompt, chatFileCache, app);
  const body = {
    model,
    instructions: systemPrompt,
    input
  };
  delete body.previous_response_id;
  delete body.previousResponseId;

  if (/^o\d/.test(model) || /^gpt-5/.test(model)) {
    body.reasoning = { effort: "medium" };
  }
  const apiTools = tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema
  }));
  if (settings.enableWebSearch) {
    apiTools.push({ type: "web_search_preview" });
  }
  if (apiTools.length > 0) {
    body.tools = apiTools;
  }

  const payload = new ChatPayload(body, "openai", model);
  void SentLog.writeLatestSentLog(app, payload);
  const serializedBody = payload.bodyJson;
  const charsSent = payload.charCount;
  const bytesSent = payload.byteCount;
  let response;
  try {
    response = await (0, obsidian.requestUrl)({
      url: `${baseUrl}/v1/responses`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: serializedBody,
      throw: false
    });
  } catch (e) {
    const err = asRecord2(e);
    const status = typeof err.status === "number" || typeof err.status === "string" ? String(err.status) : "";
    const message = typeof err.message === "string" ? err.message : String(e);
    const apiMsg = getNestedString2(err, ["json", "error", "message"]);
    const combined = `${apiMsg || ""} ${message || ""}`.trim();
    if (allowChainResetRetry && shouldResetOpenAIChain(status, combined)) {
      noteOpenAIRecoveryAttempt(`OpenAI retry attempt: reset response chain after ${status || "unknown"} chain-desync error.`);
      previousResponseId = null;
      return sendOpenAIMessageAttempt(settings, messages, tools, systemPrompt, chatFileCache, false, app);
    }
    if (apiMsg) {
      const err2 = new Error(`OpenAI API error (${status || "unknown"}): ${apiMsg}`);
      err2.aichatTelemetry = { charsSent, bytesSent };
      throw err2;
    }
    const err2 = new Error(`OpenAI request failed (${status}): ${message}`);
    err2.aichatTelemetry = { charsSent, bytesSent };
    throw err2;
  }
  if (response.status !== 200) {
    const errorBody = getNestedString2(response.json, ["error", "message"]) ?? `HTTP ${response.status}`;
    if (allowChainResetRetry && shouldResetOpenAIChain(String(response.status), errorBody)) {
      noteOpenAIRecoveryAttempt(`OpenAI retry attempt: reset response chain after ${response.status} chain-desync error.`);
      previousResponseId = null;
      return sendOpenAIMessageAttempt(settings, messages, tools, systemPrompt, chatFileCache, false, app);
    }
    const err2 = new Error(`OpenAI API error (${response.status}): ${errorBody}`);
    err2.aichatTelemetry = { charsSent, bytesSent };
    throw err2;
  }
  const data = asRecord2(response.json);
  await logOpenAIInboundResponse(data, { sessionId, turnId });
  previousResponseId = null;
  const parsed = fromResponsesOutput(data);
  return { ...parsed, charsSent, bytesSent };
}
function shouldResetOpenAIChain(status, message) {
  const s = String(status || "").trim();
  const m = String(message || "").toLowerCase();
  const statusSuggestsChainIssue = s === "400" || s === "404" || s === "409" || s === "410";
  if (!statusSuggestsChainIssue) return false;

  const hasPreviousIdIssue = m.includes("previous_response_id") || m.includes("response id") && (m.includes("invalid") || m.includes("not found") || m.includes("expired"));
  const hasToolChainIssue = m.includes("function_call_output") || m.includes("tool call") && m.includes("call_id") || m.includes("tool output") && m.includes("function call");

  return hasPreviousIdIssue || hasToolChainIssue;
}
async function buildCurrentTurnInput(messages, systemPrompt, chatFileCache, app = null) {
  const items = [];
  const replayItems = [];

  for (const msg of messages) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    if (typeof msg.content === "string") {
      const text2 = msg.content;
      if (text2) {
        replayItems.push({
          type: "message",
          role,
          content: text2
        });
      }
      continue;
    }
    for (const block2 of msg.content) {
      if (block2.type === "text" && block2.text) {
        replayItems.push({
          type: "message",
          role,
          content: block2.text
        });
      } else if (block2.type === "tool_use" && block2.name && block2.id) {
        replayItems.push({
          type: "function_call",
          call_id: block2.id,
          name: block2.name,
          arguments: JSON.stringify(block2.input ?? {})
        });
      } else if (block2.type === "tool_result" && block2.tool_use_id) {
        const hasMatchingCall = replayItems.some((it) => it?.type === "function_call" && it?.call_id === block2.tool_use_id);
        if (hasMatchingCall) {
          replayItems.push({
            type: "function_call_output",
            call_id: block2.tool_use_id,
            output: block2.content || ""
          });
        } else {
          replayItems.push({
            type: "function_call",
            call_id: block2.tool_use_id,
            name: "__orphaned_tool_result__",
            arguments: JSON.stringify({
              cause: "no_matching_function_call",
              source: "history_replay"
            })
          });
          replayItems.push({
            type: "function_call_output",
            call_id: block2.tool_use_id,
            output: block2.content || ""
          });
        }
      }
    }
  }

  const cfcEntries = await chatFileCache.buildEntriesForRequest(messages, 0, app);
  const cfcSystemMessages = chatFileCache.buildSystemMessagesFromEntries(cfcEntries);
  if (cfcSystemMessages.length > 0) {
    for (const cfcMessage of cfcSystemMessages) {
      items.push(cfcMessage);
    }
  } else {
    items.push({
      type: "message",
      role: "system",
      content: "Chat File Cache (CFC):\n(empty)"
    });
  }

  items.push(...replayItems);
  return items;
}
function fromResponsesOutput(data) {
  const output = Array.isArray(data.output) ? data.output.filter(isRecord2) : [];
  const content = [];
  let hasToolCalls = false;
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content.filter(isRecord2)) {
        if (part.type === "output_text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      hasToolCalls = true;
      let input = {};
      try {
        const parsed = JSON.parse(typeof item.arguments === "string" ? item.arguments : "{}");
        input = isRecord2(parsed) ? parsed : { _raw: parsed };
      } catch {
        input = { _raw: item.arguments };
      }
      content.push({
        type: "tool_use",
        id: stringValue(item.call_id) || stringValue(item.id),
        name: stringValue(item.name),
        input
      });
    }
  }
  const stopReason = hasToolCalls ? "tool_use" : "end_turn";
  const usage = isRecord2(data.usage) ? data.usage : void 0;
  const inputTokens = usage ? numberValue(usage.input_tokens) : 0;
  const outputTokens = usage ? numberValue(usage.output_tokens) : 0;
  const totalTokens = usage
    ? (typeof usage.total_tokens === "number" ? numberValue(usage.total_tokens) : inputTokens + outputTokens)
    : 0;
  return {
    content,
    stopReason,
    usage: usage ? { inputTokens, outputTokens, totalTokens } : void 0
  };
}
function numberValue(value) {
  return typeof value === "number" ? value : 0;
}
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
function getNestedString2(value, path) {
  let current = value;
  for (const key2 of path) {
    if (!isRecord2(current)) return void 0;
    current = current[key2];
  }
  return typeof current === "string" ? current : void 0;
}
function asRecord2(value) {
  return isRecord2(value) ? value : {};
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
let DEFAULT_OPENAI_URL, previousResponseId, openaiRecoveryNotes;
function init_openai() {
  "use strict";
  DEFAULT_OPENAI_URL = "https://api.openai.com";
  previousResponseId = null;
  openaiRecoveryNotes = [];
}


declareExports({
  sendOpenAIMessage,
  clearOpenAIState,
  consumeOpenAIRecoveryNotes
});


}

{
// src/auth/chatgptOAuth.js

registerInit("chatgptOAuth", init_chatgptOAuth);
let ISSUER, CLIENT_ID, DEVICE_VERIFICATION_URI, DEVICE_REDIRECT_URI, POLL_MARGIN_MS, USER_AGENT, ChatGPTOAuthError, sleep, base64UrlDecode, parseJwtClaims, extractAccountIdFromClaims, extractAccountId, describeError, ChatGPTOAuthService;
function init_chatgptOAuth() {
  "use strict";
  ISSUER = "https://auth.openai.com";
  CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
  DEVICE_VERIFICATION_URI = `${ISSUER}/codex/device`;
  DEVICE_REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
  POLL_MARGIN_MS = 3e3;
  USER_AGENT = "aichat/chatgpt-oauth";
  ChatGPTOAuthError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ChatGPTOAuthError";
    }
  };
  sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  base64UrlDecode = (input) => {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - padded.length % 4);
    return atob(padded + padding);
  };
  parseJwtClaims = (token) => {
    const parts = token.split(".");
    if (parts.length !== 3) return void 0;
    try {
      return JSON.parse(base64UrlDecode(parts[1]));
    } catch {
      return void 0;
    }
  };
  extractAccountIdFromClaims = (claims) => {
    return claims.chatgpt_account_id || claims["https://api.openai.com/auth"]?.chatgpt_account_id || claims.organizations?.[0]?.id;
  };
  extractAccountId = (tokens) => {
    if (tokens.id_token) {
      const claims = parseJwtClaims(tokens.id_token);
      if (claims) {
        const accountId = extractAccountIdFromClaims(claims);
        if (accountId) return accountId;
      }
    }
    const accessClaims = parseJwtClaims(tokens.access_token);
    return accessClaims ? extractAccountIdFromClaims(accessClaims) : void 0;
  };
  describeError = (response) => {
    if (typeof response.text === "string" && response.text.trim()) {
      return ` — ${response.text.trim().slice(0, 300)}`;
    }
    if (response.json && typeof response.json === "object") {
      try {
        return ` — ${JSON.stringify(response.json)}`;
      } catch {
        return "";
      }
    }
    return "";
  };
  ChatGPTOAuthService = class {
    constructor(store) {
      this.store = store;
    }
    /** Synchronous read of the stored credential (whether or not it's expired). */
    getCredential() {
      return this.store.get();
    }
    /** Wipe the stored credential. */
    clearCredential() {
      this.store.clear();
    }
    /**
     * Start the device authorization flow.
     * Returns the user-facing code + verification URL the user must visit.
     */
    async beginDeviceAuthorization() {
      const response = await (0, obsidian.requestUrl)({
        url: `${ISSUER}/api/accounts/deviceauth/usercode`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({ client_id: CLIENT_ID }),
        throw: false
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ChatGPTOAuthError(
          `Failed to start ChatGPT device authorization: HTTP ${response.status}${describeError(response)}`
        );
      }
      const data = response.json;
      if (!data?.device_auth_id || !data?.user_code) {
        throw new ChatGPTOAuthError("Device authorization response was missing required fields.");
      }
      const intervalSec = Math.max(parseInt(String(data.interval ?? "5"), 10) || 5, 1);
      return {
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
        verificationUri: DEVICE_VERIFICATION_URI,
        intervalMs: intervalSec * 1e3
      };
    }
    /**
     * Poll for completion of a device authorization. Resolves with the stored
     * credential when the user finishes authorizing, or rejects on cancel /
     * unrecoverable error. Use `cancel()` from the returned handle to stop.
     */
    pollDeviceAuthorization(authorization) {
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };
      const promise = (async () => {
        while (true) {
          if (cancelled) {
            throw new ChatGPTOAuthError("ChatGPT login was cancelled.");
          }
          const response = await (0, obsidian.requestUrl)({
            url: `${ISSUER}/api/accounts/deviceauth/token`,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": USER_AGENT
            },
            body: JSON.stringify({
              device_auth_id: authorization.deviceAuthId,
              user_code: authorization.userCode
            }),
            throw: false
          });
          if (response.status >= 200 && response.status < 300) {
            const data = response.json;
            if (typeof data.authorization_code !== "string" || typeof data.code_verifier !== "string") {
              throw new ChatGPTOAuthError("Device authorization returned an invalid token payload.");
            }
            const credential = await this.exchangeAuthorizationCode({
              code: data.authorization_code,
              codeVerifier: data.code_verifier,
              redirectUri: DEVICE_REDIRECT_URI
            });
            this.store.set(credential);
            return credential;
          }
          if (response.status !== 403 && response.status !== 404) {
            throw new ChatGPTOAuthError(
              `Device authorization polling failed: HTTP ${response.status}${describeError(response)}`
            );
          }
          await sleep(authorization.intervalMs + POLL_MARGIN_MS);
        }
      })();
      return { promise, cancel };
    }
    /**
     * Refresh an expiring credential. Stores the new credential on success.
     */
    async refreshCredential(credential) {
      const response = await (0, obsidian.requestUrl)({
        url: `${ISSUER}/oauth/token`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.refreshToken,
          client_id: CLIENT_ID
        }).toString(),
        throw: false
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ChatGPTOAuthError(
          `ChatGPT token refresh failed: HTTP ${response.status}${describeError(response)}`
        );
      }
      const data = response.json;
      const next2 = this.toCredential(data, credential.accountId);
      this.store.set(next2);
      return next2;
    }
    /**
     * Return a credential that is guaranteed to be currently valid, refreshing
     * if necessary. Returns null if there's no stored credential at all.
     * Throws if a refresh is needed but fails.
     */
    async getUsableCredential() {
      const current = this.store.get();
      if (!current) return null;
      if (!this.store.isExpired(current)) return current;
      return this.refreshCredential(current);
    }
    /** Exchange an authorization code (from device flow) for tokens. */
    async exchangeAuthorizationCode(input) {
      const response = await (0, obsidian.requestUrl)({
        url: `${ISSUER}/oauth/token`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: CLIENT_ID,
          code_verifier: input.codeVerifier
        }).toString(),
        throw: false
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ChatGPTOAuthError(
          `ChatGPT token exchange failed: HTTP ${response.status}${describeError(response)}`
        );
      }
      return this.toCredential(response.json);
    }
    toCredential(tokens, fallbackAccountId) {
      const now = Date.now();
      const accountId = extractAccountId(tokens) ?? fallbackAccountId;
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: now + (tokens.expires_in ?? 3600) * 1e3,
        updatedAt: now,
        ...tokens.id_token ? { idToken: tokens.id_token } : {},
        ...accountId ? { accountId } : {}
      };
    }
  };
  declareExports({
    ChatGPTOAuthService,
    ChatGPTOAuthError
  });
}



}

{
// src/auth/chatgptOAuthStore.js

let OAUTH_SECRET_KEY = "aichat-chatgpt-oauth";
let LEGACY_OAUTH_SECRET_KEY = "obsidian-chatting-chatgpt-oauth";
let EXPIRY_BUFFER_MS = 3e4;
let ChatGPTOAuthStore = class {
  constructor(app) {
    this.app = app;
  }
  /** Read the stored credential. Returns null if absent or malformed. */
  get() {
    let raw = null;
    try {
      raw = this.app.secretStorage.getSecret(OAUTH_SECRET_KEY) ?? this.app.secretStorage.getSecret(LEGACY_OAUTH_SECRET_KEY) ?? null;
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string" || typeof parsed.expiresAt !== "number" || typeof parsed.updatedAt !== "number") {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      updatedAt: parsed.updatedAt,
      ...typeof parsed.accountId === "string" ? { accountId: parsed.accountId } : {},
      ...typeof parsed.idToken === "string" ? { idToken: parsed.idToken } : {}
    };
  }
  /** Write the credential. */
  set(credential) {
    try {
      this.app.secretStorage.setSecret(OAUTH_SECRET_KEY, JSON.stringify(credential));
    } catch {
    }
  }
  /** Erase the credential. SecretStorage has no delete API, so we overwrite with empty. */
  clear() {
    try {
      this.app.secretStorage.setSecret(OAUTH_SECRET_KEY, "");
    } catch {
    }
  }
  /** True if the access token has already expired (or expires within ~30s). */
  isExpired(credential) {
    return credential.expiresAt <= Date.now() + EXPIRY_BUFFER_MS;
  }
};

declareExports({
  ChatGPTOAuthStore
});


}

{
// src/main.js

registerInit("types", init_types);

registerInit("chatgptOAuth", init_chatgptOAuth);
registerInit("chatgpt_oauth", init_chatgpt_oauth, ["types", "chatgptOAuth"]);
let PLUGIN_ID = "aichat";
let LEGACY_PLUGIN_ID = "obsidian-chatting";
let LEGACY_RELEASE_ASSETS = /* @__PURE__ */ new Set(["main.js", "manifest.json", "styles.css"]);
let SECRET_PROVIDERS = ["anthropic", "openai", "chatgpt-oauth"];
let CHATGPT_OAUTH_SECRET_KEY = `${PLUGIN_ID}-chatgpt-oauth`;
let LEGACY_CHATGPT_OAUTH_SECRET_KEY = `${LEGACY_PLUGIN_ID}-chatgpt-oauth`;
let ChatPlugin = class extends obsidian.Plugin {
  settings = DEFAULT_SETTINGS;
  /** Shared agent loop that persists across view open/close cycles */
  agent;
  /** ChatGPT OAuth service (used by the chatgpt-oauth provider). */
  chatgptOAuth;
  /** Chat messages for replaying into the UI when the view reopens */
  chatHistory = [];
  runtimeErrorHandlersInstalled = false;
  constructor(app, manifest) {
    console.log("[aichat] plugin constructor:enter");
    super(app, manifest);
    void this.appendStartupLogLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] aichat constructor after super`);
  }
  installRuntimeErrorHandlers() {
    if (this.runtimeErrorHandlersInstalled) return;
    this.runtimeErrorHandlersInstalled = true;
    try {
      window.addEventListener("error", (event) => {
        const err = event?.error;
        const text = err instanceof Error ? err.stack || err.message : event?.message || String(err || "unknown error");
        routeAichatRuntimeError(text, "window.error");
      });
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason;
        const text = reason instanceof Error ? reason.stack || reason.message : String(reason || "unhandled rejection");
        routeAichatRuntimeError(text, "window.unhandledrejection");
      });
    } catch {
    }
  }
  async appendStartupLogLine(line) {
    try {
      if (typeof appendStartupLogLine === "function") {
        await appendStartupLogLine(line);
        return;
      }
      const adapter = this.app?.vault?.adapter;
      if (!adapter) return;
      const path = "aichat/start.log";
      if (typeof adapter.append === "function") {
        await adapter.append(path, `${line}\n`);
        return;
      }
      const prior = await adapter.exists(path) ? await adapter.read(path) : "";
      await adapter.write(path, `${prior}${line}\n`);
    } catch {
    }
  }
  async compactChatIncomingLogAtStartup() {
    try {
      const adapter = this.app?.vault?.adapter;
      if (!adapter) return;
      const path = "chatIncoming.log";
      if (!(await adapter.exists(path))) return;
      const raw = await adapter.read(path);
      const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
      if (lines.length <= 1e3) return;
      const compacted = `${lines.slice(-1e3).join("\n")}\n`;
      await adapter.write(path, compacted);
    } catch {
    }
  }
  async onload() {
    this.installRuntimeErrorHandlers();
    setAichatStartupComplete(false);
    const startupTs = (/* @__PURE__ */ new Date()).toISOString();
    await this.appendStartupLogLine(`[${startupTs}] aichat onload start`);
    await this.compactChatIncomingLogAtStartup();
    const logStartupStep = async (step) => {
      await this.appendStartupLogLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] startup step | ${step}`);
    };
    try {
    await logStartupStep("inits:start");
    runRegisteredInits();
    await logStartupStep("inits:ok");
    await logStartupStep("migrateLegacyPluginData:start");
    await this.migrateLegacyPluginData();
    await logStartupStep("migrateLegacyPluginData:ok");
    await logStartupStep("loadSettings:start");
    await this.loadSettings();
    this.applyKeyboardHeightSetting();
    await logStartupStep("loadSettings:ok");
    await logStartupStep("oauth:init:start");
    const oauthStore = new ChatGPTOAuthStore(this.app);
    this.chatgptOAuth = new ChatGPTOAuthService(oauthStore);
    setChatGPTOAuthService(this.chatgptOAuth);
    await logStartupStep("oauth:init:ok");
    await logStartupStep("agent:init:start");
    this.agent = new AgentLoop(this.app, this.settings);
    await logStartupStep("agent:init:ok");
    await logStartupStep("chatHistory:load:start");
    await this.loadChatHistory();
    await logStartupStep("chatHistory:load:ok");
    await logStartupStep("ui:register:start");
    this.addSettingTab(new ChatSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ObsidianChatView(leaf, this));
    this.addRibbonIcon("message-circle", "Open AI Chat", (evt) => {
      if (evt.type === "contextmenu" || evt.button === 2) {
        const menu = new obsidian.Menu();
        menu.addItem(
          (item) => item.setTitle("Open chat").setIcon("message-circle").onClick(() => void this.openChat())
        );
        menu.addItem(
          (item) => item.setTitle("Chat about active note").setIcon("file-text").onClick(() => void this.chatAboutActiveNote())
        );
        menu.addItem(
          (item) => item.setTitle("Copy transcript").setIcon("clipboard").onClick(() => this.shareTranscript())
        );
        menu.showAtMouseEvent(evt);
      } else {
        void this.openChat();
      }
    });
    this.addCommand({
      id: "open-chat",
      name: "Open chat",
      callback: () => void this.openChat()
    });
    this.addCommand({
      id: "copy-transcript",
      name: "Copy conversation transcript to clipboard",
      callback: () => this.shareTranscript()
    });
    this.addCommand({
      id: "clear-chat",
      name: "Clear conversation",
      callback: () => this.clearChat()
    });
    this.addCommand({
      id: "chat-about-note",
      name: "Chat about this note",
      editorCallback: (editor, ctx) => {
        void this.openChatWithMessage(`Summarize this note: ${ctx.file?.path ?? "the active document"}`);
      }
    });
    this.addCommand({
      id: "send-selection",
      name: "Send selection to Chat",
      editorCheckCallback: (checking, editor, ctx) => {
        const sel = editor.getSelection();
        if (!sel || sel.length === 0) return false;
        if (checking) return true;
        const scope = { text: sel, filePath: ctx.file?.path ?? "" };
        void this.openChatWithSelection(scope);
        return true;
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof obsidian.TFile)) return;
        menu.addItem(
          (item) => item.setTitle("Find").setIcon("search").onClick(() => void this.searchCurrentFile(file))
        );
        if (file.extension === "md") {
          menu.addItem(
            (item) => item.setTitle("Chat about this note").setIcon("message-circle").onClick(() => void this.openChatWithMessage(`Tell me about ${file.path}`))
          );
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        const sel = editor.getSelection();
        if (sel && sel.length > 0) {
          menu.addItem(
            (item) => item.setTitle("Send selection to Chat").setIcon("message-circle").onClick(() => {
              const scope = { text: sel, filePath: info.file?.path ?? "" };
              void this.openChatWithSelection(scope);
            })
          );
        }
      })
    );
    await logStartupStep("ui:register:ok");
    await this.appendStartupLogLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] aichat onload success`);
    setAichatStartupComplete(true);
  } catch (error) {
    let text = "";
    if (error instanceof Error) {
      text = error.stack ? `${error.message} | ${error.stack}` : error.message;
    } else {
      text = String(error);
    }
    await this.appendStartupLogLine(`[${(/* @__PURE__ */ new Date()).toISOString()}] aichat onload error | ${text}`);
    routeAichatRuntimeError(text, "onload");
    throw error;
  }
  }
  onunload() {
    void this.saveChatHistory();
  }
  // ─── Chat operations ────────────────────────────────────────────────
  /**
   * True if the active provider is configured enough to send a message.
   * - anthropic / openai: an API key is set.
   * - chatgpt-oauth: a credential is present in SecretStorage.
   */
  isProviderConfigured() {
    if (this.settings.provider === "chatgpt-oauth") {
      return !!this.chatgptOAuth?.getCredential();
    }
    return !!this.settings.apiKey;
  }
  notConfiguredMessage() {
    if (this.settings.provider === "chatgpt-oauth") {
      return "Connect your ChatGPT account in AI Chat settings.";
    }
    return "Please configure your API key in AI Chat settings.";
  }
  async openChat() {
    if (!this.isProviderConfigured()) {
      new obsidian.Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
  }
  /** Open chat and immediately send a message */
  async openChatWithMessage(message) {
    if (!this.isProviderConfigured()) {
      new obsidian.Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
    const view = this.getChatView();
    if (view) {
      window.setTimeout(() => view.sendMessage(message), 100);
    }
  }
  /** Open chat with a selection scope (shows pill, user types their own question) */
  async openChatWithSelection(selection) {
    if (!this.isProviderConfigured()) {
      new obsidian.Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
    const view = this.getChatView();
    if (view) {
      window.setTimeout(() => {
        view.setSelection(selection);
        view.focus();
      }, 100);
    }
  }
  async chatAboutActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new obsidian.Notice("No active note.");
      return;
    }
    await this.openChatWithMessage(`Tell me about ${file.path}`);
  }
  async searchCurrentFile(file) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.path !== file.path) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
    const activeLeaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.activeLeaf;
    const view = activeLeaf?.view;
    if (view instanceof obsidian.MarkdownView) {
      try {
        view.setMode?.("source");
      } catch {
      }
    }
    const editor = view?.editor || this.app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.editor;
    if (editor && typeof editor.exec === "function") {
      editor.exec("find");
      return;
    }
    const opened = this.app.commands.executeCommandById("editor:open-search");
    if (opened) return;
    new obsidian.Notice("Find is available only in editable text files.");
  }
  /** Open or reveal the chat view in the right sidebar (both desktop and mobile). */
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
      await workspace.revealLeaf(leaf);
    }
  }
  /** Get the active ObsidianChatView using proper instanceof check (deferred view safe) */
  getChatView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    for (const leaf of leaves) {
      if (leaf.view instanceof ObsidianChatView) {
        return leaf.view;
      }
    }
    return null;
  }
  shareTranscript() {
    const view = this.getChatView();
    if (!view) {
      new obsidian.Notice("No active conversation.");
      return;
    }
    const transcript = view.getTranscript();
    if (!transcript || transcript.endsWith("## Conversation\n\n")) {
      new obsidian.Notice("Conversation is empty.");
      return;
    }
    navigator.clipboard.writeText(transcript).then(() => {
      new obsidian.Notice("Transcript copied to clipboard.");
    }).catch(() => {
      new obsidian.Notice("Failed to copy transcript.");
    });
  }
  clearChat() {
    const view = this.getChatView();
    if (view) {
      view.clearConversation();
      new obsidian.Notice("Conversation cleared.");
    } else {
      new obsidian.Notice("No active conversation.");
    }
  }
  // ─── Chat history persistence ─────────────────────────────────────────
  async saveChatHistory() {
    try {
      await this.ensureFolder(this.pluginDataDir);
      const state2 = {
        chatHistory: this.chatHistory.slice(-100),
        // Cap at 100 UI messages
        agentMessages: this.agent.exportMessages().slice(-80)
        // Cap at 80 API messages
      };
      await this.app.vault.adapter.write(
        this.chatStatePath,
        JSON.stringify(state2)
      );
    } catch {
    }
  }
  async loadChatHistory() {
    try {
      const raw = await this.readFirstExisting([
        this.chatStatePath,
        this.legacyChatStatePath
      ]);
      const state2 = JSON.parse(raw);
      if (!isPersistedChatState(state2)) return;
      if (Array.isArray(state2.chatHistory)) {
        this.chatHistory = state2.chatHistory;
      }
      if (Array.isArray(state2.agentMessages)) {
        this.agent.importMessages(state2.agentMessages);
      }
    } catch {
    }
  }
  // ─── Settings persistence ────────────────────────────────────────────
  async loadSettings() {
    const saved = normalizeSettings(await this.loadData());
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    if (!this.settings.model) {
      this.settings.model = DEFAULT_SETTINGS.model;
    }
    if (this.settings.provider === "chatgpt-oauth") {
      const migrated = migrateChatGPTOAuthModelSlug(this.settings.model);
      if (migrated !== this.settings.model) {
        this.settings.model = migrated;
        this.saveData({ ...this.settings, apiKey: "" }).catch(() => {
        });
      }
    }
    this.settings.apiKey = this.loadApiKey(this.settings.provider);
  }
  async saveSettings() {
    this.saveApiKey(this.settings.provider, this.settings.apiKey || "");
    const toSave = { ...this.settings, apiKey: "" };
    await this.saveData(toSave);
    this.applyKeyboardHeightSetting();
    this.getChatView()?.updateModel(
      getModelDisplayName(this.settings.provider, this.settings.model)
    );
  }
  /** Load the correct API key when provider changes */
  reloadApiKeyForProvider() {
    this.settings.apiKey = this.loadApiKey(this.settings.provider);
  }
  applyKeyboardHeightSetting() {
    const root = document.documentElement;
    const className = "aichat-zero-kb-height-vscode";
    if (this.settings.zeroKeyboardHeightInVsCode) {
      root.classList.add(className);
      return;
    }
    root.classList.remove(className);
  }
  loadApiKey(provider) {
    try {
      return this.app.secretStorage.getSecret(`${PLUGIN_ID}-api-key-${provider}`) || this.app.secretStorage.getSecret(`${LEGACY_PLUGIN_ID}-api-key-${provider}`) || "";
    } catch {
      return "";
    }
  }
  saveApiKey(provider, key2) {
    try {
      this.app.secretStorage.setSecret(`${PLUGIN_ID}-api-key-${provider}`, key2);
    } catch {
    }
  }
  async readFirstExisting(paths) {
    let lastError;
    for (const path of paths) {
      try {
        return await this.app.vault.adapter.read(path);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
  async migrateLegacyPluginData() {
    await this.migrateLegacyDataFiles();
    this.migrateLegacySecrets();
  }
  async migrateLegacyDataFiles() {
    const adapter = this.app.vault.adapter;
    try {
      if (!await adapter.exists(this.legacyPluginDataDir)) return;
      await this.ensureFolder(this.pluginDataDir);
      await this.copyLegacyPluginDataDir(this.legacyPluginDataDir, this.pluginDataDir, true);
      await adapter.rmdir(this.legacyPluginDataDir, true);
    } catch {
    }
  }
  async copyLegacyPluginDataDir(fromDir, toDir, isRoot) {
    const adapter = this.app.vault.adapter;
    const listed = await adapter.list(fromDir);
    for (const folder of listed.folders) {
      const name = folder.split("/").pop();
      if (!name) continue;
      const target = `${toDir}/${name}`;
      await this.ensureFolder(target);
      await this.copyLegacyPluginDataDir(folder, target, false);
    }
    for (const file of listed.files) {
      const name = file.split("/").pop();
      if (!name) continue;
      if (isRoot && LEGACY_RELEASE_ASSETS.has(name)) continue;
      const target = `${toDir}/${name}`;
      if (!await adapter.exists(target)) {
        await adapter.writeBinary(target, await adapter.readBinary(file));
      }
    }
  }
  async ensureFolder(path) {
    const adapter = this.app.vault.adapter;
    if (await adapter.exists(path)) return;
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    try {
      await adapter.mkdir(path);
    } catch {
    }
  }
  migrateLegacySecrets() {
    for (const provider of SECRET_PROVIDERS) {
      this.migrateSecret(
        `${PLUGIN_ID}-api-key-${provider}`,
        `${LEGACY_PLUGIN_ID}-api-key-${provider}`
      );
    }
    this.migrateSecret(CHATGPT_OAUTH_SECRET_KEY, LEGACY_CHATGPT_OAUTH_SECRET_KEY);
  }
  migrateSecret(currentKey, legacyKey) {
    try {
      const currentValue = this.app.secretStorage.getSecret(currentKey);
      const legacyValue = this.app.secretStorage.getSecret(legacyKey);
      if (legacyValue && !currentValue) {
        this.app.secretStorage.setSecret(currentKey, legacyValue);
      }
      if (legacyValue) {
        this.app.secretStorage.setSecret(legacyKey, "");
      }
    } catch {
    }
  }
  get pluginDataDir() {
    return `${this.app.vault.configDir}/plugins/${PLUGIN_ID}`;
  }
  get legacyPluginDataDir() {
    return `${this.app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}`;
  }
  get chatStatePath() {
    return `${this.pluginDataDir}/chat-state.json`;
  }
  get legacyChatStatePath() {
    return `${this.legacyPluginDataDir}/chat-state.json`;
  }
};
function isPersistedChatState(value) {
  return typeof value === "object" && value !== null;
}
function normalizeSettings(value) {
  if (!isRecord6(value)) return {};
  const settings = {};
  if (isProvider(value.provider)) settings.provider = value.provider;
  if (typeof value.apiKey === "string") settings.apiKey = value.apiKey;
  if (typeof value.model === "string") settings.model = value.model;
  if (typeof value.maxIterations === "number") settings.maxIterations = value.maxIterations;
  if (typeof value.enableWebSearch === "boolean") settings.enableWebSearch = value.enableWebSearch;
  if (typeof value.zeroKeyboardHeightInVsCode === "boolean") settings.zeroKeyboardHeightInVsCode = value.zeroKeyboardHeightInVsCode;
  return settings;
}
function isProvider(value) {
  return value === "anthropic" || value === "openai" || value === "chatgpt-oauth";
}
function isRecord6(value) {
  return typeof value === "object" && value !== null;
}
let KNOWN_GOOD_OAUTH_SLUGS = /* @__PURE__ */ new Set([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2"
]);
function migrateChatGPTOAuthModelSlug(slug) {
  if (!slug) return CHATGPT_OAUTH_DEFAULT_MODEL;
  if (KNOWN_GOOD_OAUTH_SLUGS.has(slug)) return slug;
  const dashVersion = slug.match(/^gpt-(5)-(\d+)(.*)$/);
  if (dashVersion) {
    const candidate = `gpt-${dashVersion[1]}.${dashVersion[2]}${dashVersion[3]}`;
    if (KNOWN_GOOD_OAUTH_SLUGS.has(candidate)) return candidate;
  }
  return CHATGPT_OAUTH_DEFAULT_MODEL;
}

/* nosourcemap */


// Obsidian loads this CommonJS export as the plugin entrypoint; without it, the plugin won't register.
module.exports = ChatPlugin;

}

{
// src/settings.js




registerInit("types", init_types);
let FALLBACK_MODELS = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
  ],
  openai: [
    { value: "gpt-5.3-codex", label: "Codex 5.3" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-4o", label: "GPT-4o" }
  ],
  // Mirrors the bundled `models.json` shipped with the official OpenAI Codex
  // CLI. These are the slugs the Codex backend currently accepts when the
  // request is authenticated with a ChatGPT account. Sorted by Codex CLI
  // priority (lowest first = recommended). Update when upstream changes.
  "chatgpt-oauth": [
    { value: "gpt-5.5", label: "GPT-5.5 (recommended)" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
    { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" }
  ]
};
let modelCache = /* @__PURE__ */ new Map();
function getModelDisplayName(provider, modelId) {
  const cached = modelCache.get(provider);
  const models = cached || FALLBACK_MODELS[provider] || [];
  const match = models.find((m) => m.value === modelId);
  return match?.label || modelId;
}
let ChatSettingTab = class extends obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    new obsidian.Setting(containerEl).setName("Provider").setDesc("Which AI provider to use").addDropdown(
      (dropdown) => dropdown.addOption("anthropic", "Anthropic").addOption("openai", "OpenAI").addOption("chatgpt-oauth", "ChatGPT OAuth").setValue(s.provider).onChange(async (value) => {
        s.provider = value;
        s.model = "";
        this.plugin.reloadApiKeyForProvider();
        if (s.provider === "chatgpt-oauth" && !s.model) {
          s.model = CHATGPT_OAUTH_DEFAULT_MODEL;
        }
        await this.plugin.saveSettings();
        window.setTimeout(() => this.display(), 10);
      })
    );
    if (s.provider === "chatgpt-oauth") {
      this.renderChatGPTOAuthSection(containerEl);
    } else {
      this.renderApiKeySection(containerEl);
    }
    this.renderModelSection(containerEl);
    new obsidian.Setting(containerEl).setName("Web search").setDesc("Allow the model to search the web when it needs current information").addToggle(
      (toggle) => toggle.setValue(s.enableWebSearch).onChange(async (value) => {
        s.enableWebSearch = value;
        await this.plugin.saveSettings();
      })
    );
    new obsidian.Setting(containerEl).setName("Zero keyboard height in VSCode editor").setDesc("When enabled, sets Obsidian's --keyboard-height to 0px for vscode-editor leaves.").addToggle(
      (toggle) => toggle.setValue(!!s.zeroKeyboardHeightInVsCode).onChange(async (value) => {
        s.zeroKeyboardHeightInVsCode = value;
        await this.plugin.saveSettings();
      })
    );
    new obsidian.Setting(containerEl).setName("Max tool iterations").setDesc("Safety limit for the agent loop (default: 20)").addText(
      (text2) => text2.setPlaceholder("20").setValue(String(s.maxIterations)).onChange(async (value) => {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0 && n <= 100) {
          s.maxIterations = n;
          await this.plugin.saveSettings();
        }
      })
    );
  }
  // ─── API key + test (anthropic / openai) ──────────────────────────────────
  renderApiKeySection(containerEl) {
    const s = this.plugin.settings;
    const apiKeySetting = new obsidian.Setting(containerEl).setName("API key").setDesc(s.apiKey ? "Key saved" : "Enter your API key to get started").addText((text2) => {
      text2.inputEl.type = "password";
      text2.setPlaceholder("Enter your API key").setValue(s.apiKey).onChange(async (value) => {
        const hadKey = !!s.apiKey;
        s.apiKey = value.trim();
        await this.plugin.saveSettings();
        if (!hadKey && s.apiKey) {
          window.setTimeout(() => this.display(), 10);
        }
      });
    });
    if (s.apiKey) {
      apiKeySetting.addButton(
        (button) => button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            registerInit("client", init_client, ["anthropic", "openai", "chatgpt_oauth"]);
            const response = await sendMessage(
              s,
              [{ role: "user", content: "Say hello in one word." }],
              [],
              "You are a test. Respond with one word."
            );
            const text2 = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
            new obsidian.Notice(`Connected! Response: "${text2}"`);
            apiKeySetting.setDesc("Connection successful");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new obsidian.Notice(`Connection failed: ${msg}`);
            apiKeySetting.setDesc(`Failed: ${msg}`);
          } finally {
            button.setButtonText("Test");
            button.setDisabled(false);
          }
        })
      );
    }
  }
  // ─── ChatGPT OAuth ────────────────────────────────────────────────────────
  renderChatGPTOAuthSection(containerEl) {
    const credential = this.plugin.chatgptOAuth.getCredential();
    const explainer = containerEl.createEl("div", {
      cls: "setting-item-description ochatting-oauth-explainer"
    });
    explainer.createSpan({
      text: "Sign in with your ChatGPT account instead of using an OpenAI API key. Requests are routed through the ChatGPT/Codex backend (not "
    });
    explainer.createEl("code", { text: "api.openai.com" });
    explainer.createSpan({
      text: ") and require an active ChatGPT plan with Codex access. The available models mirror the Codex CLI catalog."
    });
    if (credential) {
      const account = credential.accountId ? maskAccountId(credential.accountId) : "(no account id)";
      const expires = new Date(credential.expiresAt).toLocaleString();
      new obsidian.Setting(containerEl).setName("ChatGPT account").setDesc(`Connected \u2014 account ${account}. Token expires ${expires}.`).addButton(
        (button) => button.setButtonText("Disconnect").setWarning().onClick(async () => {
          this.plugin.chatgptOAuth.clearCredential();
          new obsidian.Notice("ChatGPT OAuth disconnected.");
          this.display();
        })
      ).addButton(
        (button) => button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            registerInit("client", init_client, ["anthropic", "openai", "chatgpt_oauth"]);
            const response = await sendMessage(
              this.plugin.settings,
              [{ role: "user", content: "Say hello in one word." }],
              [],
              "You are a test. Respond with one word."
            );
            const text2 = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
            new obsidian.Notice(`Connected! Response: "${text2 || "(no text)"}"`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new obsidian.Notice(`Connection test failed: ${msg}`);
          } finally {
            button.setButtonText("Test");
            button.setDisabled(false);
          }
        })
      );
    } else {
      new obsidian.Setting(containerEl).setName("ChatGPT account").setDesc("Not connected. Sign in with ChatGPT to use this provider.").addButton(
        (button) => button.setButtonText("Connect ChatGPT").setCta().onClick(async () => {
          try {
            const auth = await this.plugin.chatgptOAuth.beginDeviceAuthorization();
            const handle = this.plugin.chatgptOAuth.pollDeviceAuthorization(auth);
            const modal = new ChatGPTDeviceLoginModal(this.app, auth, handle, () => {
              this.display();
            });
            modal.open();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new obsidian.Notice(`Failed to start ChatGPT login: ${msg}`);
          }
        })
      );
    }
  }
  // ─── Model picker ─────────────────────────────────────────────────────────
  renderModelSection(containerEl) {
    const s = this.plugin.settings;
    const cached = modelCache.get(s.provider);
    const models = cached || FALLBACK_MODELS[s.provider] || FALLBACK_MODELS.anthropic;
    const modelSetting = new obsidian.Setting(containerEl).setName("Model").setDesc(cached ? `${cached.length} models from API` : "Using defaults. Click refresh to load from API.").addDropdown((dropdown) => {
      for (const m of models) {
        dropdown.addOption(m.value, m.label);
      }
      dropdown.addOption("__custom__", "Custom...");
      if (s.model && !models.some((m) => m.value === s.model)) {
        dropdown.addOption(s.model, `${s.model} (current)`);
      }
      dropdown.setValue(s.model || models[0]?.value || "");
      dropdown.onChange(async (value) => {
        if (value === "__custom__") {
          s.model = "";
          await this.plugin.saveSettings();
          window.setTimeout(() => this.display(), 10);
        } else {
          s.model = value;
          await this.plugin.saveSettings();
        }
      });
    });
    const canFetchModels = s.provider === "anthropic" && !!s.apiKey || s.provider === "openai" && !!s.apiKey;
    if (canFetchModels) {
      modelSetting.addButton(
        (btn) => btn.setIcon("refresh-cw").setTooltip("Fetch models from API").onClick(async () => {
          btn.setDisabled(true);
          try {
            const fetched = await fetchModelsFromAPI(s.provider, s.apiKey);
            modelCache.set(s.provider, fetched);
            new obsidian.Notice(`Loaded ${fetched.length} models`);
            if (!s.model && fetched.length > 0) {
              s.model = fetched[0].value;
              await this.plugin.saveSettings();
            }
            this.display();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            new obsidian.Notice(`Failed to fetch models: ${msg}`);
          }
        })
      );
    }
    if (!s.model) {
      new obsidian.Setting(containerEl).setName("Custom model ID").setDesc("Enter the full model identifier").addText(
        (text2) => text2.setPlaceholder(
          s.provider === "anthropic" ? "claude-sonnet-4-20250514" : s.provider === "chatgpt-oauth" ? CHATGPT_OAUTH_DEFAULT_MODEL : "gpt-4o"
        ).setValue(s.model).onChange(async (value) => {
          s.model = value.trim();
          await this.plugin.saveSettings();
        })
      );
    }
  }
};
let ChatGPTDeviceLoginModal = class extends obsidian.Modal {
  constructor(app, authorization, handle, onComplete) {
    super(app);
    this.authorization = authorization;
    this.handle = handle;
    this.onComplete = onComplete;
  }
  cancelled = false;
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new obsidian.Setting(contentEl).setName("Connect ChatGPT").setHeading();
    contentEl.createEl("p", {
      text: "1. Open this page in any browser:"
    });
    const linkRow = contentEl.createEl("div", { cls: "ochatting-device-link-row" });
    const link2 = linkRow.createEl("a", {
      text: this.authorization.verificationUri,
      href: this.authorization.verificationUri
    });
    link2.setAttr("target", "_blank");
    link2.setAttr("rel", "noopener");
    contentEl.createEl("p", { text: "2. Enter this code on the page:" });
    const codeRow = contentEl.createEl("div", { cls: "ochatting-device-code-row" });
    codeRow.createEl("code", {
      text: this.authorization.userCode,
      cls: "ochatting-device-code"
    });
    const copyBtn = codeRow.createEl("button", { text: "Copy code" });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.authorization.userCode).then(() => new obsidian.Notice("Code copied.")).catch(() => new obsidian.Notice("Failed to copy code."));
    });
    const status = contentEl.createEl("p", {
      text: "Waiting for authorization. You can return here after signing in.",
      cls: "ochatting-device-status"
    });
    const buttons = contentEl.createEl("div", { cls: "ochatting-device-buttons" });
    const openBtn = buttons.createEl("button", { text: "Open login page" });
    openBtn.classList.add("mod-cta");
    openBtn.addEventListener("click", () => {
      window.open(this.authorization.verificationUri, "_blank");
    });
    const cancelBtn = buttons.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.cancelled = true;
      this.handle.cancel();
      this.close();
    });
    this.handle.promise.then(() => {
      if (this.cancelled) return;
      new obsidian.Notice("ChatGPT connected.");
      this.onComplete();
      this.close();
    }).catch((e) => {
      if (this.cancelled) return;
      const msg = e instanceof Error ? e.message : String(e);
      status.setText(`Login failed: ${msg}`);
      status.removeClass("ochatting-device-status");
      status.addClass("ochatting-device-status-error");
    });
  }
  onClose() {
    if (!this.cancelled) {
      this.handle.cancel();
    }
    this.contentEl.empty();
  }
};
function maskAccountId(accountId) {
  if (accountId.length <= 8) return accountId;
  return `${accountId.slice(0, 4)}\u2026${accountId.slice(-4)}`;
}
async function fetchModelsFromAPI(provider, apiKey) {
  if (provider === "anthropic") {
    return fetchAnthropicModels(apiKey);
  }
  if (provider === "openai") {
    return fetchOpenAIModels(apiKey);
  }
  return FALLBACK_MODELS["chatgpt-oauth"];
}
async function fetchAnthropicModels(apiKey) {
  let response;
  try {
    response = await (0, obsidian.requestUrl)({
      url: "https://api.anthropic.com/v1/models?limit=100",
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  const models = getModelRecords(response.json).filter((m) => m.type === "model").filter((m) => typeof m.id === "string").map((m) => ({
    value: m.id,
    label: typeof m.display_name === "string" ? m.display_name : m.id
  })).sort((a, b) => {
    const da = a.value.match(/(\d{8})/)?.[1] || "";
    const db = b.value.match(/(\d{8})/)?.[1] || "";
    return db.localeCompare(da) || a.label.localeCompare(b.label);
  });
  return models.length > 0 ? models : FALLBACK_MODELS.anthropic;
}
async function fetchOpenAIModels(apiKey) {
  let response;
  try {
    response = await (0, obsidian.requestUrl)({
      url: "https://api.openai.com/v1/models",
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
  const chatPrefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-", "codex-", "gpt5"];
  const excludePatterns = ["realtime", "audio", "transcri", "search"];
  const models = getModelRecords(response.json).filter((m) => typeof m.id === "string").filter((m) => {
    const id = m.id.toLowerCase();
    return chatPrefixes.some((p) => id.startsWith(p)) && !excludePatterns.some((p) => id.includes(p));
  }).sort(
    (a, b) => numberValue3(b.created) - numberValue3(a.created)
  ).map((m) => ({ value: m.id, label: m.id }));
  return models.length > 0 ? models : FALLBACK_MODELS.openai;
}
function getModelRecords(value) {
  if (!isRecord4(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord4);
}
function numberValue3(value) {
  return typeof value === "number" ? value : 0;
}
function isRecord4(value) {
  return typeof value === "object" && value !== null;
}

declareExports({
  getModelDisplayName,
  ChatSettingTab
});


}

{
// src/tools/commands/agents.js
function resolveAgentsPath(path, vaultName) {
  if (path.startsWith("/")) {
    const marker = `/${vaultName}/`;
    const idx = path.indexOf(marker);
    if (idx !== -1) {
      return path.substring(idx + marker.length);
    }
    return path.replace(/^\/+/, "");
  }
  return obsidian.normalizePath(path);
}

async function agentsTool(app, input) {
  const rawPath = ToolHelper.requiredString(input.path).trim();
  const configPath = `${app.vault.configDir}/plugins/aichat/agents-path.txt`;
  const adapter = app.vault.adapter;

  if (rawPath === "-") {
    try {
      await adapter.write(configPath, "");
    } catch {
    }
    return { result: "Cleared AGENTS file configuration. No agents file is active.", isError: false };
  }

  if (rawPath) {
    const resolved = resolveAgentsPath(rawPath, app.vault.getName());
    let content = "";
    try {
      content = await adapter.read(resolved);
    } catch {
      return { result: `Could not read AGENTS file at: ${rawPath}`, isError: true };
    }

    const dir = `${app.vault.configDir}/plugins/aichat`;
    try {
      if (!await adapter.exists(dir)) {
        await adapter.mkdir(dir);
      }
    } catch {
    }

    await adapter.write(configPath, resolved);
    return {
      result: `Set AGENTS file: ${resolved}\n\n${content}`,
      isError: false
    };
  }

  let configured = "";
  try {
    configured = (await adapter.read(configPath)).trim();
  } catch {
    configured = "";
  }

  if (!configured) {
    return { result: "No AGENTS file configured. Call agents with a path, or agents with '-' to clear.", isError: false };
  }

  try {
    const content = await adapter.read(configured);
    return { result: `AGENTS file: ${configured}\n\n${content}`, isError: false };
  } catch {
    return { result: `Configured AGENTS file could not be read: ${configured}`, isError: true };
  }
}

const Command = declareNamespace("Command");
Command.export(resolveAgentsPath);
Command.export(agentsTool);

}

{
// src/tools/commands/ask-user.js
async function askUser(input, onAskUser) {
  const question = ToolHelper.requiredString(input.question);
  if (!question) {
    return { result: "'question' parameter is required.", isError: true };
  }
  const answer = await onAskUser(question);
  return { result: answer, isError: false };
}

const Command = declareNamespace("Command");
Command.export(askUser);

}

{
// src/tools/commands/biggest.js
async function biggest(app, input) {
  const includeExts = new Set(ToolHelper.parseExtensionTokens(input.extensions));
  if (includeExts.size === 0) {
    return {
      result: "Please provide one or more extensions in extensions (e.g. '.js,.md').",
      isError: true
    };
  }

  const files = app.vault.getFiles();
  const matches = [];

  for (const file of files) {
    const ext = ToolHelper.getPathExtension(file.path);
    if (!includeExts.has(ext)) continue;
    const size = Number.isFinite(file.stat?.size) ? file.stat.size : 0;
    matches.push({ path: file.path, size });
  }

  matches.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.path.localeCompare(b.path);
  });

  const top = matches.slice(0, 20);

  if (top.length === 0) {
    return {
      result: `No files found for extensions: ${Array.from(includeExts).join(",")}`,
      isError: false
    };
  }

  return {
    result: [
      `Top ${top.length} biggest files for extensions: ${Array.from(includeExts).join(",")}`,
      ...top.map((entry) => `- ${entry.path} ${entry.size}`),
      "",
      `Matched ${matches.length} file(s) total.`
    ].join("\n"),
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(biggest);

}

{
// src/tools/commands/create-file.js
async function createFile(app, input) {
  const path = obsidian.normalizePath(ToolHelper.requiredString(input.path));
  const hasContent = typeof input.content === "string";
  const content = hasContent ? input.content : "";
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }
  if (!hasContent) {
    return { result: "'content' parameter is required.", isError: true };
  }
  if (app.vault.getFileByPath(path)) {
    return { result: `File already exists: ${path}. Use edit_file to modify it.`, isError: true };
  }
  await ToolHelper.ensureParentFolder(app, path);
  await app.vault.create(path, content);
  return { result: `Created ${path}.`, isError: false };
}

const Command = declareNamespace("Command");
Command.export(createFile);

}

{
// src/tools/commands/delete-file.js
async function deleteFile(app, input) {
  const path = ToolHelper.requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }
  const file = app.vault.getAbstractFileByPath(obsidian.normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }
  await app.fileManager.trashFile(file);
  return { result: `Moved ${path} to trash.`, isError: false };
}

const Command = declareNamespace("Command");
Command.export(deleteFile);

}

{
// src/tools/commands/edit-file.js
function findFrontmatterEnd(content) {
  if (!content.startsWith("---")) return -1;
  const secondDash = content.indexOf("---", 3);
  if (secondDash === -1) return -1;
  return secondDash + 3;
}

function previewMatchText(value, max = 140) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildForgivingWhitespaceRegex(candidate) {
  const text = String(candidate || "");
  const whitespacePattern = /(?:\s|&nbsp;)+/ig;
  let pattern = "";
  let lastIndex = 0;
  let match = whitespacePattern.exec(text);
  while (match) {
    if (match.index > lastIndex) {
      pattern += escapeRegex(text.slice(lastIndex, match.index));
    }
    pattern += "(?:\\s|&nbsp;)+";
    lastIndex = whitespacePattern.lastIndex;
    match = whitespacePattern.exec(text);
  }
  if (lastIndex < text.length) {
    pattern += escapeRegex(text.slice(lastIndex));
  }
  return new RegExp(pattern, "i");
}

function pickAnchorToken(candidate) {
  const words = String(candidate || "").toLowerCase().split(/[^a-z0-9_./-]+/).filter((w) => w.length >= 4);
  if (words.length === 0) return "";
  words.sort((a, b) => b.length - a.length);
  return words[0];
}

function nearestSnippetHints(data, candidates, maxHints = 3) {
  const out = [];
  const lower = data.toLowerCase();
  for (const candidate of candidates) {
    if (out.length >= maxHints) break;
    const token = pickAnchorToken(candidate);
    if (!token) continue;
    const idx = lower.indexOf(token);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 50);
    const end = Math.min(data.length, idx + token.length + 50);
    const snippet = data.substring(start, end).replace(/\n/g, " ");
    out.push(`- token "${token}": ...${previewMatchText(snippet, 120)}...`);
  }
  return out;
}

function normalizeFindCandidates(findInput) {
  if (Array.isArray(findInput)) {
    return findInput.filter((v) => typeof v === "string" && v.length > 0);
  }
  if (typeof findInput === "string" && findInput.length > 0) return [findInput];
  return [];
}

async function editDocument(app, input) {
  const operation = ToolHelper.requiredString(input.operation);
  const content = ToolHelper.requiredString(input.content);
  const findCandidates = normalizeFindCandidates(input.find);
  const forgiveWhitespace = input.forgiveWhitespace !== false;
  const includeNearMatches = input.includeNearMatches === true;
  const position = ToolHelper.optionalString(input.position);
  const path = ToolHelper.optionalString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }
  const file = ToolHelper.resolveFile(app, path);
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }
  const cfcPreconditionError = await ToolHelper.validateCfcEditPrecondition(app, file, input);
  if (cfcPreconditionError) {
    return cfcPreconditionError;
  }
  switch (operation) {
    case "replace_all": {
      const beforeContent = await app.vault.cachedRead(file);
      await app.vault.modify(file, content);
      const afterContent = await app.vault.cachedRead(file);
      await ToolHelper.recordEditJournal(app, {
        filePath: file.path,
        operation: "replace_all",
        beforeContent,
        afterContent
      });
      return { result: `Replaced all content in ${file.path}.`, isError: false };
    }
    case "find_replace": {
      if (findCandidates.length === 0) {
        return { result: "'find' parameter is required for find_replace (string or string[]).", isError: true };
      }

      const beforeContent = await app.vault.cachedRead(file);
      let resultMsg = "";
      let found = false;
      let matchText = "";
      let matchMode = "exact";
      let matchedCandidateIndex = -1;

      await app.vault.process(file, (data) => {
        let idx = -1;

        for (let i = 0; i < findCandidates.length; i++) {
          const candidate = findCandidates[i];
          const exactIdx = data.indexOf(candidate);
          if (exactIdx !== -1) {
            idx = exactIdx;
            matchText = candidate;
            matchMode = "exact";
            matchedCandidateIndex = i;
            break;
          }
        }

        if (idx === -1 && forgiveWhitespace) {
          for (let i = 0; i < findCandidates.length; i++) {
            const candidate = findCandidates[i];
            const regex = buildForgivingWhitespaceRegex(candidate);
            const match = data.match(regex);
            if (match && match.index !== void 0) {
              idx = match.index;
              matchText = match[0];
              matchMode = "normalized";
              matchedCandidateIndex = i;
              break;
            }
          }
        }

        if (idx === -1) {
          found = false;
          return data;
        }

        found = true;

        if (matchMode === "exact") {
          const secondIdx = data.indexOf(matchText, idx + matchText.length);
          if (secondIdx !== -1) {
            resultMsg = "[Note: Multiple matches found, replacing first occurrence.]\n";
          }
        } else {
          const regex = buildForgivingWhitespaceRegex(findCandidates[matchedCandidateIndex]);
          const all = data.match(new RegExp(regex.source, "ig")) || [];
          if (all.length > 1) {
            resultMsg = "[Note: Multiple whitespace-forgiving matches found, replacing first occurrence.]\n";
          }
          resultMsg += "[Note: Used whitespace-forgiving fallback match (\\s and &nbsp; are treated as whitespace).]\n";
        }

        return data.substring(0, idx) + content + data.substring(idx + matchText.length);
      });

      if (!found) {
        const previews = findCandidates.slice(0, 6).map((c, i) => `  ${i + 1}. (${c.length} chars) \"${previewMatchText(c)}\"`);
        const hints = includeNearMatches ? nearestSnippetHints(await app.vault.cachedRead(file), findCandidates) : [];
        const hintBlock = hints.length > 0 ? `\nNearby hints:\n${hints.join("\n")}` : "";
        return {
          result: `Could not find the specified text in ${file.path}. Attempted ${findCandidates.length} candidate(s):\n${previews.join("\n")}\nMatching is exact, with optional whitespace-forgiving fallback (all whitespace and &nbsp; treated equivalently).${hintBlock}`,
          isError: true
        };
      }

      const afterContent = await app.vault.cachedRead(file);
      await ToolHelper.recordEditJournal(app, {
        filePath: file.path,
        operation: "find_replace",
        beforeContent,
        afterContent
      });
      const matchInfo = `(match: candidate ${matchedCandidateIndex + 1}, mode: ${matchMode})`;
      return { result: `${resultMsg}Successfully replaced text in ${file.path} ${matchInfo}.`, isError: false };
    }
    case "insert": {
      if (!position) {
        return { result: "'position' parameter is required for insert.", isError: true };
      }
      if (position !== "beginning" && position !== "end" && position !== "after_frontmatter") {
        return { result: `Unknown position: ${position}`, isError: true };
      }
      const beforeContent = await app.vault.cachedRead(file);
      await app.vault.process(file, (data) => {
        switch (position) {
          case "beginning":
            return content + "\n" + data;
          case "end":
            return data + "\n" + content;
          case "after_frontmatter": {
            const fmEnd = findFrontmatterEnd(data);
            if (fmEnd === -1) return content + "\n" + data;
            return data.substring(0, fmEnd) + "\n" + content + data.substring(fmEnd);
          }
          default:
            return data;
        }
      });
      const afterContent = await app.vault.cachedRead(file);
      await ToolHelper.recordEditJournal(app, {
        filePath: file.path,
        operation: "insert",
        beforeContent,
        afterContent
      });
      return { result: `Inserted content at ${position} of ${file.path}.`, isError: false };
    }
    default:
      return { result: `Unknown operation: ${operation}`, isError: true };
  }
}

const Command = declareNamespace("Command");
Command.export(normalizeFindCandidates);
Command.export(editDocument);

}

{
// src/tools/commands/flush.js
function flushTool(input) {
  const path = ToolHelper.optionalString(input?.path);
  const all = input?.all === true;
  const flushAll = all || !path;
  const mode = flushAll ? "all" : "path";
  return {
    result: JSON.stringify({
      action: "flush",
      mode,
      path: flushAll ? "" : path || ""
    }),
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(flushTool);

}

{
// src/tools/commands/frontmatter.js
async function frontmatter(app, input) {
  return await Command.searchRead(app, input, "frontmatter");
}

const Command = declareNamespace("Command");
Command.export(frontmatter);

}

{
// src/tools/commands/get-backlinks.js
async function getBacklinks(app, input) {
  const path = ToolHelper.optionalString(input.path);
  const file = ToolHelper.resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }
  const allLinks = app.metadataCache.resolvedLinks;
  const backlinks = [];
  for (const [sourcePath, targets] of Object.entries(allLinks)) {
    if (targets[file.path]) {
      backlinks.push(sourcePath);
    }
  }
  if (backlinks.length === 0) {
    return { result: `No backlinks found for ${file.path}.`, isError: false };
  }
  backlinks.sort();
  return {
    result: `${backlinks.length} note(s) link to ${file.path}:\n${backlinks.map((p) => `- ${p}`).join("\n")}`,
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(getBacklinks);

}

{
// src/tools/commands/get-current-datetime.js
function getCurrentDatetime() {
  const now = new Date();
  const iso = now.toISOString();
  const local = now.toLocaleString(void 0, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  });
  const dateOnly = now.toISOString().split("T")[0];
  return {
    result: `Local: ${local}\nISO: ${iso}\nDate: ${dateOnly}`,
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(getCurrentDatetime);

}

{
// src/tools/commands/get-properties.js
async function getProperties(app, input) {
  const path = ToolHelper.optionalString(input.path);
  const file = ToolHelper.resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }
  const cache = app.metadataCache.getFileCache(file);
  const frontmatter = cache?.frontmatter;
  if (!frontmatter) {
    return { result: `No frontmatter properties found in ${file.path}.`, isError: false };
  }
  const clean = { ...frontmatter };
  delete clean.position;
  return { result: JSON.stringify(clean, null, 2), isError: false };
}

const Command = declareNamespace("Command");
Command.export(getProperties);

}

{
// src/tools/commands/list-files.js
async function listFiles(app, input) {
  const folder = ToolHelper.optionalString(input.folder);
  const extension = ToolHelper.optionalString(input.extension);
  let files = app.vault.getFiles();
  if (folder) {
    const normalizedFolder = obsidian.normalizePath(folder);
    files = files.filter(
      (f) => f.path.startsWith(normalizedFolder + "/") || f.path === normalizedFolder
    );
  }
  if (extension) {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    files = files.filter((f) => f.path.endsWith(ext));
  }
  const entries = files
    .map((f) => ({ path: f.path, size: Number.isFinite(f.stat?.size) ? f.stat.size : 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const capped = entries.slice(0, 100);
  const suffix = entries.length > 100 ? `\n\n(Showing 100 of ${entries.length} files)` : "";
  if (capped.length === 0) {
    return { result: "No files found matching the criteria.", isError: false };
  }
  return {
    result: capped.map((entry) => `- ${entry.path} ${entry.size}`).join("\n") + suffix,
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(listFiles);

}

{
// src/tools/commands/open-document.js
async function openDocument(app, input) {
  const path = ToolHelper.requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }
  const file = app.vault.getFileByPath(obsidian.normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file);
  return { result: `Opened ${file.path}.`, isError: false };
}

const Command = declareNamespace("Command");
Command.export(openDocument);

}

{
// src/tools/commands/read-file.js
async function readFile(app, input) {
  const path = ToolHelper.requiredString(input.path);
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }
  const file = app.vault.getFileByPath(obsidian.normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }
  const content = await app.vault.cachedRead(file);
  return { result: content, isError: false };
}

const Command = declareNamespace("Command");
Command.export(readFile);

}

{
// src/tools/commands/rename-file.js
async function renameFile(app, input) {
  const path = ToolHelper.requiredString(input.path);
  const newPath = ToolHelper.requiredString(input.new_path);
  if (!path || !newPath) {
    return { result: "Both 'path' and 'new_path' parameters are required.", isError: true };
  }
  const file = app.vault.getAbstractFileByPath(obsidian.normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }
  const normalizedNew = obsidian.normalizePath(newPath);
  if (app.vault.getAbstractFileByPath(normalizedNew)) {
    return { result: `A file already exists at: ${normalizedNew}`, isError: true };
  }
  await ToolHelper.ensureParentFolder(app, normalizedNew);
  await app.fileManager.renameFile(file, normalizedNew);
  return { result: `Renamed ${path} to ${normalizedNew}.`, isError: false };
}

const Command = declareNamespace("Command");
Command.export(renameFile);

}

{
// src/tools/commands/revert-edit.js
async function revertEdit(app, input) {
  const requestedPath = ToolHelper.optionalString(input.path);
  const normalizedPath = requestedPath ? obsidian.normalizePath(requestedPath) : "";
  const entryId = ToolHelper.optionalString(input.entryId);
  if (!normalizedPath && !entryId) {
    return { result: "Provide either 'path' (revert last change for file) or 'entryId' (revert by journal id).", isError: true };
  }

  const entries = await ToolHelper.readEditJournalEntries(app);
  if (entries.length === 0) {
    return { result: `No journal entries found at ${ToolHelper.EDIT_JOURNAL_PATH()}.`, isError: true };
  }

  let target = null;
  if (entryId) {
    target = entries.find((e) => typeof e?.id === "string" && e.id === entryId) || null;
    if (!target) {
      return { result: `Journal entry not found: ${entryId}.`, isError: true };
    }
  } else {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (typeof e?.filePath === "string" && obsidian.normalizePath(e.filePath) === normalizedPath) {
        target = e;
        break;
      }
    }
    if (!target) {
      return { result: `No journal entries found for ${normalizedPath}.`, isError: true };
    }
  }

  if (!target.inverseOp || target.inverseOp.operation !== "replace_all" || typeof target.inverseOp.content !== "string") {
    return { result: `Journal entry ${target.id || "(unknown)"} cannot be reverted: unsupported inverse operation.`, isError: true };
  }

  const filePath = typeof target.filePath === "string" ? obsidian.normalizePath(target.filePath) : normalizedPath;
  const file = app.vault.getFileByPath(filePath);
  if (!file) {
    return { result: `File not found for journal entry: ${filePath}`, isError: true };
  }

  const beforeContent = await app.vault.cachedRead(file);
  await app.vault.modify(file, target.inverseOp.content);
  const afterContent = await app.vault.cachedRead(file);

  const revertEntry = await ToolHelper.recordEditJournal(app, {
    filePath: file.path,
    operation: "revert",
    beforeContent,
    afterContent,
    meta: {
      revertedEntryId: target.id || "",
      mode: entryId ? "by_id" : "by_last_path"
    }
  });

  const restoredHash = await ToolHelper.sha256Hex(afterContent);
  const expectedHash = typeof target.beforeHash === "string" ? target.beforeHash : "";
  const hashNote = expectedHash && restoredHash === expectedHash ? "exact prior hash restored" : "content restored (hash mismatch or unavailable)";

  return {
    result: `Reverted ${file.path} using journal entry ${target.id || "(unknown)"}. ${hashNote}. New journal entry: ${revertEntry.id}.`,
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(revertEdit);

}

{
// src/tools/commands/search-read.js
async function searchRead(app, input, extractMode = "full") {
  const queryRaw = ToolHelper.requiredString(input.query);
  const query = queryRaw.toLowerCase();
  if (!query) {
    return { result: "'query' parameter is required.", isError: true };
  }

  const searchContent = input.searchContent === true;
  const maxBytesRaw = typeof input.maxBytes === "number" ? input.maxBytes : 1e5;
  const maxBytes = Math.max(1, Math.min(maxBytesRaw, 5e6));
  const allTextFiles = input.allTextFiles !== false;
  const pathContains = requiredString(input.pathContains).toLowerCase();
  const maxMatchesScanned = ToolHelper.clampNumber(input.maxMatchesScanned, 500, 1, 5e3);

  const explicitMatchMode = ToolHelper.toSearchReadMatchMode(input.match);
  if (input.match !== void 0 && !explicitMatchMode) {
    return ToolHelper.buildSearchReadError("invalid_args", "Unknown match mode. Use first|best|exact|all.", { query: queryRaw });
  }
  const mode = explicitMatchMode || "first";

  const requireUnique = input.requireUnique === true;
  const extract = ToolHelper.toSearchReadExtract(extractMode);
  const maxMatchesDefault = mode === "all" ? 20 : 1;
  const maxMatches = ToolHelper.clampNumber(input.maxMatches, maxMatchesDefault, 1, 200);
  const maxBytesPerFileRaw = typeof input.maxBytesPerFile === "number" ? input.maxBytesPerFile : 1e6;
  const maxBytesPerFile = Math.max(64, Math.min(maxBytesPerFileRaw, 5e6));

  const includeExts = new Set(ToolHelper.parseExtensionTokens(input.extensions));
  const excludeExts = new Set(ToolHelper.parseExtensionTokens(input.excludeExtensions));

  const files = app.vault.getFiles().slice().sort((a, b) => a.path.localeCompare(b.path));
  const matches = [];
  let matchCount = 0;
  let exceededMatchCap = false;

  let skippedByExtension = 0;
  let skippedBySize = 0;
  let skippedUnreadable = 0;

  const queryComparableLower = ToolHelper.normalizeComparablePath(queryRaw).toLowerCase();

  for (const file of files) {
    if (!ToolHelper.fileMatchesExtensionPolicy(file.path, includeExts, excludeExts, allTextFiles)) {
      skippedByExtension++;
      continue;
    }

    const pathComparable = ToolHelper.normalizeComparablePath(file.path);
    const pathLower = pathComparable.toLowerCase();

    let matched = false;
    let pathHit = false;
    let contentIndex = -1;

    if (explicitMatchMode === "exact") {
      const exactCaseSensitive = pathComparable === ToolHelper.normalizeComparablePath(queryRaw);
      const exactCaseInsensitive = pathLower === queryComparableLower;
      matched = exactCaseSensitive || exactCaseInsensitive;
      pathHit = matched;
    } else {
      if (pathLower.includes(query)) {
        matched = true;
        pathHit = true;
      } else if (searchContent) {
        const fileSize = typeof file.stat?.size === "number" ? file.stat.size : 0;
        if (fileSize > maxBytes) {
          skippedBySize++;
          continue;
        }
        let content = "";
        try {
          content = await app.vault.cachedRead(file);
        } catch {
          skippedUnreadable++;
          continue;
        }
        const idx = content.toLowerCase().indexOf(query);
        if (idx !== -1) {
          matched = true;
          contentIndex = idx;
        }
      }
    }

    if (!matched) continue;
    if (pathContains && !file.path.toLowerCase().includes(pathContains)) continue;

    matchCount += 1;
    if (matches.length < maxMatchesScanned) {
      matches.push({ path: file.path, pathHit, contentIndex });
    } else {
      exceededMatchCap = true;
    }
  }

  if (matchCount === 0) {
    return ToolHelper.buildSearchReadStatus("no_match", `No matches found for query '${queryRaw}'.`, {
      query: queryRaw,
      match: mode,
      extract,
      requireUnique,
      totalMatches: 0,
      limits: { maxMatches, maxBytesPerFile }
    });
  }

  if (exceededMatchCap) {
    return ToolHelper.buildSearchReadStatus("too_many_matches_scanned", `search_read matched ${matchCount} files, exceeding maxMatchesScanned=${maxMatchesScanned}. Refine query/pathContains or increase maxMatchesScanned.`, {
      query: queryRaw,
      totalMatches: matchCount,
      maxMatchesScanned
    });
  }

  if (requireUnique && matchCount !== 1) {
    return ToolHelper.buildSearchReadStatus("not_unique", `requireUnique=true requires exactly 1 match, found ${matchCount}.`, {
      query: queryRaw,
      totalMatches: matchCount,
      candidates: matches.slice(0, 20).map((m) => m.path)
    });
  }

  let selectedMetas = [];
  if (mode === "all") {
    selectedMetas = matches.slice(0, maxMatches);
  } else if (mode === "first") {
    selectedMetas = matches.length > 0 ? [matches[0]] : [];
  } else if (mode === "exact") {
    selectedMetas = matches.slice(0, maxMatches);
  } else if (mode === "best") {
    const sorted = matches.slice().sort((a, b) => {
      const sa = ToolHelper.computeBestScore(a, query, queryComparableLower);
      const sb = ToolHelper.computeBestScore(b, query, queryComparableLower);
      if (sa !== sb) return sa - sb;
      return a.path.localeCompare(b.path);
    });
    selectedMetas = sorted.slice(0, maxMatches);
  } else {
    return ToolHelper.buildSearchReadError("invalid_args", `Unknown match mode: ${mode}. Use first|best|exact|all.`, { query: queryRaw });
  }

  const selectedEntries = [];
  const candidates = [];
  let anyTruncated = false;

  for (const meta of selectedMetas) {
    if (!meta || typeof meta.path !== "string") continue;
    const selectedPath = meta.path;
    candidates.push(selectedPath);
    const file = app.vault.getFileByPath(obsidian.normalizePath(selectedPath));
    if (!file) {
      selectedEntries.push({
        path: selectedPath,
        error: { code: "read_failed", message: "matched file no longer exists" }
      });
      continue;
    }

    let content = "";
    try {
      content = await app.vault.cachedRead(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      selectedEntries.push({
        path: selectedPath,
        error: { code: "read_failed", message: msg }
      });
      continue;
    }

    if (extract === "frontmatter") {
      const cache = app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter ? { ...cache.frontmatter } : null;
      if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "position")) {
        delete frontmatter.position;
      }
      const text = JSON.stringify(frontmatter, null, 2);
      const trimmed = ToolHelper.truncateUtf8(text, maxBytesPerFile);
      selectedEntries.push({
        path: selectedPath,
        bytes: trimmed.bytes,
        sha256: await ToolHelper.sha256Hex(trimmed.text),
        truncated: trimmed.truncated,
        content: {
          frontmatter,
          raw: trimmed.text
        }
      });
      if (trimmed.truncated) anyTruncated = true;
      continue;
    }

    if (extract === "snippet") {
      const snippet = ToolHelper.buildSnippetExtract(content, query);
      const trimmed = ToolHelper.truncateUtf8(snippet.text, maxBytesPerFile);
      selectedEntries.push({
        path: selectedPath,
        bytes: trimmed.bytes,
        sha256: await ToolHelper.sha256Hex(trimmed.text),
        truncated: trimmed.truncated,
        content: {
          snippet: trimmed.text,
          lineStart: snippet.lineStart,
          lineEnd: snippet.lineEnd
        }
      });
      if (trimmed.truncated) anyTruncated = true;
      continue;
    }

    const trimmed = ToolHelper.truncateUtf8(content, maxBytesPerFile);
    selectedEntries.push({
      path: selectedPath,
      bytes: trimmed.bytes,
      sha256: await ToolHelper.sha256Hex(trimmed.text),
      truncated: trimmed.truncated,
      content: trimmed.text
    });
    if (trimmed.truncated) anyTruncated = true;
  }

  const payload = {
    query: queryRaw,
    match: explicitMatchMode || "first",
    extract,
    requireUnique,
    totalMatches: matchCount,
    selectedCount: selectedEntries.length,
    truncated: anyTruncated,
    limits: {
      maxMatches,
      maxBytesPerFile
    },
    entries: selectedEntries,
    candidates: candidates.slice(0, 20),
    filters: {
      includeExt: includeExts.size > 0 ? Array.from(includeExts) : "all_text_files",
      excludeExt: excludeExts.size > 0 ? Array.from(excludeExts) : [],
      maxBytes,
      pathContains,
      skippedByExtension,
      skippedBySize,
      skippedUnreadable
    }
  };

  return { result: JSON.stringify(payload, null, 2), isError: false, path: selectedEntries.length === 1 ? selectedEntries[0].path : "" };
}

const Command = declareNamespace("Command");
Command.export(searchRead);

}

{
// src/tools/commands/search-vault.js
function countSubstringOccurrences(haystack, needle) {
  const source = String(haystack || "");
  const term = String(needle || "");
  if (!source || !term) return 0;
  let count = 0;
  let idx = 0;
  while (idx <= source.length - term.length) {
    const found = source.indexOf(term, idx);
    if (found === -1) break;
    count += 1;
    idx = found + term.length;
  }
  return count;
}

async function searchVault(app, input) {
  const query = ToolHelper.requiredString(input.query).toLowerCase();
  const searchContent = input.searchContent;
  const limit = Math.min(input.limit || 10, 50);
  const maxBytesRaw = typeof input.maxBytes === "number" ? input.maxBytes : 1e5;
  const maxBytes = Math.max(1, Math.min(maxBytesRaw, 5e6));
  const allTextFiles = input.allTextFiles !== false;

  const includeExts = new Set(ToolHelper.parseExtensionTokens(input.extensions));
  const excludeExts = new Set(ToolHelper.parseExtensionTokens(input.excludeExtensions));

  const files = app.vault.getFiles();
  const results = [];
  let totalMatches = 0;

  let skippedByExtension = 0;
  let skippedBySize = 0;
  let skippedUnreadable = 0;

  for (const file of files) {
    if (results.length >= limit) break;

    if (!ToolHelper.fileMatchesExtensionPolicy(file.path, includeExts, excludeExts, allTextFiles)) {
      skippedByExtension++;
      continue;
    }

    if (file.path.toLowerCase().includes(query)) {
      const pathMatches = countSubstringOccurrences(file.path.toLowerCase(), query);
      totalMatches += pathMatches > 0 ? pathMatches : 1;
      results.push(`- ${file.path}`);
      continue;
    }

    if (searchContent) {
      const fileSize = typeof file.stat?.size === "number" ? file.stat.size : 0;
      if (fileSize > maxBytes) {
        skippedBySize++;
        continue;
      }

      let content = "";
      try {
        content = await app.vault.cachedRead(file);
      } catch {
        skippedUnreadable++;
        continue;
      }

      const lowerContent = content.toLowerCase();
      const idx = lowerContent.indexOf(query);
      if (idx !== -1) {
        const matchCountInFile = countSubstringOccurrences(lowerContent, query);
        totalMatches += matchCountInFile;
        const start = Math.max(0, idx - 50);
        const end = Math.min(content.length, idx + query.length + 50);
        const snippet = content.substring(start, end).replace(/\n/g, " ");
        results.push(`- ${file.path}: ...${snippet}...`);
      }
    }
  }

  const policySummary = `Filters: includeExt=${includeExts.size > 0 ? Array.from(includeExts).join(",") : "(all text files)"}, excludeExt=${excludeExts.size > 0 ? Array.from(excludeExts).join(",") : "(none)"}, maxBytes=${maxBytes}. Skipped: extension=${skippedByExtension}, size=${skippedBySize}, unreadable=${skippedUnreadable}.`;

  if (results.length === 0) {
    return { result: `No results found for "${query}" (total matches: 0).\n${policySummary}`, isError: false };
  }
  return {
    result: `Found ${results.length} result(s) (total matches: ${totalMatches}):\n${results.join("\n")}\n\n${policySummary}`,
    isError: false
  };
}

const Command = declareNamespace("Command");
Command.export(searchVault);

}

{
// src/tools/commands/set-properties.js
async function setProperties(app, input) {
  const props = ToolHelper.requiredRecord(input.properties);
  if (!props) {
    return { result: "'properties' parameter must be an object.", isError: true };
  }
  const path = ToolHelper.optionalString(input.path);
  const file = ToolHelper.resolveFile(app, path);
  if (!file) {
    return { result: path ? `File not found: ${path}` : "No active document open.", isError: true };
  }
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    for (const [key, value] of Object.entries(props)) {
      if (value === null) {
        delete frontmatter[key];
      } else {
        frontmatter[key] = value;
      }
    }
  });
  const setKeys = Object.entries(props).filter(([, v]) => v !== null).map(([k]) => k);
  const removedKeys = Object.entries(props).filter(([, v]) => v === null).map(([k]) => k);
  const parts = [];
  if (setKeys.length > 0) parts.push(`Set: ${setKeys.join(", ")}`);
  if (removedKeys.length > 0) parts.push(`Removed: ${removedKeys.join(", ")}`);
  return { result: `Updated properties in ${file.path}. ${parts.join(". ")}.`, isError: false };
}

const Command = declareNamespace("Command");
Command.export(setProperties);

}

{
// src/tools/commands/snippets.js
async function snippets(app, input) {
  const fallbackGoal = "CFC bypass justification: snippet-only extract requested for localized context instead of reusing full cached CFC payload.";
  const goalRaw = ToolHelper.requiredString(input.goal);
  const goal = goalRaw.trim() || fallbackGoal;
  const normalizedGoal = /cfc/i.test(goal)
    ? goal
    : `${goal} | CFC note: snippet mode requested for localized extract.`;

  const queryRaw = ToolHelper.requiredString(input.query);
  const query = queryRaw.toLowerCase();
  if (!query) {
    return { result: "'query' parameter is required.", isError: true };
  }

  const searchContent = input.searchContent === true;
  const maxBytesRaw = typeof input.maxBytes === "number" ? input.maxBytes : 1e5;
  const maxBytes = Math.max(1, Math.min(maxBytesRaw, 5e6));
  const allTextFiles = input.allTextFiles !== false;
  const pathContains = ToolHelper.requiredString(input.pathContains).toLowerCase();
  const maxMatchesScanned = ToolHelper.clampNumber(input.maxMatchesScanned, 500, 1, 5e3);

  const explicitMatchMode = ToolHelper.toSearchReadMatchMode(input.match);
  if (input.match !== void 0 && !explicitMatchMode) {
    return ToolHelper.buildSearchReadError("invalid_args", "Unknown match mode. Use first|best|exact|all.", { query: queryRaw, goal: normalizedGoal });
  }
  const mode = explicitMatchMode || "first";

  const requireUnique = input.requireUnique === true;
  const maxMatchesDefault = mode === "all" ? 20 : 1;
  const maxMatches = ToolHelper.clampNumber(input.maxMatches, maxMatchesDefault, 1, 200);
  const maxBytesPerFileRaw = typeof input.maxBytesPerFile === "number" ? input.maxBytesPerFile : 1e6;
  const maxBytesPerFile = Math.max(64, Math.min(maxBytesPerFileRaw, 5e6));

  const includeExts = new Set(ToolHelper.parseExtensionTokens(input.extensions));
  const excludeExts = new Set(ToolHelper.parseExtensionTokens(input.excludeExtensions));

  const files = app.vault.getFiles().slice().sort((a, b) => a.path.localeCompare(b.path));
  const matches = [];
  let matchCount = 0;
  let exceededMatchCap = false;

  let skippedByExtension = 0;
  let skippedBySize = 0;
  let skippedUnreadable = 0;

  const queryComparableLower = ToolHelper.normalizeComparablePath(queryRaw).toLowerCase();

  for (const file of files) {
    if (!ToolHelper.fileMatchesExtensionPolicy(file.path, includeExts, excludeExts, allTextFiles)) {
      skippedByExtension++;
      continue;
    }

    const pathComparable = ToolHelper.normalizeComparablePath(file.path);
    const pathLower = pathComparable.toLowerCase();

    let matched = false;
    let pathHit = false;
    let contentIndex = -1;

    if (explicitMatchMode === "exact") {
      const exactCaseSensitive = pathComparable === ToolHelper.normalizeComparablePath(queryRaw);
      const exactCaseInsensitive = pathLower === queryComparableLower;
      matched = exactCaseSensitive || exactCaseInsensitive;
      pathHit = matched;
    } else {
      if (pathLower.includes(query)) {
        matched = true;
        pathHit = true;
      } else if (searchContent) {
        const fileSize = typeof file.stat?.size === "number" ? file.stat.size : 0;
        if (fileSize > maxBytes) {
          skippedBySize++;
          continue;
        }
        let content = "";
        try {
          content = await app.vault.cachedRead(file);
        } catch {
          skippedUnreadable++;
          continue;
        }
        const idx = content.toLowerCase().indexOf(query);
        if (idx !== -1) {
          matched = true;
          contentIndex = idx;
        }
      }
    }

    if (!matched) continue;
    if (pathContains && !file.path.toLowerCase().includes(pathContains)) continue;

    matchCount += 1;
    if (matches.length < maxMatchesScanned) {
      matches.push({ path: file.path, pathHit, contentIndex });
    } else {
      exceededMatchCap = true;
    }
  }

  if (matchCount === 0) {
    return ToolHelper.buildSearchReadStatus("no_match", `No matches found for query '${queryRaw}'.`, {
      goal: normalizedGoal,
      query: queryRaw,
      match: mode,
      extract: "snippet",
      requireUnique,
      totalMatches: 0,
      limits: { maxMatches, maxBytesPerFile }
    });
  }

  if (exceededMatchCap) {
    return ToolHelper.buildSearchReadStatus("too_many_matches_scanned", `snippets matched ${matchCount} files, exceeding maxMatchesScanned=${maxMatchesScanned}. Refine query/pathContains or increase maxMatchesScanned.`, {
      goal: normalizedGoal,
      query: queryRaw,
      totalMatches: matchCount,
      maxMatchesScanned
    });
  }

  if (requireUnique && matchCount !== 1) {
    return ToolHelper.buildSearchReadStatus("not_unique", `requireUnique=true requires exactly 1 match, found ${matchCount}.`, {
      goal: normalizedGoal,
      query: queryRaw,
      totalMatches: matchCount,
      candidates: matches.slice(0, 20).map((m) => m.path)
    });
  }

  let selectedMetas = [];
  if (mode === "all") {
    selectedMetas = matches.slice(0, maxMatches);
  } else if (mode === "first") {
    selectedMetas = matches.length > 0 ? [matches[0]] : [];
  } else if (mode === "exact") {
    selectedMetas = matches.slice(0, maxMatches);
  } else if (mode === "best") {
    const sorted = matches.slice().sort((a, b) => {
      const sa = ToolHelper.computeBestScore(a, query, queryComparableLower);
      const sb = ToolHelper.computeBestScore(b, query, queryComparableLower);
      if (sa !== sb) return sa - sb;
      return a.path.localeCompare(b.path);
    });
    selectedMetas = sorted.slice(0, maxMatches);
  } else {
    return ToolHelper.buildSearchReadError("invalid_args", `Unknown match mode: ${mode}. Use first|best|exact|all.`, { query: queryRaw, goal: normalizedGoal });
  }

  const selectedEntries = [];
  const candidates = [];
  let anyTruncated = false;

  for (const meta of selectedMetas) {
    if (!meta || typeof meta.path !== "string") continue;
    const selectedPath = meta.path;
    candidates.push(selectedPath);
    const file = app.vault.getFileByPath(obsidian.normalizePath(selectedPath));
    if (!file) {
      selectedEntries.push({
        path: selectedPath,
        error: { code: "read_failed", message: "matched file no longer exists" }
      });
      continue;
    }

    let content = "";
    try {
      content = await app.vault.cachedRead(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      selectedEntries.push({
        path: selectedPath,
        error: { code: "read_failed", message: msg }
      });
      continue;
    }

    const snippet = ToolHelper.buildSnippetExtract(content, query);
    const trimmed = ToolHelper.truncateUtf8(snippet.text, maxBytesPerFile);
    selectedEntries.push({
      path: selectedPath,
      bytes: trimmed.bytes,
      sha256: await ToolHelper.sha256Hex(trimmed.text),
      truncated: trimmed.truncated,
      content: {
        snippet: trimmed.text,
        lineStart: snippet.lineStart,
        lineEnd: snippet.lineEnd
      }
    });
    if (trimmed.truncated) anyTruncated = true;
  }

  const payload = {
    goal: normalizedGoal,
    query: queryRaw,
    match: explicitMatchMode || "first",
    extract: "snippet",
    requireUnique,
    totalMatches: matchCount,
    selectedCount: selectedEntries.length,
    truncated: anyTruncated,
    limits: {
      maxMatches,
      maxBytesPerFile
    },
    entries: selectedEntries,
    candidates: candidates.slice(0, 20),
    filters: {
      includeExt: includeExts.size > 0 ? Array.from(includeExts) : "all_text_files",
      excludeExt: excludeExts.size > 0 ? Array.from(excludeExts) : [],
      maxBytes,
      pathContains,
      skippedByExtension,
      skippedBySize,
      skippedUnreadable
    }
  };

  return { result: JSON.stringify(payload, null, 2), isError: false, path: selectedEntries.length === 1 ? selectedEntries[0].path : "" };
}

const Command = declareNamespace("Command");
Command.export(snippets);

}

{
// src/tools/commands/talk-and-end-turn.js
function talkAndEndTurn(input) {
  const text = ToolHelper.requiredString(input.text);
  if (!text) {
    return { result: "'text' parameter is required.", isError: true };
  }
  const feedbackText = ToolHelper.optionalString(input.feedback) || "";
  return { result: text, isError: false, endTurn: true, feedback: feedbackText };
}

const Command = declareNamespace("Command");
Command.export(talkAndEndTurn);

}

{
// src/tools/commands/talk.js
function talk(input) {
  const text = ToolHelper.requiredString(input.text);
  if (!text) {
    return { result: "'text' parameter is required.", isError: true };
  }
  return { result: text, isError: false };
}

const Command = declareNamespace("Command");
Command.export(talk);

}

{
// src/tools/executor.js


async function executeTool(app, toolName, input, onAskUser, onMultiStepEvent) {
  try {
    switch (toolName) {
      case "edit_file":
        return await Command.editDocument(app, input);
      case "search_vault":
        return await Command.searchVault(app, input);
      case "search_read":
        return await Command.searchRead(app, input, "full");
      case "snippets":
        return await Command.snippets(app, input);
      case "frontmatter":
        return await Command.frontmatter(app, input);
      case "read_file":
        return await Command.readFile(app, input);
      case "flush":
        return Command.flushTool(input);
      case "talk":
        return Command.talk(input);
      case "talkAndEndTurn":
        return Command.talkAndEndTurn(input);
      case "create_file":
        return await Command.createFile(app, input);
      case "list_files":
        return await Command.listFiles(app, input);
      case "biggest":
        return await Command.biggest(app, input);
      case "rename_file":
        return await Command.renameFile(app, input);
      case "delete_file":
        return await Command.deleteFile(app, input);
      case "get_properties":
        return await Command.getProperties(app, input);
      case "set_properties":
        return await Command.setProperties(app, input);
      case "get_backlinks":
        return await Command.getBacklinks(app, input);
      case "get_current_datetime":
        return Command.getCurrentDatetime();
      case "open_document":
        return await Command.openDocument(app, input);
      case "agents":
        return await Command.agentsTool(app, input);
      case "revert_edit":
        return await Command.revertEdit(app, input);
      case "ask_user":
        return await Command.askUser(input, onAskUser);
      default:
        return { result: `Tool ${toolName} failed: unknown tool`, isError: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `Tool ${toolName} failed: execution_error (${msg})`, isError: true };
  }
}

function toPolicy(value) {
  const p = typeof value === "string" ? value : "stop";
  if (p === "continue" || p === "retry_once" || p === "retry_next_candidate") return p;
  return "stop";
}

function inferChanged(tool, input, result) {
  if (result?.isError) return false;
  return tool === "edit_file" || tool === "create_file" || tool === "rename_file" || tool === "delete_file" || tool === "set_properties" || tool === "revert_edit";
}

function inferNoProgressSignal(tool, input, result) {
  if (inferChanged(tool, input, result)) return "progress";
  if (tool === "edit_file" || tool === "create_file" || tool === "rename_file" || tool === "delete_file" || tool === "set_properties" || tool === "revert_edit") {
    return "stalled";
  }
  return "neutral";
}

async function runStepOnce(app, step, onAskUser, onMultiStepEvent) {
  const timeoutMs = ToolHelper.clampNumber(step.timeoutMs, 2e4, 100, 9e4);
  const stepTool = ToolHelper.requiredString(step.tool);
  const stepInput = isRecordArg(step.input) ? step.input : {};

  if (!stepTool) {
    return { result: "Step missing tool name.", isError: true };
  }
  if (stepTool === "ask_user" && typeof onAskUser !== "function") {
    return { result: "Step requires user input but no ask-user handler is available.", isError: true, needsUserInput: true };
  }

  if (typeof onMultiStepEvent === "function") {
    try {
      onMultiStepEvent({ type: "tool_call", tool: stepTool, input: stepInput });
    } catch {
    }
  }

  const stepPromise = executeTool(app, stepTool, stepInput, onAskUser, onMultiStepEvent);
  const timeoutPromise = new Promise((resolve) => {
    window.setTimeout(() => resolve({ result: `Step timed out after ${timeoutMs}ms.`, isError: true }), timeoutMs);
  });

  const settled = await Promise.race([stepPromise, timeoutPromise]);

  if (typeof onMultiStepEvent === "function") {
    try {
      onMultiStepEvent({ type: "tool_result", tool: stepTool, input: stepInput, result: settled });
    } catch {
    }
  }

  return settled;
}

async function runStepWithPolicy(app, step, onAskUser, onMultiStepEvent) {
  const policy = toPolicy(step.onError);
  const stepTool = ToolHelper.requiredString(step.tool);
  const baseInput = isRecordArg(step.input) ? step.input : {};

  if (policy === "retry_next_candidate" && stepTool === "edit_file") {
    const findCandidates = Command.normalizeFindCandidates(baseInput.find);
    if (findCandidates.length > 1) {
      let lastError = null;
      for (let i = 0; i < findCandidates.length; i++) {
        const candidate = findCandidates[i];
        const stepWithSingle = {
          ...step,
          input: {
            ...baseInput,
            find: candidate
          }
        };
        const attemptResult = await runStepOnce(app, stepWithSingle, onAskUser, onMultiStepEvent);
        if (!attemptResult?.isError) {
          return { result: attemptResult, attempts: i + 1, policyApplied: "retry_next_candidate" };
        }
        if (attemptResult.needsUserInput) {
          return {
            result: attemptResult,
            attempts: i + 1,
            policyApplied: "needs_user_input",
            needsUserInput: true
          };
        }
        lastError = attemptResult;
      }
      return {
        result: lastError || { result: "Unknown step failure.", isError: true },
        attempts: findCandidates.length,
        policyApplied: "retry_next_candidate"
      };
    }
  }

  const result = await runStepOnce(app, step, onAskUser, onMultiStepEvent);

  if (!result?.isError) {
    return { result, attempts: 1, policyApplied: "none" };
  }

  if (result.needsUserInput) {
    return { result, attempts: 1, policyApplied: "needs_user_input", needsUserInput: true };
  }

  if (policy === "retry_once") {
    const retry = await runStepOnce(app, step, onAskUser, onMultiStepEvent);
    return { result: retry, attempts: 2, policyApplied: "retry_once" };
  }

  return { result, attempts: 1, policyApplied: policy === "continue" ? "continue" : "stop" };
}

async function evaluateStopNode(app, node, stepResults, hadToolErrors) {
  if (!isRecordArg(node)) return { ok: false, details: [{ criterion: "invalid", ok: false }] };

  if (Array.isArray(node.all)) {
    const allDetails = [];
    for (const child of node.all) {
      const evaled = await evaluateStopNode(app, child, stepResults, hadToolErrors);
      allDetails.push(...evaled.details);
      if (!evaled.ok) return { ok: false, details: allDetails };
    }
    return { ok: true, details: allDetails };
  }

  if (Array.isArray(node.any)) {
    const anyDetails = [];
    let anyOk = false;
    for (const child of node.any) {
      const evaled = await evaluateStopNode(app, child, stepResults, hadToolErrors);
      anyDetails.push(...evaled.details);
      if (evaled.ok) anyOk = true;
    }
    return { ok: anyOk, details: anyDetails };
  }

  const type = ToolHelper.requiredString(node.type);
  if (!type) return { ok: false, details: [{ criterion: "missing_type", ok: false }] };

  if (type === "no_tool_errors") {
    return { ok: !hadToolErrors, details: [{ criterion: "no_tool_errors", ok: !hadToolErrors }] };
  }

  if (type === "file_contains" || type === "file_not_contains") {
    const path = ToolHelper.requiredString(node.path);
    const text = ToolHelper.requiredString(node.text);
    const file = path ? app.vault.getFileByPath(obsidian.normalizePath(path)) : null;
    let hasText = false;
    if (file && text) {
      try {
        const raw = await app.vault.cachedRead(file);
        hasText = raw.includes(text);
      } catch {
        hasText = false;
      }
    }
    const ok = type === "file_contains" ? hasText : !hasText;
    return { ok, details: [{ criterion: type, ok }] };
  }

  if (type === "tool_result_contains" || type === "tool_result_not_contains") {
    const stepId = ToolHelper.requiredString(node.stepId || node.id);
    const text = ToolHelper.requiredString(node.text);
    const step = stepResults.get(stepId);
    const hay = step ? String(step.resultText || "") : "";
    const hasText = text ? hay.includes(text) : false;
    const ok = type === "tool_result_contains" ? hasText : !hasText;
    return { ok, details: [{ criterion: type, ok }] };
  }

  return { ok: false, details: [{ criterion: type, ok: false }] };
}

async function evaluateStopWhen(app, stopWhen, stepResults, hadToolErrors) {
  if (!isRecordArg(stopWhen)) return { ok: false, details: [] };
  return await evaluateStopNode(app, stopWhen, stepResults, hadToolErrors);
}

declareExports({
  executeTool,
  runStepOnce,
  runStepWithPolicy,
  evaluateStopWhen,
  inferChanged,
  inferNoProgressSignal
});



}

{
// src/tools/registry.js

let TOOL_DEFINITIONS = [
  {
    name: "search_vault",
    description: "Search for files in the vault by filename or content. Returns matching file paths and snippets. For content searches, prefer narrowing with extensions and/or maxBytes to avoid slow scans.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (matched against filenames and optionally content)."
        },
        searchContent: {
          type: "boolean",
          description: "Whether to also search inside file contents (slower). Default: false. If true, use extensions/excludeExtensions/maxBytes to keep scans bounded.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return. Default: 10."
        },
        extensions: {
          type: "string",
          description: "Optional extension filter for files to scan, e.g. '*.js;*.json' or '.js,.json'."
        },
        excludeExtensions: {
          type: "string",
          description: "Optional extension blacklist, e.g. '*.png;*.pdf;*.zip'."
        },
        allTextFiles: {
          type: "boolean",
          description: "When true, scan all text-like files (excluding built-in binary blacklist). Default: true."
        },
        maxBytes: {
          type: "number",
          description: "Maximum file size (in bytes) to read during content search. Default: 100000."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "snippets",
    description: "Search files and return snippet extracts only.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (path match by default; optional content search with searchContent=true)."
        },
        goal: {
          type: "string",
          description: "Required intent note: explain why CFC content was not used for this operation."
        },
        searchContent: {
          type: "boolean",
          description: "Whether to also search inside file contents. Default: false."
        },
        extensions: {
          type: "string",
          description: "Optional extension filter for files to scan, e.g. '*.md;*.js' or '.md,.js'."
        },
        excludeExtensions: {
          type: "string",
          description: "Optional extension blacklist, e.g. '*.png;*.pdf'."
        },
        allTextFiles: {
          type: "boolean",
          description: "When true, scan all text-like files (excluding built-in binary blacklist). Default: true."
        },
        maxBytes: {
          type: "integer",
          description: "Maximum file size (in bytes) to read during content search. Default: 100000."
        },
        match: {
          type: "string",
          enum: ["first", "best", "exact", "all"],
          description: "Selection mode: first=path-sorted first, best=deterministic ranking, exact=exact path match(es), all=select all up to maxMatches."
        },
        maxMatches: {
          type: "integer",
          description: "Maximum selected matches to read (default: 1; default 20 when match=all)."
        },
        maxBytesPerFile: {
          type: "integer",
          description: "Read cap per selected file. Returns truncation metadata when exceeded."
        },
        requireUnique: {
          type: "boolean",
          description: "When true, fail unless total match count is exactly 1 (checked before maxMatches)."
        },
        pathContains: {
          type: "string",
          description: "Optional additional path substring filter applied after matching and before selection."
        },
        maxMatchesScanned: {
          type: "integer",
          description: "Optional cap on stored matches while scanning (default: 500, max: 5000)."
        }
      },
      required: ["query", "goal"]
    }
  },
  {
    name: "frontmatter",
    description: "Search files and return frontmatter extracts only.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (path match by default; optional content search with searchContent=true)."
        },
        searchContent: {
          type: "boolean",
          description: "Whether to also search inside file contents. Default: false."
        },
        extensions: {
          type: "string",
          description: "Optional extension filter for files to scan, e.g. '*.md;*.js' or '.md,.js'."
        },
        excludeExtensions: {
          type: "string",
          description: "Optional extension blacklist, e.g. '*.png;*.pdf'."
        },
        allTextFiles: {
          type: "boolean",
          description: "When true, scan all text-like files (excluding built-in binary blacklist). Default: true."
        },
        maxBytes: {
          type: "integer",
          description: "Maximum file size (in bytes) to read during content search. Default: 100000."
        },
        match: {
          type: "string",
          enum: ["first", "best", "exact", "all"],
          description: "Selection mode. first=path-sorted first, best=deterministic ranking, exact=exact path match(es), all=select all up to maxMatches."
        },
        maxMatches: {
          type: "integer",
          description: "Maximum selected matches to read (default: 1; default 20 when match=all)."
        },
        maxBytesPerFile: {
          type: "integer",
          description: "Read cap per selected file. Returns truncation metadata when exceeded."
        },
        requireUnique: {
          type: "boolean",
          description: "When true, fail unless total match count is exactly 1 (checked before maxMatches)."
        },
        pathContains: {
          type: "string",
          description: "Optional additional path substring filter applied after matching and before selection."
        },
        maxMatchesScanned: {
          type: "integer",
          description: "Optional cap on stored matches while scanning (default: 500, max: 5000)."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_read",
    description: "Search files, deterministically select match(es), and return full-file reads only (extract is always full). On query miss, returns no_match; if skipped due to command-chain stop (e.g., blocked_on_error), no search was executed.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (path match by default; optional content search with searchContent=true)."
        },
        searchContent: {
          type: "boolean",
          description: "Whether to also search inside file contents. Default: false."
        },
        extensions: {
          type: "string",
          description: "Optional extension filter for files to scan, e.g. '*.md;*.js' or '.md,.js'."
        },
        excludeExtensions: {
          type: "string",
          description: "Optional extension blacklist, e.g. '*.png;*.pdf'."
        },
        allTextFiles: {
          type: "boolean",
          description: "When true, scan all text-like files (excluding built-in binary blacklist). Default: true."
        },
        maxBytes: {
          type: "number",
          description: "Maximum file size (in bytes) to read during content search. Default: 100000."
        },
        match: {
          type: "string",
          enum: ["first", "best", "exact", "all"],
          description: "New selection mode. first=path-sorted first, best=deterministic ranking, exact=exact path match(es), all=select all up to maxMatches."
        },
        maxMatches: {
          type: "number",
          description: "Maximum selected matches to read (default: 1; default 20 when match=all)."
        },
        maxBytesPerFile: {
          type: "number",
          description: "Read cap per selected file. Returns truncation metadata when exceeded."
        },
        requireUnique: {
          type: "boolean",
          description: "When true, fail unless total match count is exactly 1 (checked before maxMatches)."
        },
        pathContains: {
          type: "string",
          description: "Optional additional path substring filter applied after matching and before selection."
        },
        maxMatchesScanned: {
          type: "number",
          description: "Optional cap on stored matches while scanning (default: 500, max: 5000)."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "read_file",
    description: "Read the full content of any file in the vault by its path.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "flush",
    description: "Flush previously stored read payloads from conversation history to reduce token footprint. Supports a specific file path or all read payloads.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional file path to flush. When omitted, all read payloads are flushed."
        },
        all: {
          type: "boolean",
          description: "When true, flush all stored read payloads regardless of path."
        }
      },
      required: []
    }
  },
  {
    name: "talk",
    description: "Print text to the user in the chat stream.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to print to the user."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "talkAndEndTurn",
    description: "Print text to the user in the chat stream and end the assistant turn immediately.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to print to the user before ending the turn."
        },
        feedback: {
          type: "string",
          description: "Optional turn-level command feedback. Preferred over separate feedback tool calls. Omit when there are no issues."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "edit_file",
    description: "Edit an existing text file. Supports three operations: 'replace_all' replaces the entire content, 'find_replace' finds/replaces using one or more candidate strings, 'insert' adds content at a position.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file."
        },
        operation: {
          type: "string",
          enum: ["replace_all", "find_replace", "insert"],
          description: "The type of edit to perform."
        },
        content: {
          type: "string",
          description: "The new content (for replace_all), replacement text (for find_replace), or text to insert."
        },
        find: {
          description: "Text to find for find_replace. Can be a string or an array of candidate strings (first match wins)."
        },
        forgiveWhitespace: {
          type: "boolean",
          description: "For find_replace, also try a whitespace-forgiving match. All whitespace durations are equivalent, and \\n, \\r, \\t, space, and &nbsp; (any capitalization) are treated as whitespace. Default: true."
        },
        includeNearMatches: {
          type: "boolean",
          description: "For find_replace failures, include nearby snippet hints when possible. Default: false."
        },
        position: {
          type: "string",
          enum: ["beginning", "end", "after_frontmatter"],
          description: "Where to insert content (required for insert). 'after_frontmatter' inserts after the --- block."
        }
      },
      required: ["path", "operation", "content"]
    }
  },
  {
    name: "create_file",
    description: "Create a new file in the vault. Fails if the file already exists. IMPORTANT: The filename is the title in Obsidian, so never start content with an H1 heading that repeats the filename.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path for the new file relative to vault root (e.g. 'Notes/meeting.md')."
        },
        content: {
          type: "string",
          description: "Content of the new file."
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_files",
    description: "List files in the vault, optionally filtered by folder and/or extension.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Folder path to list (e.g. 'Projects'). Omit to list all files."
        },
        extension: {
          type: "string",
          description: "Filter by file extension (e.g. 'md'). Omit to include all types."
        }
      },
      required: []
    }
  },
  {
    name: "biggest",
    description: "Find the biggest files by included extensions, scanning from vault root through all subdirectories, and return the top 20 by size.",
    inputSchema: {
      type: "object",
      properties: {
        extensions: {
          type: "string",
          description: "Extensions to include, e.g. '.js,.md' or '*.js;*.md'."
        }
      },
      required: ["extensions"]
    }
  },
  {
    name: "rename_file",
    description: "Rename or move a file in the vault. Can be used to rename a note or move it to a different folder.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Current path of the file relative to vault root."
        },
        new_path: {
          type: "string",
          description: "New path for the file relative to vault root."
        }
      },
      required: ["path", "new_path"]
    }
  },
  {
    name: "delete_file",
    description: "Move a file to the Obsidian trash. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path of the file to delete relative to vault root."
        }
      },
      required: ["path"]
    }
  },
  {
    name: "get_properties",
    description: "Read the YAML frontmatter properties of a markdown document as structured data. Returns tags, aliases, and all custom properties.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document."
        }
      },
      required: []
    }
  },
  {
    name: "set_properties",
    description: "Set or update YAML frontmatter properties on a markdown document. Merges with existing properties. Set a value to null to remove a property.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document."
        },
        properties: {
          type: "object",
          description: "Key-value pairs to set in the frontmatter. Arrays (like tags) are supported. Set a value to null to remove that property."
        }
      },
      required: ["properties"]
    }
  },
  {
    name: "get_backlinks",
    description: "Find all notes in the vault that link to a given document. Uses Obsidian's metadata cache for fast lookups.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the document. Omit to use the active document."
        }
      },
      required: []
    }
  },
  {
    name: "get_current_datetime",
    description: "Get the current date and time in the user's local timezone. Useful for daily notes, journaling, scheduling, or any time-aware task.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "open_document",
    description: "Open a document in the Obsidian editor. Use this when the user wants to navigate to, view, or open a specific file.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root."
        }
      },
      required: ["path"]
    }
  },

  {
    name: "agents",
    description: "Manage and read a project AGENTS.md file used as persistent instructions. Supports inline include directives in AGENTS content, such as {#include path/to/file.md} or {#include path/to/file.md#Heading}. Provide a path to set it, '-' to clear it, or omit path to read current configured AGENTS content.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Vault-relative or absolute path to AGENTS.md. Use '-' to clear configured agents file. Omit to read current agents content. Include directives are resolved when AGENTS context is loaded."
        }
      },
      required: []
    }
  },
  {
    name: "revert_edit",
    description: "Revert assistant-made edits using the local edit journal. Provide path to revert the latest change for a file, or entryId to revert a specific journal entry.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to a file. Reverts the latest journaled change for this file."
        },
        entryId: {
          type: "string",
          description: "Specific journal entry id to revert."
        }
      },
      required: []
    }
  },
  {
    name: "ask_user",
    description: "Ask the user a clarifying question. Use this when you need more information before proceeding. The conversation will pause until the user responds.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user."
        }
      },
      required: ["question"]
    }
  }
];



declareExports({
  TOOL_DEFINITIONS
});

}

{
// src/tools/shared/args.js
const ToolHelper = declareNamespace("ToolHelper");

const optionalString = ToolHelper.export(function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
});

const requiredString = ToolHelper.export(function requiredString(value) {
  return typeof value === "string" ? value : "";
});

const isRecord = ToolHelper.export(function isRecord(value) {
  return typeof value === "object" && value !== null;
});

const requiredRecord = ToolHelper.export(function requiredRecord(value) {
  return ToolHelper.isRecord(value) ? value : null;
});

const clampNumber = ToolHelper.export(function clampNumber(value, fallback, min, max) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
});

}

{
// src/tools/shared/edit-journal.js
const ToolHelper = declareNamespace("ToolHelper");

const EDIT_JOURNAL_PATH = ToolHelper.export(function EDIT_JOURNAL_PATH() {
  return "aichat/.journal/edits.ndjson";
});

async function ensureAdapterFolder(adapter, folderPath) {
  const normalized = obsidian.normalizePath(folderPath);
  if (!normalized) return;
  if (await adapter.exists(normalized)) return;
  const slash = normalized.lastIndexOf("/");
  const parent = slash === -1 ? "" : normalized.substring(0, slash);
  if (parent) {
    await ensureAdapterFolder(adapter, parent);
  }
  try {
    await adapter.mkdir(normalized);
  } catch {
  }
}

function newJournalEntryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseNdjson(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {
    }
  }
  return out;
}

const readEditJournalEntries = ToolHelper.export(async function readEditJournalEntries(app) {
  try {
    const raw = await app.vault.adapter.read(ToolHelper.EDIT_JOURNAL_PATH());
    return parseNdjson(raw);
  } catch {
    return [];
  }
});

async function appendEditJournalEntry(app, entry) {
  const adapter = app.vault.adapter;
  await ensureAdapterFolder(adapter, "aichat/.journal");
  const line = JSON.stringify(entry) + "\n";
  try {
    await adapter.append(ToolHelper.EDIT_JOURNAL_PATH(), line);
    return;
  } catch {
  }
  let existing = "";
  try {
    existing = await adapter.read(ToolHelper.EDIT_JOURNAL_PATH());
  } catch {
    existing = "";
  }
  await adapter.write(ToolHelper.EDIT_JOURNAL_PATH(), existing + line);
}

const recordEditJournal = ToolHelper.export(async function recordEditJournal(app, params) {
  const beforeHash = await ToolHelper.sha256Hex(params.beforeContent);
  const afterHash = await ToolHelper.sha256Hex(params.afterContent);
  const entry = {
    id: newJournalEntryId(),
    timestamp: new Date().toISOString(),
    filePath: params.filePath,
    operation: params.operation,
    beforeHash,
    afterHash,
    inverseOp: {
      operation: "replace_all",
      content: String(params.beforeContent || "")
    }
  };
  if (params.meta && typeof params.meta === "object") {
    entry.meta = params.meta;
  }
  await appendEditJournalEntry(app, entry);
  return entry;
});

}

{
// src/tools/shared/extensions.js
const ToolHelper = declareNamespace("ToolHelper");

const parseExtensionTokens = ToolHelper.export(function parseExtensionTokens(value) {
  const tokens = [];
  if (typeof value === "string") {
    for (const raw of value.split(/[;,\s]+/)) {
      const t = raw.trim();
      if (t) tokens.push(t);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (t) tokens.push(t);
    }
  }

  const normalized = [];
  for (const token of tokens) {
    let t = token.toLowerCase();
    if (t.startsWith("*")) t = t.slice(1);
    if (!t.startsWith(".")) t = `.${t}`;
    if (t === ".") continue;
    normalized.push(t);
  }
  return Array.from(new Set(normalized));
});

const getPathExtension = ToolHelper.export(function getPathExtension(path) {
  const idx = path.lastIndexOf(".");
  if (idx === -1) return "";
  const slashIdx = path.lastIndexOf("/");
  if (slashIdx > idx) return "";
  return path.substring(idx).toLowerCase();
});

const BINARY_EXTENSION_BLACKLIST = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".heic", ".avif",
  ".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg",
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".m4v",
  ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar",
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
  ".sqlite", ".db", ".dylib", ".so", ".dll", ".exe", ".bin", ".wasm",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".psd", ".ai", ".sketch", ".fig",
  ".class", ".jar", ".pyc", ".pyo", ".o", ".a"
]);

const DEFAULT_BINARY_EXTENSION_BLACKLIST = ToolHelper.export(function DEFAULT_BINARY_EXTENSION_BLACKLIST() {
  return BINARY_EXTENSION_BLACKLIST;
});

const fileMatchesExtensionPolicy = ToolHelper.export(function fileMatchesExtensionPolicy(path, includeExts, excludeExts, allTextFiles) {
  const ext = ToolHelper.getPathExtension(path);

  if (excludeExts.has(ext)) return false;

  if (includeExts.size > 0) {
    return includeExts.has(ext);
  }

  if (!allTextFiles) {
    return ext === "";
  }

  return !ToolHelper.DEFAULT_BINARY_EXTENSION_BLACKLIST().has(ext);
});

}

{
// src/tools/shared/files.js
const ToolHelper = declareNamespace("ToolHelper");

const resolveFile = ToolHelper.export(function resolveFile(app, path) {
  if (path) {
    return app.vault.getFileByPath(obsidian.normalizePath(path));
  }
  return app.workspace.getActiveFile();
});

const validateCfcEditPrecondition = ToolHelper.export(async function validateCfcEditPrecondition(app, file, input) {
  const pre = ToolHelper.requiredRecord(input?.__cfc_precondition);
  if (!pre) return null;

  const expectedPathRaw = ToolHelper.optionalString(pre.path);
  const expectedPath = expectedPathRaw ? obsidian.normalizePath(expectedPathRaw) : file.path;
  const expectedMtimeMs = typeof pre.observedMtimeMs === "number" ? pre.observedMtimeMs : NaN;
  const expectedSize = typeof pre.observedSize === "number" ? pre.observedSize : NaN;

  if (expectedPath !== file.path) {
    return {
      result: `Blocked edit_file for ${file.path}: CFC snapshot precondition mismatch (${expectedPath}). Re-read the file before editing.`,
      isError: true
    };
  }

  let stat = null;
  try {
    stat = await app.vault.adapter.stat(file.path);
  } catch {
    stat = null;
  }
  const currentMtimeMs = typeof stat?.mtime === "number" ? stat.mtime : NaN;
  const currentSize = typeof stat?.size === "number" ? stat.size : NaN;

  if (!Number.isFinite(expectedMtimeMs) || !Number.isFinite(expectedSize) || !Number.isFinite(currentMtimeMs) || !Number.isFinite(currentSize)) {
    return {
      result: `Blocked edit_file for ${file.path}: unable to validate CFC snapshot precondition. Re-read the file before editing.`,
      isError: true
    };
  }

  if (expectedMtimeMs !== currentMtimeMs || expectedSize !== currentSize) {
    return {
      result: `Blocked edit_file for ${file.path}: file changed since CFC snapshot (expected mtime=${expectedMtimeMs}, size=${expectedSize}; current mtime=${currentMtimeMs}, size=${currentSize}). Re-read the file and retry.`,
      isError: true
    };
  }

  return null;
});

const ensureParentFolder = ToolHelper.export(async function ensureParentFolder(app, filePath) {
  const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
  if (parentPath && !app.vault.getFolderByPath(parentPath)) {
    await app.vault.createFolder(parentPath);
  }
});

}

{
// src/tools/shared/hash.js
const ToolHelper = declareNamespace("ToolHelper");

const sha256Hex = ToolHelper.export(async function sha256Hex(content) {
  const text = String(content || "");
  try {
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      const arr = Array.from(new Uint8Array(digest));
      return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
  }

  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
});

}

{
// src/tools/shared/search-read-utils.js
const ToolHelper = declareNamespace("ToolHelper");

const normalizeComparablePath = ToolHelper.export(function normalizeComparablePath(path) {
  return String(path || "").replace(/\\+/g, "/").replace(/^\/+/, "");
});

const basenameOfPath = ToolHelper.export(function basenameOfPath(path) {
  const normalized = ToolHelper.normalizeComparablePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.substring(slash + 1);
});

const toSearchReadExtract = ToolHelper.export(function toSearchReadExtract(value) {
  const raw = ToolHelper.requiredString(value).toLowerCase();
  if (raw === "snippet" || raw === "frontmatter") return raw;
  return "full";
});

const toSearchReadMatchMode = ToolHelper.export(function toSearchReadMatchMode(value) {
  const raw = ToolHelper.requiredString(value).toLowerCase();
  if (raw === "first" || raw === "best" || raw === "exact" || raw === "all") return raw;
  return "";
});

const truncateUtf8 = ToolHelper.export(function truncateUtf8(text, maxBytes) {
  const s = String(text || "");
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) {
    return { text: s, truncated: false, bytes: bytes.length };
  }
  const slice = bytes.slice(0, Math.max(0, maxBytes));
  let decoded = "";
  try {
    decoded = new TextDecoder().decode(slice);
  } catch {
    decoded = s.slice(0, Math.max(0, maxBytes));
  }
  return { text: decoded, truncated: true, bytes: bytes.length };
});

const buildSnippetExtract = ToolHelper.export(function buildSnippetExtract(content, queryLower, maxLen = 260) {
  const raw = String(content || "");
  if (!raw) return { text: "", lineStart: 1, lineEnd: 1 };
  const lower = raw.toLowerCase();
  const idx = queryLower ? lower.indexOf(queryLower) : -1;
  const center = idx >= 0 ? idx : 0;
  const start = Math.max(0, center - Math.floor(maxLen / 2));
  const end = Math.min(raw.length, start + maxLen);
  const text = raw.substring(start, end).replace(/\n/g, " ");
  const before = raw.substring(0, start);
  const within = raw.substring(start, end);
  const lineStart = before.split("\n").length;
  const lineEnd = lineStart + within.split("\n").length - 1;
  return { text, lineStart, lineEnd };
});

const buildSearchReadStatus = ToolHelper.export(function buildSearchReadStatus(code, message, extra) {
  const payload = {
    status: { code, message },
    ...extra
  };
  return { result: JSON.stringify(payload, null, 2), isError: false };
});

const computeBestScore = ToolHelper.export(function computeBestScore(matchMeta, queryLower, queryComparableLower) {
  const pathComparable = ToolHelper.normalizeComparablePath(matchMeta.path);
  const pathLower = pathComparable.toLowerCase();
  const baseLower = ToolHelper.basenameOfPath(pathComparable).toLowerCase();

  if (pathLower === queryComparableLower) return 0;
  if (baseLower === queryLower) return 1;
  if (baseLower.startsWith(queryLower)) return 2;

  if (matchMeta.pathHit) return 3;
  if (typeof matchMeta.contentIndex === "number" && matchMeta.contentIndex >= 0) return 4 + Math.min(matchMeta.contentIndex, 1e6) / 1e6;

  return 9;
});

const buildSearchReadError = ToolHelper.export(function buildSearchReadError(code, message, extra) {
  const payload = {
    error: { code, message },
    ...extra
  };
  return { result: JSON.stringify(payload, null, 2), isError: true };
});

}

{
// src/types.js
registerInit("types", init_types);

const DEFAULT_SETTINGS = {
  provider: "anthropic",
  apiKey: "",
  model: "claude-sonnet-4-6",
  maxIterations: 20,
  enableWebSearch: true,
  zeroKeyboardHeightInVsCode: false
};

const CHATGPT_OAUTH_DEFAULT_MODEL = "gpt-5.5";

function init_types() {
  "use strict";
}

declareExports({
  DEFAULT_SETTINGS,
  CHATGPT_OAUTH_DEFAULT_MODEL
});

}

{
// src/ui/chat-container-vanilla.js
function createVanillaChatContainer(target, props) {
  const state = {
    displayModel: props?.model || "",
    agentsStatus: props?.agentsStatus || "aichat",
    inputEnabled: true,
    placeholder: "Ask anything...",
    selection: null,
    askUserResolve: null,
    nextId: 0,
    messages: []
  };

  const dom = buildShell(target);
  renderHeader();
  renderInputState();

  dom.clearBtn.addEventListener("click", () => props?.onClear?.());
  dom.sendBtn.addEventListener("click", () => handleSend());
  dom.stopBtn.addEventListener("click", () => props?.onStop?.());
  dom.textarea.addEventListener("keydown", (e) => handleKeydown(e));
  dom.textarea.addEventListener("input", () => autoGrow());

  function buildShell(host) {
    host.empty();
    host.addClass("ochatting-view-container");

    const root = document.createElement("div");
    root.className = "ochatting-container";

    const header = document.createElement("div");
    header.className = "ochatting-header";

    const headerLeft = document.createElement("div");
    headerLeft.className = "ochatting-header-left";

    const title = document.createElement("span");
    title.className = "ochatting-header-title";
    title.textContent = "Chat";

    const model = document.createElement("span");
    model.className = "ochatting-header-model";

    headerLeft.appendChild(title);
    headerLeft.appendChild(model);

    const clearBtn = document.createElement("button");
    clearBtn.className = "ochatting-clear-btn";
    clearBtn.textContent = "Clear";

    header.appendChild(headerLeft);
    header.appendChild(clearBtn);

    const messagesEl = document.createElement("div");
    messagesEl.className = "ochatting-messages";

    const selectionWrap = document.createElement("div");

    const inputBar = document.createElement("div");
    inputBar.className = "ochatting-input-bar";

    const textarea = document.createElement("textarea");
    textarea.className = "ochatting-input";
    textarea.rows = 1;

    const sendBtn = document.createElement("button");
    sendBtn.className = "ochatting-send-btn";
    sendBtn.textContent = "↑";
    sendBtn.setAttribute("aria-label", "Send message");

    const stopBtn = document.createElement("button");
    stopBtn.className = "ochatting-send-btn ochatting-stop-btn";
    stopBtn.textContent = "■";
    stopBtn.setAttribute("aria-label", "Stop generation");

    inputBar.appendChild(textarea);
    inputBar.appendChild(sendBtn);
    inputBar.appendChild(stopBtn);

    root.appendChild(header);
    root.appendChild(messagesEl);
    root.appendChild(selectionWrap);
    root.appendChild(inputBar);

    host.appendChild(root);

    return {
      root,
      model,
      clearBtn,
      messagesEl,
      selectionWrap,
      inputBar,
      textarea,
      sendBtn,
      stopBtn
    };
  }

  function renderHeader() {
    const model = state.displayModel || "No model";
    const agents = state.agentsStatus || "aichat";
    dom.model.textContent = `${model} • ${agents}`;
  }

  function renderInputState() {
    dom.textarea.disabled = !state.inputEnabled;
    dom.textarea.placeholder = state.placeholder;
    dom.sendBtn.style.display = state.inputEnabled ? "inline-flex" : "none";
    dom.stopBtn.style.display = state.inputEnabled ? "none" : "inline-flex";
  }

  function renderSelectionPill() {
    dom.selectionWrap.empty();
    const sel = state.selection;
    if (!sel) return;

    const pill = document.createElement("div");
    pill.className = "ochatting-selection-pill";

    const content = document.createElement("div");
    content.className = "ochatting-selection-content";

    const label = document.createElement("span");
    label.className = "ochatting-selection-label";
    label.textContent = `Selection from ${(sel.filePath || "").split("/").pop() || ""}`;

    const preview = document.createElement("span");
    preview.className = "ochatting-selection-preview";
    const p = String(sel.text || "").substring(0, 80);
    preview.textContent = `${p}${String(sel.text || "").length > 80 ? "..." : ""}`;

    const dismiss = document.createElement("button");
    dismiss.className = "ochatting-selection-dismiss";
    dismiss.setAttribute("aria-label", "Remove selection");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      state.selection = null;
      renderSelectionPill();
    });

    content.appendChild(label);
    content.appendChild(preview);
    pill.appendChild(content);
    pill.appendChild(dismiss);
    dom.selectionWrap.appendChild(pill);
  }

  function enqueueMessage(message) {
    state.messages.push(message);
    const el = renderMessage(message);
    dom.messagesEl.appendChild(el);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      dom.messagesEl.scrollTop = dom.messagesEl.scrollHeight;
    });
  }

  function renderMarkdown(node, text) {
    node.empty();
    obsidian.MarkdownRenderer.render(props.app, text, node, "", props.component);
  }

  function renderMessage(msg) {
    if (msg.type === "user") {
      const wrap = document.createElement("div");
      wrap.className = "ochatting-msg ochatting-user-msg";
      const content = document.createElement("div");
      content.className = "ochatting-msg-content";
      content.textContent = msg.text || "";
      wrap.appendChild(content);
      msg._el = wrap;
      return wrap;
    }

    if (msg.type === "assistant") {
      const wrap = document.createElement("div");
      wrap.className = "ochatting-msg ochatting-assistant-msg";
      const content = document.createElement("div");
      content.className = "ochatting-msg-content";
      wrap.appendChild(content);
      renderMarkdown(content, msg.text || "");
      msg._el = wrap;
      return wrap;
    }

    if (msg.type === "tool-call") {
      const wrap = document.createElement("div");
      wrap.className = "ochatting-tool-call";
      const status = document.createElement("div");
      status.className = "ochatting-tool-status";
      const name = document.createElement("span");
      name.className = "ochatting-tool-name";
      name.textContent = formatToolName(msg.toolName || "", msg.toolInput || {}, null);
      status.textContent = "⏳ ";
      status.appendChild(name);

      const details = document.createElement("details");
      details.className = "ochatting-tool-details";
      const summary = document.createElement("summary");
      summary.textContent = "Parameters";
      const pre = document.createElement("pre");
      pre.className = "ochatting-tool-json";
      pre.textContent = JSON.stringify(msg.toolInput || {}, null, 2);

      details.appendChild(summary);
      details.appendChild(pre);
      wrap.appendChild(status);
      wrap.appendChild(details);
      msg._el = wrap;
      return wrap;
    }

    if (msg.type === "tool-result") {
      return renderToolResultMessage(msg);
    }

    if (msg.type === "error") {
      const wrap = document.createElement("div");
      wrap.className = "ochatting-msg ochatting-error-msg";
      const content = document.createElement("div");
      content.className = "ochatting-msg-content";
      content.textContent = msg.text || "";
      wrap.appendChild(content);
      msg._el = wrap;
      return wrap;
    }

    const thinking = document.createElement("div");
    thinking.className = "ochatting-thinking";
    thinking.textContent = "…";
    msg._el = thinking;
    return thinking;
  }

  function renderToolResultMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "ochatting-tool-call";

    const status = document.createElement("div");
    status.className = "ochatting-tool-status";

    const icon = document.createElement("span");
    const isError = !!msg.toolResult?.isError;
    icon.className = isError ? "ochatting-tool-error" : "ochatting-tool-success";
    icon.textContent = isError ? "✘" : "✔";

    const name = document.createElement("span");
    name.className = "ochatting-tool-name";
    name.textContent = formatToolName(msg.toolName || "", msg.toolInput || {}, msg.toolResult || null);

    status.appendChild(icon);
    status.appendChild(name);

    const details = document.createElement("details");
    details.className = "ochatting-tool-details";
    const summary = document.createElement("summary");
    summary.textContent = isError ? "Error" : "Result";

    const pre = document.createElement("pre");
    pre.className = "ochatting-tool-json";
    pre.textContent = truncate(String(msg.toolResult?.result || ""), 2000);

    details.appendChild(summary);
    details.appendChild(pre);

    wrap.appendChild(status);
    wrap.appendChild(details);
    msg._el = wrap;
    return wrap;
  }

  function findById(id) {
    return state.messages.find((m) => m.id === id);
  }

  function rerenderMessage(msg) {
    if (!msg || !msg._el || !msg._el.parentNode) return;
    const prevEl = msg._el;
    const parent = prevEl.parentNode;
    const next = renderMessage(msg);
    parent.replaceChild(next, prevEl);
    msg._el = next;
    scrollToBottom();
  }

  function handleSend() {
    const text = String(dom.textarea.value || "").trim();
    if (!text) return;

    dom.textarea.value = "";
    resetHeight();

    if (state.askUserResolve) {
      addUserMessage(text);
      const resolve = state.askUserResolve;
      state.askUserResolve = null;
      resolve(text);
      return;
    }

    const currentSelection = state.selection;
    state.selection = null;
    renderSelectionPill();
    props?.onSend?.(text, currentSelection);
  }

  function handleKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoGrow() {
    dom.textarea.style.height = "auto";
    dom.textarea.style.height = `${Math.min(dom.textarea.scrollHeight, 300)}px`;
  }

  function resetHeight() {
    dom.textarea.style.height = "auto";
  }

  function shortName(path) {
    const p = String(path || "");
    if (!p) return "";
    const parts = p.split("/");
    if (parts.length <= 2) return p;
    return `.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  function shortText(value, max) {
    const s = String(value || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function extractSearchReadPaths(result) {
    const out = [];
    if (result && typeof result.path === "string" && result.path) out.push(result.path);
    const raw = result && typeof result.result === "string" ? result.result : "";
    if (!raw) return Array.from(new Set(out));
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) {
        for (const entry of parsed.entries) {
          if (entry && typeof entry.path === "string" && entry.path) out.push(entry.path);
        }
      }
    } catch {
    }
    return Array.from(new Set(out));
  }

  function extractSearchVaultTotalMatches(result) {
    const raw = result && typeof result.result === "string" ? result.result : "";
    if (!raw) return null;
    const explicit = raw.match(/total matches:\s*(\d+)/i);
    if (explicit) {
      const value = Number.parseInt(explicit[1], 10);
      return Number.isFinite(value) ? value : null;
    }
    const legacy = raw.match(/^Found\s+(\d+)\s+result\(s\)/i);
    if (legacy) {
      const value = Number.parseInt(legacy[1], 10);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  }

  function formatToolName(name, input, result) {
    const rawTool = String(name || "");
    const multiPrefix = rawTool.startsWith("M ") ? "M " : "";
    const tool = multiPrefix ? rawTool.slice(2).trim() : rawTool;
    const path = typeof input?.path === "string" ? input.path : "";
    const withPrefix = (label) => multiPrefix ? `${multiPrefix}${label}` : label;

    switch (tool) {
      case "create_file":
        return withPrefix(path ? `create ${shortName(path)}` : "create file");
      case "read_file":
        return withPrefix(path ? `read ${shortName(path)}` : "read file");
      case "read_document":
        return withPrefix(path ? `read doc ${shortName(path)}` : "read doc (no path)");
      case "search_read": {
        const paths = extractSearchReadPaths(result);
        if (paths.length === 0) return withPrefix("search_read");
        return withPrefix(`search_read ${paths.map((p) => shortName(p)).join(", ")}`);
      }
      case "snippets": {
        const paths = extractSearchReadPaths(result);
        if (paths.length === 0) return withPrefix("snippets docs: (none)");
        return withPrefix(`snippets docs: ${paths.map((p) => shortName(p)).join(", ")}`);
      }
      case "edit_file": {
        const op = typeof input?.operation === "string" ? input.operation.replace(/_/g, " ") : "edit";
        return withPrefix(path ? `${op} ${shortName(path)}` : `${op} doc (no path)`);
      }
      case "rename_file": {
        const from = typeof input?.path === "string" ? shortName(input.path) : "";
        const to = typeof input?.new_path === "string" ? shortName(input.new_path) : "";
        if (from && to) return withPrefix(`rename ${from} → ${to}`);
        return withPrefix("rename file");
      }
      case "delete_file":
        return withPrefix(path ? `delete ${shortName(path)}` : "delete file");
      case "open_document":
        return withPrefix(path ? `open ${shortName(path)}` : "open document");
      case "search_vault": {
        const q = typeof input?.query === "string" ? shortText(input.query, 28) : "";
        const total = extractSearchVaultTotalMatches(result);
        if (q) return withPrefix(total === null ? `search "${q}"` : `search "${q}" (${total} found)`);
        return withPrefix(total === null ? "search vault" : `search vault (${total} found)`);
      }
      case "list_files":
        return withPrefix(input?.extension ? `list *.${String(input.extension).replace(/^\./, "")}` : "list files");
      case "get_properties":
        return withPrefix(path ? `get props ${shortName(path)}` : "get props active doc");
      case "set_properties":
        return withPrefix(path ? `set props ${shortName(path)}` : "set props active doc");
      case "get_backlinks":
        return withPrefix(path ? `backlinks ${shortName(path)}` : "backlinks active doc");
      case "agents": {
        const p = typeof input?.path === "string" ? shortText(input.path, 32) : "";
        return withPrefix(p ? `agents ${p}` : "agents status");
      }
      default:
        return withPrefix(tool.replace(/_/g, " "));
    }
  }

  function truncate(str, max) {
    if (str.length <= max) return str;
    return str.substring(0, max) + "\n... (truncated)";
  }

  function addUserMessage(text) {
    const msg = { id: state.nextId++, type: "user", text: String(text || "") };
    enqueueMessage(msg);
  }

  function addAssistantMessage(text) {
    const msg = { id: state.nextId++, type: "assistant", text: String(text || "") };
    enqueueMessage(msg);
  }

  function addToolCall(name, input) {
    const msg = {
      id: state.nextId++,
      type: "tool-call",
      toolName: name,
      toolInput: input || {}
    };
    enqueueMessage(msg);
    return msg.id;
  }

  function updateToolResult(msgId, name, result) {
    const msg = findById(msgId);
    if (!msg) return;
    try {
      msg.type = "tool-result";
      msg.toolName = name;
      msg.toolResult = result;
      rerenderMessage(msg);
    } catch (err) {
      console.error("[aichat] Failed to render tool result", err);
      const detail = err && typeof err.message === "string" ? err.message : String(err || "unknown error");
      addError(`Tool UI render error: ${detail}`);
    }
  }

  function showThinking() {
    if (state.messages.some((m) => m.type === "thinking")) return;
    const msg = { id: state.nextId++, type: "thinking" };
    enqueueMessage(msg);
  }

  function hideThinking() {
    const idx = state.messages.findIndex((m) => m.type === "thinking");
    if (idx < 0) return;
    const [msg] = state.messages.splice(idx, 1);
    msg?._el?.remove();
  }

  function addError(text) {
    const msg = { id: state.nextId++, type: "error", text: String(text || "") };
    enqueueMessage(msg);
  }

  function showAskUser(question) {
    addAssistantMessage(question);
    state.placeholder = "Type your answer...";
    state.inputEnabled = true;
    renderInputState();
    focus();
    return new Promise((resolve) => {
      state.askUserResolve = resolve;
    });
  }

  function setInputEnabled(enabled) {
    state.inputEnabled = !!enabled;
    state.placeholder = enabled ? "Ask anything..." : "Waiting for response...";
    renderInputState();
    if (enabled) focus();
  }

  function clearMessages() {
    state.messages = [];
    state.selection = null;
    state.askUserResolve = null;
    dom.messagesEl.empty();
    renderSelectionPill();
  }

  function focus() {
    requestAnimationFrame(() => dom.textarea.focus());
  }

  function setModel(name) {
    state.displayModel = name || "";
    renderHeader();
  }

  function setAgentsStatus(status) {
    state.agentsStatus = status || "aichat";
    renderHeader();
  }

  function setSelection(sel) {
    state.selection = sel || null;
    renderSelectionPill();
  }

  function getSelection() {
    return state.selection;
  }

  function clearSelection() {
    state.selection = null;
    renderSelectionPill();
  }

  function destroy() {
    state.messages = [];
    target.empty();
  }

  return {
    addUserMessage,
    addAssistantMessage,
    addToolCall,
    updateToolResult,
    showThinking,
    hideThinking,
    addError,
    showAskUser,
    setInputEnabled,
    clearMessages,
    focus,
    setModel,
    setAgentsStatus,
    setSelection,
    getSelection,
    clearSelection,
    destroy
  };
}

declareExports({
  createVanillaChatContainer
});

}

{
// src/ui/shim.js

var import_obsidian7 = require("obsidian");

// node_modules/esm-env/dev-fallback.js
var node_env = globalThis.process?.env?.NODE_ENV;
var dev_fallback_default = node_env && !node_env.toLowerCase().startsWith("prod");

// node_modules/svelte/src/internal/shared/utils.js




}

{
// src/ui/svelte/svelte-00-src_internal_shared_utils.js
// node_modules/svelte/src/internal/shared/utils.js
var is_array = Array.isArray;
var index_of = Array.prototype.indexOf;
var includes = Array.prototype.includes;
var array_from = Array.from;
var object_keys = Object.keys;
var define_property = Object.defineProperty;
var get_descriptor = Object.getOwnPropertyDescriptor;
var get_descriptors = Object.getOwnPropertyDescriptors;
var object_prototype = Object.prototype;
var array_prototype = Array.prototype;
var get_prototype_of = Object.getPrototypeOf;
var is_extensible = Object.isExtensible;
var noop = () => {
};
function run_all(arr) {
  for (var i = 0; i < arr.length; i++) {
    arr[i]();
  }
}
function deferred() {
  var resolve;
  var reject;
  var promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

}

{
// src/ui/svelte/svelte-01-src_internal_client_constants.js
// node_modules/svelte/src/internal/client/constants.js
var DERIVED = 1 << 1;
var EFFECT = 1 << 2;
var RENDER_EFFECT = 1 << 3;
var MANAGED_EFFECT = 1 << 24;
var BLOCK_EFFECT = 1 << 4;
var BRANCH_EFFECT = 1 << 5;
var ROOT_EFFECT = 1 << 6;
var BOUNDARY_EFFECT = 1 << 7;
var CONNECTED = 1 << 9;
var CLEAN = 1 << 10;
var DIRTY = 1 << 11;
var MAYBE_DIRTY = 1 << 12;
var INERT = 1 << 13;
var DESTROYED = 1 << 14;
var REACTION_RAN = 1 << 15;
var DESTROYING = 1 << 25;
var EFFECT_TRANSPARENT = 1 << 16;
var EAGER_EFFECT = 1 << 17;
var HEAD_EFFECT = 1 << 18;
var EFFECT_PRESERVED = 1 << 19;
var USER_EFFECT = 1 << 20;
var EFFECT_OFFSCREEN = 1 << 25;
var WAS_MARKED = 1 << 16;
var REACTION_IS_UPDATING = 1 << 21;
var ASYNC = 1 << 22;
var ERROR_VALUE = 1 << 23;
var STATE_SYMBOL = Symbol("$state");
var LEGACY_PROPS = Symbol("legacy props");
var LOADING_ATTR_SYMBOL = Symbol("");
var PROXY_PATH_SYMBOL = Symbol("proxy path");
var STALE_REACTION = new class StaleReactionError extends Error {
  name = "StaleReactionError";
  message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}();
var IS_XHTML = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml")
);
var TEXT_NODE = 3;
var COMMENT_NODE = 8;

}

{
// src/ui/svelte/svelte-02-src_internal_shared_errors.js
// node_modules/svelte/src/internal/shared/errors.js
function invariant_violation(message) {
  if (dev_fallback_default) {
    const error = new Error(`invariant_violation
An invariant violation occurred, meaning Svelte's internal assumptions were flawed. This is a bug in Svelte, not your app \u2014 please open an issue at https://github.com/sveltejs/svelte, citing the following message: "${message}"
https://svelte.dev/e/invariant_violation`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/invariant_violation`);
  }
}

}

{
// src/ui/svelte/svelte-03-src_internal_client_errors.js
// node_modules/svelte/src/internal/client/errors.js
function async_derived_orphan() {
  if (dev_fallback_default) {
    const error = new Error(`async_derived_orphan
Cannot create a \`$derived(...)\` with an \`await\` expression outside of an effect tree
https://svelte.dev/e/async_derived_orphan`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/async_derived_orphan`);
  }
}
function bind_invalid_checkbox_value() {
  if (dev_fallback_default) {
    const error = new Error(`bind_invalid_checkbox_value
Using \`bind:value\` together with a checkbox input is not allowed. Use \`bind:checked\` instead
https://svelte.dev/e/bind_invalid_checkbox_value`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/bind_invalid_checkbox_value`);
  }
}
function derived_references_self() {
  if (dev_fallback_default) {
    const error = new Error(`derived_references_self
A derived value cannot reference itself recursively
https://svelte.dev/e/derived_references_self`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/derived_references_self`);
  }
}
function each_key_duplicate(a, b, value) {
  if (dev_fallback_default) {
    const error = new Error(`each_key_duplicate
${value ? `Keyed each block has duplicate key \`${value}\` at indexes ${a} and ${b}` : `Keyed each block has duplicate key at indexes ${a} and ${b}`}
https://svelte.dev/e/each_key_duplicate`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/each_key_duplicate`);
  }
}
function each_key_volatile(index2, a, b) {
  if (dev_fallback_default) {
    const error = new Error(`each_key_volatile
Keyed each block has key that is not idempotent \u2014 the key for item at index ${index2} was \`${a}\` but is now \`${b}\`. Keys must be the same each time for a given item
https://svelte.dev/e/each_key_volatile`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/each_key_volatile`);
  }
}
function effect_in_teardown(rune) {
  if (dev_fallback_default) {
    const error = new Error(`effect_in_teardown
\`${rune}\` cannot be used inside an effect cleanup function
https://svelte.dev/e/effect_in_teardown`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/effect_in_teardown`);
  }
}
function effect_in_unowned_derived() {
  if (dev_fallback_default) {
    const error = new Error(`effect_in_unowned_derived
Effect cannot be created inside a \`$derived\` value that was not itself created inside an effect
https://svelte.dev/e/effect_in_unowned_derived`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/effect_in_unowned_derived`);
  }
}
function effect_orphan(rune) {
  if (dev_fallback_default) {
    const error = new Error(`effect_orphan
\`${rune}\` can only be used inside an effect (e.g. during component initialisation)
https://svelte.dev/e/effect_orphan`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/effect_orphan`);
  }
}
function effect_update_depth_exceeded() {
  if (dev_fallback_default) {
    const error = new Error(`effect_update_depth_exceeded
Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state
https://svelte.dev/e/effect_update_depth_exceeded`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/effect_update_depth_exceeded`);
  }
}
function hydration_failed() {
  if (dev_fallback_default) {
    const error = new Error(`hydration_failed
Failed to hydrate the application
https://svelte.dev/e/hydration_failed`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/hydration_failed`);
  }
}
function rune_outside_svelte(rune) {
  if (dev_fallback_default) {
    const error = new Error(`rune_outside_svelte
The \`${rune}\` rune is only available inside \`.svelte\` and \`.svelte.js/ts\` files
https://svelte.dev/e/rune_outside_svelte`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/rune_outside_svelte`);
  }
}
function state_descriptors_fixed() {
  if (dev_fallback_default) {
    const error = new Error(`state_descriptors_fixed
Property descriptors defined on \`$state\` objects must contain \`value\` and always be \`enumerable\`, \`configurable\` and \`writable\`.
https://svelte.dev/e/state_descriptors_fixed`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/state_descriptors_fixed`);
  }
}
function state_prototype_fixed() {
  if (dev_fallback_default) {
    const error = new Error(`state_prototype_fixed
Cannot set prototype of \`$state\` object
https://svelte.dev/e/state_prototype_fixed`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/state_prototype_fixed`);
  }
}
function state_unsafe_mutation() {
  if (dev_fallback_default) {
    const error = new Error(`state_unsafe_mutation
Updating state inside \`$derived(...)\`, \`$inspect(...)\` or a template expression is forbidden. If the value should not be reactive, declare it without \`$state\`
https://svelte.dev/e/state_unsafe_mutation`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/state_unsafe_mutation`);
  }
}
function svelte_boundary_reset_onerror() {
  if (dev_fallback_default) {
    const error = new Error(`svelte_boundary_reset_onerror
A \`<svelte:boundary>\` \`reset\` function cannot be called while an error is still being handled
https://svelte.dev/e/svelte_boundary_reset_onerror`);
    error.name = "Svelte error";
    throw error;
  } else {
    throw new Error(`https://svelte.dev/e/svelte_boundary_reset_onerror`);
  }
}

}

{
// src/ui/svelte/svelte-04-src_constants.js
// node_modules/svelte/src/constants.js
var EACH_ITEM_REACTIVE = 1;
var EACH_INDEX_REACTIVE = 1 << 1;
var EACH_IS_CONTROLLED = 1 << 2;
var EACH_IS_ANIMATED = 1 << 3;
var EACH_ITEM_IMMUTABLE = 1 << 4;
var PROPS_IS_RUNES = 1 << 1;
var PROPS_IS_UPDATED = 1 << 2;
var PROPS_IS_BINDABLE = 1 << 3;
var PROPS_IS_LAZY_INITIAL = 1 << 4;
var TRANSITION_OUT = 1 << 1;
var TRANSITION_GLOBAL = 1 << 2;
var TEMPLATE_FRAGMENT = 1;
var TEMPLATE_USE_IMPORT_NODE = 1 << 1;
var TEMPLATE_USE_SVG = 1 << 2;
var TEMPLATE_USE_MATHML = 1 << 3;
var HYDRATION_START = "[";
var HYDRATION_START_ELSE = "[!";
var HYDRATION_START_FAILED = "[?";
var HYDRATION_END = "]";
var HYDRATION_ERROR = {};
var ELEMENT_PRESERVE_ATTRIBUTE_CASE = 1 << 1;
var ELEMENT_IS_INPUT = 1 << 2;
var UNINITIALIZED = Symbol();
var FILENAME = Symbol("filename");
var HMR = Symbol("hmr");
var NAMESPACE_HTML = "http://www.w3.org/1999/xhtml";

}

{
// src/ui/svelte/svelte-05-src_internal_client_warnings.js
// node_modules/svelte/src/internal/client/warnings.js
var bold = "font-weight: bold";
var normal = "font-weight: normal";
function await_waterfall(name, location) {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] await_waterfall
%cAn async derived, \`${name}\` (${location}) was not read immediately after it resolved. This often indicates an unnecessary waterfall, which can slow down your app
https://svelte.dev/e/await_waterfall`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/await_waterfall`);
  }
}
function hydration_attribute_changed(attribute, html2, value) {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] hydration_attribute_changed
%cThe \`${attribute}\` attribute on \`${html2}\` changed its value between server and client renders. The client value, \`${value}\`, will be ignored in favour of the server value
https://svelte.dev/e/hydration_attribute_changed`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/hydration_attribute_changed`);
  }
}
function hydration_mismatch(location) {
  if (dev_fallback_default) {
    console.warn(
      `%c[svelte] hydration_mismatch
%c${location ? `Hydration failed because the initial UI does not match what was rendered on the server. The error occurred near ${location}` : "Hydration failed because the initial UI does not match what was rendered on the server"}
https://svelte.dev/e/hydration_mismatch`,
      bold,
      normal
    );
  } else {
    console.warn(`https://svelte.dev/e/hydration_mismatch`);
  }
}
function lifecycle_double_unmount() {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] lifecycle_double_unmount
%cTried to unmount a component that was not mounted
https://svelte.dev/e/lifecycle_double_unmount`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/lifecycle_double_unmount`);
  }
}
function state_proxy_equality_mismatch(operator) {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] state_proxy_equality_mismatch
%cReactive \`$state(...)\` proxies and the values they proxy have different identities. Because of this, comparisons with \`${operator}\` will produce unexpected results
https://svelte.dev/e/state_proxy_equality_mismatch`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/state_proxy_equality_mismatch`);
  }
}
function state_proxy_unmount() {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] state_proxy_unmount
%cTried to unmount a state proxy, rather than a component
https://svelte.dev/e/state_proxy_unmount`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/state_proxy_unmount`);
  }
}
function svelte_boundary_reset_noop() {
  if (dev_fallback_default) {
    console.warn(`%c[svelte] svelte_boundary_reset_noop
%cA \`<svelte:boundary>\` \`reset\` function only resets the boundary the first time it is called
https://svelte.dev/e/svelte_boundary_reset_noop`, bold, normal);
  } else {
    console.warn(`https://svelte.dev/e/svelte_boundary_reset_noop`);
  }
}

}

{
// src/ui/svelte/svelte-06-src_internal_client_dom_hydration.js
// node_modules/svelte/src/internal/client/dom/hydration.js
var hydrating = false;
function set_hydrating(value) {
  hydrating = value;
}
var hydrate_node;
function set_hydrate_node(node) {
  if (node === null) {
    hydration_mismatch();
    throw HYDRATION_ERROR;
  }
  return hydrate_node = node;
}
function hydrate_next() {
  return set_hydrate_node(get_next_sibling(hydrate_node));
}
function reset(node) {
  if (!hydrating) return;
  if (get_next_sibling(hydrate_node) !== null) {
    hydration_mismatch();
    throw HYDRATION_ERROR;
  }
  hydrate_node = node;
}
function next(count = 1) {
  if (hydrating) {
    var i = count;
    var node = hydrate_node;
    while (i--) {
      node = /** @type {TemplateNode} */
      get_next_sibling(node);
    }
    hydrate_node = node;
  }
}
function skip_nodes(remove = true) {
  var depth = 0;
  var node = hydrate_node;
  while (true) {
    if (node.nodeType === COMMENT_NODE) {
      var data = (
        /** @type {Comment} */
        node.data
      );
      if (data === HYDRATION_END) {
        if (depth === 0) return node;
        depth -= 1;
      } else if (data === HYDRATION_START || data === HYDRATION_START_ELSE || // "[1", "[2", etc. for if blocks
      data[0] === "[" && !isNaN(Number(data.slice(1)))) {
        depth += 1;
      }
    }
    var next2 = (
      /** @type {TemplateNode} */
      get_next_sibling(node)
    );
    if (remove) node.remove();
    node = next2;
  }
}
function read_hydration_instruction(node) {
  if (!node || node.nodeType !== COMMENT_NODE) {
    hydration_mismatch();
    throw HYDRATION_ERROR;
  }
  return (
    /** @type {Comment} */
    node.data
  );
}

}

{
// src/ui/svelte/svelte-07-src_internal_client_reactivity_equality.js
// node_modules/svelte/src/internal/client/reactivity/equality.js
function equals(value) {
  return value === this.v;
}
function safe_not_equal(a, b) {
  return a != a ? b == b : a !== b || a !== null && typeof a === "object" || typeof a === "function";
}
function safe_equals(value) {
  return !safe_not_equal(value, this.v);
}

}

{
// src/ui/svelte/svelte-08-src_internal_flags_index.js
// node_modules/svelte/src/internal/flags/index.js
var async_mode_flag = false;
var legacy_mode_flag = false;
var tracing_mode_flag = false;

}

{
// src/ui/svelte/svelte-09-src_internal_client_dev_tracing.js
// node_modules/svelte/src/internal/client/dev/tracing.js
var tracing_expressions = null;
function tag(source2, label) {
  source2.label = label;
  tag_proxy(source2.v, label);
  return source2;
}
function tag_proxy(value, label) {
  value?.[PROXY_PATH_SYMBOL]?.(label);
  return value;
}

}

{
// src/ui/svelte/svelte-10-src_internal_shared_dev.js
// node_modules/svelte/src/internal/shared/dev.js
function get_error(label) {
  const error = new Error();
  const stack2 = get_stack();
  if (stack2.length === 0) {
    return null;
  }
  stack2.unshift("\n");
  define_property(error, "stack", {
    value: stack2.join("\n")
  });
  define_property(error, "name", {
    value: label
  });
  return (
    /** @type {Error & { stack: string }} */
    error
  );
}
function get_stack() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  const stack2 = new Error().stack;
  Error.stackTraceLimit = limit;
  if (!stack2) return [];
  const lines = stack2.split("\n");
  const new_lines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const posixified = line.replaceAll("\\", "/");
    if (line.trim() === "Error") {
      continue;
    }
    if (line.includes("validate_each_keys")) {
      return [];
    }
    if (posixified.includes("svelte/src/internal") || posixified.includes("node_modules/.vite")) {
      continue;
    }
    new_lines.push(line);
  }
  return new_lines;
}
function invariant(condition, message) {
  if (!dev_fallback_default) {
    throw new Error("invariant(...) was not guarded by if (DEV)");
  }
  if (!condition) invariant_violation(message);
}

}

{
// src/ui/svelte/svelte-11-src_internal_client_context.js
// node_modules/svelte/src/internal/client/context.js
var component_context = null;
function set_component_context(context) {
  component_context = context;
}
var dev_stack = null;
function set_dev_stack(stack2) {
  dev_stack = stack2;
}
var dev_current_component_function = null;
function set_dev_current_component_function(fn) {
  dev_current_component_function = fn;
}
function push(props, runes = false, fn) {
  component_context = {
    p: component_context,
    i: false,
    c: null,
    e: null,
    s: props,
    x: null,
    r: (
      /** @type {Effect} */
      active_effect
    ),
    l: legacy_mode_flag && !runes ? { s: null, u: null, $: [] } : null
  };
  if (dev_fallback_default) {
    component_context.function = fn;
    dev_current_component_function = fn;
  }
}
function pop(component2) {
  var context = (
    /** @type {ComponentContext} */
    component_context
  );
  var effects = context.e;
  if (effects !== null) {
    context.e = null;
    for (var fn of effects) {
      create_user_effect(fn);
    }
  }
  if (component2 !== void 0) {
    context.x = component2;
  }
  context.i = true;
  component_context = context.p;
  if (dev_fallback_default) {
    dev_current_component_function = component_context?.function ?? null;
  }
  return component2 ?? /** @type {T} */
  {};
}
function is_runes() {
  return !legacy_mode_flag || component_context !== null && component_context.l === null;
}

}

{
// src/ui/svelte/svelte-12-src_internal_client_dom_task.js
// node_modules/svelte/src/internal/client/dom/task.js
var micro_tasks = [];
function run_micro_tasks() {
  var tasks = micro_tasks;
  micro_tasks = [];
  run_all(tasks);
}
function queue_micro_task(fn) {
  if (micro_tasks.length === 0 && !is_flushing_sync) {
    var tasks = micro_tasks;
    queueMicrotask(() => {
      if (tasks === micro_tasks) run_micro_tasks();
    });
  }
  micro_tasks.push(fn);
}
function flush_tasks() {
  while (micro_tasks.length > 0) {
    run_micro_tasks();
  }
}

}

{
// src/ui/svelte/svelte-13-src_internal_client_error-handling.js
// node_modules/svelte/src/internal/client/error-handling.js
var adjustments = /* @__PURE__ */ new WeakMap();
function handle_error(error) {
  var effect2 = active_effect;
  if (effect2 === null) {
    active_reaction.f |= ERROR_VALUE;
    return error;
  }
  if (dev_fallback_default && error instanceof Error && !adjustments.has(error)) {
    adjustments.set(error, get_adjustments(error, effect2));
  }
  if ((effect2.f & REACTION_RAN) === 0 && (effect2.f & EFFECT) === 0) {
    if (dev_fallback_default && !effect2.parent && error instanceof Error) {
      apply_adjustments(error);
    }
    throw error;
  }
  invoke_error_boundary(error, effect2);
}
function invoke_error_boundary(error, effect2) {
  while (effect2 !== null) {
    if ((effect2.f & BOUNDARY_EFFECT) !== 0) {
      if ((effect2.f & REACTION_RAN) === 0) {
        throw error;
      }
      try {
        effect2.b.error(error);
        return;
      } catch (e) {
        error = e;
      }
    }
    effect2 = effect2.parent;
  }
  if (dev_fallback_default && error instanceof Error) {
    apply_adjustments(error);
  }
  throw error;
}
function get_adjustments(error, effect2) {
  const message_descriptor = get_descriptor(error, "message");
  if (message_descriptor && !message_descriptor.configurable) return;
  var indent = is_firefox ? "  " : "	";
  var component_stack = `
${indent}in ${effect2.fn?.name || "<unknown>"}`;
  var context = effect2.ctx;
  while (context !== null) {
    component_stack += `
${indent}in ${context.function?.[FILENAME].split("/").pop()}`;
    context = context.p;
  }
  return {
    message: error.message + `
${component_stack}
`,
    stack: error.stack?.split("\n").filter((line) => !line.includes("svelte/src/internal")).join("\n")
  };
}
function apply_adjustments(error) {
  const adjusted = adjustments.get(error);
  if (adjusted) {
    define_property(error, "message", {
      value: adjusted.message
    });
    define_property(error, "stack", {
      value: adjusted.stack
    });
  }
}

}

{
// src/ui/svelte/svelte-14-src_internal_client_reactivity_status.js
// node_modules/svelte/src/internal/client/reactivity/status.js
var STATUS_MASK = ~(DIRTY | MAYBE_DIRTY | CLEAN);
function set_signal_status(signal, status) {
  signal.f = signal.f & STATUS_MASK | status;
}
function update_derived_status(derived2) {
  if ((derived2.f & CONNECTED) !== 0 || derived2.deps === null) {
    set_signal_status(derived2, CLEAN);
  } else {
    set_signal_status(derived2, MAYBE_DIRTY);
  }
}

}

{
// src/ui/svelte/svelte-15-src_internal_client_reactivity_utils.js
// node_modules/svelte/src/internal/client/reactivity/utils.js
function clear_marked(deps) {
  if (deps === null) return;
  for (const dep of deps) {
    if ((dep.f & DERIVED) === 0 || (dep.f & WAS_MARKED) === 0) {
      continue;
    }
    dep.f ^= WAS_MARKED;
    clear_marked(
      /** @type {Derived} */
      dep.deps
    );
  }
}
function defer_effect(effect2, dirty_effects, maybe_dirty_effects) {
  if ((effect2.f & DIRTY) !== 0) {
    dirty_effects.add(effect2);
  } else if ((effect2.f & MAYBE_DIRTY) !== 0) {
    maybe_dirty_effects.add(effect2);
  }
  clear_marked(effect2.deps);
  set_signal_status(effect2, CLEAN);
}

}

{
// src/ui/svelte/svelte-16-src_internal_client_reactivity_store.js
// node_modules/svelte/src/internal/client/reactivity/store.js
var legacy_is_updating_store = false;
var IS_UNMOUNTED = Symbol();

}

{
// src/ui/svelte/svelte-17-src_internal_client_reactivity_batch.js
// node_modules/svelte/src/internal/client/reactivity/batch.js
var batches = /* @__PURE__ */ new Set();
var current_batch = null;
var previous_batch = null;
var batch_values = null;
var last_scheduled_effect = null;
var is_flushing_sync = false;
var is_processing = false;
var collected_effects = null;
var legacy_updates = null;
var flush_count = 0;
var source_stacks = dev_fallback_default ? /* @__PURE__ */ new Set() : null;
var uid = 1;
var Batch = class _Batch {
  // for debugging. TODO remove once async is stable
  id = uid++;
  /**
   * The current values of any sources that are updated in this batch
   * They keys of this map are identical to `this.#previous`
   * @type {Map<Source, any>}
   */
  current = /* @__PURE__ */ new Map();
  /**
   * The values of any sources that are updated in this batch _before_ those updates took place.
   * They keys of this map are identical to `this.#current`
   * @type {Map<Source, any>}
   */
  previous = /* @__PURE__ */ new Map();
  /**
   * When the batch is committed (and the DOM is updated), we need to remove old branches
   * and append new ones by calling the functions added inside (if/each/key/etc) blocks
   * @type {Set<(batch: Batch) => void>}
   */
  #commit_callbacks = /* @__PURE__ */ new Set();
  /**
   * If a fork is discarded, we need to destroy any effects that are no longer needed
   * @type {Set<(batch: Batch) => void>}
   */
  #discard_callbacks = /* @__PURE__ */ new Set();
  /**
   * The number of async effects that are currently in flight
   */
  #pending = 0;
  /**
   * The number of async effects that are currently in flight, _not_ inside a pending boundary
   */
  #blocking_pending = 0;
  /**
   * A deferred that resolves when the batch is committed, used with `settled()`
   * TODO replace with Promise.withResolvers once supported widely enough
   * @type {{ promise: Promise<void>, resolve: (value?: any) => void, reject: (reason: unknown) => void } | null}
   */
  #deferred = null;
  /**
   * The root effects that need to be flushed
   * @type {Effect[]}
   */
  #roots = [];
  /**
   * Deferred effects (which run after async work has completed) that are DIRTY
   * @type {Set<Effect>}
   */
  #dirty_effects = /* @__PURE__ */ new Set();
  /**
   * Deferred effects that are MAYBE_DIRTY
   * @type {Set<Effect>}
   */
  #maybe_dirty_effects = /* @__PURE__ */ new Set();
  /**
   * A map of branches that still exist, but will be destroyed when this batch
   * is committed — we skip over these during `process`.
   * The value contains child effects that were dirty/maybe_dirty before being reset,
   * so they can be rescheduled if the branch survives.
   * @type {Map<Effect, { d: Effect[], m: Effect[] }>}
   */
  #skipped_branches = /* @__PURE__ */ new Map();
  is_fork = false;
  #decrement_queued = false;
  #is_deferred() {
    return this.is_fork || this.#blocking_pending > 0;
  }
  /**
   * Add an effect to the #skipped_branches map and reset its children
   * @param {Effect} effect
   */
  skip_effect(effect2) {
    if (!this.#skipped_branches.has(effect2)) {
      this.#skipped_branches.set(effect2, { d: [], m: [] });
    }
  }
  /**
   * Remove an effect from the #skipped_branches map and reschedule
   * any tracked dirty/maybe_dirty child effects
   * @param {Effect} effect
   */
  unskip_effect(effect2) {
    var tracked = this.#skipped_branches.get(effect2);
    if (tracked) {
      this.#skipped_branches.delete(effect2);
      for (var e of tracked.d) {
        set_signal_status(e, DIRTY);
        this.schedule(e);
      }
      for (e of tracked.m) {
        set_signal_status(e, MAYBE_DIRTY);
        this.schedule(e);
      }
    }
  }
  #process() {
    if (flush_count++ > 1e3) {
      batches.delete(this);
      infinite_loop_guard();
    }
    if (!this.#is_deferred()) {
      for (const e of this.#dirty_effects) {
        this.#maybe_dirty_effects.delete(e);
        set_signal_status(e, DIRTY);
        this.schedule(e);
      }
      for (const e of this.#maybe_dirty_effects) {
        set_signal_status(e, MAYBE_DIRTY);
        this.schedule(e);
      }
    }
    const roots = this.#roots;
    this.#roots = [];
    this.apply();
    var effects = collected_effects = [];
    var render_effects = [];
    var updates = legacy_updates = [];
    for (const root2 of roots) {
      try {
        this.#traverse(root2, effects, render_effects);
      } catch (e) {
        reset_all(root2);
        throw e;
      }
    }
    current_batch = null;
    if (updates.length > 0) {
      var batch = _Batch.ensure();
      for (const e of updates) {
        batch.schedule(e);
      }
    }
    collected_effects = null;
    legacy_updates = null;
    if (this.#is_deferred()) {
      this.#defer_effects(render_effects);
      this.#defer_effects(effects);
      for (const [e, t] of this.#skipped_branches) {
        reset_branch(e, t);
      }
    } else {
      if (this.#pending === 0) {
        batches.delete(this);
      }
      this.#dirty_effects.clear();
      this.#maybe_dirty_effects.clear();
      for (const fn of this.#commit_callbacks) fn(this);
      this.#commit_callbacks.clear();
      previous_batch = this;
      flush_queued_effects(render_effects);
      flush_queued_effects(effects);
      previous_batch = null;
      this.#deferred?.resolve();
    }
    var next_batch = (
      /** @type {Batch | null} */
      /** @type {unknown} */
      current_batch
    );
    if (this.#roots.length > 0) {
      const batch2 = next_batch ??= this;
      batch2.#roots.push(...this.#roots.filter((r2) => !batch2.#roots.includes(r2)));
    }
    if (next_batch !== null) {
      batches.add(next_batch);
      if (dev_fallback_default) {
        for (const source2 of this.current.keys()) {
          source_stacks.add(source2);
        }
      }
      next_batch.#process();
    }
    if (!batches.has(this)) {
      this.#commit();
    }
  }
  /**
   * Traverse the effect tree, executing effects or stashing
   * them for later execution as appropriate
   * @param {Effect} root
   * @param {Effect[]} effects
   * @param {Effect[]} render_effects
   */
  #traverse(root2, effects, render_effects) {
    root2.f ^= CLEAN;
    var effect2 = root2.first;
    while (effect2 !== null) {
      var flags2 = effect2.f;
      var is_branch = (flags2 & (BRANCH_EFFECT | ROOT_EFFECT)) !== 0;
      var is_skippable_branch = is_branch && (flags2 & CLEAN) !== 0;
      var skip = is_skippable_branch || (flags2 & INERT) !== 0 || this.#skipped_branches.has(effect2);
      if (!skip && effect2.fn !== null) {
        if (is_branch) {
          effect2.f ^= CLEAN;
        } else if ((flags2 & EFFECT) !== 0) {
          effects.push(effect2);
        } else if (async_mode_flag && (flags2 & (RENDER_EFFECT | MANAGED_EFFECT)) !== 0) {
          render_effects.push(effect2);
        } else if (is_dirty(effect2)) {
          if ((flags2 & BLOCK_EFFECT) !== 0) this.#maybe_dirty_effects.add(effect2);
          update_effect(effect2);
        }
        var child2 = effect2.first;
        if (child2 !== null) {
          effect2 = child2;
          continue;
        }
      }
      while (effect2 !== null) {
        var next2 = effect2.next;
        if (next2 !== null) {
          effect2 = next2;
          break;
        }
        effect2 = effect2.parent;
      }
    }
  }
  /**
   * @param {Effect[]} effects
   */
  #defer_effects(effects) {
    for (var i = 0; i < effects.length; i += 1) {
      defer_effect(effects[i], this.#dirty_effects, this.#maybe_dirty_effects);
    }
  }
  /**
   * Associate a change to a given source with the current
   * batch, noting its previous and current values
   * @param {Source} source
   * @param {any} old_value
   */
  capture(source2, old_value) {
    if (old_value !== UNINITIALIZED && !this.previous.has(source2)) {
      this.previous.set(source2, old_value);
    }
    if ((source2.f & ERROR_VALUE) === 0) {
      this.current.set(source2, source2.v);
      batch_values?.set(source2, source2.v);
    }
  }
  activate() {
    current_batch = this;
  }
  deactivate() {
    current_batch = null;
    batch_values = null;
  }
  flush() {
    var source_stacks2 = dev_fallback_default ? /* @__PURE__ */ new Set() : null;
    try {
      is_processing = true;
      current_batch = this;
      this.#process();
    } finally {
      flush_count = 0;
      last_scheduled_effect = null;
      collected_effects = null;
      legacy_updates = null;
      is_processing = false;
      current_batch = null;
      batch_values = null;
      old_values.clear();
      if (dev_fallback_default) {
        for (
          const source2 of
          /** @type {Set<Source>} */
          source_stacks2
        ) {
          source2.updated = null;
        }
      }
    }
  }
  discard() {
    for (const fn of this.#discard_callbacks) fn(this);
    this.#discard_callbacks.clear();
  }
  #commit() {
    for (const batch of batches) {
      var is_earlier = batch.id < this.id;
      var sources = [];
      for (const [source3, value] of this.current) {
        if (batch.current.has(source3)) {
          if (is_earlier && value !== batch.current.get(source3)) {
            batch.current.set(source3, value);
          } else {
            continue;
          }
        }
        sources.push(source3);
      }
      if (sources.length === 0) {
        continue;
      }
      var others = [...batch.current.keys()].filter((s) => !this.current.has(s));
      if (others.length > 0) {
        if (dev_fallback_default) {
          invariant(batch.#roots.length === 0, "Batch has scheduled roots");
        }
        batch.activate();
        var marked = /* @__PURE__ */ new Set();
        var checked = /* @__PURE__ */ new Map();
        for (var source2 of sources) {
          mark_effects(source2, others, marked, checked);
        }
        if (batch.#roots.length > 0) {
          batch.apply();
          for (var root2 of batch.#roots) {
            batch.#traverse(root2, [], []);
          }
          batch.#roots = [];
        }
        batch.deactivate();
      }
    }
  }
  /**
   *
   * @param {boolean} blocking
   */
  increment(blocking) {
    this.#pending += 1;
    if (blocking) this.#blocking_pending += 1;
  }
  /**
   * @param {boolean} blocking
   * @param {boolean} skip - whether to skip updates (because this is triggered by a stale reaction)
   */
  decrement(blocking, skip) {
    this.#pending -= 1;
    if (blocking) this.#blocking_pending -= 1;
    if (this.#decrement_queued || skip) return;
    this.#decrement_queued = true;
    queue_micro_task(() => {
      this.#decrement_queued = false;
      this.flush();
    });
  }
  /**
   * @param {Set<Effect>} dirty_effects
   * @param {Set<Effect>} maybe_dirty_effects
   */
  transfer_effects(dirty_effects, maybe_dirty_effects) {
    for (const e of dirty_effects) {
      this.#dirty_effects.add(e);
    }
    for (const e of maybe_dirty_effects) {
      this.#maybe_dirty_effects.add(e);
    }
    dirty_effects.clear();
    maybe_dirty_effects.clear();
  }
  /** @param {(batch: Batch) => void} fn */
  oncommit(fn) {
    this.#commit_callbacks.add(fn);
  }
  /** @param {(batch: Batch) => void} fn */
  ondiscard(fn) {
    this.#discard_callbacks.add(fn);
  }
  settled() {
    return (this.#deferred ??= deferred()).promise;
  }
  static ensure() {
    if (current_batch === null) {
      const batch = current_batch = new _Batch();
      if (!is_processing) {
        batches.add(current_batch);
        if (!is_flushing_sync) {
          queue_micro_task(() => {
            if (current_batch !== batch) {
              return;
            }
            batch.flush();
          });
        }
      }
    }
    return current_batch;
  }
  apply() {
    if (!async_mode_flag || !this.is_fork && batches.size === 1) {
      batch_values = null;
      return;
    }
    batch_values = new Map(this.current);
    for (const batch of batches) {
      if (batch === this || batch.is_fork) continue;
      for (const [source2, previous] of batch.previous) {
        if (!batch_values.has(source2)) {
          batch_values.set(source2, previous);
        }
      }
    }
  }
  /**
   *
   * @param {Effect} effect
   */
  schedule(effect2) {
    last_scheduled_effect = effect2;
    if (effect2.b?.is_pending && (effect2.f & (EFFECT | RENDER_EFFECT | MANAGED_EFFECT)) !== 0 && (effect2.f & REACTION_RAN) === 0) {
      effect2.b.defer_effect(effect2);
      return;
    }
    var e = effect2;
    while (e.parent !== null) {
      e = e.parent;
      var flags2 = e.f;
      if (collected_effects !== null && e === active_effect) {
        if (async_mode_flag) return;
        if ((active_reaction === null || (active_reaction.f & DERIVED) === 0) && !legacy_is_updating_store) {
          return;
        }
      }
      if ((flags2 & (ROOT_EFFECT | BRANCH_EFFECT)) !== 0) {
        if ((flags2 & CLEAN) === 0) {
          return;
        }
        e.f ^= CLEAN;
      }
    }
    this.#roots.push(e);
  }
};
function flushSync(fn) {
  var was_flushing_sync = is_flushing_sync;
  is_flushing_sync = true;
  try {
    var result;
    if (fn) {
      if (current_batch !== null && !current_batch.is_fork) {
        current_batch.flush();
      }
      result = fn();
    }
    while (true) {
      flush_tasks();
      if (current_batch === null) {
        return (
          /** @type {T} */
          result
        );
      }
      current_batch.flush();
    }
  } finally {
    is_flushing_sync = was_flushing_sync;
  }
}
function infinite_loop_guard() {
  if (dev_fallback_default) {
    var updates = /* @__PURE__ */ new Map();
    for (
      const source2 of
      /** @type {Batch} */
      current_batch.current.keys()
    ) {
      for (const [stack2, update2] of source2.updated ?? []) {
        var entry = updates.get(stack2);
        if (!entry) {
          entry = { error: update2.error, count: 0 };
          updates.set(stack2, entry);
        }
        entry.count += update2.count;
      }
    }
    for (const update2 of updates.values()) {
      if (update2.error) {
        console.error(update2.error);
      }
    }
  }
  try {
    effect_update_depth_exceeded();
  } catch (error) {
    if (dev_fallback_default) {
      define_property(error, "stack", { value: "" });
    }
    invoke_error_boundary(error, last_scheduled_effect);
  }
}
var eager_block_effects = null;
function flush_queued_effects(effects) {
  var length = effects.length;
  if (length === 0) return;
  var i = 0;
  while (i < length) {
    var effect2 = effects[i++];
    if ((effect2.f & (DESTROYED | INERT)) === 0 && is_dirty(effect2)) {
      eager_block_effects = /* @__PURE__ */ new Set();
      update_effect(effect2);
      if (effect2.deps === null && effect2.first === null && effect2.nodes === null && effect2.teardown === null && effect2.ac === null) {
        unlink_effect(effect2);
      }
      if (eager_block_effects?.size > 0) {
        old_values.clear();
        for (const e of eager_block_effects) {
          if ((e.f & (DESTROYED | INERT)) !== 0) continue;
          const ordered_effects = [e];
          let ancestor = e.parent;
          while (ancestor !== null) {
            if (eager_block_effects.has(ancestor)) {
              eager_block_effects.delete(ancestor);
              ordered_effects.push(ancestor);
            }
            ancestor = ancestor.parent;
          }
          for (let j = ordered_effects.length - 1; j >= 0; j--) {
            const e2 = ordered_effects[j];
            if ((e2.f & (DESTROYED | INERT)) !== 0) continue;
            update_effect(e2);
          }
        }
        eager_block_effects.clear();
      }
    }
  }
  eager_block_effects = null;
}
function mark_effects(value, sources, marked, checked) {
  if (marked.has(value)) return;
  marked.add(value);
  if (value.reactions !== null) {
    for (const reaction of value.reactions) {
      const flags2 = reaction.f;
      if ((flags2 & DERIVED) !== 0) {
        mark_effects(
          /** @type {Derived} */
          reaction,
          sources,
          marked,
          checked
        );
      } else if ((flags2 & (ASYNC | BLOCK_EFFECT)) !== 0 && (flags2 & DIRTY) === 0 && depends_on(reaction, sources, checked)) {
        set_signal_status(reaction, DIRTY);
        schedule_effect(
          /** @type {Effect} */
          reaction
        );
      }
    }
  }
}
function depends_on(reaction, sources, checked) {
  const depends = checked.get(reaction);
  if (depends !== void 0) return depends;
  if (reaction.deps !== null) {
    for (const dep of reaction.deps) {
      if (includes.call(sources, dep)) {
        return true;
      }
      if ((dep.f & DERIVED) !== 0 && depends_on(
        /** @type {Derived} */
        dep,
        sources,
        checked
      )) {
        checked.set(
          /** @type {Derived} */
          dep,
          true
        );
        return true;
      }
    }
  }
  checked.set(reaction, false);
  return false;
}
function schedule_effect(effect2) {
  current_batch.schedule(effect2);
}
function reset_branch(effect2, tracked) {
  if ((effect2.f & BRANCH_EFFECT) !== 0 && (effect2.f & CLEAN) !== 0) {
    return;
  }
  if ((effect2.f & DIRTY) !== 0) {
    tracked.d.push(effect2);
  } else if ((effect2.f & MAYBE_DIRTY) !== 0) {
    tracked.m.push(effect2);
  }
  set_signal_status(effect2, CLEAN);
  var e = effect2.first;
  while (e !== null) {
    reset_branch(e, tracked);
    e = e.next;
  }
}
function reset_all(effect2) {
  set_signal_status(effect2, CLEAN);
  var e = effect2.first;
  while (e !== null) {
    reset_all(e);
    e = e.next;
  }
}

}

{
// src/ui/svelte/svelte-18-src_reactivity_create-subscriber.js
// node_modules/svelte/src/reactivity/create-subscriber.js
function createSubscriber(start) {
  let subscribers = 0;
  let version = source(0);
  let stop;
  if (dev_fallback_default) {
    tag(version, "createSubscriber version");
  }
  return () => {
    if (effect_tracking()) {
      get2(version);
      render_effect(() => {
        if (subscribers === 0) {
          stop = untrack(() => start(() => increment(version)));
        }
        subscribers += 1;
        return () => {
          queue_micro_task(() => {
            subscribers -= 1;
            if (subscribers === 0) {
              stop?.();
              stop = void 0;
              increment(version);
            }
          });
        };
      });
    }
  };
}

}

{
// src/ui/svelte/svelte-19-src_internal_client_dom_blocks_boundary.js
// node_modules/svelte/src/internal/client/dom/blocks/boundary.js
var flags = EFFECT_TRANSPARENT | EFFECT_PRESERVED;
function boundary(node, props, children, transform_error) {
  new Boundary(node, props, children, transform_error);
}
var Boundary = class {
  /** @type {Boundary | null} */
  parent;
  is_pending = false;
  /**
   * API-level transformError transform function. Transforms errors before they reach the `failed` snippet.
   * Inherited from parent boundary, or defaults to identity.
   * @type {(error: unknown) => unknown}
   */
  transform_error;
  /** @type {TemplateNode} */
  #anchor;
  /** @type {TemplateNode | null} */
  #hydrate_open = hydrating ? hydrate_node : null;
  /** @type {BoundaryProps} */
  #props;
  /** @type {((anchor: Node) => void)} */
  #children;
  /** @type {Effect} */
  #effect;
  /** @type {Effect | null} */
  #main_effect = null;
  /** @type {Effect | null} */
  #pending_effect = null;
  /** @type {Effect | null} */
  #failed_effect = null;
  /** @type {DocumentFragment | null} */
  #offscreen_fragment = null;
  #local_pending_count = 0;
  #pending_count = 0;
  #pending_count_update_queued = false;
  /** @type {Set<Effect>} */
  #dirty_effects = /* @__PURE__ */ new Set();
  /** @type {Set<Effect>} */
  #maybe_dirty_effects = /* @__PURE__ */ new Set();
  /**
   * A source containing the number of pending async deriveds/expressions.
   * Only created if `$effect.pending()` is used inside the boundary,
   * otherwise updating the source results in needless `Batch.ensure()`
   * calls followed by no-op flushes
   * @type {Source<number> | null}
   */
  #effect_pending = null;
  #effect_pending_subscriber = createSubscriber(() => {
    this.#effect_pending = source(this.#local_pending_count);
    if (dev_fallback_default) {
      tag(this.#effect_pending, "$effect.pending()");
    }
    return () => {
      this.#effect_pending = null;
    };
  });
  /**
   * @param {TemplateNode} node
   * @param {BoundaryProps} props
   * @param {((anchor: Node) => void)} children
   * @param {((error: unknown) => unknown) | undefined} [transform_error]
   */
  constructor(node, props, children, transform_error) {
    this.#anchor = node;
    this.#props = props;
    this.#children = (anchor) => {
      var effect2 = (
        /** @type {Effect} */
        active_effect
      );
      effect2.b = this;
      effect2.f |= BOUNDARY_EFFECT;
      children(anchor);
    };
    this.parent = /** @type {Effect} */
    active_effect.b;
    this.transform_error = transform_error ?? this.parent?.transform_error ?? ((e) => e);
    this.#effect = block(() => {
      if (hydrating) {
        const comment2 = (
          /** @type {Comment} */
          this.#hydrate_open
        );
        hydrate_next();
        const server_rendered_pending = comment2.data === HYDRATION_START_ELSE;
        const server_rendered_failed = comment2.data.startsWith(HYDRATION_START_FAILED);
        if (server_rendered_failed) {
          const serialized_error = JSON.parse(comment2.data.slice(HYDRATION_START_FAILED.length));
          this.#hydrate_failed_content(serialized_error);
        } else if (server_rendered_pending) {
          this.#hydrate_pending_content();
        } else {
          this.#hydrate_resolved_content();
        }
      } else {
        this.#render();
      }
    }, flags);
    if (hydrating) {
      this.#anchor = hydrate_node;
    }
  }
  #hydrate_resolved_content() {
    try {
      this.#main_effect = branch(() => this.#children(this.#anchor));
    } catch (error) {
      this.error(error);
    }
  }
  /**
   * @param {unknown} error The deserialized error from the server's hydration comment
   */
  #hydrate_failed_content(error) {
    const failed = this.#props.failed;
    if (!failed) return;
    this.#failed_effect = branch(() => {
      failed(
        this.#anchor,
        () => error,
        () => () => {
        }
      );
    });
  }
  #hydrate_pending_content() {
    const pending2 = this.#props.pending;
    if (!pending2) return;
    this.is_pending = true;
    this.#pending_effect = branch(() => pending2(this.#anchor));
    queue_micro_task(() => {
      var fragment = this.#offscreen_fragment = document.createDocumentFragment();
      var anchor = create_text();
      fragment.append(anchor);
      this.#main_effect = this.#run(() => {
        return branch(() => this.#children(anchor));
      });
      if (this.#pending_count === 0) {
        this.#anchor.before(fragment);
        this.#offscreen_fragment = null;
        pause_effect(
          /** @type {Effect} */
          this.#pending_effect,
          () => {
            this.#pending_effect = null;
          }
        );
        this.#resolve(
          /** @type {Batch} */
          current_batch
        );
      }
    });
  }
  #render() {
    try {
      this.is_pending = this.has_pending_snippet();
      this.#pending_count = 0;
      this.#local_pending_count = 0;
      this.#main_effect = branch(() => {
        this.#children(this.#anchor);
      });
      if (this.#pending_count > 0) {
        var fragment = this.#offscreen_fragment = document.createDocumentFragment();
        move_effect(this.#main_effect, fragment);
        const pending2 = (
          /** @type {(anchor: Node) => void} */
          this.#props.pending
        );
        this.#pending_effect = branch(() => pending2(this.#anchor));
      } else {
        this.#resolve(
          /** @type {Batch} */
          current_batch
        );
      }
    } catch (error) {
      this.error(error);
    }
  }
  /**
   * @param {Batch} batch
   */
  #resolve(batch) {
    this.is_pending = false;
    batch.transfer_effects(this.#dirty_effects, this.#maybe_dirty_effects);
  }
  /**
   * Defer an effect inside a pending boundary until the boundary resolves
   * @param {Effect} effect
   */
  defer_effect(effect2) {
    defer_effect(effect2, this.#dirty_effects, this.#maybe_dirty_effects);
  }
  /**
   * Returns `false` if the effect exists inside a boundary whose pending snippet is shown
   * @returns {boolean}
   */
  is_rendered() {
    return !this.is_pending && (!this.parent || this.parent.is_rendered());
  }
  has_pending_snippet() {
    return !!this.#props.pending;
  }
  /**
   * @template T
   * @param {() => T} fn
   */
  #run(fn) {
    var previous_effect = active_effect;
    var previous_reaction = active_reaction;
    var previous_ctx = component_context;
    set_active_effect(this.#effect);
    set_active_reaction(this.#effect);
    set_component_context(this.#effect.ctx);
    try {
      Batch.ensure();
      return fn();
    } catch (e) {
      handle_error(e);
      return null;
    } finally {
      set_active_effect(previous_effect);
      set_active_reaction(previous_reaction);
      set_component_context(previous_ctx);
    }
  }
  /**
   * Updates the pending count associated with the currently visible pending snippet,
   * if any, such that we can replace the snippet with content once work is done
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  #update_pending_count(d, batch) {
    if (!this.has_pending_snippet()) {
      if (this.parent) {
        this.parent.#update_pending_count(d, batch);
      }
      return;
    }
    this.#pending_count += d;
    if (this.#pending_count === 0) {
      this.#resolve(batch);
      if (this.#pending_effect) {
        pause_effect(this.#pending_effect, () => {
          this.#pending_effect = null;
        });
      }
      if (this.#offscreen_fragment) {
        this.#anchor.before(this.#offscreen_fragment);
        this.#offscreen_fragment = null;
      }
    }
  }
  /**
   * Update the source that powers `$effect.pending()` inside this boundary,
   * and controls when the current `pending` snippet (if any) is removed.
   * Do not call from inside the class
   * @param {1 | -1} d
   * @param {Batch} batch
   */
  update_pending_count(d, batch) {
    this.#update_pending_count(d, batch);
    this.#local_pending_count += d;
    if (!this.#effect_pending || this.#pending_count_update_queued) return;
    this.#pending_count_update_queued = true;
    queue_micro_task(() => {
      this.#pending_count_update_queued = false;
      if (this.#effect_pending) {
        internal_set(this.#effect_pending, this.#local_pending_count);
      }
    });
  }
  get_effect_pending() {
    this.#effect_pending_subscriber();
    return get2(
      /** @type {Source<number>} */
      this.#effect_pending
    );
  }
  /** @param {unknown} error */
  error(error) {
    var onerror = this.#props.onerror;
    let failed = this.#props.failed;
    if (!onerror && !failed) {
      throw error;
    }
    if (this.#main_effect) {
      destroy_effect(this.#main_effect);
      this.#main_effect = null;
    }
    if (this.#pending_effect) {
      destroy_effect(this.#pending_effect);
      this.#pending_effect = null;
    }
    if (this.#failed_effect) {
      destroy_effect(this.#failed_effect);
      this.#failed_effect = null;
    }
    if (hydrating) {
      set_hydrate_node(
        /** @type {TemplateNode} */
        this.#hydrate_open
      );
      next();
      set_hydrate_node(skip_nodes());
    }
    var did_reset = false;
    var calling_on_error = false;
    const reset2 = () => {
      if (did_reset) {
        svelte_boundary_reset_noop();
        return;
      }
      did_reset = true;
      if (calling_on_error) {
        svelte_boundary_reset_onerror();
      }
      if (this.#failed_effect !== null) {
        pause_effect(this.#failed_effect, () => {
          this.#failed_effect = null;
        });
      }
      this.#run(() => {
        this.#render();
      });
    };
    const handle_error_result = (transformed_error) => {
      try {
        calling_on_error = true;
        onerror?.(transformed_error, reset2);
        calling_on_error = false;
      } catch (error2) {
        invoke_error_boundary(error2, this.#effect && this.#effect.parent);
      }
      if (failed) {
        this.#failed_effect = this.#run(() => {
          try {
            return branch(() => {
              var effect2 = (
                /** @type {Effect} */
                active_effect
              );
              effect2.b = this;
              effect2.f |= BOUNDARY_EFFECT;
              failed(
                this.#anchor,
                () => transformed_error,
                () => reset2
              );
            });
          } catch (error2) {
            invoke_error_boundary(
              error2,
              /** @type {Effect} */
              this.#effect.parent
            );
            return null;
          }
        });
      }
    };
    queue_micro_task(() => {
      var result;
      try {
        result = this.transform_error(error);
      } catch (e) {
        invoke_error_boundary(e, this.#effect && this.#effect.parent);
        return;
      }
      if (result !== null && typeof result === "object" && typeof /** @type {any} */
      result.then === "function") {
        result.then(
          handle_error_result,
          /** @param {unknown} e */
          (e) => invoke_error_boundary(e, this.#effect && this.#effect.parent)
        );
      } else {
        handle_error_result(result);
      }
    });
  }
};

}

{
// src/ui/svelte/svelte-20-src_internal_client_reactivity_async.js
// node_modules/svelte/src/internal/client/reactivity/async.js
function flatten(blockers, sync, async2, fn) {
  const d = is_runes() ? derived : derived_safe_equal;
  var pending2 = blockers.filter((b) => !b.settled);
  if (async2.length === 0 && pending2.length === 0) {
    fn(sync.map(d));
    return;
  }
  var parent = (
    /** @type {Effect} */
    active_effect
  );
  var restore = capture();
  var blocker_promise = pending2.length === 1 ? pending2[0].promise : pending2.length > 1 ? Promise.all(pending2.map((b) => b.promise)) : null;
  function finish(values) {
    restore();
    try {
      fn(values);
    } catch (error) {
      if ((parent.f & DESTROYED) === 0) {
        invoke_error_boundary(error, parent);
      }
    }
    unset_context();
  }
  if (async2.length === 0) {
    blocker_promise.then(() => finish(sync.map(d)));
    return;
  }
  var decrement_pending = increment_pending();
  function run3() {
    Promise.all(async2.map((expression) => async_derived(expression))).then((result) => finish([...sync.map(d), ...result])).catch((error) => invoke_error_boundary(error, parent)).finally(() => decrement_pending());
  }
  if (blocker_promise) {
    blocker_promise.then(() => {
      restore();
      run3();
      unset_context();
    });
  } else {
    run3();
  }
}
function capture() {
  var previous_effect = (
    /** @type {Effect} */
    active_effect
  );
  var previous_reaction = active_reaction;
  var previous_component_context = component_context;
  var previous_batch2 = (
    /** @type {Batch} */
    current_batch
  );
  if (dev_fallback_default) {
    var previous_dev_stack = dev_stack;
  }
  return function restore(activate_batch = true) {
    set_active_effect(previous_effect);
    set_active_reaction(previous_reaction);
    set_component_context(previous_component_context);
    if (activate_batch && (previous_effect.f & DESTROYED) === 0) {
      previous_batch2?.activate();
      previous_batch2?.apply();
    }
    if (dev_fallback_default) {
      set_from_async_derived(null);
      set_dev_stack(previous_dev_stack);
    }
  };
}
function unset_context(deactivate_batch = true) {
  set_active_effect(null);
  set_active_reaction(null);
  set_component_context(null);
  if (deactivate_batch) current_batch?.deactivate();
  if (dev_fallback_default) {
    set_from_async_derived(null);
    set_dev_stack(null);
  }
}
function increment_pending() {
  var boundary2 = (
    /** @type {Boundary} */
    /** @type {Effect} */
    active_effect.b
  );
  var batch = (
    /** @type {Batch} */
    current_batch
  );
  var blocking = boundary2.is_rendered();
  boundary2.update_pending_count(1, batch);
  batch.increment(blocking);
  return (skip = false) => {
    boundary2.update_pending_count(-1, batch);
    batch.decrement(blocking, skip);
  };
}

}

{
// src/ui/svelte/svelte-21-src_internal_client_reactivity_deriveds.js
// node_modules/svelte/src/internal/client/reactivity/deriveds.js
var current_async_effect = null;
function set_from_async_derived(v) {
  current_async_effect = v;
}
var recent_async_deriveds = /* @__PURE__ */ new Set();
// @__NO_SIDE_EFFECTS__
function derived(fn) {
  var flags2 = DERIVED | DIRTY;
  var parent_derived = active_reaction !== null && (active_reaction.f & DERIVED) !== 0 ? (
    /** @type {Derived} */
    active_reaction
  ) : null;
  if (active_effect !== null) {
    active_effect.f |= EFFECT_PRESERVED;
  }
  const signal = {
    ctx: component_context,
    deps: null,
    effects: null,
    equals,
    f: flags2,
    fn,
    reactions: null,
    rv: 0,
    v: (
      /** @type {V} */
      UNINITIALIZED
    ),
    wv: 0,
    parent: parent_derived ?? active_effect,
    ac: null
  };
  if (dev_fallback_default && tracing_mode_flag) {
    signal.created = get_error("created at");
  }
  return signal;
}
// @__NO_SIDE_EFFECTS__
function async_derived(fn, label, location) {
  let parent = (
    /** @type {Effect | null} */
    active_effect
  );
  if (parent === null) {
    async_derived_orphan();
  }
  var promise = (
    /** @type {Promise<V>} */
    /** @type {unknown} */
    void 0
  );
  var signal = source(
    /** @type {V} */
    UNINITIALIZED
  );
  if (dev_fallback_default) signal.label = label;
  var should_suspend = !active_reaction;
  var deferreds = /* @__PURE__ */ new Map();
  async_effect(() => {
    if (dev_fallback_default) current_async_effect = active_effect;
    var effect2 = (
      /** @type {Effect} */
      active_effect
    );
    var d = deferred();
    promise = d.promise;
    try {
      Promise.resolve(fn()).then(d.resolve, d.reject).finally(unset_context);
    } catch (error) {
      d.reject(error);
      unset_context();
    }
    if (dev_fallback_default) current_async_effect = null;
    var batch = (
      /** @type {Batch} */
      current_batch
    );
    if (should_suspend) {
      if ((effect2.f & REACTION_RAN) !== 0) {
        var decrement_pending = increment_pending();
      }
      if (
        /** @type {Boundary} */
        parent.b.is_rendered()
      ) {
        deferreds.get(batch)?.reject(STALE_REACTION);
        deferreds.delete(batch);
      } else {
        for (const d2 of deferreds.values()) {
          d2.reject(STALE_REACTION);
        }
        deferreds.clear();
      }
      deferreds.set(batch, d);
    }
    const handler = (value, error = void 0) => {
      if (dev_fallback_default) current_async_effect = null;
      if (decrement_pending) {
        var skip = error === STALE_REACTION;
        decrement_pending(skip);
      }
      if (error === STALE_REACTION || (effect2.f & DESTROYED) !== 0) {
        return;
      }
      batch.activate();
      if (error) {
        signal.f |= ERROR_VALUE;
        internal_set(signal, error);
      } else {
        if ((signal.f & ERROR_VALUE) !== 0) {
          signal.f ^= ERROR_VALUE;
        }
        internal_set(signal, value);
        for (const [b, d2] of deferreds) {
          deferreds.delete(b);
          if (b === batch) break;
          d2.reject(STALE_REACTION);
        }
        if (dev_fallback_default && location !== void 0) {
          recent_async_deriveds.add(signal);
          setTimeout(() => {
            if (recent_async_deriveds.has(signal)) {
              await_waterfall(
                /** @type {string} */
                signal.label,
                location
              );
              recent_async_deriveds.delete(signal);
            }
          });
        }
      }
      batch.deactivate();
    };
    d.promise.then(handler, (e) => handler(null, e || "unknown"));
  });
  teardown(() => {
    for (const d of deferreds.values()) {
      d.reject(STALE_REACTION);
    }
  });
  if (dev_fallback_default) {
    signal.f |= ASYNC;
  }
  return new Promise((fulfil) => {
    function next2(p) {
      function go() {
        if (p === promise) {
          fulfil(signal);
        } else {
          next2(promise);
        }
      }
      p.then(go, go);
    }
    next2(promise);
  });
}
// @__NO_SIDE_EFFECTS__
function derived_safe_equal(fn) {
  const signal = /* @__PURE__ */ derived(fn);
  signal.equals = safe_equals;
  return signal;
}
function destroy_derived_effects(derived2) {
  var effects = derived2.effects;
  if (effects !== null) {
    derived2.effects = null;
    for (var i = 0; i < effects.length; i += 1) {
      destroy_effect(
        /** @type {Effect} */
        effects[i]
      );
    }
  }
}
var stack = [];
function get_derived_parent_effect(derived2) {
  var parent = derived2.parent;
  while (parent !== null) {
    if ((parent.f & DERIVED) === 0) {
      return (parent.f & DESTROYED) === 0 ? (
        /** @type {Effect} */
        parent
      ) : null;
    }
    parent = parent.parent;
  }
  return null;
}
function execute_derived(derived2) {
  var value;
  var prev_active_effect = active_effect;
  set_active_effect(get_derived_parent_effect(derived2));
  if (dev_fallback_default) {
    let prev_eager_effects = eager_effects;
    set_eager_effects(/* @__PURE__ */ new Set());
    try {
      if (includes.call(stack, derived2)) {
        derived_references_self();
      }
      stack.push(derived2);
      derived2.f &= ~WAS_MARKED;
      destroy_derived_effects(derived2);
      value = update_reaction(derived2);
    } finally {
      set_active_effect(prev_active_effect);
      set_eager_effects(prev_eager_effects);
      stack.pop();
    }
  } else {
    try {
      derived2.f &= ~WAS_MARKED;
      destroy_derived_effects(derived2);
      value = update_reaction(derived2);
    } finally {
      set_active_effect(prev_active_effect);
    }
  }
  return value;
}
function update_derived(derived2) {
  var old_value = derived2.v;
  var value = execute_derived(derived2);
  if (!derived2.equals(value)) {
    derived2.wv = increment_write_version();
    if (!current_batch?.is_fork || derived2.deps === null) {
      derived2.v = value;
      current_batch?.capture(derived2, old_value);
      if (derived2.deps === null) {
        set_signal_status(derived2, CLEAN);
        return;
      }
    }
  }
  if (is_destroying_effect) {
    return;
  }
  if (batch_values !== null) {
    if (effect_tracking() || current_batch?.is_fork) {
      batch_values.set(derived2, value);
    }
  } else {
    update_derived_status(derived2);
  }
}
function freeze_derived_effects(derived2) {
  if (derived2.effects === null) return;
  for (const e of derived2.effects) {
    if (e.teardown || e.ac) {
      e.teardown?.();
      e.ac?.abort(STALE_REACTION);
      e.teardown = noop;
      e.ac = null;
      remove_reactions(e, 0);
      destroy_effect_children(e);
    }
  }
}
function unfreeze_derived_effects(derived2) {
  if (derived2.effects === null) return;
  for (const e of derived2.effects) {
    if (e.teardown) {
      update_effect(e);
    }
  }
}

}

{
// src/ui/svelte/svelte-22-src_internal_client_reactivity_sources.js
// node_modules/svelte/src/internal/client/reactivity/sources.js
var eager_effects = /* @__PURE__ */ new Set();
var old_values = /* @__PURE__ */ new Map();
function set_eager_effects(v) {
  eager_effects = v;
}
var eager_effects_deferred = false;
function set_eager_effects_deferred() {
  eager_effects_deferred = true;
}
function source(v, stack2) {
  var signal = {
    f: 0,
    // TODO ideally we could skip this altogether, but it causes type errors
    v,
    reactions: null,
    equals,
    rv: 0,
    wv: 0
  };
  if (dev_fallback_default && tracing_mode_flag) {
    signal.created = stack2 ?? get_error("created at");
    signal.updated = null;
    signal.set_during_effect = false;
    signal.trace = null;
  }
  return signal;
}
// @__NO_SIDE_EFFECTS__
function state(v, stack2) {
  const s = source(v, stack2);
  push_reaction_value(s);
  return s;
}
// @__NO_SIDE_EFFECTS__
function mutable_source(initial_value, immutable = false, trackable = true) {
  const s = source(initial_value);
  if (!immutable) {
    s.equals = safe_equals;
  }
  if (legacy_mode_flag && trackable && component_context !== null && component_context.l !== null) {
    (component_context.l.s ??= []).push(s);
  }
  return s;
}
function set(source2, value, should_proxy = false) {
  if (active_reaction !== null && // since we are untracking the function inside `$inspect.with` we need to add this check
  // to ensure we error if state is set inside an inspect effect
  (!untracking || (active_reaction.f & EAGER_EFFECT) !== 0) && is_runes() && (active_reaction.f & (DERIVED | BLOCK_EFFECT | ASYNC | EAGER_EFFECT)) !== 0 && (current_sources === null || !includes.call(current_sources, source2))) {
    state_unsafe_mutation();
  }
  let new_value = should_proxy ? proxy(value) : value;
  if (dev_fallback_default) {
    tag_proxy(
      new_value,
      /** @type {string} */
      source2.label
    );
  }
  return internal_set(source2, new_value, legacy_updates);
}
function internal_set(source2, value, updated_during_traversal = null) {
  if (!source2.equals(value)) {
    var old_value = source2.v;
    if (is_destroying_effect) {
      old_values.set(source2, value);
    } else {
      old_values.set(source2, old_value);
    }
    source2.v = value;
    var batch = Batch.ensure();
    batch.capture(source2, old_value);
    if (dev_fallback_default) {
      if (tracing_mode_flag || active_effect !== null) {
        source2.updated ??= /* @__PURE__ */ new Map();
        const count = (source2.updated.get("")?.count ?? 0) + 1;
        source2.updated.set("", { error: (
          /** @type {any} */
          null
        ), count });
        if (tracing_mode_flag || count > 5) {
          const error = get_error("updated at");
          if (error !== null) {
            let entry = source2.updated.get(error.stack);
            if (!entry) {
              entry = { error, count: 0 };
              source2.updated.set(error.stack, entry);
            }
            entry.count++;
          }
        }
      }
      if (active_effect !== null) {
        source2.set_during_effect = true;
      }
    }
    if ((source2.f & DERIVED) !== 0) {
      const derived2 = (
        /** @type {Derived} */
        source2
      );
      if ((source2.f & DIRTY) !== 0) {
        execute_derived(derived2);
      }
      if (batch_values === null) {
        update_derived_status(derived2);
      }
    }
    source2.wv = increment_write_version();
    mark_reactions(source2, DIRTY, updated_during_traversal);
    if (is_runes() && active_effect !== null && (active_effect.f & CLEAN) !== 0 && (active_effect.f & (BRANCH_EFFECT | ROOT_EFFECT)) === 0) {
      if (untracked_writes === null) {
        set_untracked_writes([source2]);
      } else {
        untracked_writes.push(source2);
      }
    }
    if (!batch.is_fork && eager_effects.size > 0 && !eager_effects_deferred) {
      flush_eager_effects();
    }
  }
  return value;
}
function flush_eager_effects() {
  eager_effects_deferred = false;
  for (const effect2 of eager_effects) {
    if ((effect2.f & CLEAN) !== 0) {
      set_signal_status(effect2, MAYBE_DIRTY);
    }
    if (is_dirty(effect2)) {
      update_effect(effect2);
    }
  }
  eager_effects.clear();
}
function increment(source2) {
  set(source2, source2.v + 1);
}
function mark_reactions(signal, status, updated_during_traversal) {
  var reactions = signal.reactions;
  if (reactions === null) return;
  var runes = is_runes();
  var length = reactions.length;
  for (var i = 0; i < length; i++) {
    var reaction = reactions[i];
    var flags2 = reaction.f;
    if (!runes && reaction === active_effect) continue;
    if (dev_fallback_default && (flags2 & EAGER_EFFECT) !== 0) {
      eager_effects.add(reaction);
      continue;
    }
    var not_dirty = (flags2 & DIRTY) === 0;
    if (not_dirty) {
      set_signal_status(reaction, status);
    }
    if ((flags2 & DERIVED) !== 0) {
      var derived2 = (
        /** @type {Derived} */
        reaction
      );
      batch_values?.delete(derived2);
      if ((flags2 & WAS_MARKED) === 0) {
        if (flags2 & CONNECTED) {
          reaction.f |= WAS_MARKED;
        }
        mark_reactions(derived2, MAYBE_DIRTY, updated_during_traversal);
      }
    } else if (not_dirty) {
      var effect2 = (
        /** @type {Effect} */
        reaction
      );
      if ((flags2 & BLOCK_EFFECT) !== 0 && eager_block_effects !== null) {
        eager_block_effects.add(effect2);
      }
      if (updated_during_traversal !== null) {
        updated_during_traversal.push(effect2);
      } else {
        schedule_effect(effect2);
      }
    }
  }
}

}

{
// src/ui/svelte/svelte-23-src_internal_client_proxy.js
// node_modules/svelte/src/internal/client/proxy.js
var regex_is_valid_identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
function proxy(value) {
  if (typeof value !== "object" || value === null || STATE_SYMBOL in value) {
    return value;
  }
  const prototype = get_prototype_of(value);
  if (prototype !== object_prototype && prototype !== array_prototype) {
    return value;
  }
  var sources = /* @__PURE__ */ new Map();
  var is_proxied_array = is_array(value);
  var version = state(0);
  var stack2 = dev_fallback_default && tracing_mode_flag ? get_error("created at") : null;
  var parent_version = update_version;
  var with_parent = (fn) => {
    if (update_version === parent_version) {
      return fn();
    }
    var reaction = active_reaction;
    var version2 = update_version;
    set_active_reaction(null);
    set_update_version(parent_version);
    var result = fn();
    set_active_reaction(reaction);
    set_update_version(version2);
    return result;
  };
  if (is_proxied_array) {
    sources.set("length", state(
      /** @type {any[]} */
      value.length,
      stack2
    ));
    if (dev_fallback_default) {
      value = /** @type {any} */
      inspectable_array(
        /** @type {any[]} */
        value
      );
    }
  }
  var path = "";
  let updating = false;
  function update_path(new_path) {
    if (updating) return;
    updating = true;
    path = new_path;
    tag(version, `${path} version`);
    for (const [prop2, source2] of sources) {
      tag(source2, get_label(path, prop2));
    }
    updating = false;
  }
  return new Proxy(
    /** @type {any} */
    value,
    {
      defineProperty(_, prop2, descriptor) {
        if (!("value" in descriptor) || descriptor.configurable === false || descriptor.enumerable === false || descriptor.writable === false) {
          state_descriptors_fixed();
        }
        var s = sources.get(prop2);
        if (s === void 0) {
          with_parent(() => {
            var s2 = state(descriptor.value, stack2);
            sources.set(prop2, s2);
            if (dev_fallback_default && typeof prop2 === "string") {
              tag(s2, get_label(path, prop2));
            }
            return s2;
          });
        } else {
          set(s, descriptor.value, true);
        }
        return true;
      },
      deleteProperty(target, prop2) {
        var s = sources.get(prop2);
        if (s === void 0) {
          if (prop2 in target) {
            const s2 = with_parent(() => state(UNINITIALIZED, stack2));
            sources.set(prop2, s2);
            increment(version);
            if (dev_fallback_default) {
              tag(s2, get_label(path, prop2));
            }
          }
        } else {
          set(s, UNINITIALIZED);
          increment(version);
        }
        return true;
      },
      get(target, prop2, receiver) {
        if (prop2 === STATE_SYMBOL) {
          return value;
        }
        if (dev_fallback_default && prop2 === PROXY_PATH_SYMBOL) {
          return update_path;
        }
        var s = sources.get(prop2);
        var exists = prop2 in target;
        if (s === void 0 && (!exists || get_descriptor(target, prop2)?.writable)) {
          s = with_parent(() => {
            var p = proxy(exists ? target[prop2] : UNINITIALIZED);
            var s2 = state(p, stack2);
            if (dev_fallback_default) {
              tag(s2, get_label(path, prop2));
            }
            return s2;
          });
          sources.set(prop2, s);
        }
        if (s !== void 0) {
          var v = get2(s);
          return v === UNINITIALIZED ? void 0 : v;
        }
        return Reflect.get(target, prop2, receiver);
      },
      getOwnPropertyDescriptor(target, prop2) {
        var descriptor = Reflect.getOwnPropertyDescriptor(target, prop2);
        if (descriptor && "value" in descriptor) {
          var s = sources.get(prop2);
          if (s) descriptor.value = get2(s);
        } else if (descriptor === void 0) {
          var source2 = sources.get(prop2);
          var value2 = source2?.v;
          if (source2 !== void 0 && value2 !== UNINITIALIZED) {
            return {
              enumerable: true,
              configurable: true,
              value: value2,
              writable: true
            };
          }
        }
        return descriptor;
      },
      has(target, prop2) {
        if (prop2 === STATE_SYMBOL) {
          return true;
        }
        var s = sources.get(prop2);
        var has = s !== void 0 && s.v !== UNINITIALIZED || Reflect.has(target, prop2);
        if (s !== void 0 || active_effect !== null && (!has || get_descriptor(target, prop2)?.writable)) {
          if (s === void 0) {
            s = with_parent(() => {
              var p = has ? proxy(target[prop2]) : UNINITIALIZED;
              var s2 = state(p, stack2);
              if (dev_fallback_default) {
                tag(s2, get_label(path, prop2));
              }
              return s2;
            });
            sources.set(prop2, s);
          }
          var value2 = get2(s);
          if (value2 === UNINITIALIZED) {
            return false;
          }
        }
        return has;
      },
      set(target, prop2, value2, receiver) {
        var s = sources.get(prop2);
        var has = prop2 in target;
        if (is_proxied_array && prop2 === "length") {
          for (var i = value2; i < /** @type {Source<number>} */
          s.v; i += 1) {
            var other_s = sources.get(i + "");
            if (other_s !== void 0) {
              set(other_s, UNINITIALIZED);
            } else if (i in target) {
              other_s = with_parent(() => state(UNINITIALIZED, stack2));
              sources.set(i + "", other_s);
              if (dev_fallback_default) {
                tag(other_s, get_label(path, i));
              }
            }
          }
        }
        if (s === void 0) {
          if (!has || get_descriptor(target, prop2)?.writable) {
            s = with_parent(() => state(void 0, stack2));
            if (dev_fallback_default) {
              tag(s, get_label(path, prop2));
            }
            set(s, proxy(value2));
            sources.set(prop2, s);
          }
        } else {
          has = s.v !== UNINITIALIZED;
          var p = with_parent(() => proxy(value2));
          set(s, p);
        }
        var descriptor = Reflect.getOwnPropertyDescriptor(target, prop2);
        if (descriptor?.set) {
          descriptor.set.call(receiver, value2);
        }
        if (!has) {
          if (is_proxied_array && typeof prop2 === "string") {
            var ls = (
              /** @type {Source<number>} */
              sources.get("length")
            );
            var n = Number(prop2);
            if (Number.isInteger(n) && n >= ls.v) {
              set(ls, n + 1);
            }
          }
          increment(version);
        }
        return true;
      },
      ownKeys(target) {
        get2(version);
        var own_keys = Reflect.ownKeys(target).filter((key3) => {
          var source3 = sources.get(key3);
          return source3 === void 0 || source3.v !== UNINITIALIZED;
        });
        for (var [key2, source2] of sources) {
          if (source2.v !== UNINITIALIZED && !(key2 in target)) {
            own_keys.push(key2);
          }
        }
        return own_keys;
      },
      setPrototypeOf() {
        state_prototype_fixed();
      }
    }
  );
}
function get_label(path, prop2) {
  if (typeof prop2 === "symbol") return `${path}[Symbol(${prop2.description ?? ""})]`;
  if (regex_is_valid_identifier.test(prop2)) return `${path}.${prop2}`;
  return /^\d+$/.test(prop2) ? `${path}[${prop2}]` : `${path}['${prop2}']`;
}
function get_proxied_value(value) {
  try {
    if (value !== null && typeof value === "object" && STATE_SYMBOL in value) {
      return value[STATE_SYMBOL];
    }
  } catch {
  }
  return value;
}
var ARRAY_MUTATING_METHODS = /* @__PURE__ */ new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift"
]);
function inspectable_array(array) {
  return new Proxy(array, {
    get(target, prop2, receiver) {
      var value = Reflect.get(target, prop2, receiver);
      if (!ARRAY_MUTATING_METHODS.has(
        /** @type {string} */
        prop2
      )) {
        return value;
      }
      return function(...args) {
        set_eager_effects_deferred();
        var result = value.apply(this, args);
        flush_eager_effects();
        return result;
      };
    }
  });
}

}

{
// src/ui/svelte/svelte-24-src_internal_client_dev_equality.js
// node_modules/svelte/src/internal/client/dev/equality.js
function init_array_prototype_warnings() {
  const array_prototype2 = Array.prototype;
  const cleanup = Array.__svelte_cleanup;
  if (cleanup) {
    cleanup();
  }
  const { indexOf, lastIndexOf, includes: includes2 } = array_prototype2;
  array_prototype2.indexOf = function(item, from_index) {
    const index2 = indexOf.call(this, item, from_index);
    if (index2 === -1) {
      for (let i = from_index ?? 0; i < this.length; i += 1) {
        if (get_proxied_value(this[i]) === item) {
          state_proxy_equality_mismatch("array.indexOf(...)");
          break;
        }
      }
    }
    return index2;
  };
  array_prototype2.lastIndexOf = function(item, from_index) {
    const index2 = lastIndexOf.call(this, item, from_index ?? this.length - 1);
    if (index2 === -1) {
      for (let i = 0; i <= (from_index ?? this.length - 1); i += 1) {
        if (get_proxied_value(this[i]) === item) {
          state_proxy_equality_mismatch("array.lastIndexOf(...)");
          break;
        }
      }
    }
    return index2;
  };
  array_prototype2.includes = function(item, from_index) {
    const has = includes2.call(this, item, from_index);
    if (!has) {
      for (let i = 0; i < this.length; i += 1) {
        if (get_proxied_value(this[i]) === item) {
          state_proxy_equality_mismatch("array.includes(...)");
          break;
        }
      }
    }
    return has;
  };
  Array.__svelte_cleanup = () => {
    array_prototype2.indexOf = indexOf;
    array_prototype2.lastIndexOf = lastIndexOf;
    array_prototype2.includes = includes2;
  };
}

}

{
// src/ui/svelte/svelte-25-src_internal_client_dom_operations.js
// node_modules/svelte/src/internal/client/dom/operations.js
var $window;
var $document;
var is_firefox;
var first_child_getter;
var next_sibling_getter;
function init_operations() {
  if ($window !== void 0) {
    return;
  }
  $window = window;
  $document = document;
  is_firefox = /Firefox/.test(navigator.userAgent);
  var element_prototype = Element.prototype;
  var node_prototype = Node.prototype;
  var text_prototype = Text.prototype;
  first_child_getter = get_descriptor(node_prototype, "firstChild").get;
  next_sibling_getter = get_descriptor(node_prototype, "nextSibling").get;
  if (is_extensible(element_prototype)) {
    element_prototype.__click = void 0;
    element_prototype.__className = void 0;
    element_prototype.__attributes = null;
    element_prototype.__style = void 0;
    element_prototype.__e = void 0;
  }
  if (is_extensible(text_prototype)) {
    text_prototype.__t = void 0;
  }
  if (dev_fallback_default) {
    element_prototype.__svelte_meta = null;
    init_array_prototype_warnings();
  }
}
function create_text(value = "") {
  return document.createTextNode(value);
}
// @__NO_SIDE_EFFECTS__
function get_first_child(node) {
  return (
    /** @type {TemplateNode | null} */
    first_child_getter.call(node)
  );
}
// @__NO_SIDE_EFFECTS__
function get_next_sibling(node) {
  return (
    /** @type {TemplateNode | null} */
    next_sibling_getter.call(node)
  );
}
function child(node, is_text) {
  if (!hydrating) {
    return /* @__PURE__ */ get_first_child(node);
  }
  var child2 = /* @__PURE__ */ get_first_child(hydrate_node);
  if (child2 === null) {
    child2 = hydrate_node.appendChild(create_text());
  } else if (is_text && child2.nodeType !== TEXT_NODE) {
    var text2 = create_text();
    child2?.before(text2);
    set_hydrate_node(text2);
    return text2;
  }
  if (is_text) {
    merge_text_nodes(
      /** @type {Text} */
      child2
    );
  }
  set_hydrate_node(child2);
  return child2;
}
function first_child(node, is_text = false) {
  if (!hydrating) {
    var first = /* @__PURE__ */ get_first_child(node);
    if (first instanceof Comment && first.data === "") return /* @__PURE__ */ get_next_sibling(first);
    return first;
  }
  if (is_text) {
    if (hydrate_node?.nodeType !== TEXT_NODE) {
      var text2 = create_text();
      hydrate_node?.before(text2);
      set_hydrate_node(text2);
      return text2;
    }
    merge_text_nodes(
      /** @type {Text} */
      hydrate_node
    );
  }
  return hydrate_node;
}
function sibling(node, count = 1, is_text = false) {
  let next_sibling = hydrating ? hydrate_node : node;
  var last_sibling;
  while (count--) {
    last_sibling = next_sibling;
    next_sibling = /** @type {TemplateNode} */
    /* @__PURE__ */ get_next_sibling(next_sibling);
  }
  if (!hydrating) {
    return next_sibling;
  }
  if (is_text) {
    if (next_sibling?.nodeType !== TEXT_NODE) {
      var text2 = create_text();
      if (next_sibling === null) {
        last_sibling?.after(text2);
      } else {
        next_sibling.before(text2);
      }
      set_hydrate_node(text2);
      return text2;
    }
    merge_text_nodes(
      /** @type {Text} */
      next_sibling
    );
  }
  set_hydrate_node(next_sibling);
  return next_sibling;
}
function clear_text_content(node) {
  node.textContent = "";
}
function should_defer_append() {
  if (!async_mode_flag) return false;
  if (eager_block_effects !== null) return false;
  var flags2 = (
    /** @type {Effect} */
    active_effect.f
  );
  return (flags2 & REACTION_RAN) !== 0;
}
function create_element(tag2, namespace, is2) {
  let options = is2 ? { is: is2 } : void 0;
  return (
    /** @type {T extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[T] : Element} */
    document.createElementNS(namespace ?? NAMESPACE_HTML, tag2, options)
  );
}
function merge_text_nodes(text2) {
  if (
    /** @type {string} */
    text2.nodeValue.length < 65536
  ) {
    return;
  }
  let next2 = text2.nextSibling;
  while (next2 !== null && next2.nodeType === TEXT_NODE) {
    next2.remove();
    text2.nodeValue += /** @type {string} */
    next2.nodeValue;
    next2 = text2.nextSibling;
  }
}

}

{
// src/ui/svelte/svelte-26-src_internal_client_dom_elements_misc.js
// node_modules/svelte/src/internal/client/dom/elements/misc.js
function remove_textarea_child(dom) {
  if (hydrating && get_first_child(dom) !== null) {
    clear_text_content(dom);
  }
}
var listening_to_form_reset = false;
function add_form_reset_listener() {
  if (!listening_to_form_reset) {
    listening_to_form_reset = true;
    document.addEventListener(
      "reset",
      (evt) => {
        Promise.resolve().then(() => {
          if (!evt.defaultPrevented) {
            for (
              const e of
              /**@type {HTMLFormElement} */
              evt.target.elements
            ) {
              e.__on_r?.();
            }
          }
        });
      },
      // In the capture phase to guarantee we get noticed of it (no possibility of stopPropagation)
      { capture: true }
    );
  }
}

}

{
// src/ui/svelte/svelte-27-src_internal_client_dom_elements_bindings_shared.js
// node_modules/svelte/src/internal/client/dom/elements/bindings/shared.js
function without_reactive_context(fn) {
  var previous_reaction = active_reaction;
  var previous_effect = active_effect;
  set_active_reaction(null);
  set_active_effect(null);
  try {
    return fn();
  } finally {
    set_active_reaction(previous_reaction);
    set_active_effect(previous_effect);
  }
}
function listen_to_event_and_reset_event(element2, event2, handler, on_reset = handler) {
  element2.addEventListener(event2, () => without_reactive_context(handler));
  const prev = element2.__on_r;
  if (prev) {
    element2.__on_r = () => {
      prev();
      on_reset(true);
    };
  } else {
    element2.__on_r = () => on_reset(true);
  }
  add_form_reset_listener();
}

}

{
// src/ui/svelte/svelte-28-src_internal_client_reactivity_effects.js
// node_modules/svelte/src/internal/client/reactivity/effects.js
function validate_effect(rune) {
  if (active_effect === null) {
    if (active_reaction === null) {
      effect_orphan(rune);
    }
    effect_in_unowned_derived();
  }
  if (is_destroying_effect) {
    effect_in_teardown(rune);
  }
}
function push_effect(effect2, parent_effect) {
  var parent_last = parent_effect.last;
  if (parent_last === null) {
    parent_effect.last = parent_effect.first = effect2;
  } else {
    parent_last.next = effect2;
    effect2.prev = parent_last;
    parent_effect.last = effect2;
  }
}
function create_effect(type, fn) {
  var parent = active_effect;
  if (dev_fallback_default) {
    while (parent !== null && (parent.f & EAGER_EFFECT) !== 0) {
      parent = parent.parent;
    }
  }
  if (parent !== null && (parent.f & INERT) !== 0) {
    type |= INERT;
  }
  var effect2 = {
    ctx: component_context,
    deps: null,
    nodes: null,
    f: type | DIRTY | CONNECTED,
    first: null,
    fn,
    last: null,
    next: null,
    parent,
    b: parent && parent.b,
    prev: null,
    teardown: null,
    wv: 0,
    ac: null
  };
  if (dev_fallback_default) {
    effect2.component_function = dev_current_component_function;
  }
  var e = effect2;
  if ((type & EFFECT) !== 0) {
    if (collected_effects !== null) {
      collected_effects.push(effect2);
    } else {
      Batch.ensure().schedule(effect2);
    }
  } else if (fn !== null) {
    try {
      update_effect(effect2);
    } catch (e2) {
      destroy_effect(effect2);
      throw e2;
    }
    if (e.deps === null && e.teardown === null && e.nodes === null && e.first === e.last && // either `null`, or a singular child
    (e.f & EFFECT_PRESERVED) === 0) {
      e = e.first;
      if ((type & BLOCK_EFFECT) !== 0 && (type & EFFECT_TRANSPARENT) !== 0 && e !== null) {
        e.f |= EFFECT_TRANSPARENT;
      }
    }
  }
  if (e !== null) {
    e.parent = parent;
    if (parent !== null) {
      push_effect(e, parent);
    }
    if (active_reaction !== null && (active_reaction.f & DERIVED) !== 0 && (type & ROOT_EFFECT) === 0) {
      var derived2 = (
        /** @type {Derived} */
        active_reaction
      );
      (derived2.effects ??= []).push(e);
    }
  }
  return effect2;
}
function effect_tracking() {
  return active_reaction !== null && !untracking;
}
function teardown(fn) {
  const effect2 = create_effect(RENDER_EFFECT, null);
  set_signal_status(effect2, CLEAN);
  effect2.teardown = fn;
  return effect2;
}
function user_effect(fn) {
  validate_effect("$effect");
  if (dev_fallback_default) {
    define_property(fn, "name", {
      value: "$effect"
    });
  }
  var flags2 = (
    /** @type {Effect} */
    active_effect.f
  );
  var defer = !active_reaction && (flags2 & BRANCH_EFFECT) !== 0 && (flags2 & REACTION_RAN) === 0;
  if (defer) {
    var context = (
      /** @type {ComponentContext} */
      component_context
    );
    (context.e ??= []).push(fn);
  } else {
    return create_user_effect(fn);
  }
}
function create_user_effect(fn) {
  return create_effect(EFFECT | USER_EFFECT, fn);
}
function effect_root(fn) {
  Batch.ensure();
  const effect2 = create_effect(ROOT_EFFECT | EFFECT_PRESERVED, fn);
  return () => {
    destroy_effect(effect2);
  };
}
function component_root(fn) {
  Batch.ensure();
  const effect2 = create_effect(ROOT_EFFECT | EFFECT_PRESERVED, fn);
  return (options = {}) => {
    return new Promise((fulfil) => {
      if (options.outro) {
        pause_effect(effect2, () => {
          destroy_effect(effect2);
          fulfil(void 0);
        });
      } else {
        destroy_effect(effect2);
        fulfil(void 0);
      }
    });
  };
}
function effect(fn) {
  return create_effect(EFFECT, fn);
}
function async_effect(fn) {
  return create_effect(ASYNC | EFFECT_PRESERVED, fn);
}
function render_effect(fn, flags2 = 0) {
  return create_effect(RENDER_EFFECT | flags2, fn);
}
function template_effect(fn, sync = [], async2 = [], blockers = []) {
  flatten(blockers, sync, async2, (values) => {
    create_effect(RENDER_EFFECT, () => fn(...values.map(get2)));
  });
}
function block(fn, flags2 = 0) {
  var effect2 = create_effect(BLOCK_EFFECT | flags2, fn);
  if (dev_fallback_default) {
    effect2.dev_stack = dev_stack;
  }
  return effect2;
}
function branch(fn) {
  return create_effect(BRANCH_EFFECT | EFFECT_PRESERVED, fn);
}
function execute_effect_teardown(effect2) {
  var teardown2 = effect2.teardown;
  if (teardown2 !== null) {
    const previously_destroying_effect = is_destroying_effect;
    const previous_reaction = active_reaction;
    set_is_destroying_effect(true);
    set_active_reaction(null);
    try {
      teardown2.call(null);
    } finally {
      set_is_destroying_effect(previously_destroying_effect);
      set_active_reaction(previous_reaction);
    }
  }
}
function destroy_effect_children(signal, remove_dom = false) {
  var effect2 = signal.first;
  signal.first = signal.last = null;
  while (effect2 !== null) {
    const controller = effect2.ac;
    if (controller !== null) {
      without_reactive_context(() => {
        controller.abort(STALE_REACTION);
      });
    }
    var next2 = effect2.next;
    if ((effect2.f & ROOT_EFFECT) !== 0) {
      effect2.parent = null;
    } else {
      destroy_effect(effect2, remove_dom);
    }
    effect2 = next2;
  }
}
function destroy_block_effect_children(signal) {
  var effect2 = signal.first;
  while (effect2 !== null) {
    var next2 = effect2.next;
    if ((effect2.f & BRANCH_EFFECT) === 0) {
      destroy_effect(effect2);
    }
    effect2 = next2;
  }
}
function destroy_effect(effect2, remove_dom = true) {
  var removed = false;
  if ((remove_dom || (effect2.f & HEAD_EFFECT) !== 0) && effect2.nodes !== null && effect2.nodes.end !== null) {
    remove_effect_dom(
      effect2.nodes.start,
      /** @type {TemplateNode} */
      effect2.nodes.end
    );
    removed = true;
  }
  set_signal_status(effect2, DESTROYING);
  destroy_effect_children(effect2, remove_dom && !removed);
  remove_reactions(effect2, 0);
  var transitions = effect2.nodes && effect2.nodes.t;
  if (transitions !== null) {
    for (const transition2 of transitions) {
      transition2.stop();
    }
  }
  execute_effect_teardown(effect2);
  effect2.f ^= DESTROYING;
  effect2.f |= DESTROYED;
  var parent = effect2.parent;
  if (parent !== null && parent.first !== null) {
    unlink_effect(effect2);
  }
  if (dev_fallback_default) {
    effect2.component_function = null;
  }
  effect2.next = effect2.prev = effect2.teardown = effect2.ctx = effect2.deps = effect2.fn = effect2.nodes = effect2.ac = null;
}
function remove_effect_dom(node, end) {
  while (node !== null) {
    var next2 = node === end ? null : get_next_sibling(node);
    node.remove();
    node = next2;
  }
}
function unlink_effect(effect2) {
  var parent = effect2.parent;
  var prev = effect2.prev;
  var next2 = effect2.next;
  if (prev !== null) prev.next = next2;
  if (next2 !== null) next2.prev = prev;
  if (parent !== null) {
    if (parent.first === effect2) parent.first = next2;
    if (parent.last === effect2) parent.last = prev;
  }
}
function pause_effect(effect2, callback, destroy = true) {
  var transitions = [];
  pause_children(effect2, transitions, true);
  var fn = () => {
    if (destroy) destroy_effect(effect2);
    if (callback) callback();
  };
  var remaining = transitions.length;
  if (remaining > 0) {
    var check = () => --remaining || fn();
    for (var transition2 of transitions) {
      transition2.out(check);
    }
  } else {
    fn();
  }
}
function pause_children(effect2, transitions, local) {
  if ((effect2.f & INERT) !== 0) return;
  effect2.f ^= INERT;
  var t = effect2.nodes && effect2.nodes.t;
  if (t !== null) {
    for (const transition2 of t) {
      if (transition2.is_global || local) {
        transitions.push(transition2);
      }
    }
  }
  var child2 = effect2.first;
  while (child2 !== null) {
    var sibling2 = child2.next;
    var transparent = (child2.f & EFFECT_TRANSPARENT) !== 0 || // If this is a branch effect without a block effect parent,
    // it means the parent block effect was pruned. In that case,
    // transparency information was transferred to the branch effect.
    (child2.f & BRANCH_EFFECT) !== 0 && (effect2.f & BLOCK_EFFECT) !== 0;
    pause_children(child2, transitions, transparent ? local : false);
    child2 = sibling2;
  }
}
function resume_effect(effect2) {
  resume_children(effect2, true);
}
function resume_children(effect2, local) {
  if ((effect2.f & INERT) === 0) return;
  effect2.f ^= INERT;
  if ((effect2.f & CLEAN) === 0) {
    set_signal_status(effect2, DIRTY);
    Batch.ensure().schedule(effect2);
  }
  var child2 = effect2.first;
  while (child2 !== null) {
    var sibling2 = child2.next;
    var transparent = (child2.f & EFFECT_TRANSPARENT) !== 0 || (child2.f & BRANCH_EFFECT) !== 0;
    resume_children(child2, transparent ? local : false);
    child2 = sibling2;
  }
  var t = effect2.nodes && effect2.nodes.t;
  if (t !== null) {
    for (const transition2 of t) {
      if (transition2.is_global || local) {
        transition2.in();
      }
    }
  }
}
function move_effect(effect2, fragment) {
  if (!effect2.nodes) return;
  var node = effect2.nodes.start;
  var end = effect2.nodes.end;
  while (node !== null) {
    var next2 = node === end ? null : get_next_sibling(node);
    fragment.append(node);
    node = next2;
  }
}

}

{
// src/ui/svelte/svelte-29-src_internal_client_legacy.js
// node_modules/svelte/src/internal/client/legacy.js
var captured_signals = null;

}

{
// src/ui/svelte/svelte-30-src_internal_client_runtime.js
// node_modules/svelte/src/internal/client/runtime.js
var is_updating_effect = false;
var is_destroying_effect = false;
function set_is_destroying_effect(value) {
  is_destroying_effect = value;
}
var active_reaction = null;
var untracking = false;
function set_active_reaction(reaction) {
  active_reaction = reaction;
}
var active_effect = null;
function set_active_effect(effect2) {
  active_effect = effect2;
}
var current_sources = null;
function push_reaction_value(value) {
  if (active_reaction !== null && (!async_mode_flag || (active_reaction.f & DERIVED) !== 0)) {
    if (current_sources === null) {
      current_sources = [value];
    } else {
      current_sources.push(value);
    }
  }
}
var new_deps = null;
var skipped_deps = 0;
var untracked_writes = null;
function set_untracked_writes(value) {
  untracked_writes = value;
}
var write_version = 1;
var read_version = 0;
var update_version = read_version;
function set_update_version(value) {
  update_version = value;
}
function increment_write_version() {
  return ++write_version;
}
function is_dirty(reaction) {
  var flags2 = reaction.f;
  if ((flags2 & DIRTY) !== 0) {
    return true;
  }
  if (flags2 & DERIVED) {
    reaction.f &= ~WAS_MARKED;
  }
  if ((flags2 & MAYBE_DIRTY) !== 0) {
    var dependencies = (
      /** @type {Value[]} */
      reaction.deps
    );
    var length = dependencies.length;
    for (var i = 0; i < length; i++) {
      var dependency = dependencies[i];
      if (is_dirty(
        /** @type {Derived} */
        dependency
      )) {
        update_derived(
          /** @type {Derived} */
          dependency
        );
      }
      if (dependency.wv > reaction.wv) {
        return true;
      }
    }
    if ((flags2 & CONNECTED) !== 0 && // During time traveling we don't want to reset the status so that
    // traversal of the graph in the other batches still happens
    batch_values === null) {
      set_signal_status(reaction, CLEAN);
    }
  }
  return false;
}
function schedule_possible_effect_self_invalidation(signal, effect2, root2 = true) {
  var reactions = signal.reactions;
  if (reactions === null) return;
  if (!async_mode_flag && current_sources !== null && includes.call(current_sources, signal)) {
    return;
  }
  for (var i = 0; i < reactions.length; i++) {
    var reaction = reactions[i];
    if ((reaction.f & DERIVED) !== 0) {
      schedule_possible_effect_self_invalidation(
        /** @type {Derived} */
        reaction,
        effect2,
        false
      );
    } else if (effect2 === reaction) {
      if (root2) {
        set_signal_status(reaction, DIRTY);
      } else if ((reaction.f & CLEAN) !== 0) {
        set_signal_status(reaction, MAYBE_DIRTY);
      }
      schedule_effect(
        /** @type {Effect} */
        reaction
      );
    }
  }
}
function update_reaction(reaction) {
  var previous_deps = new_deps;
  var previous_skipped_deps = skipped_deps;
  var previous_untracked_writes = untracked_writes;
  var previous_reaction = active_reaction;
  var previous_sources = current_sources;
  var previous_component_context = component_context;
  var previous_untracking = untracking;
  var previous_update_version = update_version;
  var flags2 = reaction.f;
  new_deps = /** @type {null | Value[]} */
  null;
  skipped_deps = 0;
  untracked_writes = null;
  active_reaction = (flags2 & (BRANCH_EFFECT | ROOT_EFFECT)) === 0 ? reaction : null;
  current_sources = null;
  set_component_context(reaction.ctx);
  untracking = false;
  update_version = ++read_version;
  if (reaction.ac !== null) {
    without_reactive_context(() => {
      reaction.ac.abort(STALE_REACTION);
    });
    reaction.ac = null;
  }
  try {
    reaction.f |= REACTION_IS_UPDATING;
    var fn = (
      /** @type {Function} */
      reaction.fn
    );
    var result = fn();
    reaction.f |= REACTION_RAN;
    var deps = reaction.deps;
    var is_fork = current_batch?.is_fork;
    if (new_deps !== null) {
      var i;
      if (!is_fork) {
        remove_reactions(reaction, skipped_deps);
      }
      if (deps !== null && skipped_deps > 0) {
        deps.length = skipped_deps + new_deps.length;
        for (i = 0; i < new_deps.length; i++) {
          deps[skipped_deps + i] = new_deps[i];
        }
      } else {
        reaction.deps = deps = new_deps;
      }
      if (effect_tracking() && (reaction.f & CONNECTED) !== 0) {
        for (i = skipped_deps; i < deps.length; i++) {
          (deps[i].reactions ??= []).push(reaction);
        }
      }
    } else if (!is_fork && deps !== null && skipped_deps < deps.length) {
      remove_reactions(reaction, skipped_deps);
      deps.length = skipped_deps;
    }
    if (is_runes() && untracked_writes !== null && !untracking && deps !== null && (reaction.f & (DERIVED | MAYBE_DIRTY | DIRTY)) === 0) {
      for (i = 0; i < /** @type {Source[]} */
      untracked_writes.length; i++) {
        schedule_possible_effect_self_invalidation(
          untracked_writes[i],
          /** @type {Effect} */
          reaction
        );
      }
    }
    if (previous_reaction !== null && previous_reaction !== reaction) {
      read_version++;
      if (previous_reaction.deps !== null) {
        for (let i2 = 0; i2 < previous_skipped_deps; i2 += 1) {
          previous_reaction.deps[i2].rv = read_version;
        }
      }
      if (previous_deps !== null) {
        for (const dep of previous_deps) {
          dep.rv = read_version;
        }
      }
      if (untracked_writes !== null) {
        if (previous_untracked_writes === null) {
          previous_untracked_writes = untracked_writes;
        } else {
          previous_untracked_writes.push(.../** @type {Source[]} */
          untracked_writes);
        }
      }
    }
    if ((reaction.f & ERROR_VALUE) !== 0) {
      reaction.f ^= ERROR_VALUE;
    }
    return result;
  } catch (error) {
    return handle_error(error);
  } finally {
    reaction.f ^= REACTION_IS_UPDATING;
    new_deps = previous_deps;
    skipped_deps = previous_skipped_deps;
    untracked_writes = previous_untracked_writes;
    active_reaction = previous_reaction;
    current_sources = previous_sources;
    set_component_context(previous_component_context);
    untracking = previous_untracking;
    update_version = previous_update_version;
  }
}
function remove_reaction(signal, dependency) {
  let reactions = dependency.reactions;
  if (reactions !== null) {
    var index2 = index_of.call(reactions, signal);
    if (index2 !== -1) {
      var new_length = reactions.length - 1;
      if (new_length === 0) {
        reactions = dependency.reactions = null;
      } else {
        reactions[index2] = reactions[new_length];
        reactions.pop();
      }
    }
  }
  if (reactions === null && (dependency.f & DERIVED) !== 0 && // Destroying a child effect while updating a parent effect can cause a dependency to appear
  // to be unused, when in fact it is used by the currently-updating parent. Checking `new_deps`
  // allows us to skip the expensive work of disconnecting and immediately reconnecting it
  (new_deps === null || !includes.call(new_deps, dependency))) {
    var derived2 = (
      /** @type {Derived} */
      dependency
    );
    if ((derived2.f & CONNECTED) !== 0) {
      derived2.f ^= CONNECTED;
      derived2.f &= ~WAS_MARKED;
    }
    update_derived_status(derived2);
    freeze_derived_effects(derived2);
    remove_reactions(derived2, 0);
  }
}
function remove_reactions(signal, start_index) {
  var dependencies = signal.deps;
  if (dependencies === null) return;
  for (var i = start_index; i < dependencies.length; i++) {
    remove_reaction(signal, dependencies[i]);
  }
}
function update_effect(effect2) {
  var flags2 = effect2.f;
  if ((flags2 & DESTROYED) !== 0) {
    return;
  }
  set_signal_status(effect2, CLEAN);
  var previous_effect = active_effect;
  var was_updating_effect = is_updating_effect;
  active_effect = effect2;
  is_updating_effect = true;
  if (dev_fallback_default) {
    var previous_component_fn = dev_current_component_function;
    set_dev_current_component_function(effect2.component_function);
    var previous_stack = (
      /** @type {any} */
      dev_stack
    );
    set_dev_stack(effect2.dev_stack ?? dev_stack);
  }
  try {
    if ((flags2 & (BLOCK_EFFECT | MANAGED_EFFECT)) !== 0) {
      destroy_block_effect_children(effect2);
    } else {
      destroy_effect_children(effect2);
    }
    execute_effect_teardown(effect2);
    var teardown2 = update_reaction(effect2);
    effect2.teardown = typeof teardown2 === "function" ? teardown2 : null;
    effect2.wv = write_version;
    if (dev_fallback_default && tracing_mode_flag && (effect2.f & DIRTY) !== 0 && effect2.deps !== null) {
      for (var dep of effect2.deps) {
        if (dep.set_during_effect) {
          dep.wv = increment_write_version();
          dep.set_during_effect = false;
        }
      }
    }
  } finally {
    is_updating_effect = was_updating_effect;
    active_effect = previous_effect;
    if (dev_fallback_default) {
      set_dev_current_component_function(previous_component_fn);
      set_dev_stack(previous_stack);
    }
  }
}
async function tick() {
  if (async_mode_flag) {
    return new Promise((f) => {
      requestAnimationFrame(() => f());
      setTimeout(() => f());
    });
  }
  await Promise.resolve();
  flushSync();
}
function get2(signal) {
  var flags2 = signal.f;
  var is_derived = (flags2 & DERIVED) !== 0;
  captured_signals?.add(signal);
  if (active_reaction !== null && !untracking) {
    var destroyed = active_effect !== null && (active_effect.f & DESTROYED) !== 0;
    if (!destroyed && (current_sources === null || !includes.call(current_sources, signal))) {
      var deps = active_reaction.deps;
      if ((active_reaction.f & REACTION_IS_UPDATING) !== 0) {
        if (signal.rv < read_version) {
          signal.rv = read_version;
          if (new_deps === null && deps !== null && deps[skipped_deps] === signal) {
            skipped_deps++;
          } else if (new_deps === null) {
            new_deps = [signal];
          } else {
            new_deps.push(signal);
          }
        }
      } else {
        (active_reaction.deps ??= []).push(signal);
        var reactions = signal.reactions;
        if (reactions === null) {
          signal.reactions = [active_reaction];
        } else if (!includes.call(reactions, active_reaction)) {
          reactions.push(active_reaction);
        }
      }
    }
  }
  if (dev_fallback_default) {
    recent_async_deriveds.delete(signal);
    if (tracing_mode_flag && !untracking && tracing_expressions !== null && active_reaction !== null && tracing_expressions.reaction === active_reaction) {
      if (signal.trace) {
        signal.trace();
      } else {
        var trace2 = get_error("traced at");
        if (trace2) {
          var entry = tracing_expressions.entries.get(signal);
          if (entry === void 0) {
            entry = { traces: [] };
            tracing_expressions.entries.set(signal, entry);
          }
          var last = entry.traces[entry.traces.length - 1];
          if (trace2.stack !== last?.stack) {
            entry.traces.push(trace2);
          }
        }
      }
    }
  }
  if (is_destroying_effect && old_values.has(signal)) {
    return old_values.get(signal);
  }
  if (is_derived) {
    var derived2 = (
      /** @type {Derived} */
      signal
    );
    if (is_destroying_effect) {
      var value = derived2.v;
      if ((derived2.f & CLEAN) === 0 && derived2.reactions !== null || depends_on_old_values(derived2)) {
        value = execute_derived(derived2);
      }
      old_values.set(derived2, value);
      return value;
    }
    var should_connect = (derived2.f & CONNECTED) === 0 && !untracking && active_reaction !== null && (is_updating_effect || (active_reaction.f & CONNECTED) !== 0);
    var is_new = (derived2.f & REACTION_RAN) === 0;
    if (is_dirty(derived2)) {
      if (should_connect) {
        derived2.f |= CONNECTED;
      }
      update_derived(derived2);
    }
    if (should_connect && !is_new) {
      unfreeze_derived_effects(derived2);
      reconnect(derived2);
    }
  }
  if (batch_values?.has(signal)) {
    return batch_values.get(signal);
  }
  if ((signal.f & ERROR_VALUE) !== 0) {
    throw signal.v;
  }
  return signal.v;
}
function reconnect(derived2) {
  derived2.f |= CONNECTED;
  if (derived2.deps === null) return;
  for (const dep of derived2.deps) {
    (dep.reactions ??= []).push(derived2);
    if ((dep.f & DERIVED) !== 0 && (dep.f & CONNECTED) === 0) {
      unfreeze_derived_effects(
        /** @type {Derived} */
        dep
      );
      reconnect(
        /** @type {Derived} */
        dep
      );
    }
  }
}
function depends_on_old_values(derived2) {
  if (derived2.v === UNINITIALIZED) return true;
  if (derived2.deps === null) return false;
  for (const dep of derived2.deps) {
    if (old_values.has(dep)) {
      return true;
    }
    if ((dep.f & DERIVED) !== 0 && depends_on_old_values(
      /** @type {Derived} */
      dep
    )) {
      return true;
    }
  }
  return false;
}
function untrack(fn) {
  var previous_untracking = untracking;
  try {
    untracking = true;
    return fn();
  } finally {
    untracking = previous_untracking;
  }
}
function deep_read_state(value) {
  if (typeof value !== "object" || !value || value instanceof EventTarget) {
    return;
  }
  if (STATE_SYMBOL in value) {
    deep_read(value);
  } else if (!Array.isArray(value)) {
    for (let key2 in value) {
      const prop2 = value[key2];
      if (typeof prop2 === "object" && prop2 && STATE_SYMBOL in prop2) {
        deep_read(prop2);
      }
    }
  }
}
function deep_read(value, visited = /* @__PURE__ */ new Set()) {
  if (typeof value === "object" && value !== null && // We don't want to traverse DOM elements
  !(value instanceof EventTarget) && !visited.has(value)) {
    visited.add(value);
    if (value instanceof Date) {
      value.getTime();
    }
    for (let key2 in value) {
      try {
        deep_read(value[key2], visited);
      } catch (e) {
      }
    }
    const proto = get_prototype_of(value);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== Map.prototype && proto !== Set.prototype && proto !== Date.prototype) {
      const descriptors = get_descriptors(proto);
      for (let key2 in descriptors) {
        const get3 = descriptors[key2].get;
        if (get3) {
          try {
            get3.call(value);
          } catch (e) {
          }
        }
      }
    }
  }
}

}

{
// src/ui/svelte/svelte-31-src_utils.js
// node_modules/svelte/src/utils.js
var DOM_BOOLEAN_ATTRIBUTES = [
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "disabled",
  "formnovalidate",
  "indeterminate",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "seamless",
  "selected",
  "webkitdirectory",
  "defer",
  "disablepictureinpicture",
  "disableremoteplayback"
];
var DOM_PROPERTIES = [
  ...DOM_BOOLEAN_ATTRIBUTES,
  "formNoValidate",
  "isMap",
  "noModule",
  "playsInline",
  "readOnly",
  "value",
  "volume",
  "defaultValue",
  "defaultChecked",
  "srcObject",
  "noValidate",
  "allowFullscreen",
  "disablePictureInPicture",
  "disableRemotePlayback"
];
var PASSIVE_EVENTS = ["touchstart", "touchmove"];
function is_passive_event(name) {
  return PASSIVE_EVENTS.includes(name);
}
var STATE_CREATION_RUNES = (
  /** @type {const} */
  [
    "$state",
    "$state.raw",
    "$derived",
    "$derived.by"
  ]
);
var RUNES = (
  /** @type {const} */
  [
    ...STATE_CREATION_RUNES,
    "$state.eager",
    "$state.snapshot",
    "$props",
    "$props.id",
    "$bindable",
    "$effect",
    "$effect.pre",
    "$effect.tracking",
    "$effect.root",
    "$effect.pending",
    "$inspect",
    "$inspect().with",
    "$inspect.trace",
    "$host"
  ]
);

}

{
// src/ui/svelte/svelte-32-src_internal_client_dev_css.js
// node_modules/svelte/src/internal/client/dev/css.js
var all_styles = /* @__PURE__ */ new Map();
function register_style(hash2, style) {
  var styles = all_styles.get(hash2);
  if (!styles) {
    styles = /* @__PURE__ */ new Set();
    all_styles.set(hash2, styles);
  }
  styles.add(style);
}

}

{
// src/ui/svelte/svelte-33-src_internal_client_dom_elements_events.js
// node_modules/svelte/src/internal/client/dom/elements/events.js
var event_symbol = Symbol("events");
var all_registered_events = /* @__PURE__ */ new Set();
var root_event_handles = /* @__PURE__ */ new Set();
function delegated(event_name, element2, handler) {
  (element2[event_symbol] ??= {})[event_name] = handler;
}
function delegate(events) {
  for (var i = 0; i < events.length; i++) {
    all_registered_events.add(events[i]);
  }
  for (var fn of root_event_handles) {
    fn(events);
  }
}
var last_propagated_event = null;
function handle_event_propagation(event2) {
  var handler_element = this;
  var owner_document = (
    /** @type {Node} */
    handler_element.ownerDocument
  );
  var event_name = event2.type;
  var path = event2.composedPath?.() || [];
  var current_target = (
    /** @type {null | Element} */
    path[0] || event2.target
  );
  last_propagated_event = event2;
  var path_idx = 0;
  var handled_at = last_propagated_event === event2 && event2[event_symbol];
  if (handled_at) {
    var at_idx = path.indexOf(handled_at);
    if (at_idx !== -1 && (handler_element === document || handler_element === /** @type {any} */
    window)) {
      event2[event_symbol] = handler_element;
      return;
    }
    var handler_idx = path.indexOf(handler_element);
    if (handler_idx === -1) {
      return;
    }
    if (at_idx <= handler_idx) {
      path_idx = at_idx;
    }
  }
  current_target = /** @type {Element} */
  path[path_idx] || event2.target;
  if (current_target === handler_element) return;
  define_property(event2, "currentTarget", {
    configurable: true,
    get() {
      return current_target || owner_document;
    }
  });
  var previous_reaction = active_reaction;
  var previous_effect = active_effect;
  set_active_reaction(null);
  set_active_effect(null);
  try {
    var throw_error;
    var other_errors = [];
    while (current_target !== null) {
      var parent_element = current_target.assignedSlot || current_target.parentNode || /** @type {any} */
      current_target.host || null;
      try {
        var delegated2 = current_target[event_symbol]?.[event_name];
        if (delegated2 != null && (!/** @type {any} */
        current_target.disabled || // DOM could've been updated already by the time this is reached, so we check this as well
        // -> the target could not have been disabled because it emits the event in the first place
        event2.target === current_target)) {
          delegated2.call(current_target, event2);
        }
      } catch (error) {
        if (throw_error) {
          other_errors.push(error);
        } else {
          throw_error = error;
        }
      }
      if (event2.cancelBubble || parent_element === handler_element || parent_element === null) {
        break;
      }
      current_target = parent_element;
    }
    if (throw_error) {
      for (let error of other_errors) {
        queueMicrotask(() => {
          throw error;
        });
      }
      throw throw_error;
    }
  } finally {
    event2[event_symbol] = handler_element;
    delete event2.currentTarget;
    set_active_reaction(previous_reaction);
    set_active_effect(previous_effect);
  }
}

}

{
// src/ui/svelte/svelte-34-src_internal_client_dom_reconciler.js
// node_modules/svelte/src/internal/client/dom/reconciler.js
var policy = (
  // We gotta write it like this because after downleveling the pure comment may end up in the wrong location
  globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", {
    /** @param {string} html */
    createHTML: (html2) => {
      return html2;
    }
  })
);
function create_trusted_html(html2) {
  return (
    /** @type {string} */
    policy?.createHTML(html2) ?? html2
  );
}
function create_fragment_from_html(html2) {
  var elem = create_element("template");
  elem.innerHTML = create_trusted_html(html2.replaceAll("<!>", "<!---->"));
  return elem.content;
}

}

{
// src/ui/svelte/svelte-35-src_internal_client_dom_template.js
// node_modules/svelte/src/internal/client/dom/template.js
function assign_nodes(start, end) {
  var effect2 = (
    /** @type {Effect} */
    active_effect
  );
  if (effect2.nodes === null) {
    effect2.nodes = { start, end, a: null, t: null };
  }
}
// @__NO_SIDE_EFFECTS__
function from_html(content, flags2) {
  var is_fragment = (flags2 & TEMPLATE_FRAGMENT) !== 0;
  var use_import_node = (flags2 & TEMPLATE_USE_IMPORT_NODE) !== 0;
  var node;
  var has_start = !content.startsWith("<!>");
  return () => {
    if (hydrating) {
      assign_nodes(hydrate_node, null);
      return hydrate_node;
    }
    if (node === void 0) {
      node = create_fragment_from_html(has_start ? content : "<!>" + content);
      if (!is_fragment) node = /** @type {TemplateNode} */
      get_first_child(node);
    }
    var clone = (
      /** @type {TemplateNode} */
      use_import_node || is_firefox ? document.importNode(node, true) : node.cloneNode(true)
    );
    if (is_fragment) {
      var start = (
        /** @type {TemplateNode} */
        get_first_child(clone)
      );
      var end = (
        /** @type {TemplateNode} */
        clone.lastChild
      );
      assign_nodes(start, end);
    } else {
      assign_nodes(clone, clone);
    }
    return clone;
  };
}
function comment() {
  if (hydrating) {
    assign_nodes(hydrate_node, null);
    return hydrate_node;
  }
  var frag = document.createDocumentFragment();
  var start = document.createComment("");
  var anchor = create_text();
  frag.append(start, anchor);
  assign_nodes(start, anchor);
  return frag;
}
function append(anchor, dom) {
  if (hydrating) {
    var effect2 = (
      /** @type {Effect & { nodes: EffectNodes }} */
      active_effect
    );
    if ((effect2.f & REACTION_RAN) === 0 || effect2.nodes.end === null) {
      effect2.nodes.end = hydrate_node;
    }
    hydrate_next();
    return;
  }
  if (anchor === null) {
    return;
  }
  anchor.before(
    /** @type {Node} */
    dom
  );
}

}

{
// src/ui/svelte/svelte-36-src_internal_client_render.js
// node_modules/svelte/src/internal/client/render.js
var should_intro = true;
function set_text(text2, value) {
  var str = value == null ? "" : typeof value === "object" ? `${value}` : value;
  if (str !== (text2.__t ??= text2.nodeValue)) {
    text2.__t = str;
    text2.nodeValue = `${str}`;
  }
}
function mount(component2, options) {
  return _mount(component2, options);
}
function hydrate(component2, options) {
  init_operations();
  options.intro = options.intro ?? false;
  const target = options.target;
  const was_hydrating = hydrating;
  const previous_hydrate_node = hydrate_node;
  try {
    var anchor = get_first_child(target);
    while (anchor && (anchor.nodeType !== COMMENT_NODE || /** @type {Comment} */
    anchor.data !== HYDRATION_START)) {
      anchor = get_next_sibling(anchor);
    }
    if (!anchor) {
      throw HYDRATION_ERROR;
    }
    set_hydrating(true);
    set_hydrate_node(
      /** @type {Comment} */
      anchor
    );
    const instance = _mount(component2, { ...options, anchor });
    set_hydrating(false);
    return (
      /**  @type {Exports} */
      instance
    );
  } catch (error) {
    if (error instanceof Error && error.message.split("\n").some((line) => line.startsWith("https://svelte.dev/e/"))) {
      throw error;
    }
    if (error !== HYDRATION_ERROR) {
      console.warn("Failed to hydrate: ", error);
    }
    if (options.recover === false) {
      hydration_failed();
    }
    init_operations();
    clear_text_content(target);
    set_hydrating(false);
    return mount(component2, options);
  } finally {
    set_hydrating(was_hydrating);
    set_hydrate_node(previous_hydrate_node);
  }
}
var listeners = /* @__PURE__ */ new Map();
function _mount(Component, { target, anchor, props = {}, events, context, intro = true, transformError }) {
  init_operations();
  var component2 = void 0;
  var unmount2 = component_root(() => {
    var anchor_node = anchor ?? target.appendChild(create_text());
    boundary(
      /** @type {TemplateNode} */
      anchor_node,
      {
        pending: () => {
        }
      },
      (anchor_node2) => {
        push({});
        var ctx = (
          /** @type {ComponentContext} */
          component_context
        );
        if (context) ctx.c = context;
        if (events) {
          props.$$events = events;
        }
        if (hydrating) {
          assign_nodes(
            /** @type {TemplateNode} */
            anchor_node2,
            null
          );
        }
        should_intro = intro;
        component2 = Component(anchor_node2, props) || {};
        should_intro = true;
        if (hydrating) {
          active_effect.nodes.end = hydrate_node;
          if (hydrate_node === null || hydrate_node.nodeType !== COMMENT_NODE || /** @type {Comment} */
          hydrate_node.data !== HYDRATION_END) {
            hydration_mismatch();
            throw HYDRATION_ERROR;
          }
        }
        pop();
      },
      transformError
    );
    var registered_events = /* @__PURE__ */ new Set();
    var event_handle = (events2) => {
      for (var i = 0; i < events2.length; i++) {
        var event_name = events2[i];
        if (registered_events.has(event_name)) continue;
        registered_events.add(event_name);
        var passive2 = is_passive_event(event_name);
        for (const node of [target, document]) {
          var counts = listeners.get(node);
          if (counts === void 0) {
            counts = /* @__PURE__ */ new Map();
            listeners.set(node, counts);
          }
          var count = counts.get(event_name);
          if (count === void 0) {
            node.addEventListener(event_name, handle_event_propagation, { passive: passive2 });
            counts.set(event_name, 1);
          } else {
            counts.set(event_name, count + 1);
          }
        }
      }
    };
    event_handle(array_from(all_registered_events));
    root_event_handles.add(event_handle);
    return () => {
      for (var event_name of registered_events) {
        for (const node of [target, document]) {
          var counts = (
            /** @type {Map<string, number>} */
            listeners.get(node)
          );
          var count = (
            /** @type {number} */
            counts.get(event_name)
          );
          if (--count == 0) {
            node.removeEventListener(event_name, handle_event_propagation);
            counts.delete(event_name);
            if (counts.size === 0) {
              listeners.delete(node);
            }
          } else {
            counts.set(event_name, count);
          }
        }
      }
      root_event_handles.delete(event_handle);
      if (anchor_node !== anchor) {
        anchor_node.parentNode?.removeChild(anchor_node);
      }
    };
  });
  mounted_components.set(component2, unmount2);
  return component2;
}
var mounted_components = /* @__PURE__ */ new WeakMap();
function unmount(component2, options) {
  const fn = mounted_components.get(component2);
  if (fn) {
    mounted_components.delete(component2);
    return fn(options);
  }
  if (dev_fallback_default) {
    if (STATE_SYMBOL in component2) {
      state_proxy_unmount();
    } else {
      lifecycle_double_unmount();
    }
  }
  return Promise.resolve();
}

}

{
// src/ui/svelte/svelte-37-src_internal_client_dom_blocks_branches.js
// node_modules/svelte/src/internal/client/dom/blocks/branches.js
var BranchManager = class {
  /** @type {TemplateNode} */
  anchor;
  /** @type {Map<Batch, Key>} */
  #batches = /* @__PURE__ */ new Map();
  /**
   * Map of keys to effects that are currently rendered in the DOM.
   * These effects are visible and actively part of the document tree.
   * Example:
   * ```
   * {#if condition}
   * 	foo
   * {:else}
   * 	bar
   * {/if}
   * ```
   * Can result in the entries `true->Effect` and `false->Effect`
   * @type {Map<Key, Effect>}
   */
  #onscreen = /* @__PURE__ */ new Map();
  /**
   * Similar to #onscreen with respect to the keys, but contains branches that are not yet
   * in the DOM, because their insertion is deferred.
   * @type {Map<Key, Branch>}
   */
  #offscreen = /* @__PURE__ */ new Map();
  /**
   * Keys of effects that are currently outroing
   * @type {Set<Key>}
   */
  #outroing = /* @__PURE__ */ new Set();
  /**
   * Whether to pause (i.e. outro) on change, or destroy immediately.
   * This is necessary for `<svelte:element>`
   */
  #transition = true;
  /**
   * @param {TemplateNode} anchor
   * @param {boolean} transition
   */
  constructor(anchor, transition2 = true) {
    this.anchor = anchor;
    this.#transition = transition2;
  }
  /**
   * @param {Batch} batch
   */
  #commit = (batch) => {
    if (!this.#batches.has(batch)) return;
    var key2 = (
      /** @type {Key} */
      this.#batches.get(batch)
    );
    var onscreen = this.#onscreen.get(key2);
    if (onscreen) {
      resume_effect(onscreen);
      this.#outroing.delete(key2);
    } else {
      var offscreen = this.#offscreen.get(key2);
      if (offscreen) {
        this.#onscreen.set(key2, offscreen.effect);
        this.#offscreen.delete(key2);
        offscreen.fragment.lastChild.remove();
        this.anchor.before(offscreen.fragment);
        onscreen = offscreen.effect;
      }
    }
    for (const [b, k] of this.#batches) {
      this.#batches.delete(b);
      if (b === batch) {
        break;
      }
      const offscreen2 = this.#offscreen.get(k);
      if (offscreen2) {
        destroy_effect(offscreen2.effect);
        this.#offscreen.delete(k);
      }
    }
    for (const [k, effect2] of this.#onscreen) {
      if (k === key2 || this.#outroing.has(k)) continue;
      const on_destroy = () => {
        const keys = Array.from(this.#batches.values());
        if (keys.includes(k)) {
          var fragment = document.createDocumentFragment();
          move_effect(effect2, fragment);
          fragment.append(create_text());
          this.#offscreen.set(k, { effect: effect2, fragment });
        } else {
          destroy_effect(effect2);
        }
        this.#outroing.delete(k);
        this.#onscreen.delete(k);
      };
      if (this.#transition || !onscreen) {
        this.#outroing.add(k);
        pause_effect(effect2, on_destroy, false);
      } else {
        on_destroy();
      }
    }
  };
  /**
   * @param {Batch} batch
   */
  #discard = (batch) => {
    this.#batches.delete(batch);
    const keys = Array.from(this.#batches.values());
    for (const [k, branch2] of this.#offscreen) {
      if (!keys.includes(k)) {
        destroy_effect(branch2.effect);
        this.#offscreen.delete(k);
      }
    }
  };
  /**
   *
   * @param {any} key
   * @param {null | ((target: TemplateNode) => void)} fn
   */
  ensure(key2, fn) {
    var batch = (
      /** @type {Batch} */
      current_batch
    );
    var defer = should_defer_append();
    if (fn && !this.#onscreen.has(key2) && !this.#offscreen.has(key2)) {
      if (defer) {
        var fragment = document.createDocumentFragment();
        var target = create_text();
        fragment.append(target);
        this.#offscreen.set(key2, {
          effect: branch(() => fn(target)),
          fragment
        });
      } else {
        this.#onscreen.set(
          key2,
          branch(() => fn(this.anchor))
        );
      }
    }
    this.#batches.set(batch, key2);
    if (defer) {
      for (const [k, effect2] of this.#onscreen) {
        if (k === key2) {
          batch.unskip_effect(effect2);
        } else {
          batch.skip_effect(effect2);
        }
      }
      for (const [k, branch2] of this.#offscreen) {
        if (k === key2) {
          batch.unskip_effect(branch2.effect);
        } else {
          batch.skip_effect(branch2.effect);
        }
      }
      batch.oncommit(this.#commit);
      batch.ondiscard(this.#discard);
    } else {
      if (hydrating) {
        this.anchor = hydrate_node;
      }
      this.#commit(batch);
    }
  }
};

}

{
// src/ui/svelte/svelte-38-src_internal_client_dom_blocks_if.js
// node_modules/svelte/src/internal/client/dom/blocks/if.js
function if_block(node, fn, elseif = false) {
  var marker;
  if (hydrating) {
    marker = hydrate_node;
    hydrate_next();
  }
  var branches = new BranchManager(node);
  var flags2 = elseif ? EFFECT_TRANSPARENT : 0;
  function update_branch(key2, fn2) {
    if (hydrating) {
      var data = read_hydration_instruction(
        /** @type {TemplateNode} */
        marker
      );
      if (key2 !== parseInt(data.substring(1))) {
        var anchor = skip_nodes();
        set_hydrate_node(anchor);
        branches.anchor = anchor;
        set_hydrating(false);
        branches.ensure(key2, fn2);
        set_hydrating(true);
        return;
      }
    }
    branches.ensure(key2, fn2);
  }
  block(() => {
    var has_branch = false;
    fn((fn2, key2 = 0) => {
      has_branch = true;
      update_branch(key2, fn2);
    });
    if (!has_branch) {
      update_branch(-1, null);
    }
  }, flags2);
}

}

{
// src/ui/svelte/svelte-39-src_internal_client_dom_blocks_key.js
// node_modules/svelte/src/internal/client/dom/blocks/key.js
var NAN = Symbol("NaN");

}

{
// src/ui/svelte/svelte-40-src_internal_client_dom_blocks_each.js
// node_modules/svelte/src/internal/client/dom/blocks/each.js
function pause_effects(state2, to_destroy, controlled_anchor) {
  var transitions = [];
  var length = to_destroy.length;
  var group;
  var remaining = to_destroy.length;
  for (var i = 0; i < length; i++) {
    let effect2 = to_destroy[i];
    pause_effect(
      effect2,
      () => {
        if (group) {
          group.pending.delete(effect2);
          group.done.add(effect2);
          if (group.pending.size === 0) {
            var groups = (
              /** @type {Set<EachOutroGroup>} */
              state2.outrogroups
            );
            destroy_effects(state2, array_from(group.done));
            groups.delete(group);
            if (groups.size === 0) {
              state2.outrogroups = null;
            }
          }
        } else {
          remaining -= 1;
        }
      },
      false
    );
  }
  if (remaining === 0) {
    var fast_path = transitions.length === 0 && controlled_anchor !== null;
    if (fast_path) {
      var anchor = (
        /** @type {Element} */
        controlled_anchor
      );
      var parent_node = (
        /** @type {Element} */
        anchor.parentNode
      );
      clear_text_content(parent_node);
      parent_node.append(anchor);
      state2.items.clear();
    }
    destroy_effects(state2, to_destroy, !fast_path);
  } else {
    group = {
      pending: new Set(to_destroy),
      done: /* @__PURE__ */ new Set()
    };
    (state2.outrogroups ??= /* @__PURE__ */ new Set()).add(group);
  }
}
function destroy_effects(state2, to_destroy, remove_dom = true) {
  var preserved_effects;
  if (state2.pending.size > 0) {
    preserved_effects = /* @__PURE__ */ new Set();
    for (const keys of state2.pending.values()) {
      for (const key2 of keys) {
        preserved_effects.add(
          /** @type {EachItem} */
          state2.items.get(key2).e
        );
      }
    }
  }
  for (var i = 0; i < to_destroy.length; i++) {
    var e = to_destroy[i];
    if (preserved_effects?.has(e)) {
      e.f |= EFFECT_OFFSCREEN;
      const fragment = document.createDocumentFragment();
      move_effect(e, fragment);
    } else {
      destroy_effect(to_destroy[i], remove_dom);
    }
  }
}
var offscreen_anchor;
function each(node, flags2, get_collection, get_key, render_fn, fallback_fn = null) {
  var anchor = node;
  var items = /* @__PURE__ */ new Map();
  var is_controlled = (flags2 & EACH_IS_CONTROLLED) !== 0;
  if (is_controlled) {
    var parent_node = (
      /** @type {Element} */
      node
    );
    anchor = hydrating ? set_hydrate_node(get_first_child(parent_node)) : parent_node.appendChild(create_text());
  }
  if (hydrating) {
    hydrate_next();
  }
  var fallback2 = null;
  var each_array = derived_safe_equal(() => {
    var collection = get_collection();
    return is_array(collection) ? collection : collection == null ? [] : array_from(collection);
  });
  var array;
  var pending2 = /* @__PURE__ */ new Map();
  var first_run = true;
  function commit(batch) {
    if ((state2.effect.f & DESTROYED) !== 0) {
      return;
    }
    state2.pending.delete(batch);
    state2.fallback = fallback2;
    reconcile(state2, array, anchor, flags2, get_key);
    if (fallback2 !== null) {
      if (array.length === 0) {
        if ((fallback2.f & EFFECT_OFFSCREEN) === 0) {
          resume_effect(fallback2);
        } else {
          fallback2.f ^= EFFECT_OFFSCREEN;
          move(fallback2, null, anchor);
        }
      } else {
        pause_effect(fallback2, () => {
          fallback2 = null;
        });
      }
    }
  }
  function discard(batch) {
    state2.pending.delete(batch);
  }
  var effect2 = block(() => {
    array = /** @type {V[]} */
    get2(each_array);
    var length = array.length;
    let mismatch = false;
    if (hydrating) {
      var is_else = read_hydration_instruction(anchor) === HYDRATION_START_ELSE;
      if (is_else !== (length === 0)) {
        anchor = skip_nodes();
        set_hydrate_node(anchor);
        set_hydrating(false);
        mismatch = true;
      }
    }
    var keys = /* @__PURE__ */ new Set();
    var batch = (
      /** @type {Batch} */
      current_batch
    );
    var defer = should_defer_append();
    for (var index2 = 0; index2 < length; index2 += 1) {
      if (hydrating && hydrate_node.nodeType === COMMENT_NODE && /** @type {Comment} */
      hydrate_node.data === HYDRATION_END) {
        anchor = /** @type {Comment} */
        hydrate_node;
        mismatch = true;
        set_hydrating(false);
      }
      var value = array[index2];
      var key2 = get_key(value, index2);
      if (dev_fallback_default) {
        var key_again = get_key(value, index2);
        if (key2 !== key_again) {
          each_key_volatile(String(index2), String(key2), String(key_again));
        }
      }
      var item = first_run ? null : items.get(key2);
      if (item) {
        if (item.v) internal_set(item.v, value);
        if (item.i) internal_set(item.i, index2);
        if (defer) {
          batch.unskip_effect(item.e);
        }
      } else {
        item = create_item(
          items,
          first_run ? anchor : offscreen_anchor ??= create_text(),
          value,
          key2,
          index2,
          render_fn,
          flags2,
          get_collection
        );
        if (!first_run) {
          item.e.f |= EFFECT_OFFSCREEN;
        }
        items.set(key2, item);
      }
      keys.add(key2);
    }
    if (length === 0 && fallback_fn && !fallback2) {
      if (first_run) {
        fallback2 = branch(() => fallback_fn(anchor));
      } else {
        fallback2 = branch(() => fallback_fn(offscreen_anchor ??= create_text()));
        fallback2.f |= EFFECT_OFFSCREEN;
      }
    }
    if (length > keys.size) {
      if (dev_fallback_default) {
        validate_each_keys(array, get_key);
      } else {
        each_key_duplicate("", "", "");
      }
    }
    if (hydrating && length > 0) {
      set_hydrate_node(skip_nodes());
    }
    if (!first_run) {
      pending2.set(batch, keys);
      if (defer) {
        for (const [key3, item2] of items) {
          if (!keys.has(key3)) {
            batch.skip_effect(item2.e);
          }
        }
        batch.oncommit(commit);
        batch.ondiscard(discard);
      } else {
        commit(batch);
      }
    }
    if (mismatch) {
      set_hydrating(true);
    }
    get2(each_array);
  });
  var state2 = { effect: effect2, flags: flags2, items, pending: pending2, outrogroups: null, fallback: fallback2 };
  first_run = false;
  if (hydrating) {
    anchor = hydrate_node;
  }
}
function skip_to_branch(effect2) {
  while (effect2 !== null && (effect2.f & BRANCH_EFFECT) === 0) {
    effect2 = effect2.next;
  }
  return effect2;
}
function reconcile(state2, array, anchor, flags2, get_key) {
  var is_animated = (flags2 & EACH_IS_ANIMATED) !== 0;
  var length = array.length;
  var items = state2.items;
  var current = skip_to_branch(state2.effect.first);
  var seen;
  var prev = null;
  var to_animate;
  var matched = [];
  var stashed = [];
  var value;
  var key2;
  var effect2;
  var i;
  if (is_animated) {
    for (i = 0; i < length; i += 1) {
      value = array[i];
      key2 = get_key(value, i);
      effect2 = /** @type {EachItem} */
      items.get(key2).e;
      if ((effect2.f & EFFECT_OFFSCREEN) === 0) {
        effect2.nodes?.a?.measure();
        (to_animate ??= /* @__PURE__ */ new Set()).add(effect2);
      }
    }
  }
  for (i = 0; i < length; i += 1) {
    value = array[i];
    key2 = get_key(value, i);
    effect2 = /** @type {EachItem} */
    items.get(key2).e;
    if (state2.outrogroups !== null) {
      for (const group of state2.outrogroups) {
        group.pending.delete(effect2);
        group.done.delete(effect2);
      }
    }
    if ((effect2.f & EFFECT_OFFSCREEN) !== 0) {
      effect2.f ^= EFFECT_OFFSCREEN;
      if (effect2 === current) {
        move(effect2, null, anchor);
      } else {
        var next2 = prev ? prev.next : current;
        if (effect2 === state2.effect.last) {
          state2.effect.last = effect2.prev;
        }
        if (effect2.prev) effect2.prev.next = effect2.next;
        if (effect2.next) effect2.next.prev = effect2.prev;
        link(state2, prev, effect2);
        link(state2, effect2, next2);
        move(effect2, next2, anchor);
        prev = effect2;
        matched = [];
        stashed = [];
        current = skip_to_branch(prev.next);
        continue;
      }
    }
    if ((effect2.f & INERT) !== 0) {
      resume_effect(effect2);
      if (is_animated) {
        effect2.nodes?.a?.unfix();
        (to_animate ??= /* @__PURE__ */ new Set()).delete(effect2);
      }
    }
    if (effect2 !== current) {
      if (seen !== void 0 && seen.has(effect2)) {
        if (matched.length < stashed.length) {
          var start = stashed[0];
          var j;
          prev = start.prev;
          var a = matched[0];
          var b = matched[matched.length - 1];
          for (j = 0; j < matched.length; j += 1) {
            move(matched[j], start, anchor);
          }
          for (j = 0; j < stashed.length; j += 1) {
            seen.delete(stashed[j]);
          }
          link(state2, a.prev, b.next);
          link(state2, prev, a);
          link(state2, b, start);
          current = start;
          prev = b;
          i -= 1;
          matched = [];
          stashed = [];
        } else {
          seen.delete(effect2);
          move(effect2, current, anchor);
          link(state2, effect2.prev, effect2.next);
          link(state2, effect2, prev === null ? state2.effect.first : prev.next);
          link(state2, prev, effect2);
          prev = effect2;
        }
        continue;
      }
      matched = [];
      stashed = [];
      while (current !== null && current !== effect2) {
        (seen ??= /* @__PURE__ */ new Set()).add(current);
        stashed.push(current);
        current = skip_to_branch(current.next);
      }
      if (current === null) {
        continue;
      }
    }
    if ((effect2.f & EFFECT_OFFSCREEN) === 0) {
      matched.push(effect2);
    }
    prev = effect2;
    current = skip_to_branch(effect2.next);
  }
  if (state2.outrogroups !== null) {
    for (const group of state2.outrogroups) {
      if (group.pending.size === 0) {
        destroy_effects(state2, array_from(group.done));
        state2.outrogroups?.delete(group);
      }
    }
    if (state2.outrogroups.size === 0) {
      state2.outrogroups = null;
    }
  }
  if (current !== null || seen !== void 0) {
    var to_destroy = [];
    if (seen !== void 0) {
      for (effect2 of seen) {
        if ((effect2.f & INERT) === 0) {
          to_destroy.push(effect2);
        }
      }
    }
    while (current !== null) {
      if ((current.f & INERT) === 0 && current !== state2.fallback) {
        to_destroy.push(current);
      }
      current = skip_to_branch(current.next);
    }
    var destroy_length = to_destroy.length;
    if (destroy_length > 0) {
      var controlled_anchor = (flags2 & EACH_IS_CONTROLLED) !== 0 && length === 0 ? anchor : null;
      if (is_animated) {
        for (i = 0; i < destroy_length; i += 1) {
          to_destroy[i].nodes?.a?.measure();
        }
        for (i = 0; i < destroy_length; i += 1) {
          to_destroy[i].nodes?.a?.fix();
        }
      }
      pause_effects(state2, to_destroy, controlled_anchor);
    }
  }
  if (is_animated) {
    queue_micro_task(() => {
      if (to_animate === void 0) return;
      for (effect2 of to_animate) {
        effect2.nodes?.a?.apply();
      }
    });
  }
}
function create_item(items, anchor, value, key2, index2, render_fn, flags2, get_collection) {
  var v = (flags2 & EACH_ITEM_REACTIVE) !== 0 ? (flags2 & EACH_ITEM_IMMUTABLE) === 0 ? mutable_source(value, false, false) : source(value) : null;
  var i = (flags2 & EACH_INDEX_REACTIVE) !== 0 ? source(index2) : null;
  if (dev_fallback_default && v) {
    v.trace = () => {
      get_collection()[i?.v ?? index2];
    };
  }
  return {
    v,
    i,
    e: branch(() => {
      render_fn(anchor, v ?? value, i ?? index2, get_collection);
      return () => {
        items.delete(key2);
      };
    })
  };
}
function move(effect2, next2, anchor) {
  if (!effect2.nodes) return;
  var node = effect2.nodes.start;
  var end = effect2.nodes.end;
  var dest = next2 && (next2.f & EFFECT_OFFSCREEN) === 0 ? (
    /** @type {EffectNodes} */
    next2.nodes.start
  ) : anchor;
  while (node !== null) {
    var next_node = (
      /** @type {TemplateNode} */
      get_next_sibling(node)
    );
    dest.before(node);
    if (node === end) {
      return;
    }
    node = next_node;
  }
}
function link(state2, prev, next2) {
  if (prev === null) {
    state2.effect.first = next2;
  } else {
    prev.next = next2;
  }
  if (next2 === null) {
    state2.effect.last = prev;
  } else {
    next2.prev = prev;
  }
}
function validate_each_keys(array, key_fn) {
  const keys = /* @__PURE__ */ new Map();
  const length = array.length;
  for (let i = 0; i < length; i++) {
    const key2 = key_fn(array[i], i);
    if (keys.has(key2)) {
      const a = String(keys.get(key2));
      const b = String(i);
      let k = String(key2);
      if (k.startsWith("[object ")) k = null;
      each_key_duplicate(a, b, k);
    }
    keys.set(key2, i);
  }
}

}

{
// src/ui/svelte/svelte-41-src_internal_client_dom_css.js
// node_modules/svelte/src/internal/client/dom/css.js
function append_styles(anchor, css) {
  effect(() => {
    var root2 = anchor.getRootNode();
    var target = (
      /** @type {ShadowRoot} */
      root2.host ? (
        /** @type {ShadowRoot} */
        root2
      ) : (
        /** @type {Document} */
        root2.head ?? /** @type {Document} */
        root2.ownerDocument.head
      )
    );
    if (!target.querySelector("#" + css.hash)) {
      const style = create_element("style");
      style.id = css.hash;
      style.textContent = css.code;
      target.appendChild(style);
      if (dev_fallback_default) {
        register_style(css.hash, style);
      }
    }
  });
}

}

{
// src/ui/svelte/svelte-42-src_internal_client_dom_elements_actions.js
// node_modules/svelte/src/internal/client/dom/elements/actions.js
function action(dom, action2, get_value) {
  effect(() => {
    var payload = untrack(() => action2(dom, get_value?.()) || {});
    if (get_value && payload?.update) {
      var inited = false;
      var prev = (
        /** @type {any} */
        {}
      );
      render_effect(() => {
        var value = get_value();
        deep_read_state(value);
        if (inited && safe_not_equal(prev, value)) {
          prev = value;
          payload.update(value);
        }
      });
      inited = true;
    }
    if (payload?.destroy) {
      return () => (
        /** @type {Function} */
        payload.destroy()
      );
    }
  });
}

// node_modules/clsx/dist/clsx.mjs
function r(e) {
  var t, f, n = "";
  if ("string" == typeof e || "number" == typeof e) n += e;
  else if ("object" == typeof e) if (Array.isArray(e)) {
    var o = e.length;
    for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
  } else for (f in e) e[f] && (n && (n += " "), n += f);
  return n;
}
function clsx() {
  for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
  return n;
}

}

{
// src/ui/svelte/svelte-43-src_internal_shared_attributes.js
// node_modules/svelte/src/internal/shared/attributes.js
function clsx2(value) {
  if (typeof value === "object") {
    return clsx(value);
  } else {
    return value ?? "";
  }
}
var whitespace = [..." 	\n\r\f\xA0\v\uFEFF"];
function to_class(value, hash2, directives) {
  var classname = value == null ? "" : "" + value;
  if (hash2) {
    classname = classname ? classname + " " + hash2 : hash2;
  }
  if (directives) {
    for (var key2 of Object.keys(directives)) {
      if (directives[key2]) {
        classname = classname ? classname + " " + key2 : key2;
      } else if (classname.length) {
        var len = key2.length;
        var a = 0;
        while ((a = classname.indexOf(key2, a)) >= 0) {
          var b = a + len;
          if ((a === 0 || whitespace.includes(classname[a - 1])) && (b === classname.length || whitespace.includes(classname[b]))) {
            classname = (a === 0 ? "" : classname.substring(0, a)) + classname.substring(b + 1);
          } else {
            a = b;
          }
        }
      }
    }
  }
  return classname === "" ? null : classname;
}

}

{
// src/ui/svelte/svelte-44-src_internal_client_dom_elements_class.js
// node_modules/svelte/src/internal/client/dom/elements/class.js
function set_class(dom, is_html, value, hash2, prev_classes, next_classes) {
  var prev = dom.__className;
  if (hydrating || prev !== value || prev === void 0) {
    var next_class_name = to_class(value, hash2, next_classes);
    if (!hydrating || next_class_name !== dom.getAttribute("class")) {
      if (next_class_name == null) {
        dom.removeAttribute("class");
      } else if (is_html) {
        dom.className = next_class_name;
      } else {
        dom.setAttribute("class", next_class_name);
      }
    }
    dom.__className = value;
  } else if (next_classes && prev_classes !== next_classes) {
    for (var key2 in next_classes) {
      var is_present = !!next_classes[key2];
      if (prev_classes == null || is_present !== !!prev_classes[key2]) {
        dom.classList.toggle(key2, is_present);
      }
    }
  }
  return next_classes;
}

}

{
// src/ui/svelte/svelte-45-src_internal_client_dom_elements_attributes.js
// node_modules/svelte/src/internal/client/dom/elements/attributes.js
var CLASS = Symbol("class");
var STYLE = Symbol("style");
var IS_CUSTOM_ELEMENT = Symbol("is custom element");
var IS_HTML = Symbol("is html");
var LINK_TAG = IS_XHTML ? "link" : "LINK";
function set_attribute2(element2, attribute, value, skip_warning) {
  var attributes = get_attributes(element2);
  if (hydrating) {
    attributes[attribute] = element2.getAttribute(attribute);
    if (attribute === "src" || attribute === "srcset" || attribute === "href" && element2.nodeName === LINK_TAG) {
      if (!skip_warning) {
        check_src_in_dev_hydration(element2, attribute, value ?? "");
      }
      return;
    }
  }
  if (attributes[attribute] === (attributes[attribute] = value)) return;
  if (attribute === "loading") {
    element2[LOADING_ATTR_SYMBOL] = value;
  }
  if (value == null) {
    element2.removeAttribute(attribute);
  } else if (typeof value !== "string" && get_setters(element2).includes(attribute)) {
    element2[attribute] = value;
  } else {
    element2.setAttribute(attribute, value);
  }
}
function get_attributes(element2) {
  return (
    /** @type {Record<string | symbol, unknown>} **/
    // @ts-expect-error
    element2.__attributes ??= {
      [IS_CUSTOM_ELEMENT]: element2.nodeName.includes("-"),
      [IS_HTML]: element2.namespaceURI === NAMESPACE_HTML
    }
  );
}
var setters_cache = /* @__PURE__ */ new Map();
function get_setters(element2) {
  var cache_key = element2.getAttribute("is") || element2.nodeName;
  var setters = setters_cache.get(cache_key);
  if (setters) return setters;
  setters_cache.set(cache_key, setters = []);
  var descriptors;
  var proto = element2;
  var element_proto = Element.prototype;
  while (element_proto !== proto) {
    descriptors = get_descriptors(proto);
    for (var key2 in descriptors) {
      if (descriptors[key2].set) {
        setters.push(key2);
      }
    }
    proto = get_prototype_of(proto);
  }
  return setters;
}
function check_src_in_dev_hydration(element2, attribute, value) {
  if (!dev_fallback_default) return;
  if (attribute === "srcset" && srcset_url_equal(element2, value)) return;
  if (src_url_equal(element2.getAttribute(attribute) ?? "", value)) return;
  hydration_attribute_changed(
    attribute,
    element2.outerHTML.replace(element2.innerHTML, element2.innerHTML && "..."),
    String(value)
  );
}
function src_url_equal(element_src, url) {
  if (element_src === url) return true;
  return new URL(element_src, document.baseURI).href === new URL(url, document.baseURI).href;
}
function split_srcset(srcset) {
  return srcset.split(",").map((src) => src.trim().split(" ").filter(Boolean));
}
function srcset_url_equal(element2, srcset) {
  var element_urls = split_srcset(element2.srcset);
  var urls = split_srcset(srcset);
  return urls.length === element_urls.length && urls.every(
    ([url, width], i) => width === element_urls[i][1] && // We need to test both ways because Vite will create an a full URL with
    // `new URL(asset, import.meta.url).href` for the client when `base: './'`, and the
    // relative URLs inside srcset are not automatically resolved to absolute URLs by
    // browsers (in contrast to img.src). This means both SSR and DOM code could
    // contain relative or absolute URLs.
    (src_url_equal(element_urls[i][0], url) || src_url_equal(url, element_urls[i][0]))
  );
}

}

{
// src/ui/svelte/svelte-46-src_internal_client_dom_elements_bindings_input.js
// node_modules/svelte/src/internal/client/dom/elements/bindings/input.js
function bind_value(input, get3, set2 = get3) {
  var batches2 = /* @__PURE__ */ new WeakSet();
  listen_to_event_and_reset_event(input, "input", async (is_reset) => {
    if (dev_fallback_default && input.type === "checkbox") {
      bind_invalid_checkbox_value();
    }
    var value = is_reset ? input.defaultValue : input.value;
    value = is_numberlike_input(input) ? to_number(value) : value;
    set2(value);
    if (current_batch !== null) {
      batches2.add(current_batch);
    }
    await tick();
    if (value !== (value = get3())) {
      var start = input.selectionStart;
      var end = input.selectionEnd;
      var length = input.value.length;
      input.value = value ?? "";
      if (end !== null) {
        var new_length = input.value.length;
        if (start === end && end === length && new_length > length) {
          input.selectionStart = new_length;
          input.selectionEnd = new_length;
        } else {
          input.selectionStart = start;
          input.selectionEnd = Math.min(end, new_length);
        }
      }
    }
  });
  if (
    // If we are hydrating and the value has since changed,
    // then use the updated value from the input instead.
    hydrating && input.defaultValue !== input.value || // If defaultValue is set, then value == defaultValue
    // TODO Svelte 6: remove input.value check and set to empty string?
    untrack(get3) == null && input.value
  ) {
    set2(is_numberlike_input(input) ? to_number(input.value) : input.value);
    if (current_batch !== null) {
      batches2.add(current_batch);
    }
  }
  render_effect(() => {
    if (dev_fallback_default && input.type === "checkbox") {
      bind_invalid_checkbox_value();
    }
    var value = get3();
    if (input === document.activeElement) {
      var batch = (
        /** @type {Batch} */
        async_mode_flag ? previous_batch : current_batch
      );
      if (batches2.has(batch)) {
        return;
      }
    }
    if (is_numberlike_input(input) && value === to_number(input.value)) {
      return;
    }
    if (input.type === "date" && !value && !input.value) {
      return;
    }
    if (value !== input.value) {
      input.value = value ?? "";
    }
  });
}
function is_numberlike_input(input) {
  var type = input.type;
  return type === "number" || type === "range";
}
function to_number(value) {
  return value === "" ? null : +value;
}

}

{
// src/ui/svelte/svelte-47-src_internal_client_dom_elements_bindings_this.js
// node_modules/svelte/src/internal/client/dom/elements/bindings/this.js
function is_bound_this(bound_value, element_or_component) {
  return bound_value === element_or_component || bound_value?.[STATE_SYMBOL] === element_or_component;
}
function bind_this(element_or_component = {}, update2, get_value, get_parts) {
  var component_effect = (
    /** @type {ComponentContext} */
    component_context.r
  );
  var parent = (
    /** @type {Effect} */
    active_effect
  );
  effect(() => {
    var old_parts;
    var parts;
    render_effect(() => {
      old_parts = parts;
      parts = get_parts?.() || [];
      untrack(() => {
        if (element_or_component !== get_value(...parts)) {
          update2(element_or_component, ...parts);
          if (old_parts && is_bound_this(get_value(...old_parts), element_or_component)) {
            update2(null, ...old_parts);
          }
        }
      });
    });
    return () => {
      let p = parent;
      while (p !== component_effect && p.parent !== null && p.parent.f & DESTROYING) {
        p = p.parent;
      }
      const teardown2 = () => {
        if (parts && is_bound_this(get_value(...parts), element_or_component)) {
          update2(null, ...parts);
        }
      };
      const original_teardown = p.teardown;
      p.teardown = () => {
        teardown2();
        original_teardown?.();
      };
    };
  });
  return element_or_component;
}

}

{
// src/ui/svelte/svelte-48-src_legacy_legacy-client.js
// node_modules/svelte/src/legacy/legacy-client.js
function createClassComponent(options) {
  return new Svelte4Component(options);
}
var Svelte4Component = class {
  /** @type {any} */
  #events;
  /** @type {Record<string, any>} */
  #instance;
  /**
   * @param {ComponentConstructorOptions & {
   *  component: any;
   * }} options
   */
  constructor(options) {
    var sources = /* @__PURE__ */ new Map();
    var add_source = (key2, value) => {
      var s = mutable_source(value, false, false);
      sources.set(key2, s);
      return s;
    };
    const props = new Proxy(
      { ...options.props || {}, $$events: {} },
      {
        get(target, prop2) {
          return get2(sources.get(prop2) ?? add_source(prop2, Reflect.get(target, prop2)));
        },
        has(target, prop2) {
          if (prop2 === LEGACY_PROPS) return true;
          get2(sources.get(prop2) ?? add_source(prop2, Reflect.get(target, prop2)));
          return Reflect.has(target, prop2);
        },
        set(target, prop2, value) {
          set(sources.get(prop2) ?? add_source(prop2, value), value);
          return Reflect.set(target, prop2, value);
        }
      }
    );
    this.#instance = (options.hydrate ? hydrate : mount)(options.component, {
      target: options.target,
      anchor: options.anchor,
      props,
      context: options.context,
      intro: options.intro ?? false,
      recover: options.recover,
      transformError: options.transformError
    });
    if (!async_mode_flag && (!options?.props?.$$host || options.sync === false)) {
      flushSync();
    }
    this.#events = props.$$events;
    for (const key2 of Object.keys(this.#instance)) {
      if (key2 === "$set" || key2 === "$destroy" || key2 === "$on") continue;
      define_property(this, key2, {
        get() {
          return this.#instance[key2];
        },
        /** @param {any} value */
        set(value) {
          this.#instance[key2] = value;
        },
        enumerable: true
      });
    }
    this.#instance.$set = /** @param {Record<string, any>} next */
    (next2) => {
      Object.assign(props, next2);
    };
    this.#instance.$destroy = () => {
      unmount(this.#instance);
    };
  }
  /** @param {Record<string, any>} props */
  $set(props) {
    this.#instance.$set(props);
  }
  /**
   * @param {string} event
   * @param {(...args: any[]) => any} callback
   * @returns {any}
   */
  $on(event2, callback) {
    this.#events[event2] = this.#events[event2] || [];
    const cb = (...args) => callback.call(this, ...args);
    this.#events[event2].push(cb);
    return () => {
      this.#events[event2] = this.#events[event2].filter(
        /** @param {any} fn */
        (fn) => fn !== cb
      );
    };
  }
  $destroy() {
    this.#instance.$destroy();
  }
};

}

{
// src/ui/svelte/svelte-49-src_internal_client_dom_elements_custom-element.js
// node_modules/svelte/src/internal/client/dom/elements/custom-element.js
var SvelteElement;
if (typeof HTMLElement === "function") {
  SvelteElement = class extends HTMLElement {
    /** The Svelte component constructor */
    $$ctor;
    /** Slots */
    $$s;
    /** @type {any} The Svelte component instance */
    $$c;
    /** Whether or not the custom element is connected */
    $$cn = false;
    /** @type {Record<string, any>} Component props data */
    $$d = {};
    /** `true` if currently in the process of reflecting component props back to attributes */
    $$r = false;
    /** @type {Record<string, CustomElementPropDefinition>} Props definition (name, reflected, type etc) */
    $$p_d = {};
    /** @type {Record<string, EventListenerOrEventListenerObject[]>} Event listeners */
    $$l = {};
    /** @type {Map<EventListenerOrEventListenerObject, Function>} Event listener unsubscribe functions */
    $$l_u = /* @__PURE__ */ new Map();
    /** @type {any} The managed render effect for reflecting attributes */
    $$me;
    /** @type {ShadowRoot | null} The ShadowRoot of the custom element */
    $$shadowRoot = null;
    /**
     * @param {*} $$componentCtor
     * @param {*} $$slots
     * @param {ShadowRootInit | undefined} shadow_root_init
     */
    constructor($$componentCtor, $$slots, shadow_root_init) {
      super();
      this.$$ctor = $$componentCtor;
      this.$$s = $$slots;
      if (shadow_root_init) {
        this.$$shadowRoot = this.attachShadow(shadow_root_init);
      }
    }
    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} listener
     * @param {boolean | AddEventListenerOptions} [options]
     */
    addEventListener(type, listener, options) {
      this.$$l[type] = this.$$l[type] || [];
      this.$$l[type].push(listener);
      if (this.$$c) {
        const unsub = this.$$c.$on(type, listener);
        this.$$l_u.set(listener, unsub);
      }
      super.addEventListener(type, listener, options);
    }
    /**
     * @param {string} type
     * @param {EventListenerOrEventListenerObject} listener
     * @param {boolean | AddEventListenerOptions} [options]
     */
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, options);
      if (this.$$c) {
        const unsub = this.$$l_u.get(listener);
        if (unsub) {
          unsub();
          this.$$l_u.delete(listener);
        }
      }
    }
    async connectedCallback() {
      this.$$cn = true;
      if (!this.$$c) {
        let create_slot = function(name) {
          return (anchor) => {
            const slot2 = create_element("slot");
            if (name !== "default") slot2.name = name;
            append(anchor, slot2);
          };
        };
        await Promise.resolve();
        if (!this.$$cn || this.$$c) {
          return;
        }
        const $$slots = {};
        const existing_slots = get_custom_elements_slots(this);
        for (const name of this.$$s) {
          if (name in existing_slots) {
            if (name === "default" && !this.$$d.children) {
              this.$$d.children = create_slot(name);
              $$slots.default = true;
            } else {
              $$slots[name] = create_slot(name);
            }
          }
        }
        for (const attribute of this.attributes) {
          const name = this.$$g_p(attribute.name);
          if (!(name in this.$$d)) {
            this.$$d[name] = get_custom_element_value(name, attribute.value, this.$$p_d, "toProp");
          }
        }
        for (const key2 in this.$$p_d) {
          if (!(key2 in this.$$d) && this[key2] !== void 0) {
            this.$$d[key2] = this[key2];
            delete this[key2];
          }
        }
        this.$$c = createClassComponent({
          component: this.$$ctor,
          target: this.$$shadowRoot || this,
          props: {
            ...this.$$d,
            $$slots,
            $$host: this
          }
        });
        this.$$me = effect_root(() => {
          render_effect(() => {
            this.$$r = true;
            for (const key2 of object_keys(this.$$c)) {
              if (!this.$$p_d[key2]?.reflect) continue;
              this.$$d[key2] = this.$$c[key2];
              const attribute_value = get_custom_element_value(
                key2,
                this.$$d[key2],
                this.$$p_d,
                "toAttribute"
              );
              if (attribute_value == null) {
                this.removeAttribute(this.$$p_d[key2].attribute || key2);
              } else {
                this.setAttribute(this.$$p_d[key2].attribute || key2, attribute_value);
              }
            }
            this.$$r = false;
          });
        });
        for (const type in this.$$l) {
          for (const listener of this.$$l[type]) {
            const unsub = this.$$c.$on(type, listener);
            this.$$l_u.set(listener, unsub);
          }
        }
        this.$$l = {};
      }
    }
    // We don't need this when working within Svelte code, but for compatibility of people using this outside of Svelte
    // and setting attributes through setAttribute etc, this is helpful
    /**
     * @param {string} attr
     * @param {string} _oldValue
     * @param {string} newValue
     */
    attributeChangedCallback(attr2, _oldValue, newValue) {
      if (this.$$r) return;
      attr2 = this.$$g_p(attr2);
      this.$$d[attr2] = get_custom_element_value(attr2, newValue, this.$$p_d, "toProp");
      this.$$c?.$set({ [attr2]: this.$$d[attr2] });
    }
    disconnectedCallback() {
      this.$$cn = false;
      Promise.resolve().then(() => {
        if (!this.$$cn && this.$$c) {
          this.$$c.$destroy();
          this.$$me();
          this.$$c = void 0;
        }
      });
    }
    /**
     * @param {string} attribute_name
     */
    $$g_p(attribute_name) {
      return object_keys(this.$$p_d).find(
        (key2) => this.$$p_d[key2].attribute === attribute_name || !this.$$p_d[key2].attribute && key2.toLowerCase() === attribute_name
      ) || attribute_name;
    }
  };
}
function get_custom_element_value(prop2, value, props_definition, transform) {
  const type = props_definition[prop2]?.type;
  value = type === "Boolean" && typeof value !== "boolean" ? value != null : value;
  if (!transform || !props_definition[prop2]) {
    return value;
  } else if (transform === "toAttribute") {
    switch (type) {
      case "Object":
      case "Array":
        return value == null ? null : JSON.stringify(value);
      case "Boolean":
        return value ? "" : null;
      case "Number":
        return value == null ? null : value;
      default:
        return value;
    }
  } else {
    switch (type) {
      case "Object":
      case "Array":
        return value && JSON.parse(value);
      case "Boolean":
        return value;
      // conversion already handled above
      case "Number":
        return value != null ? +value : value;
      default:
        return value;
    }
  }
}
function get_custom_elements_slots(element2) {
  const result = {};
  element2.childNodes.forEach((node) => {
    result[
      /** @type {Element} node */
      node.slot || "default"
    ] = true;
  });
  return result;
}

}

{
// src/ui/svelte/svelte-50-src_index-client.js
// node_modules/svelte/src/index-client.js
if (dev_fallback_default) {
  let throw_rune_error = function(rune) {
    if (!(rune in globalThis)) {
      let value;
      Object.defineProperty(globalThis, rune, {
        configurable: true,
        // eslint-disable-next-line getter-return
        get: () => {
          if (value !== void 0) {
            return value;
          }
          rune_outside_svelte(rune);
        },
        set: (v) => {
          value = v;
        }
      });
    }
  };
  throw_rune_error("$state");
  throw_rune_error("$effect");
  throw_rune_error("$derived");
  throw_rune_error("$inspect");
  throw_rune_error("$props");
  throw_rune_error("$bindable");
}

}

{
// src/ui/svelte/svelte-51-src_version.js
// node_modules/svelte/src/version.js
var PUBLIC_VERSION = "5";

}

{
// src/ui/svelte/svelte-52-src_internal_disclose-version.js
// node_modules/svelte/src/internal/disclose-version.js
if (typeof window !== "undefined") {
  ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add(PUBLIC_VERSION);
}

// src/ui/ChatContainer.svelte
var import_obsidian6 = require("obsidian");
var root_2 = from_html(`<div class="ochatting-msg ochatting-user-msg svelte-hkdyy7"><div class="ochatting-msg-content svelte-hkdyy7"> </div></div>`);
var root_3 = from_html(`<div class="ochatting-msg ochatting-assistant-msg svelte-hkdyy7"><div class="ochatting-msg-content svelte-hkdyy7"></div></div>`);
var root_4 = from_html(`<div class="ochatting-tool-call svelte-hkdyy7"><div class="ochatting-tool-status svelte-hkdyy7"><span class="ochatting-spinner svelte-hkdyy7"></span> <span class="ochatting-tool-name svelte-hkdyy7"> </span></div> <details class="ochatting-tool-details svelte-hkdyy7"><summary class="svelte-hkdyy7">Parameters</summary> <pre class="ochatting-tool-json svelte-hkdyy7"> </pre></details></div>`);
var root_5 = from_html(`<div class="ochatting-tool-call svelte-hkdyy7"><div class="ochatting-tool-status svelte-hkdyy7"><span> </span> <span class="ochatting-tool-name svelte-hkdyy7"> </span></div> <details class="ochatting-tool-details svelte-hkdyy7"><summary class="svelte-hkdyy7"> </summary> <pre class="ochatting-tool-json svelte-hkdyy7"> </pre></details></div>`);
var root_6 = from_html(`<div class="ochatting-msg ochatting-error-msg svelte-hkdyy7"><div class="ochatting-msg-content svelte-hkdyy7"> </div></div>`);
var root_7 = from_html(`<div class="ochatting-thinking svelte-hkdyy7"><span class="ochatting-dot svelte-hkdyy7"></span> <span class="ochatting-dot svelte-hkdyy7"></span> <span class="ochatting-dot svelte-hkdyy7"></span></div>`);
var root_8 = from_html(`<div class="ochatting-selection-pill svelte-hkdyy7"><div class="ochatting-selection-content svelte-hkdyy7"><span class="ochatting-selection-label svelte-hkdyy7"> </span> <span class="ochatting-selection-preview svelte-hkdyy7"> </span></div> <button class="ochatting-selection-dismiss svelte-hkdyy7" aria-label="Remove selection"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svelte-hkdyy7"><line x1="18" y1="6" x2="6" y2="18" class="svelte-hkdyy7"></line><line x1="6" y1="6" x2="18" y2="18" class="svelte-hkdyy7"></line></svg></button></div>`);
var root_9 = from_html(`<button class="ochatting-send-btn svelte-hkdyy7" aria-label="Send message"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svelte-hkdyy7"><line x1="12" y1="19" x2="12" y2="5" class="svelte-hkdyy7"></line><polyline points="5 12 12 5 19 12" class="svelte-hkdyy7"></polyline></svg></button>`);
var root_10 = from_html(`<button class="ochatting-send-btn ochatting-stop-btn svelte-hkdyy7" aria-label="Stop generation"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="svelte-hkdyy7"><rect x="4" y="4" width="16" height="16" rx="2" class="svelte-hkdyy7"></rect></svg></button>`);
var root = from_html(`<div class="ochatting-container svelte-hkdyy7"><div class="ochatting-header svelte-hkdyy7"><div class="ochatting-header-left svelte-hkdyy7"><span class="ochatting-header-title svelte-hkdyy7">Chat</span> <span class="ochatting-header-model svelte-hkdyy7"> </span></div> <button class="ochatting-clear-btn svelte-hkdyy7">Clear</button></div> <div class="ochatting-messages svelte-hkdyy7"></div> <!> <div class="ochatting-input-bar svelte-hkdyy7"><textarea class="ochatting-input svelte-hkdyy7" rows="1"></textarea> <!></div></div>`);
var $$css = {
  hash: "svelte-hkdyy7",
  code: "\n  /* \u2500\u2500\u2500 Container \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-container.svelte-hkdyy7 {display:flex;flex-direction:column;height:100%;overflow:hidden;}\n\n  /* \u2500\u2500\u2500 Header \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-header.svelte-hkdyy7 {display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--background-modifier-border);flex-shrink:0;}.ochatting-header-left.svelte-hkdyy7 {display:flex;align-items:baseline;gap:8px;}.ochatting-header-title.svelte-hkdyy7 {font-weight:var(--font-weight-bold, 600);font-size:var(--font-ui-medium);color:var(--text-normal);}.ochatting-header-model.svelte-hkdyy7 {font-size:var(--font-ui-smaller);color:var(--text-muted);}.ochatting-clear-btn.svelte-hkdyy7 {font-size:var(--font-ui-smaller);color:var(--text-muted);background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:var(--radius-s);}.ochatting-clear-btn.svelte-hkdyy7:hover {background:var(--background-modifier-hover);color:var(--text-normal);}\n\n  /* \u2500\u2500\u2500 Messages \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-messages.svelte-hkdyy7 {flex:1 1 0;overflow-y:auto;overscroll-behavior:contain;padding:12px;display:flex;flex-direction:column;gap:8px;-webkit-user-select:text;user-select:text;}.ochatting-msg.svelte-hkdyy7 {max-width:90%;padding:8px 12px;border-radius:var(--radius-m);line-height:1.5;word-wrap:break-word;-webkit-user-select:text;user-select:text;}.ochatting-user-msg.svelte-hkdyy7 {align-self:flex-end;background:var(--interactive-accent);color:var(--text-on-accent);border-bottom-right-radius:var(--radius-s);}.ochatting-assistant-msg.svelte-hkdyy7 {align-self:flex-start;background:var(--background-secondary);color:var(--text-normal);border-bottom-left-radius:var(--radius-s);}.ochatting-assistant-msg.svelte-hkdyy7 p:first-child {margin-top:0;}.ochatting-assistant-msg.svelte-hkdyy7 p:last-child {margin-bottom:0;}.ochatting-error-msg.svelte-hkdyy7 {align-self:flex-start;background:var(--background-secondary);color:var(--text-error);border-left:3px solid var(--text-error);font-size:var(--font-ui-smaller);max-width:90%;}\n\n  /* \u2500\u2500\u2500 Tool Calls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-tool-call.svelte-hkdyy7 {align-self:flex-start;padding:6px 10px;background:var(--background-secondary-alt);border-radius:var(--radius-s);font-size:var(--font-ui-smaller);color:var(--text-muted);max-width:90%;}.ochatting-tool-status.svelte-hkdyy7 {display:flex;align-items:center;gap:6px;}.ochatting-tool-name.svelte-hkdyy7 {font-weight:500;}.ochatting-tool-success.svelte-hkdyy7 {color:var(--text-success);}.ochatting-tool-error.svelte-hkdyy7 {color:var(--text-error);}.ochatting-tool-details.svelte-hkdyy7 {margin-top:4px;}.ochatting-tool-details.svelte-hkdyy7 summary:where(.svelte-hkdyy7) {cursor:pointer;color:var(--text-faint);font-size:var(--font-ui-smaller);}.ochatting-tool-json.svelte-hkdyy7 {margin:4px 0 0;padding:6px 8px;background:var(--background-primary);border-radius:var(--radius-s);font-size:11px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all;}\n\n  /* \u2500\u2500\u2500 Spinner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-spinner.svelte-hkdyy7 {display:inline-block;width:12px;height:12px;border:2px solid var(--text-faint);border-top-color:var(--interactive-accent);border-radius:50%;\n    animation: svelte-hkdyy7-ochatting-spin 0.6s linear infinite;}\n\n  @keyframes svelte-hkdyy7-ochatting-spin {\n    to { transform: rotate(360deg); }\n  }\n\n  /* \u2500\u2500\u2500 Thinking Dots \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-thinking.svelte-hkdyy7 {align-self:flex-start;display:flex;gap:4px;padding:8px 12px;}.ochatting-dot.svelte-hkdyy7 {width:8px;height:8px;background:var(--text-faint);border-radius:50%;\n    animation: svelte-hkdyy7-ochatting-pulse 1.4s ease-in-out infinite;}.ochatting-dot.svelte-hkdyy7:nth-child(2) {animation-delay:0.2s;}.ochatting-dot.svelte-hkdyy7:nth-child(3) {animation-delay:0.4s;}\n\n  @keyframes svelte-hkdyy7-ochatting-pulse {\n    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }\n    40% { opacity: 1; transform: scale(1); }\n  }\n\n  /* \u2500\u2500\u2500 Input Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-input-bar.svelte-hkdyy7 {display:flex;align-items:flex-end;gap:8px;padding:8px 12px;padding-bottom:calc(8px + env(safe-area-inset-bottom, 0px));border-top:1px solid var(--background-modifier-border);background:transparent;flex-shrink:0;}.ochatting-input.svelte-hkdyy7 {flex:1;resize:none;border:1.5px solid var(--background-modifier-border-hover, var(--background-modifier-border));border-radius:20px;padding:8px 16px;font-size:var(--font-ui-medium);font-family:var(--font-interface);background-color:var(--background-secondary);color:var(--text-normal);line-height:1.4;max-height:300px;overflow-y:auto;box-shadow:none;}.ochatting-input.svelte-hkdyy7:focus {outline:none;border-color:var(--interactive-accent);box-shadow:none;}.ochatting-input.svelte-hkdyy7:disabled {opacity:0.5;}.ochatting-send-btn.svelte-hkdyy7 {width:34px;height:34px;min-width:34px;min-height:34px;padding:0;border:none;border-radius:50%;background-color:var(--interactive-accent);color:var(--text-on-accent);cursor:pointer;flex-shrink:0;box-shadow:none;display:flex;align-items:center;justify-content:center;margin-bottom:1px;}.ochatting-send-btn.svelte-hkdyy7:hover {background-color:var(--interactive-accent-hover);}.ochatting-send-btn.svelte-hkdyy7:disabled {opacity:0.4;cursor:not-allowed;}.ochatting-stop-btn.svelte-hkdyy7 {background-color:var(--text-error);}.ochatting-stop-btn.svelte-hkdyy7:hover {background-color:var(--text-error);opacity:0.85;}\n\n  /* \u2500\u2500\u2500 Selection Pill \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */.ochatting-selection-pill.svelte-hkdyy7 {display:flex;align-items:center;gap:8px;margin:8px 8px 0;padding:6px 10px;background:var(--background-secondary);border:1px solid var(--background-modifier-border);border-radius:var(--radius-m);flex-shrink:0;}.ochatting-selection-content.svelte-hkdyy7 {flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}.ochatting-selection-label.svelte-hkdyy7 {font-size:var(--font-ui-smaller);color:var(--text-muted);font-weight:500;}.ochatting-selection-preview.svelte-hkdyy7 {font-size:var(--font-ui-smaller);color:var(--text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.ochatting-selection-dismiss.svelte-hkdyy7 {flex-shrink:0;width:20px;height:20px;padding:0;border:none;border-radius:50%;background:var(--background-modifier-hover);color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;}.ochatting-selection-dismiss.svelte-hkdyy7:hover {background:var(--background-modifier-border);color:var(--text-normal);}\n\n  /* \u2500\u2500\u2500 Responsive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n  @media (max-width: 768px) {.ochatting-msg.svelte-hkdyy7 {max-width:95%;}.ochatting-input-bar.svelte-hkdyy7 {gap:10px;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom, 0px));}.ochatting-input.svelte-hkdyy7 {font-size:16px; /* Prevents iOS zoom on focus */padding:10px 16px;border-radius:22px;}.ochatting-send-btn.svelte-hkdyy7 {width:36px;height:36px;min-width:36px;min-height:36px;}\n  }"
};
function ChatContainer($$anchor, $$props) {
  push($$props, true);
  append_styles($$anchor, $$css);
  let displayModel = state("");
  let agentsStatus = state("aichat");
  let messages = state(proxy([]));
  let inputText = state("");
  let inputEnabled = state(true);
  let placeholder = state("Ask anything...");
  let messagesEl = state(void 0);
  let textareaEl = state(void 0);
  let nextId = 0;
  let selection = state(null);
  let askUserResolve = state(null);
  user_effect(() => {
    set(displayModel, $$props.model, true);
  });
  user_effect(() => {
    set(agentsStatus, $$props.agentsStatus || "aichat", true);
  });
  user_effect(() => {
    get2(messages).length;
    if (get2(messagesEl)) {
      requestAnimationFrame(() => {
        get2(messagesEl).scrollTop = get2(messagesEl).scrollHeight;
      });
    }
  });
  function addUserMessage(text2) {
    get2(messages).push({ id: nextId++, type: "user", text: text2 });
  }
  function addAssistantMessage(text2) {
    get2(messages).push({ id: nextId++, type: "assistant", text: text2 });
  }
  function addToolCall(name, input) {
    const id = nextId++;
    get2(messages).push({ id, type: "tool-call", toolName: name, toolInput: input });
    return id;
  }
  function updateToolResult(msgId, name, result) {
    const msg = get2(messages).find((m) => m.id === msgId);
    if (msg) {
      msg.type = "tool-result";
      msg.toolName = name;
      msg.toolResult = result;
    }
  }
  function showThinking() {
    if (!get2(messages).some((m) => m.type === "thinking")) {
      get2(messages).push({ id: nextId++, type: "thinking" });
    }
  }
  function hideThinking() {
    const idx = get2(messages).findIndex((m) => m.type === "thinking");
    if (idx !== -1) get2(messages).splice(idx, 1);
  }
  function addError(text2) {
    get2(messages).push({ id: nextId++, type: "error", text: text2 });
  }
  function showAskUser(question) {
    addAssistantMessage(question);
    set(placeholder, "Type your answer...");
    set(inputEnabled, true);
    get2(textareaEl)?.focus();
    return new Promise((resolve) => {
      set(askUserResolve, resolve, true);
    });
  }
  function setInputEnabled(enabled) {
    set(inputEnabled, enabled, true);
    set(placeholder, enabled ? "Ask anything..." : "Waiting for response...", true);
    if (enabled) {
      requestAnimationFrame(() => {
        get2(textareaEl)?.focus();
      });
    }
  }
  function clearMessages() {
    set(messages, [], true);
    set(selection, null);
    hideThinking();
  }
  function focus() {
    get2(textareaEl)?.focus();
  }
  function setModel(name) {
    set(displayModel, name, true);
  }
  function setAgentsStatus(status) {
    set(agentsStatus, status || "aichat", true);
  }
  function setSelection(sel) {
    set(selection, sel, true);
  }
  function getSelection() {
    return get2(selection);
  }
  function clearSelection() {
    set(selection, null);
  }
  function handleSend() {
    const text2 = get2(inputText).trim();
    if (!text2) return;
    set(inputText, "");
    resetHeight();
    if (get2(askUserResolve)) {
      addUserMessage(text2);
      const resolve = get2(askUserResolve);
      set(askUserResolve, null);
      resolve(text2);
      return;
    }
    const currentSelection = get2(selection);
    set(selection, null);
    $$props.onSend(text2, currentSelection);
  }
  function handleKeydown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
  function autoGrow() {
    if (!get2(textareaEl)) return;
    get2(textareaEl).style.height = "auto";
    get2(textareaEl).style.height = Math.min(get2(textareaEl).scrollHeight, 300) + "px";
  }
  function resetHeight() {
    if (!get2(textareaEl)) return;
    get2(textareaEl).style.height = "auto";
  }
  function renderMarkdown(node, text2) {
    node.empty();
    import_obsidian6.MarkdownRenderer.render($$props.app, text2, node, "", $$props.component);
  }
  function markdown(node, text2) {
    renderMarkdown(node, text2);
    return {
      update(newText) {
        renderMarkdown(node, newText);
      }
    };
  }
  function shortName(path) {
    const p = String(path || "");
    if (!p) return "";
    const parts = p.split("/");
    if (parts.length <= 2) return p;
    return `.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  function shortText(value, max = 28) {
    const s = String(value || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
  function extractSearchReadPaths(result) {
    const out = [];
    if (result && typeof result.path === "string" && result.path) {
      out.push(result.path);
    }
    const raw = result && typeof result.result === "string" ? result.result : "";
    if (!raw) return Array.from(new Set(out));
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) {
        for (const entry of parsed.entries) {
          if (entry && typeof entry.path === "string" && entry.path) {
            out.push(entry.path);
          }
        }
      }
    } catch {
    }
    return Array.from(new Set(out));
  }
  function extractSearchVaultTotalMatches(result) {
    const raw = result && typeof result.result === "string" ? result.result : "";
    if (!raw) return null;
    const explicit = raw.match(/total matches:\s*(\d+)/i);
    if (explicit) {
      const value = Number.parseInt(explicit[1], 10);
      return Number.isFinite(value) ? value : null;
    }
    const legacy = raw.match(/^Found\s+(\d+)\s+result\(s\)/i);
    if (legacy) {
      const value = Number.parseInt(legacy[1], 10);
      return Number.isFinite(value) ? value : null;
    }
    return null;
  }
  function formatToolName(name, input = {}, result = null) {
    const rawTool = String(name || "");
    const multiPrefix = rawTool.startsWith("M ") ? "M " : "";
    const tool = multiPrefix ? rawTool.slice(2).trim() : rawTool;
    const path = typeof input.path === "string" ? input.path : "";
    const withPrefix = (label) => multiPrefix ? `${multiPrefix}${label}` : label;

    switch (tool) {
      case "create_file":
        return withPrefix(path ? `create ${shortName(path)}` : "create file");
      case "read_file":
        return withPrefix(path ? `read ${shortName(path)}` : "read file");
      case "read_document":
        return withPrefix(path ? `read doc ${shortName(path)}` : "read active doc");
      case "search_read": {
        const paths = extractSearchReadPaths(result);
        if (paths.length === 0) return withPrefix("search_read");
        return withPrefix(`search_read ${paths.map((p) => shortName(p)).join(", ")}`);
      }
      case "edit_file": {
        const op = typeof input.operation === "string" ? input.operation.replace(/_/g, " ") : "edit";
        return withPrefix(path ? `${op} ${shortName(path)}` : `${op} active doc`);
      }
      case "rename_file": {
        const from = typeof input.path === "string" ? shortName(input.path) : "";
        const to = typeof input.new_path === "string" ? shortName(input.new_path) : "";
        if (from && to) return withPrefix(`rename ${from} → ${to}`);
        return withPrefix("rename file");
      }
      case "delete_file":
        return withPrefix(path ? `delete ${shortName(path)}` : "delete file");
      case "open_document":
        return withPrefix(path ? `open ${shortName(path)}` : "open document");
      case "search_vault": {
        const q = typeof input.query === "string" ? shortText(input.query) : "";
        const total = extractSearchVaultTotalMatches(result);
        if (q) {
          return withPrefix(total === null ? `search "${q}"` : `search "${q}" (${total} found)`);
        }
        return withPrefix(total === null ? "search vault" : `search vault (${total} found)`);
      }
      case "list_files":
        return withPrefix(input.extension ? `list *.${String(input.extension).replace(/^\./, "")}` : "list files");
      case "get_properties":
        return withPrefix(path ? `get props ${shortName(path)}` : "get props active doc");
      case "set_properties":
        return withPrefix(path ? `set props ${shortName(path)}` : "set props active doc");
      case "get_backlinks":
        return withPrefix(path ? `backlinks ${shortName(path)}` : "backlinks active doc");
      case "run_shell": {
        const action = typeof input.action === "string" ? input.action : "run";
        const cmd = typeof input.command === "string" ? shortText(input.command, 24) : "";
        return withPrefix(cmd ? `shell ${action}: ${cmd}` : `shell ${action}`);
      }
      case "agents": {
        const p = typeof input.path === "string" ? shortText(input.path, 32) : "";
        return withPrefix(p ? `agents ${p}` : "agents status");
      }
      default:
        return withPrefix(tool.replace(/_/g, " "));
    }
  }
  function truncate(str, max) {
    if (str.length <= max) return str;
    return str.substring(0, max) + "\n... (truncated)";
  }
  var $$exports = {
    addUserMessage,
    addAssistantMessage,
    addToolCall,
    updateToolResult,
    showThinking,
    hideThinking,
    addError,
    showAskUser,
    setInputEnabled,
    clearMessages,
    focus,
    setModel,
    setAgentsStatus,
    setSelection,
    getSelection,
    clearSelection
  };
  var div = root();
  var div_1 = child(div);
  var div_2 = child(div_1);
  var span = sibling(child(div_2), 2);
  var text_1 = child(span, true);
  reset(span);
  reset(div_2);
  var button = sibling(div_2, 2);
  reset(div_1);
  var div_3 = sibling(div_1, 2);
  each(div_3, 21, () => get2(messages), (msg) => msg.id, ($$anchor2, msg) => {
    var fragment = comment();
    var node_1 = first_child(fragment);
    {
      var consequent = ($$anchor3) => {
        var div_4 = root_2();
        var div_5 = child(div_4);
        var text_2 = child(div_5, true);
        reset(div_5);
        reset(div_4);
        template_effect(() => set_text(text_2, get2(msg).text));
        append($$anchor3, div_4);
      };
      var consequent_1 = ($$anchor3) => {
        var div_6 = root_3();
        var div_7 = child(div_6);
        action(div_7, ($$node, $$action_arg) => markdown?.($$node, $$action_arg), () => get2(msg).text ?? "");
        reset(div_6);
        append($$anchor3, div_6);
      };
      var consequent_2 = ($$anchor3) => {
        var div_8 = root_4();
        var div_9 = child(div_8);
        var span_1 = sibling(child(div_9), 2);
        var text_3 = child(span_1, true);
        reset(span_1);
        reset(div_9);
        var details = sibling(div_9, 2);
        var pre = sibling(child(details), 2);
        var text_4 = child(pre, true);
        reset(pre);
        reset(details);
        reset(div_8);
        template_effect(
          ($0, $1) => {
            set_text(text_3, $0);
            set_text(text_4, $1);
          },
          [
            () => formatToolName(get2(msg).toolName ?? "", get2(msg).toolInput ?? {}, get2(msg).toolResult ?? null),
            () => JSON.stringify(get2(msg).toolInput, null, 2)
          ]
        );
        append($$anchor3, div_8);
      };
      var consequent_3 = ($$anchor3) => {
        var div_10 = root_5();
        var div_11 = child(div_10);
        var span_2 = child(div_11);
        var text_5 = child(span_2, true);
        reset(span_2);
        var span_3 = sibling(span_2, 2);
        var text_6 = child(span_3, true);
        reset(span_3);
        reset(div_11);
        var details_1 = sibling(div_11, 2);
        var summary = child(details_1);
        var text_7 = child(summary, true);
        reset(summary);
        var pre_1 = sibling(summary, 2);
        var text_8 = child(pre_1, true);
        reset(pre_1);
        reset(details_1);
        reset(div_10);
        template_effect(
          ($0, $1) => {
            set_class(span_2, 1, clsx2(get2(msg).toolResult?.isError ? "ochatting-tool-error" : "ochatting-tool-success"), "svelte-hkdyy7");
            set_text(text_5, get2(msg).toolResult?.isError ? "\u2718" : "\u2714");
            set_text(text_6, $0);
            set_text(text_7, get2(msg).toolResult?.isError ? "Error" : "Result");
            set_text(text_8, $1);
          },
          [
            () => formatToolName(get2(msg).toolName ?? "", get2(msg).toolInput ?? {}, get2(msg).toolResult ?? null),
            () => truncate(get2(msg).toolResult?.result ?? "", 2e3)
          ]
        );
        append($$anchor3, div_10);
      };
      var consequent_4 = ($$anchor3) => {
        var div_12 = root_6();
        var div_13 = child(div_12);
        var text_9 = child(div_13, true);
        reset(div_13);
        reset(div_12);
        template_effect(() => set_text(text_9, get2(msg).text));
        append($$anchor3, div_12);
      };
      var consequent_5 = ($$anchor3) => {
        var div_14 = root_7();
        append($$anchor3, div_14);
      };
      if_block(node_1, ($$render) => {
        if (get2(msg).type === "user") $$render(consequent);
        else if (get2(msg).type === "assistant") $$render(consequent_1, 1);
        else if (get2(msg).type === "tool-call") $$render(consequent_2, 2);
        else if (get2(msg).type === "tool-result") $$render(consequent_3, 3);
        else if (get2(msg).type === "error") $$render(consequent_4, 4);
        else if (get2(msg).type === "thinking") $$render(consequent_5, 5);
      });
    }
    append($$anchor2, fragment);
  });
  reset(div_3);
  bind_this(div_3, ($$value) => set(messagesEl, $$value), () => get2(messagesEl));
  var node_2 = sibling(div_3, 2);
  {
    var consequent_6 = ($$anchor2) => {
      var div_15 = root_8();
      var div_16 = child(div_15);
      var span_4 = child(div_16);
      var text_10 = child(span_4);
      reset(span_4);
      var span_5 = sibling(span_4, 2);
      var text_11 = child(span_5);
      reset(span_5);
      reset(div_16);
      var button_1 = sibling(div_16, 2);
      reset(div_15);
      template_effect(
        ($0, $1) => {
          set_text(text_10, `Selection from ${$0 ?? ""}`);
          set_text(text_11, `${$1 ?? ""}${get2(selection).text.length > 80 ? "..." : ""}`);
        },
        [
          () => get2(selection).filePath.split("/").pop(),
          () => get2(selection).text.substring(0, 80)
        ]
      );
      delegated("click", button_1, () => set(selection, null));
      append($$anchor2, div_15);
    };
    if_block(node_2, ($$render) => {
      if (get2(selection)) $$render(consequent_6);
    });
  }
  var div_17 = sibling(node_2, 2);
  var textarea = child(div_17);
  remove_textarea_child(textarea);
  bind_this(textarea, ($$value) => set(textareaEl, $$value), () => get2(textareaEl));
  var node_3 = sibling(textarea, 2);
  {
    var consequent_7 = ($$anchor2) => {
      var button_2 = root_9();
      delegated("click", button_2, handleSend);
      append($$anchor2, button_2);
    };
    var alternate = ($$anchor2) => {
      var button_3 = root_10();
      delegated("click", button_3, function(...$$args) {
        $$props.onStop?.apply(this, $$args);
      });
      append($$anchor2, button_3);
    };
    if_block(node_3, ($$render) => {
      if (get2(inputEnabled)) $$render(consequent_7);
      else $$render(alternate, -1);
    });
  }
  reset(div_17);
  reset(div);
  template_effect(() => {
    const model = get2(displayModel) || "No model";
    const agents = get2(agentsStatus) || "aichat";
    set_text(text_1, `${model} • ${agents}`);
    set_attribute2(textarea, "placeholder", get2(placeholder));
    textarea.disabled = !get2(inputEnabled);
  });
  delegated("click", button, function(...$$args) {
    $$props.onClear?.apply(this, $$args);
  });
  delegated("keydown", textarea, handleKeydown);
  delegated("input", textarea, autoGrow);
  bind_value(textarea, () => get2(inputText), ($$value) => set(inputText, $$value));
  append($$anchor, div);
  return pop($$exports);
}
delegate(["click", "keydown", "input"]);

//__AI_SPLIT_SEGMENT_END__ 000010
//__AI_SPLIT_SEGMENT_START__ 000011
// src/ui/chat-view.ts
var VIEW_TYPE_CHAT = "aichat-view";
var ObsidianChatView = class extends import_obsidian7.ItemView {
  plugin;
  chatContainer;
  running = false;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_CHAT;
  }
  getDisplayText() {
    return "AI Chat";
  }
  getIcon() {
    return "message-circle";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("ochatting-view-container");
    this.chatContainer = mount(
      ChatContainer,
      {
        target: container,
        props: {
          app: this.app,
          component: this,
          provider: this.plugin.settings.provider,
          model: getModelDisplayName(this.plugin.settings.provider, this.plugin.settings.model),
          agentsStatus: await this.getAgentsStatusLabel(),
          onSend: (text2, selection) => {
            void this.handleUserMessage(text2, selection);
          },
          onClear: () => this.handleClear(),
          onStop: () => this.handleStop()
        }
      }
    );
    for (const msg of this.plugin.chatHistory) {
      switch (msg.type) {
        case "user":
          this.chatContainer.addUserMessage(msg.text);
          break;
        case "assistant":
          this.chatContainer.addAssistantMessage(msg.text);
          break;
        case "tool-result":
          if (msg.toolName && msg.toolResult) {
            const id = this.chatContainer.addToolCall(msg.toolName, msg.toolInput || {});
            this.chatContainer.updateToolResult(id, msg.toolName, msg.toolResult);
          }
          break;
        case "error":
          this.chatContainer.addError(msg.text);
          break;
      }
    }
    this.chatContainer.focus();
  }
  async onClose() {
    this.plugin.agent.abort();
    if (this.chatContainer) {
      await unmount(this.chatContainer);
      this.chatContainer = void 0;
    }
  }
  async getAgentsStatusLabel() {
    const configPath = `${this.app.vault.configDir}/plugins/aichat/agents-path.txt`;
    let configuredPath = "";
    try {
      configuredPath = (await this.app.vault.adapter.read(configPath)).trim();
    } catch {
      configuredPath = "";
    }
    if (!configuredPath) return "aichat";

    const normalized = (0, import_obsidian7.normalizePath)(configuredPath);
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2];
    if (parts.length === 1) return "root";
    return "aichat";
  }
  async refreshAgentsStatus() {
    const status = await this.getAgentsStatusLabel();
    this.chatContainer?.setAgentsStatus(status);
  }
  /** Export the full transcript for debugging */
  getTranscript() {
    return this.plugin.agent.exportTranscript();
  }
  /** Programmatically send a message */
  sendMessage(text2) {
    void this.handleUserMessage(text2, this.chatContainer?.getSelection() ?? null);
  }
  /** Set the selection scope and show the pill */
  setSelection(selection) {
    this.chatContainer?.setSelection(selection);
  }
  /** Focus the input */
  focus() {
    this.chatContainer?.focus();
  }
  /** Update the model display name in the header */
  updateModel(name) {
    this.chatContainer?.setModel(name);
  }
  /** Clear conversation */
  clearConversation() {
    this.handleClear();
  }
  async handleUserMessage(text2, selection) {
    if (this.running) {
      new import_obsidian7.Notice("Please wait for the current response to complete.");
      return;
    }
    const chat = this.chatContainer;
    const history = this.plugin.chatHistory;
    this.running = true;
    chat.addUserMessage(text2);
    history.push({ type: "user", text: text2 });
    chat.setInputEnabled(false);
    const toolCallIds = /* @__PURE__ */ new Map();
    try {
      await this.plugin.agent.run(text2, {
        onThinking: () => {
          chat.showThinking();
        },
        onToolCall: (name, input) => {
          chat.hideThinking();
          if (name === "ask_user") return;
          const msgId = chat.addToolCall(name, input);
          toolCallIds.set(`latest-${name}`, msgId);
        },
        onToolResult: (name, result) => {
          if (name === "ask_user") return;
          const msgId = toolCallIds.get(`latest-${name}`);
          if (msgId !== void 0) {
            chat.updateToolResult(msgId, name, result);
          }
          history.push({ type: "tool-result", toolName: name, toolInput: {}, toolResult: result });
          if (name === "agents") {
            void this.refreshAgentsStatus();
          }
        },
        onResponse: (text3) => {
          chat.hideThinking();
          chat.addAssistantMessage(text3);
          history.push({ type: "assistant", text: text3 });
        },
        onAskUser: async (question) => {
          chat.hideThinking();
          chat.setInputEnabled(true);
          const answer = await chat.showAskUser(question);
          chat.setInputEnabled(false);
          return answer;
        },
        onError: (error) => {
          chat.hideThinking();
          chat.addError(error);
          history.push({ type: "error", text: error });
        }
      }, selection);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      chat.addError(`Unexpected error: ${msg}`);
      history.push({ type: "error", text: `Unexpected error: ${msg}` });
    } finally {
      this.running = false;
      chat.setInputEnabled(true);
      chat.focus();
      void this.plugin.saveChatHistory();
    }
  }
  handleStop() {
    this.plugin.agent.abort();
    this.running = false;
    const chat = this.chatContainer;
    if (chat) {
      chat.hideThinking();
      chat.setInputEnabled(true);
      chat.focus();
    }
    void this.plugin.saveChatHistory();
  }
  handleClear() {
    this.plugin.agent.abort();
    this.plugin.agent.clear();
    this.plugin.chatHistory = [];
    this.chatContainer?.clearMessages();
    this.running = false;
    this.chatContainer?.setInputEnabled(true);
    void this.plugin.saveChatHistory();
  }
};

//__AI_SPLIT_SEGMENT_END__ 000011

}

{
// util.js
// aichat/util.ts
function clampSafeNumber(value, fallback, min, max) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

declareExports({
  clampSafeNumber
});

}

