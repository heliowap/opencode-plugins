// OpenCode resolves a local plugin directory from its root, so the entry point lives here and the
// implementation stays under src/. A subdirectory entry in `exports` is not loaded for a local
// directory, only for an installed package.
export { default } from "./src/index.ts"
