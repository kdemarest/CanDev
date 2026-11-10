# dev workspace

## Reproducibility (top priority)
- Everything needed to work here must be recreatable from git clones plus `setup.sh` plus standard installs (`pkg`, npm via tracked lockfiles). Nothing that matters may live only in `~`, a global config, or an untracked file.
- New tools, configs, or setup steps go in this workspace (`tools/`, `setup.sh`, `.obsidian/` settings) or a project repo, never only on this device. Update `setup.sh`/`README.md` in the same change.

## Loud errors: silent fallbacks are FORBIDDEN
**Never write code that hides a problem.** Ken MUST have loud errors (2026-11-09). A missing hook, file, setting, field or value throws an error that names what is missing and where it should have come from. It is never papered over with a stand-in value. All of these are forbidden:
- `x || 9.81`, `?? 10`, `: [10]` and the like for a value that should have been read.
- `typeof f === "function" ? f() : default` for a hook that should exist.
- `catch { return [] }`, `catch { return null }` or an empty `catch` around a read that should succeed.
- `if (!thing) continue;` skipping data that should be there, without saying so.

A fallback hides the real bug: a stale page, a reader that broke, a renamed file. The fix is to make the failure visible and fix the cause, or tell Ken what to do (reload the page, run a tool), never to default. A value that is genuinely optional is fine to default, but say why in a comment.

## Git
- Commit or push only when the user authorizes it for that change. Otherwise leave changes uncommitted and say what changed, so the user can commit or ask you to. This applies to every repo here, including `Medical/` and `workout/`.
- Exception: `docs/` follows its own CLAUDE.md, which commits and pushes at the end of each phase.

## Dependencies
- Vendor unminified three.js (`build/three.js`), never `three.min.js`, unless there is a compelling reason. The r160 minified build has a minifier bug that breaks lit rendering.

## Tools
- `jslint` (ESLint, config `tools/eslint.config.js`) after JS edits; lints gptviz, movi, modl, edtabs, layout, travel, deps, workout, lens, tools. Fix `no-undef` before building.
- Each plugin's `build.sh` runs `tools/jsload.js` (fake-Obsidian load test: construct, onload, onunload). If a bundle uses an Obsidian export the fake lacks, add it to the fake.
- `jsload --test <expr>` also runs a plugin's in-bundle test suite (movi: `Movi.Test.runAll()`, parser + logger); add tests there when changing the parser.
- Tool packages install to `~/.local/share/devenv-tools` via `setup.sh` (node_modules can't live on sdcard).

## Sites that work in Ken's browser but refuse scripts
- Don't reverse-engineer them. If Ken can open the page, open it in Lens (`runLens --no-claude --mini <url>`, then `node lens/drive.js`), a real browser, and take what the page itself loads. Its downloads keep the session.

## Installing Python packages
- Termux has no prebuilt wheels for many packages, so pip compiles them with clang. Never let pip rebuild numpy: use Termux's `python-numpy`, and install with `--no-build-isolation --no-deps`, after installing the build tools that package names. Run long installs in the background with a log.

## Showing Ken images
- Write any image Ken should look at (a model preview, a render, a comparison) to `/sdcard/Download/preview.png`, overwriting it each time; several views go side by side in that one file (`magick a.png b.png +append`). Ken opens it from Downloads; long paths are hard to copy on the phone.

## Toolchain speed
- Game development speed is directly proportional to the speed and effectiveness of the toolchain, so optimizing tools matters a lot (Ken, 2026-11-04). When a tool Ken waits on (a build, an install, a Tweak drag, a scene load) is slow, measure where the time goes and propose speedups; prefer caching what didn't change, using every core, and vectorizing (numpy is fine) over waiting.
