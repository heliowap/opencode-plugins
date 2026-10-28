# opencode-v2-tps-meter

OpenCode 2 CLI plugin that shows a tokens-per-second meter in the prompt footer.

- While the model streams, the footer shows a live estimate such as `~42 tok/s`. It counts streamed text, reasoning, and tool-input characters at four characters per token, averaged since the first streamed character of the step.
- When a step ends, the footer switches to the exact value, such as `104.8 tok/s`: the provider's output plus reasoning tokens of every step since the prompt started, divided by the summed time from each step's request dispatch to the end of its stream. In a turn with tool calls this is a running average across steps. It is the same formula as OpenCode's built-in `session.tps` footer, so the final value matches the turn's assistant footer.

The live estimate only sees what the provider streams. Models that think without streaming their reasoning, or stream a summary of it, show a live value well below the exact one.

## Install

Add the package to `plugins` in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["github:heliowap/opencode-v2-tps-meter"]
}
```

Restart OpenCode.

## Development

```sh
bun install
bun test
bun run typecheck
```

See [CODING_STANDARDS.md](CODING_STANDARDS.md).
