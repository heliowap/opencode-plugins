# OpenCode Go quota investigation

Checked on 2026-10-12. Scope: identify a read-only quota source and verify whether the existing OpenCode Go provider key can access it. No plugin implementation, inference requests, subscription changes, or credential changes were performed.

## Conclusion

A usable quota endpoint exists: `GET https://opencode.ai/zen/go/v1/usage`. A request with the active OpenCode Go provider's normal API key returned HTTP 200 and three quota windows. A browser login is not needed for this request. The plugin does not currently implement this reader.

The usage route is present in official source but is not listed among the endpoints in the [V2 Go documentation](https://opencode.ai/v2/docs/console/go). Treat it as an undocumented interface, not a promised public API contract.

## Request and source evidence

```http
GET /zen/go/v1/usage
Authorization: Bearer <REDACTED>
```

No query parameters were needed in the successful request.

- The official [V2 documentation homepage](https://opencode.ai/v2/docs/) links the `anomalyco/opencode` repository. Source inspection was pinned to commit `a22754f761f868a80231859c4b8be8887f81187c`.
- The [usage route](https://github.com/anomalyco/opencode/blob/a22754f761f868a80231859c4b8be8887f81187c/packages/console/app/src/routes/zen/go/v1/usage.ts#L1-L6) exports GET and delegates to the inference proxy. Calling this usage route does not request model inference.
- The [proxy route map](https://github.com/anomalyco/opencode/blob/a22754f761f868a80231859c4b8be8887f81187c/packages/console/app/src/lib/inference-proxy.ts#L3-L18) forwards it to the backend path `/go/v1/usage`.
- The [authentication forwarding](https://github.com/anomalyco/opencode/blob/a22754f761f868a80231859c4b8be8887f81187c/packages/console/app/src/lib/inference-proxy.ts#L28-L58) reads the Bearer key and forwards it. The backend owns authentication and accounting; their current implementation is not exposed by this proxy source.

## Live verification

Primary source: [the deployed usage endpoint](https://opencode.ai/zen/go/v1/usage), fetched in this session.

| Request | Observed result |
| --- | --- |
| GET without authentication | HTTP 401; JSON `AuthError`, message `Unauthorized` |
| GET with an invalid test Bearer | HTTP 401; the same JSON error |
| GET with the active saved Go key | HTTP 200; `Content-Type: application/json` |

The successful response was observed at `Mon, 12 Oct 2026 22:07:39 GMT`:

```json
{
  "usage": {
    "rolling": {
      "status": "ok",
      "percent": 2,
      "resetsAt": "2026-10-13T02:19:02.000Z"
    },
    "weekly": {
      "status": "ok",
      "percent": 6,
      "resetsAt": "2026-10-19T00:00:00.000Z"
    },
    "monthly": {
      "status": "ok",
      "percent": 26,
      "resetsAt": "2026-11-06T16:54:00.000Z"
    }
  }
}
```

The key was read through a scoped `opencode auth export opencode-go` subprocess and consumed only in memory. Command output contained either structural field types or the sanitized usage response, never the credential. No credential was saved in this note or a temporary file.

## Historical interpretation

The [pre-migration implementation](https://github.com/anomalyco/opencode/blob/9f8db119fcbd4999379129ac7734375ac23460fb/packages/console/app/src/routes/zen/go/v1/usage.ts#L116-L161) exposes the same three-window response structure observed in production. It formats `percent` from `usagePercent` and `resetsAt` from the calculated reset interval.

- [Historical subscription calculations](https://github.com/anomalyco/opencode/blob/9f8db119fcbd4999379129ac7734375ac23460fb/packages/console/core/src/subscription.ts#L53-L154) define the percentage as **consumed usage**, calculated with `floor(min(100, usage / limit * 100))`. A saturated window has status `rate-limited` and percentage 100. This establishes the historical field contract, not proof of the current private backend's formula.
- The [historical usage query](https://github.com/anomalyco/opencode/blob/9f8db119fcbd4999379129ac7734375ac23460fb/packages/console/app/src/routes/zen/go/v1/usage.ts#L77-L100) reads three counters for the authenticated key's user and workspace, rather than returning counters per model.
- [Historical date helpers](https://github.com/anomalyco/opencode/blob/9f8db119fcbd4999379129ac7734375ac23460fb/packages/console/core/src/util/date.ts#L1-L38) reset weekly usage on Monday at 00:00 UTC and monthly usage on the subscription anniversary, not necessarily the first of the month. The observed weekly and monthly timestamps are compatible with that contract. A reader should still use the returned timestamps instead of reconstructing them.

The historical route already attempted a migrated backend before its local implementation. Consequently, these functions are evidence of the older public contract, not a way to inspect the current backend internals.

## Current interpretation and boundaries

The [Go documentation](https://opencode.ai/v2/docs/console/go#usage-limits) defines 5-hour, weekly, and monthly limits, with model-dependent monthly dollar allowances. The observed response contains one `rolling`, one `weekly`, and one `monthly` object, not a model-by-model breakdown.

- **UNVERIFIED:** whether the current private backend preserves the historical percentage formula, pricing normalization, and exact reset rules. The historical source supports interpreting `percent` as consumption, but the single live response does not prove its calculation.
- **UNVERIFIED:** current quota aggregation across models. The observed response provides three windows without a model dimension; the older public implementation used shared user/workspace counters.
- **UNVERIFIED:** current responses with `rate-limited` or other statuses, behavior without a subscription, Go Plus responses, optional query parameters, and endpoint stability. The authenticated check exercises one active Go account with `ok` windows only.
- The [pinned public repository tree](https://api.github.com/repos/anomalyco/opencode/git/trees/a22754f761f868a80231859c4b8be8887f81187c?recursive=1) does not include the authenticated console workspace usage UI. The integration does not require reproducing that UI because the direct usage request succeeded.

The endpoint discovery and successful authentication establish feasibility, not completion of plugin support. No implementation or publishing was requested by this investigation.
