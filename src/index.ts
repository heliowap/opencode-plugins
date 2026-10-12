import { Plugin } from "@opencode/plugin"
import { fetchNativeAccounts } from "./native.ts"
import { NATIVE_SOURCES, type QuotaResult } from "./quota.ts"
import { QuotaRpc } from "./rpc.ts"

export default Plugin.define({
  id: "cliproxy.quota.server",
  async setup(context) {
    const registration = await context.rpc.register(QuotaRpc, {
      native: async (_input, call) => {
        const entries = await Promise.all(
          Object.entries(NATIVE_SOURCES).map(async ([integration, source]): Promise<[string, QuotaResult]> => {
            const connection = await context.integration.connection.active(integration).catch(() => undefined)
            if (connection?.type !== "credential" || connection.method !== source.method) return [integration, { ok: true, accounts: [] }]
            const credential = await context.integration.connection.resolve(connection).catch(() => undefined)
            if (!credential) return [integration, { ok: false, error: `Unable to resolve the ${source.name} connection` }]
            return [integration, await fetchNativeAccounts(integration, source, connection, credential, Date.now(), undefined, call.signal)]
          }),
        )
        return Object.fromEntries(entries)
      },
    })
    return () => registration.dispose()
  },
})
