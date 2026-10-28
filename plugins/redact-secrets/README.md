# opencode-v2-redact-secrets

An OpenCode plugin that masks credentials in tool results before the model sees
them or the session stores them.

## What it does

The plugin registers a tool `execute.after` hook. For a completed tool call it
redacts the result; for a failed call it redacts the error (when the error is a
plain object). Redaction walks strings, arrays and plain objects recursively
and replaces matches with `[REDACTED]`:

- **Known environment secrets.** At startup it collects the values of
  environment variables whose names match `API_KEY`, `APIKEY`, `TOKEN`,
  `SECRET`, `PASSWORD`, `PASSWD` or `CREDENTIAL` (case-insensitive), and masks
  any occurrence of those values.
- **Secret-looking fields.** It masks the value in key/value text such as
  `api_key=...`, `"password": "..."` or `Authorization: Bearer ...`, for the keys
  `api_key`/`apikey`, `authorization`, `password`, `secret` and `token`
  (optionally prefixed by `access_`, `refresh_`, `auth_` or `id_`). The key is
  kept; only the value is replaced.

## Limits

- Environment variable values shorter than 12 characters are not masked.
- Environment variables are read once, when the plugin starts.
- Field values are masked only when the key matches the pattern above and the
  value is at least 8 characters with no quotes, whitespace, `,`, `;` or `}`.
- Secrets in any other shape (for example a bare token with no key, or a key
  name outside the list) pass through unchanged.

## Install

Add the plugin to `opencode.jsonc`:

```jsonc
{
  "plugins": ["github:heliowap/opencode-v2-redact-secrets"]
}
```

## Development

```sh
bun install && bun run typecheck
```

## License

MIT
