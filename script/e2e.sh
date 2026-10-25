#!/bin/sh
# Unit tests cannot see the plugin wiring, so this drives the real thing.
#
# It builds a throwaway clone that is one commit behind origin/dev while its own refs still say
# zero, runs two prompts in one OpenCode session, and prints the user messages OpenCode persisted.
# A passing run shows the base check appended to the first message, saying "1 commit behind
# origin/dev", and nothing appended to the second.
#
# Usage: script/e2e.sh [model]
set -eu

plugin=$(cd "$(dirname "$0")/.." && pwd)
model=${1:-cli_proxy/cpa-claude-haiku-5-5}
root=$(mktemp -d "${TMPDIR:-/tmp}/base-check-e2e-XXXXXX")
trap 'rm -rf "$root"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME="Base Check"
export GIT_AUTHOR_EMAIL=base-check@example.com
export GIT_COMMITTER_NAME="Base Check"
export GIT_COMMITTER_EMAIL=base-check@example.com

git init -q --bare --initial-branch=dev "$root/origin.git"
git clone -q "$root/origin.git" "$root/seed" 2>/dev/null
echo seed >"$root/seed/seed.txt"
git -C "$root/seed" add .
git -C "$root/seed" commit -q --message seed
git -C "$root/seed" push -q --set-upstream origin dev
git clone -q "$root/origin.git" "$root/work"

# Only a fetch can reveal this commit, so the report proves the fetch ran.
echo published >"$root/seed/published.txt"
git -C "$root/seed" add .
git -C "$root/seed" commit -q --message published
git -C "$root/seed" push -q origin dev
echo "behind according to the clone's own refs: $(git -C "$root/work" rev-list --count HEAD..origin/dev)"

# OpenCode loads a local plugin only from a directory inside the project, resolved from the
# package root; absolute paths, file:// URLs and symlinks are ignored (opencode 2.1.4).
mkdir "$root/work/basecheck"
cp -R "$plugin/src" "$plugin/index.ts" "$plugin/package.json" "$root/work/basecheck/"
cat >"$root/work/opencode.jsonc" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "./basecheck", "options": { "base": "origin/dev" } }]
}
JSON

cd "$root/work"
session=$(opencode run --format json --model "$model" "Reply with the single word: ok" | tail -1 |
  python3 -c 'import sys,json;print(json.loads(sys.stdin.read())["sessionID"])')
opencode run --session "$session" --format json --model "$model" "Reply with the single word: ok" >/dev/null

opencode api get "/api/session/$session/message" | python3 -c '
import sys, json
for index, message in enumerate(m for m in reversed(json.load(sys.stdin)["data"]) if m.get("type") == "user"):
    print(f"--- user message {index + 1} ---")
    print(message["text"])
'
