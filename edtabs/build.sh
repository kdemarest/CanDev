#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# Single-file plugin: syntax check, load test plus the rule tests, then install.
DEST="../.obsidian/plugins/edtabs"

command -v node >/dev/null || { echo "Build failed: node not found in PATH." >&2; exit 1; }

node --check main.js || { echo "Build failed: syntax check failed for main.js." >&2; exit 1; }
node ../tools/jsload.js main.js edtabs --test "EdTabs.Test.runAll()"

mkdir -p "$DEST"
cp main.js manifest.json "$DEST/"
# Tell Obsidian Hot Reload to watch this plugin.
touch "$DEST/.hotreload"

echo "Built edtabs"
