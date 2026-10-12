import { mergeAccounts, type Account, type NativeCredential, type NativeSource, type QuotaResult } from "./quota.ts"

export async function fetchNativeAccounts(
  integration: string,
  source: NativeSource,
  connection: { readonly id: string; readonly label: string } | undefined,
  credential: NativeCredential | undefined,
  now: number,
  usageURL?: string,
  signal?: AbortSignal,
): Promise<QuotaResult> {
  if (!connection || !credential) return { ok: true, accounts: [] }
  const plan = source.plan(credential)
  if (!plan) return { ok: true, accounts: [] }
  if (plan.kind === "hint") return { ok: false, error: plan.message }
  const response = await fetch(usageURL ?? plan.call.url, {
    method: plan.call.method,
    headers: { ...plan.call.header, Authorization: `Bearer ${plan.token}` },
    body: plan.call.data,
    signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
  }).catch(() => undefined)
  if (!response) return { ok: false, error: `Unable to fetch ${source.name} quota` }
  if (!response.ok) return { ok: false, error: `${source.name} quota: HTTP ${response.status}` }
  const body: unknown = await response.json().catch(() => undefined)
  const windows = source.parse(body)
  if (windows.length === 0) return { ok: false, error: `${source.name} returned no quota data` }
  const account: Account = {
    provider: source.provider,
    label: connection.label,
    authIndex: `${integration}:${connection.id}`,
    observedAt: now,
    windows,
  }
  return { ok: true, accounts: mergeAccounts([], [account], now) }
}
