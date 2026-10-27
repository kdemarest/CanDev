# GITSETUP.md — Termux + Git, the complete story

Everything needed to get git working on a fresh Termux install, on Android,
with the project living on `sdcard` (shared storage). Written so this never
needs re-derivation from scratch again.

---

## 0. Prerequisites (already covered in README.md)

- Termux installed from **F-Droid only** (`https://f-droid.org/packages/com.termux/`).
  Never Play Store — deprecated, frozen, broken mirrors.
- `pkg update && pkg upgrade`
- `termux-setup-storage` — grants access to `~/storage/shared` (= `sdcard`)
- `pkg install git nodejs`

---

## 1. Why git can't just live on sdcard normally

`sdcard` (shared storage) is FUSE-mounted, not a native Linux filesystem.
It doesn't support the file permissions, symlinks, and other Unix
semantics that a real `.git` directory needs internally. Putting `.git`
directly on `sdcard` will eventually corrupt or misbehave.

**Fix:** keep the *working tree* (your actual files) on `sdcard`, but keep
the *real* `.git` directory in Termux's own private, native-Linux storage
(`$HOME`, i.e. `/data/data/com.termux/files/home/...`). The project folder
on `sdcard` gets a small `.git` **file** (not directory) that just points
at the real one elsewhere:

```
gitdir: /data/data/com.termux/files/home/git-repos/<project>.git
```

This is done via `--separate-git-dir`.

**Consequence:** the real `.git` directory lives in Termux's app-private
storage, which is wiped if Termux is ever uninstalled. The `sdcard`
working tree survives; the `.git` pointer will dangle. This is expected —
see "Recovering after a Termux reinstall" below.

---

## 2. One-time global git config (per fresh Termux install)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### Default branch name (optional, silences a warning)

```bash
git config --global init.defaultBranch main
```

### Trust sdcard paths

Git refuses to operate on directories where it thinks ownership looks
"dubious" — this reliably happens with FUSE-mounted `sdcard` paths on
Android. You'll hit this **per project folder**, the first time you use
each one:

```bash
git config --global --add safe.directory /storage/emulated/0/dev/<project>
```

(`/storage/emulated/0/` is the same thing as `sdcard`/`~/storage/shared/`,
just the raw path git reports.)

---

## 3. Authentication (GitHub)

Use HTTPS + Personal Access Token (PAT)

GitHub no longer accepts your account password over HTTPS — you must use
a **Personal Access Token** (create one at
`github.com/settings/tokens`) used *as* the password when git prompts.

To avoid re-entering it every time, cache it:

```bash
git config --global credential.helper store
```

- `store` → PAT saved in **plaintext** in `~/.git-credentials` after first
  successful auth. Convenient, but sensitive — back this file up carefully,
  don't share it, and note it now lives in Termux's private storage (not
  `sdcard`), so it needs explicit backup.
- `cache` (alternative) → held in memory only, times out (default 15 min),
  never touches disk, **cannot be backed up** — you'll just re-enter it
  after every fresh install. No action needed either way, just know which
  one you're using:
  ```bash
  git config --get credential.helper
  ```

First push/pull after setting this will prompt once for username + PAT,
then remember it.

One fine-grained PAT (`CanopyClaude`) covers every repo: add each new repo
under its **Repository access** (Contents: read and write); the token text
doesn't change. `~/.git-credentials` holds one line,
`https://kdemarest:<token>@github.com`. Don't run `gh auth setup-git`: it
routes git logins through `gh`'s own token instead of this file.

---

## 4. Cloning a NEW repo (empty destination) with separate-git-dir

```bash
mkdir -p ~/git-repos
git clone --separate-git-dir=~/git-repos/<project>.git \
  <repo-url> ~/storage/shared/dev/<project>
```

---

## 5. Recovering after a Termux reinstall (existing sdcard files, dangling .git)

This happens because Termux private storage (where the real `.git` lived)
is wiped on uninstall; `sdcard` files survive. Use this when the project
folder already exists on `sdcard` with real files in it (including files
you deliberately never committed, e.g. local secrets/config) — this
approach re-links git **without deleting anything untracked**:

```bash
cd ~/storage/shared/dev/<project>

git init --separate-git-dir="$HOME/git-repos/<project>.git" .

git remote add origin <repo-url>
git fetch origin

# find default branch name
git remote show origin | grep "HEAD branch"

# force tracked files to match remote; untracked files are left untouched
git checkout -f -B main origin/main   # substitute branch name if not "main"
git branch --set-upstream-to=origin/main main
```

If you hit the "dubious ownership" error here, run the safe.directory
command from step 2 for this specific path, then retry.

`setup.sh` does all of this automatically for every project (sections 2, 4, 5).
