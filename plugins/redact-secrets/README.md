# redact-secrets

Formerly `heliowap/opencode-v2-redact-secrets`.

An OpenCode plugin that masks credentials in tool results before the model sees
them or the session stores them.

## What it does

The plugin registers a tool `execute.after` hook. For a completed tool call it
redacts the result; for a failed call it redacts the error (when the error is a
plain object). Redaction walks strings, arrays and plain objects recursively
and replaces matches with a `[REDACTED:<id>]` placeholder:

- **Known environment secrets.** At startup it collects the values of
  environment variables whose names match `API_KEY`, `APIKEY`, `TOKEN`,
  `SECRET`, `PASSWORD`, `PASSWD` or `CREDENTIAL` (case-insensitive), and masks
  any occurrence of those values.
- **Secret-looking fields.** It masks the value in key/value text such as
  `api_key=...`, `"password": "..."` or `Authorization: Bearer ...`, for the keys
  `api_key`/`apikey`, `authorization`, `password`, `secret` and `token`
  (optionally prefixed by `access_`, `refresh_`, `auth_` or `id_`). The key is
  kept; only the value is replaced, and only when the value looks like a
  literal credential rather than an expression or a reference.

## Limits

- Environment variable values shorter than 12 characters are not masked.
- Environment variables are read once, when the plugin starts.
- A field value is masked only when the whole key is one of the names above
  (substrings inside longer identifiers, such as `knownSecret` or
  `sessionToken`, never match) and the value is at least 8 characters.
- A field value is masked only when it looks like a literal. A value is left
  alone when it contains whitespace, quotes, `,`, `;` or any of `( ) [ ] { }`;
  when it starts with `$`, `${`, `${{`, `{env:` or `process.env`; or when it is
  a dotted identifier chain such as `secrets.length` or `os.environ`. Code and
  config references keep their text instead of showing a placeholder.
- Secrets in any other shape (for example a bare token with no key, or a key
  name outside the list) pass through unchanged.

## Install

Add the plugin to `opencode.jsonc`:

```jsonc
{
  "plugins": ["github:heliowap/opencode-plugins#main::path:plugins/redact-secrets"]
}
```

## Development

```sh
bun install && bun run typecheck
```

## License

MIT
