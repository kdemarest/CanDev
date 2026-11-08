#!/data/data/com.termux/files/usr/bin/bash
# Off-phone backup of uncommitted work. For each repo, snapshots the working tree (tracked edits,
# deletions and untracked files that aren't ignored) as one commit on top of HEAD and force-pushes it
# to origin's backup/phone branch. The local branch, index and files are left untouched, so this is
# safe to run any time; main on GitHub never changes. Each run replaces the previous snapshot.
#
#   tools/backup.sh            the Canopy work: ../Canopy, this workspace, layout, modl, docs, vids
#   tools/backup.sh lens movi  just those repos (paths relative to this workspace, or absolute)
#
# To see a snapshot elsewhere: git fetch origin backup/phone && git diff main origin/backup/phone
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
branch="${BACKUP_BRANCH:-backup/phone}"
[ $# -gt 0 ] && repos=("$@") || repos=(../Canopy . layout modl docs vids)
tmp="${TMPDIR:-/data/data/com.termux/files/usr/tmp}"
failed=0

for repo in "${repos[@]}"; do
    name="$(basename "$(cd "$repo" && pwd)")"
    # A copy of the real index keeps the sparse checkout's skip-worktree bits (Canopy), so files that
    # aren't checked out stay in the snapshot instead of reading as deleted, and keeps the stat cache,
    # so only changed files are re-hashed.
    index="$tmp/backup-index-$name-$$"
    cp "$(git -C "$repo" rev-parse --path-format=absolute --git-path index)" "$index" || { failed=1; continue; }
    GIT_INDEX_FILE="$index" git -C "$repo" add -A 2>/dev/null
    # add -A skips new files outside the sparse patterns; add those by name (--sparse on the whole
    # tree would stage every file that isn't checked out as deleted).
    git -C "$repo" ls-files -z --others --exclude-standard |
        GIT_INDEX_FILE="$index" git -C "$repo" add --sparse --pathspec-from-file=- --pathspec-file-nul 2>/dev/null
    tree="$(GIT_INDEX_FILE="$index" git -C "$repo" write-tree)"
    rm -f "$index"
    if [ "$tree" = "$(git -C "$repo" rev-parse 'HEAD^{tree}')" ]; then
        echo "$name: nothing uncommitted"
        continue
    fi
    # Guard: the snapshot may delete only what git status shows deleted.
    deleted="$(git -C "$repo" diff --no-renames --name-only --diff-filter=D HEAD "$tree" | wc -l)"
    expected="$(git -C "$repo" status --porcelain --no-renames | grep -c '^ D\|^D ')"
    if [ "$deleted" -gt "$expected" ]; then
        echo "$name: snapshot would delete $deleted files but git status shows $expected; not pushed"
        failed=1
        continue
    fi
    commit="$(git -C "$repo" commit-tree "$tree" -p HEAD -m "Backup of the phone's uncommitted work, $(date '+%Y-%m-%d %H:%M')")"
    summary="$(git -C "$repo" diff --shortstat HEAD "$commit")"
    if git -C "$repo" push --quiet --force origin "$commit:refs/heads/$branch"; then
        echo "$name: pushed to $branch ($summary)"
    else
        echo "$name: push failed"
        failed=1
    fi
done
exit $failed
