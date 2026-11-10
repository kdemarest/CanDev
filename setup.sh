#!/data/data/com.termux/files/usr/bin/bash
# Recreates the dev workspace on an Android phone (Termux). Safe to re-run.
#   1. Each project repo: cloned if missing; re-linked if its files survived but its git
#      database did not (e.g. after a Termux reinstall); left alone if already working.
#      Git databases live in ~/git-repos (sdcard can't hold a real .git); see GITSETUP.md.
#      Canopy (the game) likewise, beside the workspace, as a sparse checkout (tools/canopy-sparse-checkout).
#   2. Lint/load-test tools: installed into ~/.local/share/devenv-tools (no node_modules on sdcard).
#   3. Plugins: built into .obsidian/plugins.
# Prerequisites: README.md.
set -euo pipefail

DEV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_REPOS="$HOME/git-repos"
TOOLS_HOME="$HOME/.local/share/devenv-tools"
GITHUB="https://github.com/kdemarest"
# folder:repo where they differ
PROJECTS=(docs:CanopyDocs vids:canvid layout:CanLayout gptviz movi modl aichat travel:WorldTravel CanopyGrid deps:CanDeps ObAiChat workout Medical:medical lens smash)
PLUGINS=(gptviz movi modl edtabs ObAiChat)

for cmd in git node npm python3 magick gh glslangValidator mcs javac aapt aapt2 d8 apksigner clang cmake make; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd. Run: pkg install git nodejs python python-numpy imagemagick gh glslang mono openjdk-21 aapt aapt2 d8 apksigner clang cmake make" >&2; exit 1; }
done
# Notifications (lens/drive.js asks Ken to wake the phone when Ocular is away; Ken, 2026-11-10): the
# termux-api package's commands, and the Termux:API app they talk to (without it they hang). The app
# must come from the same source as Termux (F-Droid here: their signatures must match), so it is
# installed by hand: https://f-droid.org/packages/com.termux.api/
command -v termux-notification >/dev/null || { echo "Missing termux-notification. Run: pkg install termux-api" >&2; exit 1; }
pm list packages com.termux.api 2>/dev/null | grep -q "package:com.termux.api$" || { echo "Missing the Termux:API app: install it from F-Droid (https://f-droid.org/packages/com.termux.api/), the same source as Termux" >&2; exit 1; }
# modl's model scripts paint their textures with numpy (Termux's package; pip can't build it here)
python3 -c "import numpy" 2>/dev/null || { echo "Missing numpy. Run: pkg install python-numpy" >&2; exit 1; }
# Medical reads MRI DICOM (pydicom); Resoscan's are JPEG-LS, decoded by pylibjpeg-libjpeg. No Android
# wheel exists, so it compiles with clang (~1.5 min). --no-build-isolation keeps pip from building numpy.
if ! python3 -c "import pydicom, libjpeg" 2>/dev/null; then
  pip install pydicom cython poetry-core setuptools
  pip install --no-build-isolation --no-deps pylibjpeg pylibjpeg-libjpeg
fi

if [ -z "$(git config --global user.name || true)" ]; then
  read -rp "Git user name: " name
  read -rp "Git email: " email
  git config --global user.name "$name"
  git config --global user.email "$email"
fi
git config --global init.defaultBranch main
# Unless a credential helper is already set up: the GitHub PAT is asked for on first push,
# then stored in ~/.git-credentials.
if [ -z "$(git config --global --get credential.helper || true)" ]; then
  git config --global credential.helper store
fi
# gh (the GitHub CLI) watches and re-runs Actions, e.g. the travel map's GitHub Pages deploy.
# Logging in is interactive, so only remind; the same PAT works: gh auth login --with-token
gh auth status >/dev/null 2>&1 || echo "gh: not logged in. Run: gh auth login   (see README.md, New phone)"

mkdir -p "$GIT_REPOS"

# The workspace itself is the repo CanDev: after a Termux reinstall its .git file points at a
# git dir that may be gone; re-point it, or re-link it to a fresh clone (never touching files).
git config --global --get-all safe.directory | grep -qxF "$DEV" || git config --global --add safe.directory "$DEV"
if ! git -C "$DEV" rev-parse --git-dir >/dev/null 2>&1; then
  if [ -d "$GIT_REPOS/CanDev.git" ]; then
    echo "workspace: re-pointing to $GIT_REPOS/CanDev.git"
    echo "gitdir: $GIT_REPOS/CanDev.git" > "$DEV/.git"
  else
    echo "workspace: re-linking to a fresh clone of CanDev"
    rm -f "$DEV/.git"
    git -C "$DEV" init -q --separate-git-dir="$GIT_REPOS/CanDev.git"
    git -C "$DEV" remote add origin "$GITHUB/CanDev.git"
    git -C "$DEV" fetch -q origin && git -C "$DEV" reset -q origin/main
  fi
fi

# Search path, outputs and scan folders for gptviz and movi (see tools/resolve.js).
if [ ! -f "$DEV/workspace.json" ]; then
  echo "workspace.json: writing the default"
  cat > "$DEV/workspace.json" <<'JSON'
{
  "path": ["vids", "docs/**"],
  "outputs": "vids",
  "candidates": "vids/candidates",
  "scan": ["vids", "docs/**"]
}
JSON
fi

for entry in "${PROJECTS[@]}"; do
  p=${entry%%:*} repo=${entry#*:}
  wt="$DEV/$p"
  gd="$GIT_REPOS/$repo.git"

  # sdcard is FUSE-mounted, so git distrusts its ownership; trust each project explicitly.
  git config --global --get-all safe.directory | grep -qxF "$wt" || git config --global --add safe.directory "$wt"

  if [ -d "$wt" ] && git -C "$wt" rev-parse --git-dir >/dev/null 2>&1; then
    echo "$p: ok"
  elif [ -d "$gd" ]; then
    echo "$p: re-pointing to $gd"
    restore_files=false
    [ -d "$wt" ] || restore_files=true
    mkdir -p "$wt"
    echo "gitdir: $gd" > "$wt/.git"
    # Folder was gone entirely: check the files back out (never done over existing files).
    if $restore_files; then
      git -C "$wt" checkout -q -f HEAD -- .
    fi
  elif [ -d "$wt" ]; then
    # Files survived, database did not: re-link without touching untracked files.
    echo "$p: re-linking existing files to a fresh clone of origin"
    rm -f "$wt/.git"
    git -C "$wt" init -q --separate-git-dir="$gd"
    git -C "$wt" remote add origin "$GITHUB/$repo.git"
    git -C "$wt" fetch -q origin
    git -C "$wt" checkout -q -f -B main origin/main
    git -C "$wt" branch -q --set-upstream-to=origin/main main
  else
    echo "$p: cloning"
    git clone -q --separate-git-dir="$gd" "$GITHUB/$repo.git" "$wt"
  fi
done

# Canopy, the game (Unity), beside the workspace: a shallow, blob:none clone with a sparse checkout
# (the whole repo is gigabytes of art), its file list tools/canopy-sparse-checkout; layout fetches
# other blobs as it needs them. The list is (re)installed and applied whenever it changes.
CANOPY="$(dirname "$DEV")/Canopy"
CANOPY_GD="$GIT_REPOS/Canopy.git"
CANOPY_SPARSE="$DEV/tools/canopy-sparse-checkout"
git config --global --get-all safe.directory | grep -qxF "$CANOPY" || git config --global --add safe.directory "$CANOPY"
if [ -d "$CANOPY" ] && git -C "$CANOPY" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Canopy: ok"
elif [ -d "$CANOPY_GD" ]; then
  echo "Canopy: re-pointing to $CANOPY_GD"
  mkdir -p "$CANOPY"
  echo "gitdir: $CANOPY_GD" > "$CANOPY/.git"
else
  survived=false
  [ -d "$CANOPY/Assets" ] && survived=true
  echo "Canopy: cloning (sparse, shallow; only the files tools/canopy-sparse-checkout lists)"
  mkdir -p "$CANOPY"
  rm -f "$CANOPY/.git"
  git -C "$CANOPY" init -q --separate-git-dir="$CANOPY_GD"
  git -C "$CANOPY" remote add origin "$GITHUB/Canopy.git"
  git -C "$CANOPY" config remote.origin.fetch "+refs/heads/main:refs/remotes/origin/main"
  git -C "$CANOPY" config remote.origin.promisor true
  git -C "$CANOPY" config remote.origin.partialclonefilter blob:none
  git -C "$CANOPY" sparse-checkout init --no-cone
  cp "$CANOPY_SPARSE" "$CANOPY_GD/info/sparse-checkout"
  git -C "$CANOPY" fetch -q --depth 1 --filter=blob:none origin main
  if $survived; then
    # Files survived on sdcard (e.g. a Termux reinstall): keep them, uncommitted edits and all.
    git -C "$CANOPY" symbolic-ref HEAD refs/heads/main
    git -C "$CANOPY" update-ref refs/heads/main origin/main
    git -C "$CANOPY" reset -q
    git -C "$CANOPY" sparse-checkout reapply
    echo "Canopy: files kept; listed files missing from sdcard show as deleted (git -C $CANOPY status)"
  else
    git -C "$CANOPY" checkout -q -B main origin/main
  fi
  git -C "$CANOPY" branch -q --set-upstream-to=origin/main main
fi
if ! cmp -s "$CANOPY_SPARSE" "$CANOPY_GD/info/sparse-checkout"; then
  echo "Canopy: applying tools/canopy-sparse-checkout"
  cp "$CANOPY_SPARSE" "$CANOPY_GD/info/sparse-checkout"
  git -C "$CANOPY" sparse-checkout reapply
fi

echo "tools: installing into $TOOLS_HOME"
mkdir -p "$TOOLS_HOME" "$HOME/.local/bin"
cp "$DEV/tools/package.json" "$DEV/tools/package-lock.json" "$TOOLS_HOME/"
(cd "$TOOLS_HOME" && npm ci --no-fund --no-audit --loglevel=error)
# Arm's ASTC encoder, for layout's compressed textures (layout/tools/texture-astc.js). Termux has no
# package for it, so it is built from its tag; the version file skips this once done.
ASTC_TAG=5.7.1
if [ "$(cat "$TOOLS_HOME/bin/astcenc.version" 2>/dev/null)" != "$ASTC_TAG" ]; then
  echo "tools: building astcenc $ASTC_TAG"
  rm -rf "$TOOLS_HOME/src/astc-encoder"
  mkdir -p "$TOOLS_HOME/src" "$TOOLS_HOME/bin"
  git clone -q --depth 1 --branch "$ASTC_TAG" -c advice.detachedHead=false https://github.com/ARM-software/astc-encoder.git "$TOOLS_HOME/src/astc-encoder"
  cmake -S "$TOOLS_HOME/src/astc-encoder" -B "$TOOLS_HOME/src/astc-encoder/build" -DCMAKE_BUILD_TYPE=Release -DASTCENC_ISA_NEON=ON -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ >/dev/null
  make -C "$TOOLS_HOME/src/astc-encoder/build" -j"$(nproc)" >/dev/null
  cp "$TOOLS_HOME/src/astc-encoder/build/Source/astcenc-neon" "$TOOLS_HOME/bin/astcenc"
  echo "$ASTC_TAG" > "$TOOLS_HOME/bin/astcenc.version"
fi
# sdcard is mounted noexec, so the command on PATH runs the tracked script through bash.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/tools/jslint" "$@"\n' "$DEV" > "$HOME/.local/bin/jslint"
chmod +x "$HOME/.local/bin/jslint"
# ktcheck: type-checks smash's Kotlin on the phone, no Gradle (tools/ktcheck/README.md); --prepare
# downloads android.jar and smash's dependencies and builds the compile server, once
command -v kotlinc >/dev/null || { echo "Missing kotlinc. Run: pkg install kotlin" >&2; exit 1; }
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/tools/ktcheck/ktcheck.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/ktcheck"
chmod +x "$HOME/.local/bin/ktcheck"
[ -d "$DEV/smash" ] || { echo "setup: smash isn't cloned, so ktcheck can't prepare for it" >&2; exit 1; }
bash "$DEV/tools/ktcheck/ktcheck.sh" --prepare "$DEV/smash"
# runLayout starts layout in the background (auto-restarting on edits); also a Termux:Widget button.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/layout/runLayout.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/runLayout"
chmod +x "$HOME/.local/bin/runLayout"
mkdir -p "$HOME/.shortcuts"
printf '#!/data/data/com.termux/files/usr/bin/bash\n# Termux:Widget shortcut: start layout and open it in the browser.\n~/.local/bin/runLayout\n' > "$HOME/.shortcuts/runLayout"
chmod +x "$HOME/.shortcuts/runLayout"
# runDeps keeps deps/status.md current in the background (read-only; see deps/README.md).
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/deps/runDeps.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/runDeps"
chmod +x "$HOME/.local/bin/runDeps"
# runTravel starts the trip map server (travel/, a separate project) and opens it; also a widget button.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/travel/runTravel.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/runTravel"
chmod +x "$HOME/.local/bin/runTravel"
printf '#!/data/data/com.termux/files/usr/bin/bash\n# Termux:Widget shortcut: start the trip map and open it in the browser.\n~/.local/bin/runTravel\n' > "$HOME/.shortcuts/runTravel"
chmod +x "$HOME/.shortcuts/runTravel"
# runWorkout serves the workout timer pages (workout/, also on GitHub Pages) locally and opens Ken's; also a widget button.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/workout/runWorkout.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/runWorkout"
chmod +x "$HOME/.local/bin/runWorkout"
printf '#!/data/data/com.termux/files/usr/bin/bash\n# Termux:Widget shortcut: start the workout timer and open it in the browser.\n~/.local/bin/runWorkout\n' > "$HOME/.shortcuts/runWorkout"
chmod +x "$HOME/.shortcuts/runWorkout"
# runLens starts the Lens bridge (lens/: research browser with Claude) and opens the app; also a widget button.
# The app itself: bash lens/build.sh builds it and opens the installer (Android asks to confirm).
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/lens/runLens.sh" "$@"\n' "$DEV" > "$HOME/.local/bin/runLens"
chmod +x "$HOME/.local/bin/runLens"
printf '#!/data/data/com.termux/files/usr/bin/bash\n# Termux:Widget shortcut: start the Lens bridge and open Lens.\n~/.local/bin/runLens\n' > "$HOME/.shortcuts/runLens"
chmod +x "$HOME/.shortcuts/runLens"
# runOcular: the Termux Claude's own test browser (Ken, 2026-11-10), a separate app (bash lens/build.sh
# --ocular) with its own bridge, so testing never touches Lens; lens/drive.js drives it.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/lens/runLens.sh" --ocular "$@"\n' "$DEV" > "$HOME/.local/bin/runOcular"
chmod +x "$HOME/.local/bin/runOcular"
# backupPhone pushes every Canopy repo's uncommitted work to its backup/phone branch (tools/backup.sh); also a widget button.
printf '#!/data/data/com.termux/files/usr/bin/bash\n# Termux:Widget shortcut: push uncommitted Canopy work to backup/phone branches on GitHub.\nbash "%s/tools/backup.sh"\nread -rp "Press Enter to close."\n' "$DEV" > "$HOME/.shortcuts/backupPhone"
chmod +x "$HOME/.shortcuts/backupPhone"

for p in "${PLUGINS[@]}"; do
  echo "$p: building"
  (cd "$DEV/$p" && bash build.sh)
done

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "Add ~/.local/bin to PATH for jslint (e.g. in ~/.bashrc)." ;;
esac
echo "Done. Open $DEV as the Obsidian vault."
