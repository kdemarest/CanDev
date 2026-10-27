// Workspace file-name resolution, shared by gptviz, movi, and movi's compileText.
// Authored text names files by bare name ("Aeku", "Reference.md"), never by path. The vault-root
// workspace.json decides where they are:
//   path        folders searched in order; "dir/**" includes subfolders. The first match wins,
//               and a name found in more than one place is reported as shadowed.
//   outputs     where every generated file goes (Prompt and Extract images, Mark sidecars).
//   candidates  where gptviz keeps candidate images; never searched.
//   scan        folders whose notes gptviz and movi read for Prompt, Extract, Mark, Script.
// Matching ignores case. A name without an extension tries the caller's extensions in order.
// Each plugin's build.sh bundles this file; Node tools define unit() and require() it.
/* global unit */
unit("workspace-resolve", [], () => {
    const FILE = "workspace.json";

    const fail = message => {
        throw new Error(`${FILE}: ${message}`);
    };

    const parseDir = (value, field) => {
        if (typeof value !== "string" || !value.trim()) {
            fail(`'${field}' entries must be non-empty folder names.`);
        }
        let dir = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        const recurse = /\/\*\*$/.test(dir) || dir === "**";
        dir = dir.replace(/\/?\*\*$/, "");
        if (dir.includes("*") || dir.split("/").includes("..")) {
            fail(`'${field}' entry '${value}' must be a folder, optionally ending in /**.`);
        }
        return { dir, recurse };
    };

    const parseDirList = (raw, field) => {
        if (!Array.isArray(raw[field]) || raw[field].length === 0) {
            fail(`'${field}' must be a non-empty array of folders.`);
        }
        return raw[field].map(value => parseDir(value, field));
    };

    const parseFolder = (raw, field) => {
        const entry = parseDir(raw[field], field);
        if (entry.recurse) {
            fail(`'${field}' must be a single folder, without /**.`);
        }
        return entry.dir;
    };

    // Parses workspace.json text into { path, outputs, candidates, scan }; throws on bad input.
    function parse(text) {
        let raw;
        try {
            raw = JSON.parse(text);
        } catch (error) {
            fail(`invalid JSON: ${error.message}`);
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            fail("the root must be a JSON object.");
        }
        return {
            path: parseDirList(raw, "path"),
            outputs: parseFolder(raw, "outputs"),
            candidates: parseFolder(raw, "candidates"),
            scan: parseDirList(raw, "scan")
        };
    }

    const join = (dir, name) => (dir ? `${dir}/${name}` : name);

    const inDir = (filePath, entry) => {
        if (!entry.dir) {
            return entry.recurse || !filePath.includes("/");
        }
        const prefix = `${entry.dir}/`.toLowerCase();
        const lower = filePath.toLowerCase();
        if (!lower.startsWith(prefix)) {
            return false;
        }
        return entry.recurse || !lower.slice(prefix.length).includes("/");
    };

    // True when a vault path is in one of the scan folders.
    function inScan(config, filePath) {
        return config.scan.some(entry => inDir(filePath, entry));
    }

    // Index of the files on the search path: lowercased file name -> vault paths, in search order.
    // filePaths is every vault file path; files under the candidates folder are never indexed.
    function buildIndex(config, filePaths) {
        const index = new Map();
        const candidates = config.candidates.toLowerCase();
        config.path.forEach(entry => {
            for (const filePath of filePaths) {
                const lower = filePath.toLowerCase();
                if (lower.startsWith(`${candidates}/`) || !inDir(filePath, entry)) {
                    continue;
                }
                const name = lower.slice(lower.lastIndexOf("/") + 1);
                if (!index.has(name)) {
                    index.set(name, []);
                }
                const paths = index.get(name);
                if (!paths.includes(filePath)) {
                    paths.push(filePath);
                }
            }
        });
        return index;
    }

    // Finds a bare name on the search path. extensions are tried, in order, when the name has
    // none (e.g. [".png"], [".md"]). Returns { path, shadowed }, where shadowed lists the other
    // matches, or { error } when the name holds a folder or nothing matches.
    function resolve(index, name, extensions = []) {
        const bare = String(name || "").trim();
        if (!bare) {
            return { error: "empty file name" };
        }
        if (bare.includes("/") || bare.includes("\\")) {
            return { error: `'${bare}' names a folder; use the bare file name` };
        }
        const tries = /\.[^./]+$/.test(bare) ? [bare] : extensions.map(extension => bare + extension);
        for (const attempt of tries) {
            const paths = index.get(attempt.toLowerCase());
            if (paths && paths.length > 0) {
                return { path: paths[0], shadowed: paths.slice(1) };
            }
        }
        return { error: `'${bare}' is not on the search path` };
    }

    globalThis.WorkspaceResolve = {
        FILE,
        parse,
        inScan,
        buildIndex,
        resolve,
        outputPath: (config, name) => join(config.outputs, name),
        candidatePath: (config, name) => join(config.candidates, name)
    };
});
