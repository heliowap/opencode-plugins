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
- **Project dotfiles.** It also reads `.env` and `.env.*` files in the session
  directory (`.env.example` is skipped) and adds their values to the
  known-secret set, so a project's own credentials are masked wherever they
  appear in tool output — even without their key.
- **Secret-looking fields.** It masks the value in key/value text such as
  `api_key=...`, `"password": "..."` or `Authorization: Bearer ...`, for any key
  whose name contains `KEY`, `PASS`, `PWD`, `SECRET`, `TOKEN`, `CRYPT`,
  `PRIVATE`, `CREDENTIAL` or `AUTH` (case-insensitive) — for example
  `SMTP_PASS`, `APP_CRYPT_KEY` or `CERT_PASSWORD_ENCRYPTION_KEY`. The key is
  kept; only the value is replaced, and only when the value looks like a
  literal credential rather than an expression or a reference.
- **URL credentials.** In a URL with userinfo such as
  `mysql://root:pass@host/db`, only the password is replaced:
  `mysql://root:[REDACTED:<id>]@host/db`.

## Limits

- Environment and dotfile values shorter than 12 characters are not masked.
- Environment variables and project dotfiles are read once, when the plugin
  starts; later edits to a `.env` file are not picked up.
- Dotfile values are collected only when the variable name contains a secret
  marker (`KEY`, `PASS`, `PWD`, `SECRET`, `TOKEN`, `CRYPT`, `PRIVATE`,
  `CREDENTIAL` or `AUTH`), so `PORT` or `NODE_ENV` values are never tracked.
- A field value is masked only when the key name contains one of the markers
  above and the value looks like a literal. A value is left alone when it
  contains whitespace, quotes, `,`, `;` or any of `( ) [ ] { }`; when it starts
  with `$`, `${`, `${{`, `{env:` or `process.env`; or when it is a dotted
  identifier chain such as `secrets.length` or `os.environ`. Code and config
  references keep their text instead of showing a placeholder.
- URL passwords are masked at 8 characters or more; the scheme, user, host and
  path stay readable.
- Secrets in any other shape (for example a bare token with no key and no
  matching dotfile or environment value) pass through unchanged.

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
