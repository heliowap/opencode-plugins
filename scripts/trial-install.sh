#!/usr/bin/env bash
# Usage: scripts/trial-install.sh <ref> <name>...
# Installs plugins/<name> from github:heliowap/opencode-plugins#<ref> into an
# isolated OpenCode environment and proves they load, without touching the
# live ~/.config/opencode.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <ref> <name>..." >&2
  exit 2
fi
ref=$1
shift
names=("$@")

live_dir="$HOME/.config/opencode"
live_files=("$live_dir/opencode.jsonc" "$live_dir/cli.json")

live_env() {
  env -u XDG_CONFIG_HOME -u XDG_CACHE_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME \
    -u OPENCODE_SERVER_PASSWORD "$@"
}

hash_live() {
  local f
  for f in "${live_files[@]}"; do
    if [ -e "$f" ]; then shasum -a 256 "$f" | cut -d' ' -f1; else echo absent; fi
  done
}

# (a) live fingerprint
before_hashes=$(hash_live)
before_status=$(live_env opencode service status 2>&1 || true)
echo "live hashes before:"
paste -d' ' <(printf '%s\n' "${live_files[@]}") <(printf '%s\n' "$before_hashes")
echo "live service status before: $before_status"

# (b) isolated environment
T=$(mktemp -d)
export XDG_CONFIG_HOME="$T/config" XDG_CACHE_HOME="$T/cache" XDG_DATA_HOME="$T/data" XDG_STATE_HOME="$T/state"
export OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_SERVER_PASSWORD=trial-install
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

serve_pid=
cleanup() {
  if [ -n "$serve_pid" ]; then
    kill "$serve_pid" 2>/dev/null || true
    wait "$serve_pid" 2>/dev/null || true
    serve_pid=
  fi
  opencode service stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

# (c) isolation guard
refuse() {
  echo "ISOLATION NOT PROVEN: $1" >&2
  exit 3
}
paths=$(opencode debug paths)
echo "$paths"
for key in config cache data state; do
  p=$(printf '%s\n' "$paths" | awk -v k="$key" '$1 == k { print $2 }')
  case "$p" in
    "$T"/*) ;;
    *) refuse "$key path '$p' is not under $T" ;;
  esac
done
iso_status=$(opencode service status 2>&1 || true)
echo "isolated service status: $iso_status"
if [ "$iso_status" = "$before_status" ] || { [ -n "$before_status" ] && [ "$before_status" != stopped ] && [[ "$iso_status" == *"$before_status"* ]]; }; then
  refuse "isolated service status reports the live service"
fi

# (d) install
for name in "${names[@]}"; do
  spec="github:heliowap/opencode-plugins#${ref}::path:plugins/${name}"
  echo "+ opencode plugin add '$spec'"
  opencode plugin add "$spec"
  cfg=$(grep -rlF -- "$spec" "$XDG_CONFIG_HOME/opencode" || true)
  if [ -z "$cfg" ]; then
    echo "spec not found in isolated config: $spec" >&2
    exit 1
  fi
  echo "config file: $cfg"
  echo "spec written: $(grep -F -- "$spec" "$cfg" | sed 's/^[[:space:]]*//')"
done

# (e) load proof
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
opencode serve --hostname 127.0.0.1 --port "$port" >"$T/serve.log" 2>&1 &
serve_pid=$!
echo "serve pid $serve_pid on 127.0.0.1:$port"

deadline=$((SECONDS + 120))
while :; do
  body=$(curl -fsS -u "opencode:$OPENCODE_SERVER_PASSWORD" "http://127.0.0.1:$port/api/plugin" 2>/dev/null || true)
  if [ -n "$body" ] && printf '%s' "$body" | python3 -c '
import json, sys
want = sys.argv[1:]
data = json.load(sys.stdin)["data"]
# Plugin ids differ from directory names (tps.meter.server, local.unpushed-work), so match on the installed spec.
state = {p.get("source", {}).get("target", "").rsplit("::path:plugins/", 1)[-1]: p["state"]["status"] for p in data}
sys.exit(0 if all(state.get(w) == "active" for w in want) else 1)
' "${names[@]}"; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "timeout: plugins not active after 120s: ${names[*]}" >&2
    cat "$T/serve.log" >&2 || true
    exit 1
  fi
  sleep 2
done
for name in "${names[@]}"; do
  echo "plugin list entry: $(printf '%s' "$body" | python3 -c '
import json, sys
print(json.dumps(next(p for p in json.load(sys.stdin)["data"] if p.get("source", {}).get("target", "").endswith("::path:plugins/" + sys.argv[1]))))
' "$name")"
done

# (f) teardown
cleanup

# (g) live files untouched
after_hashes=$(hash_live)
after_status=$(live_env opencode service status 2>&1 || true)
echo "live hashes after:"
paste -d' ' <(printf '%s\n' "${live_files[@]}") <(printf '%s\n' "$after_hashes")
echo "live service status after: $after_status"
if [ "$before_hashes" != "$after_hashes" ] || [ "$before_status" != "$after_status" ]; then
  echo "LIVE CONFIG MODIFIED" >&2
  exit 4
fi

# (h)
rm -rf "$T"
echo "TRIAL OK ${names[*]} live-config-unchanged $(printf '%s\n' "$after_hashes" | head -1)"
