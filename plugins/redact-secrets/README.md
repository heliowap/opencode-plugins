# redact-secrets

Formerly `heliowap/opencode-v2-redact-secrets`.

An OpenCode plugin that masks credentials in tool results before the model sees
them or the session stores them.

## What it does

The plugin registers tool `execute.after` and `execute.before` hooks. For a
completed tool call it redacts the result; for a failed call it redacts the
error. Redaction walks strings, arrays and
plain objects recursively and replaces matches with a `[REDACTED:<id>]`
placeholder:

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

## Placeholders

Every masked value becomes `[REDACTED:<id>]`, where `<id>` is the first 8 hex
characters of an HMAC of the value under a key generated when the plugin
starts. The plugin keeps an in-memory map from id to value, so within one
server process the same value always gets the same id and each placeholder can
be resolved back.

Because the model only ever sees masked text, the `execute.before` hook keeps
placeholders from being written to disk:

- For `edit`, `write`, `patch` and `apply_patch` inputs, every known
  `[REDACTED:<id>]` is replaced with its value before the tool runs, so a file
  keeps its real secret when the agent edits around a masked line.
- An edit input holding a placeholder with an unknown id (for example after a
  restart) or the bare `[REDACTED]` is rejected, unless the target file already
  contains that exact text. The error tells the agent to re-read the lines it
  wants to change.
- A placeholder where the input names the target file — a `path` or
  `filePath` field, or a file header inside a patch — is always rejected and
  never substituted. The masked text there stands for a file location, and a
  file's path can itself be a collected secret (the value of a credential
  variable such as `GOOGLE_APPLICATION_CREDENTIALS`).
- A `shell` input containing a `[REDACTED:<id>]` placeholder is rejected and
  never substituted, so placeholders cannot send secrets elsewhere. The bare
  `[REDACTED]` stays usable in commands such as `grep`.

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
- The id map lives only in memory: after a restart every placeholder becomes
  unresolvable, and the real value is never written to a result, an error or a
  log — only the placeholder text itself is.
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
bun install
bun run typecheck
bun test
```

## License

MIT
