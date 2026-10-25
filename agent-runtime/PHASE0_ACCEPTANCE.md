# Phase 0 Acceptance

Date: 2026-10-24
Work dir: `F:\project\novel-generator\agent-runtime`

## Versions and locations

- [x] Node version: `v24.19.0`
- [x] `@earendil-works/pi-coding-agent`: `1.4.0`
- [x] `@earendil-works/pi-ai`: `1.4.0`
- [x] `typebox`: `1.3.27`
- [x] npm cache: `F:\project\novel-generator\.cache\npm` (`npm config get cache`)
- [x] npm cache configured in `.npmrc`; npm commands in this run also used `TMP`/`TEMP=F:\project\novel-generator\.cache\tmp`
- [x] Pi state under `.agent`: `auth.json`, `models.json`, `sessions/`
- [x] `.agent/models.json` uses `$NOVELBUILDER_API_KEY` placeholder; no real key written
- [x] `agent/models.example.json` exists and matches the DeepSeek/OpenAI-compatible example

## Verification results

- [x] `npm run typecheck` — passed (exit 0, no output)
- [x] `npm test` — `Test Files 6 passed (6)`, `Tests 37 passed (37)`
- [x] `npm run check:pi` — `Pi SDK exports OK: createAgentSession, defineTool, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager`
- [x] `npm run smoke -- --dry-run` — `dry-run ok`, `model: novelbuilder/deepseek-chat`, `tools: echo`
- [ ] Real model smoke — **PENDING (no API key); not run; no paid tokens spent**

## Unverified / pending

- [ ] **Session persistence** — requires a real or fake conversation; expected `.jsonl` under `.agent/sessions`. Check: `Get-ChildItem -Recurse .agent/sessions -Filter *.jsonl` (currently empty; sessions are written lazily on the first message).
- [ ] **`SessionManager.open` recovery** — requires a persisted session file. Check: `node --import tsx --input-type=module -e "import { SessionManager } from '@earendil-works/pi-coding-agent'; SessionManager.open('.agent/sessions/<file>.jsonl'); console.log('SessionManager.open OK')"`.

## Gate verdict

**Phase 0 status: 部分验证 (partially verified).**

The Phase 1 formal gate is **NOT** met: real model smoke is **PENDING** (no API key) and session persistence / `SessionManager.open` recovery are unverified. Therefore this is **not** a full Phase 0 pass. The user explicitly instructed us to continue to other implementations, so work proceeds under that explicit instruction rather than claiming a full Phase 0 pass.

## .agent contents

`.agent`:
- `sessions/` (directory)
- `auth.json` (2 bytes, `{}`)
- `models.json` (291 bytes)

`.agent/sessions`: empty after the dry run (no prompt was sent, so no JSONL was written).

## C-drive check

- [x] `~/.pi/agent/sessions` not used by this work. It exists from earlier unrelated sessions; files there were last modified `2026-08-15`, and none were modified in the last 2 days.
- [x] `C:\Users\kenly\AppData\Local\npm-cache\_cacache` was not written by our commands; `npm config get cache` points to `F:\...\.cache\npm`.
- [x] C `_logs` may be written by unrelated external npm activity (e.g. periodic update checks); such entries are not produced by our commands.
- [x] No new files created under `~/.pi` or the C npm `_cacache` during this run.

## Exceptions found (pre-existing, not modified)

- Earlier C temp test dirs exist: `C:\Users\kenly\AppData\Local\Temp\novelbuilder-agent-*` and `novelbuilder-project-*` (created `2026-10-24 01:13–01:14`, before the F-drive TMP/TEMP policy was applied).
- `C:\Users\kenly\AppData\Local\Temp\tsx-kenly` exists (created `2026-10-24 01:01`, last modified `10:44:57`, before this run).
- C npm-cache `_cacache` contains entries written `2026-10-24 00:50–00:54` from earlier work; C `_logs` entries may be written by unrelated external npm activity, not by our commands.
- These were left untouched because changes outside `F:\project\novel-generator` are out of scope.

## Files changed in this task

- `agent-runtime/scripts/check-pi-api.ts` (new)
- `agent-runtime/PI_SDK_NOTES.md` (new)
- `agent-runtime/PHASE0_ACCEPTANCE.md` (new)
- `agent-runtime/agent/models.example.json` (verified existing)
- `agent-runtime/PHASE0_RUN.log` (new; curated local-only digest of actual command output — not tracked)

`PHASE0_RUN.log` is intentionally **local-only**: `*.log` is already in `.gitignore`, so no `.gitignore` change was made.

No commit was made.
