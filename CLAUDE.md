# dev workspace

## Reproducibility (top priority)
- Everything needed to work here must be recreatable from git clones plus `setup.sh` plus standard installs (`pkg`, npm via tracked lockfiles). Nothing that matters may live only in `~`, a global config, or an untracked file.
- New tools, configs, or setup steps go in this workspace (`tools/`, `setup.sh`, `.obsidian/` settings) or a project repo, never only on this device. Update `setup.sh`/`README.md` in the same change.

## Git
- Never commit or push. The user commits and pushes as needed.
- Exception: `docs/` follows its own CLAUDE.md, which commits and pushes at the end of each phase.

## Dependencies
- Vendor unminified three.js (`build/three.js`), never `three.min.js`, unless there is a compelling reason. The r160 minified build has a minifier bug that breaks lit rendering.

## Tools
- `jslint` (ESLint, config `tools/eslint.config.js`) after JS edits; lints gptviz, movi, modl, edtabs, layout, travel, deps, tools. Fix `no-undef` before building.
- Each plugin's `build.sh` runs `tools/jsload.js` (fake-Obsidian load test: construct, onload, onunload). If a bundle uses an Obsidian export the fake lacks, add it to the fake.
- `jsload --test <expr>` also runs a plugin's in-bundle test suite (movi: `Movi.Test.runAll()`, parser + logger); add tests there when changing the parser.
- Tool packages install to `~/.local/share/devenv-tools` via `setup.sh` (node_modules can't live on sdcard).
