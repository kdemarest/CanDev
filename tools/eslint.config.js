// ESLint config for the plugin projects in this workspace (run via tools/jslint).
// Each plugin is a set of plain scripts concatenated into one bundle (see _preamble.js),
// so cross-file names are declared here as globals.
// Packages come from the tool install (setup.sh), since node_modules can't live on sdcard.
const path = require("path");
const { createRequire } = require("module");

const toolsHome = process.env.DEVENV_TOOLS || path.join(process.env.HOME, ".local/share/devenv-tools");
const toolRequire = createRequire(path.join(toolsHome, "package.json"));
const js = toolRequire("@eslint/js");
const globals = toolRequire("globals");

const DEV = path.resolve(__dirname, "..");

const shared = {
    ...globals.browser,
    require: "readonly",
    module: "writable",
    unit: "readonly",
    runUnits: "readonly",
    WorkspaceResolve: "readonly"
};

module.exports = [
    {
        basePath: DEV,
        ignores: [
            "**/assembled-plugin.js",
            "**/vendor/**",
            "**/node_modules/**",
            ".obsidian/**",
            "OLDaichat/**",
            "layout/web/three.js",
            "docs/**",
            "vids/**",
            "travel/cache/**",
            "travel/data/**"
        ]
    },
    {
        // Plugin code runs in Obsidian's browser context.
        basePath: DEV,
        files: ["gptviz/**/*.js", "movi/**/*.js", "modl/**/*.js", "edtabs/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "script",
            globals: shared
        },
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
        }
    },
    { basePath: DEV, files: ["gptviz/**/*.js"], languageOptions: { globals: { GPTViz: "writable" } } },
    { basePath: DEV, files: ["modl/**/*.js"], languageOptions: { globals: { MODL: "writable" } } },
    { basePath: DEV, files: ["movi/**/*.js"], ignores: ["movi/main.js"], languageOptions: { globals: { Movi: "readonly" } } },
    {
        // Node tooling: workspace tools/, movi/tools/ and modl/tools/.
        basePath: DEV,
        files: ["tools/**/*.js", "movi/tools/**/*.js", "modl/tools/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: globals.node },
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }]
        }
    },
    {
        // layout's page: plain browser scripts sharing THREE, Space and Surface.
        basePath: DEV,
        files: ["layout/web/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser, THREE: "readonly", Space: "writable", Surface: "writable", module: "readonly" } },
        rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
    },
    {
        // layout's server and tools.
        basePath: DEV,
        files: ["layout/*.js", "layout/tools/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: globals.node },
        rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
    },
    {
        // deps: Node, read-only status of the workspace.
        basePath: DEV,
        files: ["deps/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: globals.node },
        rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
    },
    {
        // travel's page: plain browser scripts (days.js also loads in Node).
        basePath: DEV,
        files: ["travel/app/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser, L: "readonly", module: "readonly" } },
        rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
    },
    {
        // travel's server and tools.
        basePath: DEV,
        files: ["travel/*.js", "travel/tools/**/*.js"],
        ...js.configs.recommended,
        languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: globals.node },
        rules: { ...js.configs.recommended.rules, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] }
    },
    {
        // The preamble defines unit/runUnits for every other file.
        basePath: DEV,
        files: ["*/_preamble.js"],
        languageOptions: { globals: { unit: "off", runUnits: "off" } },
        rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^(unit|runUnits)$" }] }
    }
];
