// Load test for a built plugin bundle: node tools/jsload.js <bundle.js> <pluginId> [--test <expr>]
// Runs the bundle in a sandbox with a fake Obsidian, then constructs the plugin and runs
// onload() and onunload() (the hot-reload cycle). With --test, also evaluates <expr> inside
// the bundle (e.g. "Movi.Test.runAll()"), which must resolve to { passed, failed, cases },
// and fails if any case failed. Fails if the bundle uses an Obsidian
// export this fake does not provide, so the fake stays honest as the plugins grow.
// The fake app and DOM are permissive: unknown members return inert stubs. This catches
// load-time crashes and unit/ordering mistakes, not wrong use of Obsidian's API.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [bundlePath, pluginId, testFlag, testExpression] = process.argv.slice(2);
if (!bundlePath || !pluginId || (testFlag !== undefined && (testFlag !== "--test" || !testExpression))) {
    console.error("usage: node tools/jsload.js <bundle.js> <pluginId> [--test <expr>]");
    process.exit(2);
}
const source = fs.readFileSync(bundlePath, "utf8");

// Inert value: any property, call, or construction yields another stub; values set on it stick.
function stub(name) {
    const members = new Map();
    return new Proxy(function () {}, {
        get(target, key) {
            if (key === "then") return undefined; // not a promise
            if (key === Symbol.toPrimitive) return () => `[${name}]`;
            if (key === Symbol.iterator) return function* () {};
            if (key === "length") return 0;
            if (!members.has(key)) members.set(key, stub(`${name}.${String(key)}`));
            return members.get(key);
        },
        set(target, key, value) {
            members.set(key, value);
            return true;
        },
        apply: () => stub(`${name}()`),
        construct: () => stub(`new ${name}`)
    });
}

// Real object whose missing members fall back to stubs.
function partial(name, obj) {
    return new Proxy(obj, {
        get: (target, key) => (key in target ? target[key] : (target[key] = stub(`${name}.${String(key)}`)))
    });
}

class Component {
    register() {}
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
}

// Workspace with one tab per registered view type, each unloaded (deferred) the way Obsidian
// restores background tabs: its view is a placeholder that only reports the type. Showing or
// rebuilding the tab creates the real view from the plugin's registerView factory.
const viewFactories = new Map();
const leaves = [];
const workspaceHandlers = [];
const layoutReadyCallbacks = [];
const fakeNote = { path: "vids/JsloadNote.md", name: "JsloadNote.md", basename: "JsloadNote", extension: "md" };

// Fire the workspace events Obsidian sends while restoring and switching tabs.
async function fireWorkspaceEvents() {
    const args = { "file-open": [fakeNote], "active-leaf-change": [leaves[0] || null], "layout-change": [] };
    for (const { name, callback } of workspaceHandlers) {
        if (name in args) await callback(...args[name]);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
}

function makeLeaf(type) {
    const leaf = {
        isDeferred: true,
        getViewState: () => ({ type, state: {} }),
        async setViewState(state) { await loadView(leaf, state.type); },
        async loadIfDeferred() { if (leaf.isDeferred) await loadView(leaf, type); },
        async openFile() {},
        detach() { leaves.splice(leaves.indexOf(leaf), 1); }
    };
    leaf.view = { leaf, getViewType: () => type, containerEl: stub("deferredContainerEl") };
    return leaf;
}

async function loadView(leaf, type) {
    const factory = viewFactories.get(type);
    if (!factory) return;
    leaf.isDeferred = false;
    leaf.view = factory(leaf);
    if (leaf.view.onOpen) await leaf.view.onOpen();
}

class Plugin extends Component {
    constructor(app, manifest) {
        super();
        this.app = app;
        this.manifest = manifest;
        this.commands = [];
    }
    addCommand(command) { this.commands.push(command); return command; }
    addRibbonIcon() { return stub("ribbonIcon"); }
    addSettingTab() {}
    addStatusBarItem() { return stub("statusBarItem"); }
    // A saved, still-unloaded tab of each registered view type, as after an Obsidian restart.
    registerView(type, factory) { viewFactories.set(type, factory); leaves.push(makeLeaf(type)); }
    registerMarkdownPostProcessor() {}
    async loadData() { return null; }
    async saveData() {}
}

class ItemView extends Component {
    constructor(leaf) {
        super();
        this.leaf = leaf;
        this.app = leaf && leaf.app;
        this.containerEl = stub("containerEl");
        this.contentEl = stub("contentEl");
    }
    addAction() { return stub("action"); }
}

class Modal {
    constructor(app) {
        this.app = app;
        this.contentEl = stub("contentEl");
        this.titleEl = stub("titleEl");
        this.modalEl = stub("modalEl");
    }
    open() { this.onOpen && this.onOpen(); }
    close() { this.onClose && this.onClose(); }
}

class PluginSettingTab {
    constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = stub("containerEl");
    }
}

const fakeObsidian = {
    Component,
    Plugin,
    ItemView,
    Modal,
    PluginSettingTab,
    MarkdownView: class MarkdownView extends ItemView {},
    FileView: class FileView extends ItemView {},
    TFile: class TFile {},
    WorkspaceLeaf: class WorkspaceLeaf { async openFile() {} },
    TFolder: class TFolder {},
    Notice: class Notice { constructor(message) { this.message = message; } hide() {} },
    Menu: class Menu { addItem() { return this; } addSeparator() { return this; } showAtPosition() {} showAtMouseEvent() {} onHide() {} },
    Setting: class Setting { constructor() { return stub("setting"); } },
    SecretComponent: class SecretComponent { constructor() { return stub("secretComponent"); } },
    FileSystemAdapter: class FileSystemAdapter {},
    normalizePath: p => String(p || ""),
    setIcon() {},
    requestUrl: async () => ({ status: 200, json: {}, text: "", arrayBuffer: new ArrayBuffer(0) })
};

// Every Obsidian export the bundle names must exist in the fake.
const used = new Set();
for (const m of source.matchAll(/\bobsidian\.([A-Za-z_]\w*)/g)) used.add(m[1]);
for (const m of source.matchAll(/\{([^{}]*)\}\s*=\s*require\(\s*["']obsidian["']\s*\)/g)) {
    for (const part of m[1].split(",")) {
        const name = part.split(":")[0].trim();
        if (name) used.add(name);
    }
}
const missing = [...used].filter(name => !(name in fakeObsidian)).sort();
if (missing.length > 0) {
    console.error(`jsload: the bundle uses Obsidian exports the fake lacks: ${missing.join(", ")}. Add them to tools/jsload.js.`);
    process.exit(1);
}

// The vault's real workspace.json, so the plugins load the same search path they use in Obsidian.
const files = new Map();
const workspacePath = path.join(__dirname, "..", "workspace.json");
if (fs.existsSync(workspacePath)) files.set("workspace.json", fs.readFileSync(workspacePath, "utf8"));
const app = partial("app", {
    workspace: partial("workspace", {
        on: (name, callback) => { workspaceHandlers.push({ name, callback }); return {}; },
        offref() {},
        onLayoutReady: callback => { layoutReadyCallbacks.push(callback); },
        getLeavesOfType: type => leaves.filter(leaf => leaf.getViewState().type === type),
        iterateAllLeaves: callback => [...leaves].forEach(callback),
        iterateRootLeaves: callback => [...leaves].forEach(callback),
        revealLeaf: async leaf => leaf.loadIfDeferred(),
        getLeaf: () => { const leaf = makeLeaf("empty"); leaves.push(leaf); return leaf; },
        getActiveFile: () => null,
        getActiveViewOfType: () => null,
        activeLeaf: null
    }),
    vault: partial("vault", {
        getName: () => "dev",
        getMarkdownFiles: () => [],
        getFiles: () => [],
        getAbstractFileByPath: () => null,
        getFileByPath: () => null,
        on: () => ({}),
        adapter: partial("adapter", {
            exists: async p => files.has(p),
            read: async p => files.get(p) || "",
            write: async (p, text) => { files.set(p, text); },
            append: async (p, text) => { files.set(p, (files.get(p) || "") + text); }
        })
    }),
    metadataCache: partial("metadataCache", { on: () => ({}), getFileCache: () => null }),
    secretStorage: partial("secretStorage", { getSecret: () => "" })
});

const windowLike = partial("window", {
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    devicePixelRatio: 1,
    __THREE__: undefined // three.js warns about duplicate copies if this looks set
});

// As in Obsidian, exports and module.exports start as the same object.
const moduleObject = { exports: {} };
const sandbox = {
    console,
    module: moduleObject,
    exports: moduleObject.exports,
    require: id => (id === "obsidian" ? fakeObsidian : require(id)),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    URL,
    Blob,
    atob,
    btoa,
    Event,
    EventTarget,
    CustomEvent: class CustomEvent extends Event { constructor(type, init) { super(type, init); this.detail = init && init.detail; } },
    window: windowLike,
    document: stub("document"),
    navigator: stub("navigator"),
    ResizeObserver: class ResizeObserver { observe() {} disconnect() {} },
    // Fake DOM nodes are stubs; let instanceof checks against DOM classes pass.
    HTMLElement: class HTMLElement { static [Symbol.hasInstance]() { return true; } },
    CSS: { escape: value => String(value) },
    MutationObserver: class MutationObserver { observe() {} disconnect() {} }
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

process.on("unhandledRejection", error => {
    console.error(`jsload: unhandled rejection in ${pluginId}: ${error && error.stack || error}`);
    process.exit(1);
});

(async () => {
    try {
        vm.runInNewContext(source, sandbox, { filename: `plugin:${pluginId}`, timeout: 10000 });
    } catch (error) {
        throw new Error(`loading the bundle failed: ${error.stack || error}`, { cause: error });
    }

    const PluginClass = sandbox.module.exports;
    if (typeof PluginClass !== "function") {
        throw new Error("module.exports is not the plugin class");
    }

    // Anything the plugin reports through console.error during load/unload is a failure,
    // including errors its own error handling would show in a dialog.
    const reported = [];
    const realConsoleError = console.error;
    console.error = (...args) => reported.push(args.map(String).join(" "));

    const plugin = new PluginClass(app, { id: pluginId, dir: `.obsidian/plugins/${pluginId}` });
    // Restart sequence: load, restore-time events while tabs are still unloaded, layout ready,
    // then events again, then unload.
    await plugin.onload();
    await fireWorkspaceEvents();
    for (const callback of layoutReadyCallbacks) await callback();
    await fireWorkspaceEvents();
    await plugin.onunload();

    console.error = realConsoleError;
    if (reported.length > 0) {
        throw new Error(`errors reported during load/unload:\n  ${reported.join("\n  ")}`);
    }
    console.log(`jsload: ${path.basename(bundlePath)} (${pluginId}) loaded, onload/onunload ok, ${plugin.commands.length} commands`);

    if (testExpression) {
        const report = await vm.runInContext(testExpression, sandbox);
        for (const result of report.cases.filter(c => !c.ok)) {
            console.error(`  FAIL ${result.suite}/${result.name}: ${result.message}`);
        }
        console.log(`jsload: ${pluginId} tests: ${report.passed} passed, ${report.failed} failed`);
        if (report.failed > 0) {
            process.exit(1);
        }
    }
})().catch(error => {
    console.error(`jsload: ${pluginId} failed: ${error.stack || error}`);
    process.exit(1);
});
