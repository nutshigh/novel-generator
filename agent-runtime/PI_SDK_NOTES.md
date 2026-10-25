# Pi SDK Notes (verified against installed packages)

Environment: Node **v24.19.0**; `@earendil-works/pi-coding-agent` **1.4.0**; `@earendil-works/pi-ai` **1.4.0**; `typebox` **1.3.27**.

Verified facts:

- `createAgentSession({ modelRuntime, model, noTools: "builtin", customTools, sessionManager, settingsManager, resourceLoader })`
  returns `{ session, extensionsResult, modelFallbackMessage? }`. `cwd` and `agentDir` may also be supplied. Source: `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts`.
- `defineTool({ name, label, description, parameters: Type.Object(...), execute })` is exported from the package root and returns `ToolDefinition<...> & AnyToolDefinition`. `AnyToolDefinition` is an internal alias, not a separate public import surface. Source: `dist/core/extensions/types.d.ts`.
- `modelRuntime.getModel(provider, modelId)` returns `Model<Api> | undefined`. `await modelRuntime.setRuntimeApiKey(provider, key)` is async. Source: `dist/core/model-runtime.d.ts`.
- `SessionManager.create(cwd, sessionDir)` writes JSONL sessions under the given `sessionDir`; if `sessionDir` is omitted it falls back to `~/.pi/agent/sessions/<encoded-cwd>/`. This app always passes `resolve(agentDir, "sessions")` (`.agent/sessions`) explicitly. Source: `dist/core/session-manager.d.ts`.
- The app currently maps this **subset** of SDK events: `agent_start`, `message_update` (text deltas via `assistantMessageEvent`), `tool_execution_start` / `tool_execution_update` / `tool_execution_end`, `turn_end`, `agent_end`. This list is **not exhaustive** and deliberately omits events such as `turn_start`, `message_start`, `message_end`, `tool_call`, `tool_result`, `agent_before_settle`, `agent_settled`, `model_select`, `thinking_level_select`, and session events (`session_start`, `session_before_switch`, ...). Source: `dist/core/extensions/types.d.ts`, `src/events.ts`.
- Phase 0 `RunEvent` names (`agent.start`, `turn.end`, `tool.update`) are a local simplification. Phase 1 must map them to the SSE contract (`run.phase`, `run.turn_end`, `tool.progress`) per the main plan.
- Sessions are written lazily on the first conversation message; an empty `.agent/sessions` after a dry run is expected.
- `session.dispose()` is required; the CLI calls it in a `finally` block. Source: `dist/core/agent-session.d.ts:391`.
- Custom OpenAI-compatible endpoints are configured through `models.json` with `api: "openai-completions"`, a `baseUrl`, and a model list. `agent/models.example.json` and `.agent/models.json` both use `https://api.deepseek.com/v1`. The key placeholder is `$NOVELBUILDER_API_KEY`; no real key is stored.
- `noTools: "builtin"` disables the default built-in read/bash/edit/write tools but keeps extension/custom tools active (verified in the `CreateAgentSessionOptions.noTools` doc comment and by the dry-run reporting `tools: echo`).
- `modelsPath: null` maps to `undefined` in `ModelRuntime.create`, which prevents loading the global `~/.pi/agent/models.json`; only built-in catalogs plus the explicitly supplied path are used. The app never relies on the global `~/.pi` fallback. Source: `dist/core/model-runtime.js`.
- Story write serialization is **not** a `createAgentSession` option. It must be enforced by Story Engine locks/idempotency at the application layer.
- `SettingsManager.inMemory({ compaction, retry })` is used by `src/runtime.ts` to avoid writing global settings.
