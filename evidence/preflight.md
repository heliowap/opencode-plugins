probe_sha: 09390f4ce9ebc653f7850de602803a981c06fb33

# Preflight: `::path:` Git subdirectory install

Command: `scripts/trial-install.sh 09390f4ce9ebc653f7850de602803a981c06fb33 preflight-probe` (exit 0, OpenCode v2.2.0)

## Spec written by `plugin add`

Written verbatim, no normalization, to the isolated `opencode.json` under `plugins`:

```
github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe
```

## Plugin-list entry (`GET /api/plugin` on the isolated server)

```json
{"id": "preflight-probe", "source": {"type": "package", "target": "github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe", "version": "09390f4ce9ebc653f7850de602803a981c06fb33"}, "features": {"server": true}, "state": {"status": "active"}}
```

## Live file hashes (sha256)

| file | before | after |
| --- | --- | --- |
| `~/.config/opencode/opencode.jsonc` | `1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30` | `1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30` |
| `~/.config/opencode/cli.json` | `cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001` | `cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001` |

Live service status before and after: `http://127.0.0.1:49374`. Isolated: `stopped`.

## Full output

```
live hashes before:
/Users/heliowap/.config/opencode/opencode.jsonc 1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30
/Users/heliowap/.config/opencode/cli.json cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001
live service status before: http://127.0.0.1:49374
home       /Users/heliowap
data       /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/data/opencode
cache      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/cache/opencode
config     /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/config/opencode
state      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/state/opencode
tmp        /private/var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/opencode
bin        /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/cache/opencode/bin
log        /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/data/opencode/log
repos      /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/data/opencode/repos
db         /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/data/opencode/opencode.db
isolated service status: stopped
+ opencode plugin add 'github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe'
Plugin "github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe" installed and added to /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/config/opencode/opencode.json
config file: /var/folders/88/hpv52wzj48x76m5g4p7_7yfc0000gn/T/tmp.ZRXI5bZGGh/config/opencode/opencode.json
spec written: "github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe"
serve pid 58999 on 127.0.0.1:57037
plugin list entry: {"id": "preflight-probe", "source": {"type": "package", "target": "github:heliowap/opencode-plugins#09390f4ce9ebc653f7850de602803a981c06fb33::path:plugins/preflight-probe", "version": "09390f4ce9ebc653f7850de602803a981c06fb33"}, "features": {"server": true}, "state": {"status": "active"}}
live hashes after:
/Users/heliowap/.config/opencode/opencode.jsonc 1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30
/Users/heliowap/.config/opencode/cli.json cf09a70800ba11e078190b3bc6adc14e866ff204ffb6ceda61356c0d497c1001
live service status after: http://127.0.0.1:49374
TRIAL OK preflight-probe live-config-unchanged 1d043d2749e163a01a75d437803705976cad115f391d2d570fa6e81ac798ec30
```
