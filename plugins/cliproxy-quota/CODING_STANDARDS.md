# Coding standards

These rules follow the [OpenCode style guide](https://github.com/anomalyco/opencode/blob/dev/AGENTS.md), adapted to this plugin.

## Style

- Prefer `flatMap`, `filter`, and `map` over loops, and no `else`.
- Keep one function unless a helper is reused or names a real concept.
- Avoid destructuring that drops context.

## Architecture

- `src/quota.ts` holds every quota rule as pure functions: parsing the management API response, mapping a model to a provider, summarizing, and formatting. It does no I/O and takes `now` as an argument.
- `src/client.ts` is the only code that talks to CLIProxyAPI. It returns a `FetchResult` union instead of throwing. A live probe result decides which windows a credential shows, and each window takes the newer of the probe and the recorded signals (`mergeAccounts`). The caller keeps one `ProbeMemory` across refreshes: it holds each credential's last probe answer, which a failed or skipped probe reuses, and spaces out probes for providers in `PROBE_INTERVAL_MS`.
- `src/tui.tsx` is a thin adapter. It reads OpenCode state, calls the functions above, and renders slots. Keep logic out of it.
- `index.ts` and `tui.tsx` at the root are entry points. OpenCode resolves a local plugin directory by looking for `index` (or `server`) and `tui` files at its root, not through `package.json` `exports`.
- `src/index.ts` resolves the active connection of each native integration (`openai`, `opencode-go`) through OpenCode's integration API and exposes quota through `src/rpc.ts`. Credentials stay on the server; the TUI receives only quota or a safe error. OpenCode loads a package's TUI entry only when the package also has a server entry.
- `src/native.ts` calls a native source's quota endpoint with the resolved credential: the OAuth token for OpenAI's Codex `wham/usage`, the saved API key for OpenCode Go's usage route. OpenAI token-sharing grants use the public OpenAI API, so show their usage-settings link rather than probing Codex. Keep native and proxy results separate in the TUI.
- Add a provider with recorded signals to `READERS`, or one that needs an upstream request through the proxy's `api-call` to `PROBES`. Add its model pattern to `MODEL_PROVIDERS`, which is ordered, so put specific patterns before general ones. Every change ships with tests.
- Windows store `usedPercent`. The UI shows `100 - usedPercent` as the quota left, matching the CLIProxyAPI Management Center.

## Tests

- The root `CODING_STANDARDS.md` defines the tautological shapes. `bun script/check-tests.ts` enforces the first one mechanically: a test must fail when every function it imports returns `undefined`. It replaces every function exported from each source module in its `modules` list with one that returns `undefined` and fails if any test still passes. Add new source modules to that list.
- `test/client.test.ts` runs a real `Bun.serve` server.
- `bunfig.toml` turns on coverage and fails `bun test` below 95% of lines or functions in the files the tests load. `src/tui.tsx` and the entry points are not loaded by tests; check them end to end instead.

## End-to-end checks

Unit tests cannot see the TUI. After changing `src/tui.tsx`, check a real terminal:

1. Run `bun script/fake-proxy.ts` in the background.
2. In a temporary git repository with at least one commit, write an `opencode.jsonc` that lists this directory in `plugins`. Add a provider whose `baseURL` is `http://127.0.0.1:18317/v1` and a model ID starting with `codex/`.
3. Start `opencode --standalone` inside `tmux` with `CLIPROXY_URL=http://127.0.0.1:18317` and `CLIPROXY_MANAGEMENT_KEY=test-key`.
4. Read the screen with `tmux capture-pane -p`. The footer must show `5h 58% · wk 14% left`. After you send a message, the sidebar must list `conta-1`.
