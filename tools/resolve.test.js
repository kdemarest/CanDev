// Tests for tools/resolve.js: node tools/resolve.test.js
"use strict";
const assert = require("assert");
globalThis.unit = (name, deps, factory) => factory();
require("./resolve.js");
const W = globalThis.WorkspaceResolve;

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

const config = W.parse(JSON.stringify({
    path: ["vids", "docs/**"],
    outputs: "vids",
    candidates: "vids/candidates",
    scan: ["vids", "docs/**"]
}));
const files = [
    "vids/Aeku.png",
    "vids/Reference.md",
    "vids/candidates/Aeku-26.png",
    "vids/sub/Deep.png",
    "docs/characters/Aeku.md",
    "docs/characters/Navimax.md",
    "docs/Reference.md",
    "gptviz/README.md"
];
const index = W.buildIndex(config, files);

test("parse reads folders and recursion", () => {
    assert.deepStrictEqual(config.path, [{ dir: "vids", recurse: false }, { dir: "docs", recurse: true }]);
    assert.strictEqual(config.outputs, "vids");
});
test("parse rejects a missing field", () => {
    assert.throws(() => W.parse('{"path":["vids"],"outputs":"vids","scan":["vids"]}'), /candidates/);
});
test("parse rejects a recursive outputs folder", () => {
    assert.throws(() => W.parse('{"path":["vids"],"outputs":"vids/**","candidates":"c","scan":["vids"]}'), /single folder/);
});
test("parse rejects bad JSON", () => {
    assert.throws(() => W.parse("{"), /invalid JSON/);
});
test("bare name with a default extension", () => {
    assert.deepStrictEqual(W.resolve(index, "Aeku", [".png"]), { path: "vids/Aeku.png", shadowed: [] });
});
test("matching ignores case", () => {
    assert.strictEqual(W.resolve(index, "navimax.MD").path, "docs/characters/Navimax.md");
});
test("extensions are tried in order", () => {
    assert.strictEqual(W.resolve(index, "Aeku", [".md", ".png"]).path, "docs/characters/Aeku.md");
});
test("vids is searched first and the shadowed copy is reported", () => {
    assert.deepStrictEqual(W.resolve(index, "Reference.md"), { path: "vids/Reference.md", shadowed: ["docs/Reference.md"] });
});
test("candidates are never on the path", () => {
    assert.match(W.resolve(index, "Aeku-26.png").error, /not on the search path/);
});
test("a non-recursive folder skips subfolders", () => {
    assert.ok(W.resolve(index, "Deep.png").error);
});
test("files outside the path are not found", () => {
    assert.ok(W.resolve(index, "README.md").error);
});
test("a name holding a folder is an error", () => {
    assert.match(W.resolve(index, "candidates/Aeku-26.png").error, /bare file name/);
});
test("scan membership", () => {
    assert.ok(W.inScan(config, "docs/characters/Aeku.md"));
    assert.ok(W.inScan(config, "vids/Aeku.md"));
    assert.ok(!W.inScan(config, "vids/sub/Deep.md"));
    assert.ok(!W.inScan(config, "gptviz/README.md"));
});
test("output and candidate paths", () => {
    assert.strictEqual(W.outputPath(config, "Aeku.png"), "vids/Aeku.png");
    assert.strictEqual(W.candidatePath(config, "Aeku-27.png"), "vids/candidates/Aeku-27.png");
});

let failed = 0;
for (const { name, fn } of cases) {
    try {
        fn();
    } catch (error) {
        failed++;
        console.log(`FAIL ${name}: ${error.message}`);
    }
}
console.log(`resolve tests: passed=${cases.length - failed} failed=${failed}`);
process.exitCode = failed ? 1 : 0;
