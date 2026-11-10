# dev workspace

Obsidian vault and workspace for the game-movie projects, plus travel planning. Each project is its own repo:

| Folder | Repo | What |
|---|---|---|
| `docs/` | kdemarest/CanopyDocs | Canopy game design: one file per game element |
| `vids/` | kdemarest/canvid | video content: scenes, prompts, scripts, images, `candidates/` |
| `gptviz/` | kdemarest/gptviz | plugin: AI image generation |
| `movi/` | kdemarest/movi | plugin: movie playback |
| `modl/` | kdemarest/modl | plugin: procedural 3D assets (modeling language) |
| `layout/` | kdemarest/CanLayout | web app: view Unity areas, compose scenes (`runLayout`) |
| `deps/` | kdemarest/CanDeps | what is out of date across the projects, and why (`deps/status.md`); its page builds what you tick (`runDeps`, http://localhost:8070/) |
| `aichat/` | kdemarest/aichat | plugin: Claude CLI in the browser (on hold; docs only so far) |
| `ObAiChat/` | kdemarest/ObAiChat | plugin: ChatGPT inside Obsidian (was OLDaichat; based on Chatting with AI) |
| `travel/` | kdemarest/WorldTravel | trip maps, a separate project (not Canopy): one dot per day of a trip (`runTravel`) |
| `CanopyGrid/` | kdemarest/CanopyGrid | Unity project that cut Canopy's trees into grid chunks (Dicer, Mantis LOD); reference for `layout/tools/dice.js` and `mantis.js`. Canopy holds the authoritative sources |
| `workout/` | kdemarest/workout | web app: workout timers for Ken ("Ken Arms" doc) and Lulu ("Rehab Lulu" doc), on GitHub Pages at https://kdemarest.github.io/workout/ (`runWorkout` serves it locally, http://localhost:8095/ken/) |
| `Medical/` | kdemarest/medical (private) | Ken's and Lulu's medical records, one folder per person and topic; start at `Medical/index.md` |
| `lens/` | kdemarest/lens | Android app: a research browser with a Claude chat pane; Claude drives the page and has this workspace (`runLens`; build with `bash lens/build.sh`). Also Ocular, the Termux Claude's own copy for testing pages (`runOcular`, `bash lens/build.sh --ocular`) |
| `smash/` | kdemarest/smash | Android app: SMS repeater, with AWS Lambdas for email forwarding and logs (Gradle; build scripts are Windows `.cmd`) |
| `edtabs/` | kdemarest/CanDev (this repo) | plugin: code-editor-style tabs, one tab per file |

`Todo.md` is the roadmap for the whole workspace, in priority order.

This folder itself is the repo kdemarest/CanDev (git dir `~/git-repos/CanDev.git`), which ignores the project folders. It holds what ties them together: `setup.sh`, `tools/` (lint, load test, the shared `resolve.js`), `CLAUDE.md`, the vault config in `.obsidian/`, and `workspace.json`.

Backup: uncommitted work lives only on this phone, so `bash tools/backup.sh` (or the `backupPhone` widget button) pushes a snapshot of each Canopy repo's working tree (Canopy, this folder, layout, modl, docs, vids; or the repos you name) to its `backup/phone` branch on GitHub. It leaves the local branch, index and files alone, never touches `main`, and each run replaces the last snapshot. To restore or test one elsewhere (Unity on the PC): `git fetch origin backup/phone`, then check it out or `git diff main origin/backup/phone`.

`workspace.json` tells gptviz and movi where files are. Notes name files by bare name (`Images: Aeku`, `{#include Reference}`), never by path; `path` lists the folders searched, in order, and `dir/**` includes subfolders. Every generated image goes to `outputs`, candidates to `candidates` (never searched), and `scan` lists the folders whose notes hold Prompt, Extract, Mark, and Script sections. `node tools/resolve.test.js` tests the resolver.

## New phone

1. Install Termux from F-Droid, and Termux:API from F-Droid too (it must come from the same source as Termux: their signatures must match), then:
   ```bash
   pkg update && pkg install git nodejs python imagemagick gh glslang mono openjdk-21 aapt aapt2 d8 apksigner termux-api
   termux-setup-storage   # grant storage access
   gh auth login          # the GitHub CLI; paste the PAT (below)
   ```
   `glslang` compiles modl's generated shaders to check them (`modl/tools/shaders.js`), and Canopy shader code Claude writes. `mono` gives `mcs`, a C# compiler, to check Canopy C# Claude writes against stubs of the Unity API it uses (Canopy itself only builds in Unity). `gh` runs and watches GitHub Actions, such as the travel map's GitHub Pages deploy. One fine-grained PAT serves both git and `gh`: give it the project repos, with Repository permissions Contents, Workflows (to push `.github/workflows/`), Actions and Pages, all Read and write. Turning Pages on for a repo the first time needs Administration too, or the repo's Settings → Pages → Source: GitHub Actions by hand. `openjdk-21`, `aapt`, `aapt2`, `d8` and `apksigner` build the Lens app on the phone (`lens/build.sh`), and Ocular, Claude's own copy of it for testing pages (`lens/build.sh --ocular`, `runOcular`). `termux-api` and the Termux:API app let tools post notifications (`lens/drive.js` asks you to wake the phone when Ocular is away).
2. Clone this workspace (repo kdemarest/CanDev) to `/sdcard/dev`, its git dir in Termux's storage: `git clone --separate-git-dir=$HOME/git-repos/CanDev.git https://github.com/kdemarest/CanDev.git /sdcard/dev`.
3. `bash /sdcard/dev/setup.sh`: clones every project, installs the tools, builds the plugins. Re-run it any time, e.g. after a Termux reinstall.
4. Open `/sdcard/dev` as the vault in Obsidian, and install from Settings → Community plugins: Hot Reload, VSCode Editor, Chatting with AI. Their settings come with the repo (`.obsidian/plugins/*/data.json`); our own plugins (gptviz, movi, modl, edtabs, ObAiChat) are built into the vault by `setup.sh`.

Git layout and recovery details: `GITSETUP.md`.

## Daily use

- Scripts on sdcard run via `bash script.sh` (sdcard is mounted noexec).
- Plugins: `bash build.sh` in the plugin folder: syntax check, `tools/jsload.js` load test, then install into `.obsidian/plugins`.
- `jslint` lints gptviz, movi, modl, edtabs, layout, travel, deps, workout, lens, tools.
- Git per project as usual (`git -C vids pull`, etc.); the database lives in `~/git-repos/<repo>.git`.
