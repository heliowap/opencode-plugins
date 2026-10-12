import { Plugin } from "@opencode/plugin"

// OpenCode loads a package's TUI entry only when the package also has a server entry.
export default Plugin.define({
  id: "tps.meter.server",
  setup() {},
})
