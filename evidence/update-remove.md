script_sha: 001d0a48d5f119066153f52d9d40fad9b0e9db27

# `plugin update`/`plugin remove` against the `::path:` spec

Command: `scripts/trial-install.sh main redact-secrets` (exit 0, OpenCode v2.2.5). The script ran at `001d0a4`; `main` resolved to `ab6808d24abb9286c68d43a820c6a3a55c214c64`. Refs #19.

| # | Check | Result | Exit |
| --- | --- | --- | --- |
| 1 | `opencode plugin add '<spec>'` | Spec written verbatim to isolated `opencode.json` | 0 |
| 2 | `GET /api/plugin` on the proof server | `redact-secrets` `active`, `source.target` = spec, version `ab6808d` | 0 |
| 3 | `opencode plugin update --server <url> '<spec>'` | `No plugin updates available` | 0 |
| 4 | `opencode plugin update --server <url>` (no target) | `No plugin updates available` | 0 |
| 5 | Control: `update --server <url> '<…::path:plugins/__none__>'` | `Error: Plugin is not configured` — refused, so check 3 is not vacuous | 1 |
| 6 | `opencode plugin remove '<spec>'` | `removed from …/opencode.json`; spec absent from isolated config | 0 |
| 7 | Live `~/.config/opencode` hashes and service status | Unchanged | 0 |

The same probes show `update` also refuses `redact-secrets` (the plugin id) and `github:heliowap/opencode-plugins` (the bare repo): the configured package target is the verbatim `::path:` spec, so the README command forms (`plugin update`, `plugin update <spec>`, `plugin remove <spec>`) are all correct as written.

Two probes shaped the script:

- `plugin update` resolves its target through a server connection. The managed service cannot start inside the isolated environment — its default port is held by the live service — so the script passes `--server` pointing at the proof server it already starts.
- `plugin update --standalone` reports the configured plugin as `Plugin is not configured` and `plugin check --standalone` reports `No package plugins found`; the private server does not enumerate configured package plugins. `remove` needs no server at all, and `remove` of an unconfigured spec exits 0 while leaving the real entry — which is why the script asserts on the config afterwards instead of trusting the exit code.

## Live file hashes (sha256)

| file | before | after |
| --- | --- | --- |
| `~/.config/opencode/opencode.jsonc` | `ecd8923bc5ceac1f24bcfab70fd25b78e1ed372fca92880a8748395a854df234` | `ecd8923bc5ceac1f24bcfab70fd25b78e1ed372fca92880a8748395a854df234` |
| `~/.config/opencode/cli.json` | `cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001` | `cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001` |

Live service status before and after: `http://127.0.0.1:49374`. Isolated: `stopped`.

## Full output

```
live hashes before:
/Users/heliowap/.config/opencode/opencode.jsonc ecd8923bc5ceac1f24bcfab70fd25b78e1ed372fca92880a8748395a854df234
/Users/heliowap/.config/opencode/cli.json cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001
live service status before: http://127.0.0.1:49374
home       /Users/heliowap
data       /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/data/opencode
cache      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/cache/opencode
config     /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/config/opencode
state      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/state/opencode
tmp        /private/var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/opencode
bin        /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/cache/opencode/bin
log        /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/data/opencode/log
repos      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/data/opencode/repos
db         /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/data/opencode/opencode.db
isolated service status: stopped
+ opencode plugin add 'github:heliowap/opencode-plugins#main::path:plugins/redact-secrets'
Plugin "github:heliowap/opencode-plugins#main::path:plugins/redact-secrets" installed and added to /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/config/opencode/opencode.json
config file: /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/config/opencode/opencode.json
spec written: "github:heliowap/opencode-plugins#main::path:plugins/redact-secrets"
serve pid 33931 on 127.0.0.1:55490
plugin list entry: {"id": "redact-secrets", "source": {"type": "package", "target": "github:heliowap/opencode-plugins#main::path:plugins/redact-secrets", "version": "ab6808d24abb9286c68d43a820c6a3a55c214c64"}, "features": {"server": true}, "state": {"status": "active"}}
+ opencode plugin update --server http://127.0.0.1:55490 'github:heliowap/opencode-plugins#main::path:plugins/redact-secrets'
No plugin updates available
+ opencode plugin update --server http://127.0.0.1:55490
No plugin updates available
unconfigured target refused: Error: Plugin is not configured: github:heliowap/opencode-plugins#main::path:plugins/__none__
+ opencode plugin remove 'github:heliowap/opencode-plugins#main::path:plugins/redact-secrets'
Plugin "github:heliowap/opencode-plugins#main::path:plugins/redact-secrets" removed from /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.eh0wrCajYe/config/opencode/opencode.json
config entry removed: github:heliowap/opencode-plugins#main::path:plugins/redact-secrets
live hashes after:
/Users/heliowap/.config/opencode/opencode.jsonc ecd8923bc5ceac1f24bcfab70fd25b78e1ed372fca92880a8748395a854df234
/Users/heliowap/.config/opencode/cli.json cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001
live service status after: http://127.0.0.1:49374
TRIAL OK redact-secrets live-config-unchanged ecd8923bc5ceac1f24bcfab70fd25b78e1ed372fca92880a8748395a854df234
```
