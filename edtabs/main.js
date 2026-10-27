// Editor-style tabs: each file has at most one tab in the main area.
//   - Opening a file that already has a tab switches to that tab.
//   - Opening a file from a tab that shows something else opens it in a new tab.
//   - Only an empty tab is replaced in place.
// Obsidian routes every file open (explorer, links, search, quick switcher, plugins) through
// WorkspaceLeaf.openFile, so that is the one place patched. Pinned tabs, sidebars, and
// opening a file in the tab already showing it keep Obsidian's behavior. At startup,
// duplicate tabs of one file are closed, keeping the active or first one.
const obsidian = require("obsidian");

const EdTabs = {};
globalThis.EdTabs = EdTabs;

// The rule, kept pure for the tests. leaf: { inMainArea, pinned, showsFile (the path it
// shows, or ""), isEmpty }. Returns "original" (Obsidian's behavior), "switch" (to the
// file's existing tab), or "newTab".
EdTabs.decideOpen = function(leaf, filePath, hasOtherTab) {
    if (!leaf.inMainArea || leaf.pinned || leaf.showsFile === filePath) {
        return "original";
    }
    if (hasOtherTab) {
        return "switch";
    }
    return leaf.isEmpty ? "original" : "newTab";
};

class EdTabsPlugin extends obsidian.Plugin {
    async onload() {
        const plugin = this;
        const originalOpenFile = obsidian.WorkspaceLeaf.prototype.openFile;
        this.originalOpenFile = originalOpenFile;
        this.patchedOpenFile = function(file, openState) {
            return plugin.openFile(this, file, openState);
        };
        obsidian.WorkspaceLeaf.prototype.openFile = this.patchedOpenFile;

        this.app.workspace.onLayoutReady(() => this.closeDuplicateTabs());
    }

    onunload() {
        if (obsidian.WorkspaceLeaf.prototype.openFile === this.patchedOpenFile) {
            obsidian.WorkspaceLeaf.prototype.openFile = this.originalOpenFile;
        }
    }

    // The file a leaf shows; an unloaded (deferred) tab only has it in its saved state.
    leafFilePath(leaf) {
        return leaf.view?.file?.path || leaf.getViewState().state?.file || "";
    }

    mainAreaLeaves() {
        const leaves = [];
        this.app.workspace.iterateRootLeaves(leaf => leaves.push(leaf));
        return leaves;
    }

    async openFile(leaf, file, openState) {
        const original = () => this.originalOpenFile.call(leaf, file, openState);
        if (!file) {
            return original();
        }

        const inMainArea = leaf.getRoot() === this.app.workspace.rootSplit;
        const otherTab = inMainArea
            ? this.mainAreaLeaves().find(other => other !== leaf && this.leafFilePath(other) === file.path)
            : null;
        const decision = EdTabs.decideOpen({
            inMainArea,
            pinned: Boolean(leaf.getViewState().pinned),
            showsFile: this.leafFilePath(leaf),
            isEmpty: leaf.view?.getViewType() === "empty"
        }, file.path, Boolean(otherTab));

        if (decision === "switch") {
            // A new empty tab made just for this open (e.g. "Open in new tab") is not kept.
            if (leaf.view?.getViewType() === "empty") {
                leaf.detach();
            }
            this.app.workspace.setActiveLeaf(otherTab, { focus: true });
            await otherTab.loadIfDeferred();
            if (openState?.eState) {
                otherTab.setEphemeralState(openState.eState);
            }
            return;
        }

        if (decision === "newTab") {
            return this.originalOpenFile.call(this.app.workspace.getLeaf("tab"), file, openState);
        }

        return original();
    }

    closeDuplicateTabs() {
        const active = this.app.workspace.getMostRecentLeaf();
        const keptByPath = new Map();
        const duplicates = [];

        for (const leaf of this.mainAreaLeaves()) {
            const path = this.leafFilePath(leaf);
            if (!path || leaf.getViewState().pinned) {
                continue;
            }
            const kept = keptByPath.get(path);
            if (!kept) {
                keptByPath.set(path, leaf);
            } else if (leaf === active) {
                duplicates.push(kept);
                keptByPath.set(path, leaf);
            } else {
                duplicates.push(leaf);
            }
        }

        duplicates.forEach(leaf => leaf.detach());
    }
}

// In-bundle tests of the rule: jsload --test "EdTabs.Test.runAll()".
EdTabs.Test = {
    runAll() {
        const tab = overrides => ({ inMainArea: true, pinned: false, showsFile: "a.md", isEmpty: false, ...overrides });
        const cases = [
            ["file with a tab elsewhere switches to it", EdTabs.decideOpen(tab(), "b.md", true), "switch"],
            ["new file from a tab showing another opens a new tab", EdTabs.decideOpen(tab(), "b.md", false), "newTab"],
            ["new file in an empty tab opens in place", EdTabs.decideOpen(tab({ showsFile: "", isEmpty: true }), "b.md", false), "original"],
            ["empty tab for a file with a tab switches", EdTabs.decideOpen(tab({ showsFile: "", isEmpty: true }), "b.md", true), "switch"],
            ["same file in its own tab stays", EdTabs.decideOpen(tab(), "a.md", true), "original"],
            ["pinned tab keeps Obsidian's behavior", EdTabs.decideOpen(tab({ pinned: true }), "b.md", true), "original"],
            ["sidebar keeps Obsidian's behavior", EdTabs.decideOpen(tab({ inMainArea: false }), "b.md", true), "original"],
            ["non-file view (e.g. a plugin view) opens a new tab", EdTabs.decideOpen(tab({ showsFile: "" }), "b.md", false), "newTab"]
        ].map(([name, actual, expected]) => ({
            suite: "decideOpen",
            name,
            ok: actual === expected,
            message: `expected ${expected}, got ${actual}`
        }));
        const failed = cases.filter(c => !c.ok).length;
        return { passed: cases.length - failed, failed, cases };
    }
};

module.exports = EdTabsPlugin;
