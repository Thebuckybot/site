#!/usr/bin/env bash
# Phase 4.5B headless regression runner.
# Copies site/vm into a temp ESM workspace (the repo ships no package.json so the
# browser loads modules directly; Node needs "type":"module") and runs the suite.
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"          # .../site/vm
tmp="$(mktemp -d)"
cp -r "$here" "$tmp/vm"
echo '{"type":"module"}' > "$tmp/package.json"
node "$tmp/vm/tests/phase45b_regression.mjs"
code=$?
# v3 blok 3 - de War Room. Aparte suite: hij stubt de gatewayClient, en dat mag
# de runtime-suite hierboven niet zien.
node "$tmp/vm/tests/warroom_leaks.mjs" || code=$?
rm -rf "$tmp"
exit $code
