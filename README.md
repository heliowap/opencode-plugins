# opencode-v2-model-routes

OpenCode 2 plugin that keeps OpenAI and Anthropic models in the model catalog
only when they come from an approved provider.

A `model.transform` hook removes every model that matches both conditions:

- its provider is not one of `openai`, `cli_proxy`, `cli_proxy_openai` or
  `opencode-go`;
- its ID starts with `openai/` or `anthropic/` (optionally prefixed with `~`),
  or its family starts with `gpt` or `claude`.

Models from other vendors, and OpenAI or Anthropic models served by the
approved providers, are left untouched. The provider list and patterns are
defined in [`src/index.ts`](src/index.ts).

## Install

Add the plugin to `opencode.jsonc`:

```jsonc
{
  "plugins": ["github:heliowap/opencode-v2-model-routes"]
}
```

## Development

```sh
bun install && bun run typecheck
```

## License

[MIT](LICENSE)
