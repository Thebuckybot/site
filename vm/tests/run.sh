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
rm -rf "$tmp"
exit $code
