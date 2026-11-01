# opencode-plugins

Monorepo of OpenCode v2 plugins plus the issue-tracker workflow run on it.

## Language

### Goal plugin (`plugins/goal`)

**Goal**:
A persistent, audited objective bound to one session; survives turns until completed, blocked, or cleared.

**Goal turn**:
A turn while a goal is active. Ends in a reducer `TurnEnded` event; the next one starts from a continuation.

**Continuation**:
The synthetic message that resumes a goal turn after a cooldown or an external event.

**Progress**:
A turn that completes a file-changing tool, dispatches or continues a subagent, or calls `goal_update`. Text alone is not progress.

**Idle turn**:
A goal turn without progress; drives the continuation backoff. _Avoid_: empty turn — that is the stricter term below.

**Empty turn**:
A turn with neither text nor progress. Three consecutive empty turns move the goal to `blocked`.

**Verified wait**:
A no-progress turn that polls a specific external handle confirmed live — not a restatement of status.

**Cooldown**:
The scheduled delay before the next continuation; `continuationDelayMs` is its base.

**Blocked audit**:
The rule that `blocked` requires the same blocking condition across at least three consecutive goal turns.

### redact-secrets (`plugins/redact-secrets`)

**Mask**:
The mask `[REDACTED]`, applied to tool results before the model sees them.

**Known secret**:
A credential value matched by exact value — sourced from the process environment, and (per #10) from project dotfiles at the setup seam.

**Placeholder**:
The keyed mask form `[REDACTED:<id>]` that `execute.before` resolves back to the real value on tool inputs (per #12).

### Issue-tracker workflow

**Category role**:
One of `bug` | `enhancement`. Every triaged issue carries exactly one.

**State role**:
One of `needs-triage` | `needs-info` | `ready-for-agent` | `ready-for-human` | `wontfix`. Every triaged issue carries exactly one.

**Fold**:
Closing an issue as `duplicate` whose acceptance criteria move into the absorbing issue's agent brief.
