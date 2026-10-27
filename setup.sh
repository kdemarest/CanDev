#!/data/data/com.termux/files/usr/bin/bash
# Recreates the dev workspace on an Android phone (Termux). Safe to re-run.
#   1. Each project repo: cloned if missing; re-linked if its files survived but its git
#      database did not (e.g. after a Termux reinstall); left alone if already working.
#      Git databases live in ~/git-repos (sdcard can't hold a real .git); see GITSETUP.md.
#   2. Lint/load-test tools: installed into ~/.local/share/devenv-tools (no node_modules on sdcard).
#   3. Plugins: built into .obsidian/plugins.
# Prerequisites: README.md.
set -euo pipefail

DEV="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_REPOS="$HOME/git-repos"
TOOLS_HOME="$HOME/.local/share/devenv-tools"
GITHUB="https://github.com/kdemarest"
# folder:repo where they differ
PROJECTS=(docs:CanopyDocs vids:canvid layout:CanLayout gptviz movi modl aichat travel:WorldTravel CanopyGrid deps:CanDeps gptchat)
PLUGINS=(gptviz movi modl edtabs gptchat)

for cmd in git node npm python3 magick gh glslangValidator; do
  command -v "$cmd" >/dev/null || { echo "Missing $cmd. Run: pkg install git nodejs python imagemagick gh glslang" >&2; exit 1; }
done

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

echo "tools: installing into $TOOLS_HOME"
mkdir -p "$TOOLS_HOME" "$HOME/.local/bin"
cp "$DEV/tools/package.json" "$DEV/tools/package-lock.json" "$TOOLS_HOME/"
(cd "$TOOLS_HOME" && npm ci --no-fund --no-audit --loglevel=error)
# sdcard is mounted noexec, so the command on PATH runs the tracked script through bash.
printf '#!/data/data/com.termux/files/usr/bin/bash\nexec bash "%s/tools/jslint" "$@"\n' "$DEV" > "$HOME/.local/bin/jslint"
chmod +x "$HOME/.local/bin/jslint"
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

for p in "${PLUGINS[@]}"; do
  echo "$p: building"
  (cd "$DEV/$p" && bash build.sh)
done

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "Add ~/.local/bin to PATH for jslint (e.g. in ~/.bashrc)." ;;
esac
echo "Done. Open $DEV as the Obsidian vault."
