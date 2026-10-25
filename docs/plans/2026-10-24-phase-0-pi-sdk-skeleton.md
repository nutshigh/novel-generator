# Phase 0：Pi SDK 验证与 Agent Runtime 骨架

> **给后续实现者：** 这是 Phase 0 的可执行计划。严格按任务顺序做；每完成一个任务先跑该任务的验证命令，再进入下一个。不要自动 commit，除非用户明确要求。

**Goal：** 在本机跑通 `@earendil-works/pi-coding-agent@1.4.0`，建立一个可创建会话、注册自定义工具、流式输出、持久化/恢复会话、并且把数据放在项目目录内的 `agent-runtime` 骨架。

**Architecture：** 独立的 Node/TypeScript 服务，使用 Pi SDK 的 `createAgentSession` + `ModelRuntime` + `SessionManager` + `DefaultResourceLoader`。禁用 Pi 内置编码工具，只注册故事工具；本阶段只验证一个 `echo` 工具，不接 Story Engine。

**Tech Stack：** Node >= 22.19、TypeScript 5.9、tsx、Vitest、`@earendil-works/pi-coding-agent@1.4.0`、`@earendil-works/pi-ai@1.4.0`、TypeBox。

## 0. 新项目位置与磁盘策略

- 新项目根目录：`F:\project\novel-generator`
- Agent Runtime：`F:\project\novel-generator\agent-runtime`
- npm cache：`F:\project\novel-generator\.cache\npm`
- npm/node 临时目录：`F:\project\novel-generator\.cache\tmp`
- Pi 的 auth/models/sessions 全部放在 `agent-runtime/.agent` 下，不写 `C:\Users\...\.pi`

**硬性要求：** 所有依赖、缓存、临时文件、会话文件都必须落在 F 盘。每一条 npm 命令执行前都必须设置：

```powershell
$env:npm_config_cache="F:\project\novel-generator\.cache\npm"
$env:TMP="F:\project\novel-generator\.cache\tmp"
$env:TEMP="F:\project\novel-generator\.cache\tmp"
```

---

## 前置检查

在 `F:\project\novel-generator` 下执行：

```powershell
node --version
npm --version
npm view @earendil-works/pi-coding-agent version
npm view @earendil-works/pi-ai version
```

预期：

```text
v24.19.0
11.17.0
1.4.0
1.4.0
```

要求：

- Node >= 22.19.0；当前 24.19.0 满足。
- npm 能访问 registry。
- 不修改旧项目 `F:\project\NovelForge\NovelForge` 的任何文件。
- 所有新增文件放在 `F:\project\novel-generator\agent-runtime`。
- 依赖和缓存不得写入 C 盘。

---

## 文件结构

```
agent-runtime/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  .env.example
  agent/
    models.example.json
  src/
    config.ts
    events.ts
    runtime.ts
    cli.ts
    tools/
      echo.ts
  scripts/
    check-pi-api.ts
  test/
    smoke.test.ts
    config.test.ts
    events.test.ts
    echo-tool.test.ts
    runtime.test.ts
  PI_SDK_NOTES.md
  PHASE0_ACCEPTANCE.md
```

---

## Task 1：初始化 TypeScript 项目

**Files：**

- Create：`agent-runtime/package.json`
- Create：`agent-runtime/tsconfig.json`
- Create：`agent-runtime/vitest.config.ts`
- Create：`agent-runtime/.gitignore`
- Create：`agent-runtime/.env.example`

- [ ] **Step 1：创建 `package.json`**

```json
{
  "name": "@novelbuilder/agent-runtime",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check:pi": "node --env-file-if-exists=.env --import tsx scripts/check-pi-api.ts",
    "smoke": "node --env-file-if-exists=.env --import tsx src/cli.ts"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "1.4.0",
    "@earendil-works/pi-ai": "1.4.0",
    "typebox": "1.3.27"
  },
  "devDependencies": {
    "@types/node": "24.12.4",
    "tsx": "4.22.1",
    "typescript": "5.9.3",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2：创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "scripts", "vitest.config.ts"]
}
```

- [ ] **Step 3：创建 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4：创建 `.gitignore`**

```text
node_modules/
dist/
.agent/
.workspace/
.env
*.log
```

- [ ] **Step 5：创建 `.env.example`**

```text
NOVELBUILDER_PROVIDER=novelbuilder
NOVELBUILDER_MODEL=deepseek-chat
NOVELBUILDER_API_KEY=
NOVELBUILDER_AGENT_DIR=.agent
NOVELBUILDER_PROJECT_DIR=.workspace
NOVELBUILDER_MODELS_PATH=.agent/models.json

PI_SKIP_VERSION_CHECK=1
PI_TELEMETRY=0
```

- [ ] **Step 6：创建 `agent-runtime/.npmrc`**

```text
cache=F:\project\novel-generator\.cache\npm
fund=false
audit=false
```

- [ ] **Step 7：安装依赖（缓存和临时目录指向 F 盘）**

```powershell
cd F:\project\novel-generator\agent-runtime
$env:npm_config_cache="F:\project\novel-generator\.cache\npm"
$env:TMP="F:\project\novel-generator\.cache\tmp"
$env:TEMP="F:\project\novel-generator\.cache\tmp"
npm install --ignore-scripts
```

预期：

```text
added ... packages
```

- [ ] **Step 8：验证安装版本**

```powershell
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai typebox --depth=0
```

预期：

```text
@earendil-works/pi-coding-agent@1.4.0
@earendil-works/pi-ai@1.4.0
typebox@1.3.27
```

- [ ] **Step 9：创建空测试并通过**

先创建 `test/smoke.test.ts`：

```ts
import { expect, it } from "vitest";

it("test runner works", () => {
  expect(1 + 1).toBe(2);
});
```

运行：

```powershell
npm test
```

预期：

```text
Test Files  1 passed
Tests       1 passed
```

---

## Task 2：环境配置模块

**Files：**

- Create：`agent-runtime/src/config.ts`
- Create：`agent-runtime/test/config.test.ts`

- [ ] **Step 1：先写失败测试**

`test/config.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("throws when provider is missing", () => {
    expect(() =>
      loadConfig({ NOVELBUILDER_MODEL: "deepseek-chat" } as NodeJS.ProcessEnv),
    ).toThrow(/NOVELBUILDER_PROVIDER/);
  });

  it("throws when model is missing", () => {
    expect(() =>
      loadConfig({ NOVELBUILDER_PROVIDER: "novelbuilder" } as NodeJS.ProcessEnv),
    ).toThrow(/NOVELBUILDER_MODEL/);
  });

  it("applies defaults relative to cwd", () => {
    const config = loadConfig({
      NOVELBUILDER_PROVIDER: "novelbuilder",
      NOVELBUILDER_MODEL: "deepseek-chat",
    } as NodeJS.ProcessEnv);

    expect(config.provider).toBe("novelbuilder");
    expect(config.modelId).toBe("deepseek-chat");
    expect(config.agentDir.endsWith(".agent")).toBe(true);
    expect(config.projectDir.endsWith(".workspace")).toBe(true);
    expect(config.modelsPath).toBeUndefined();
  });

  it("resolves explicit paths", () => {
    const config = loadConfig({
      NOVELBUILDER_PROVIDER: "novelbuilder",
      NOVELBUILDER_MODEL: "deepseek-chat",
      NOVELBUILDER_AGENT_DIR: "custom-agent",
      NOVELBUILDER_MODELS_PATH: "custom-agent/models.json",
    } as NodeJS.ProcessEnv);

    expect(config.agentDir.endsWith("custom-agent")).toBe(true);
    expect(config.modelsPath?.endsWith("models.json")).toBe(true);
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```powershell
npm test -- test/config.test.ts
```

预期：FAIL，`Cannot find module '../src/config.js'`。

- [ ] **Step 3：实现 `src/config.ts`**

```ts
import { resolve } from "node:path";

export interface AgentRuntimeConfig {
  provider: string;
  modelId: string;
  apiKey?: string;
  agentDir: string;
  projectDir: string;
  modelsPath?: string;
  systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT =
  "You are a precise assistant. Use the echo tool when the user asks you to echo text.";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? resolve(trimmed) : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentRuntimeConfig {
  return {
    provider: required(env, "NOVELBUILDER_PROVIDER"),
    modelId: required(env, "NOVELBUILDER_MODEL"),
    apiKey: env.NOVELBUILDER_API_KEY?.trim() || undefined,
    agentDir: resolve(env.NOVELBUILDER_AGENT_DIR?.trim() || ".agent"),
    projectDir: resolve(env.NOVELBUILDER_PROJECT_DIR?.trim() || ".workspace"),
    modelsPath: optionalPath(env.NOVELBUILDER_MODELS_PATH),
    systemPrompt: env.NOVELBUILDER_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
  };
}
```

- [ ] **Step 4：运行测试，确认通过**

```powershell
npm test -- test/config.test.ts
```

预期：PASS，4 tests passed。

- [ ] **Step 5：类型检查**

```powershell
npm run typecheck
```

预期：无输出，exit 0。

---

## Task 3：Pi 事件归一化

**Files：**

- Create：`agent-runtime/src/events.ts`
- Create：`agent-runtime/test/events.test.ts`

- [ ] **Step 1：先写失败测试**

`test/events.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { normalizePiEvent } from "../src/events.js";

describe("normalizePiEvent", () => {
  it("maps agent lifecycle events", () => {
    expect(normalizePiEvent({ type: "agent_start" })).toEqual({ type: "agent.start" });
    expect(normalizePiEvent({ type: "turn_end" })).toEqual({ type: "turn.end" });
    expect(normalizePiEvent({ type: "agent_end" })).toEqual({ type: "agent.end" });
  });

  it("maps text deltas", () => {
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "你好" },
      }),
    ).toEqual({ type: "agent.delta", text: "你好" });
  });

  it("ignores non-text message updates", () => {
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "..." },
      }),
    ).toBeNull();
  });

  it("maps tool lifecycle events", () => {
    expect(
      normalizePiEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "echo" }),
    ).toEqual({ type: "tool.start", toolCallId: "c1", toolName: "echo" });

    expect(
      normalizePiEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "echo", isError: false }),
    ).toEqual({ type: "tool.end", toolCallId: "c1", toolName: "echo", isError: false });
  });

  it("returns null for unknown events", () => {
    expect(normalizePiEvent({ type: "something_else" })).toBeNull();
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```powershell
npm test -- test/events.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3：实现 `src/events.ts`**

```ts
export type RunEvent =
  | { type: "agent.start" }
  | { type: "agent.delta"; text: string }
  | { type: "turn.end" }
  | { type: "agent.end" }
  | { type: "tool.start"; toolCallId: string; toolName: string }
  | { type: "tool.update"; toolCallId: string; toolName: string }
  | { type: "tool.end"; toolCallId: string; toolName: string; isError: boolean };

export interface PiEventLike {
  type: string;
  [key: string]: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizePiEvent(event: PiEventLike): RunEvent | null {
  switch (event.type) {
    case "agent_start":
      return { type: "agent.start" };
    case "turn_end":
      return { type: "turn.end" };
    case "agent_end":
      return { type: "agent.end" };
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (!update || typeof update !== "object") return null;
      const { type, delta } = update as { type?: unknown; delta?: unknown };
      if (type === "text_delta" && typeof delta === "string") {
        return { type: "agent.delta", text: delta };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        type: "tool.start",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
      };
    case "tool_execution_update":
      return {
        type: "tool.update",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
      };
    case "tool_execution_end":
      return {
        type: "tool.end",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
        isError: Boolean(event.isError),
      };
    default:
      return null;
  }
}
```

- [ ] **Step 4：运行测试，确认通过**

```powershell
npm test -- test/events.test.ts
```

预期：PASS，5 tests passed。

---

## Task 4：自定义 `echo` 工具

**Files：**

- Create：`agent-runtime/src/tools/echo.ts`
- Create：`agent-runtime/test/echo-tool.test.ts`

- [ ] **Step 1：先写失败测试**

`test/echo-tool.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { echoTool } from "../src/tools/echo.js";

describe("echoTool", () => {
  it("returns the input text", async () => {
    const result = await echoTool.execute(
      "call-1",
      { text: "hello" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toEqual({ length: 5 });
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```powershell
npm test -- test/echo-tool.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3：实现 `src/tools/echo.ts`**

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const echoTool = defineTool({
  name: "echo",
  label: "Echo",
  description: "Return the provided text unchanged.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: params.text }],
    details: { length: params.text.length },
  }),
});
```

- [ ] **Step 4：运行测试，确认通过**

```powershell
npm test -- test/echo-tool.test.ts
```

预期：PASS，1 test passed。

- [ ] **Step 5：类型检查**

```powershell
npm run typecheck
```

预期：exit 0。若 `execute` 的参数数量报错，以安装包 `dist/core/extensions/types.d.ts` 的 `ToolDefinition.execute` 签名为准；不要用 `any` 绕过。

---

## Task 5：会话工厂

**Files：**

- Create：`agent-runtime/src/runtime.ts`
- Create：`agent-runtime/test/runtime.test.ts`

- [ ] **Step 1：先写失败测试**

`test/runtime.test.ts`：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNovelAgentSession } from "../src/runtime.js";

describe("createNovelAgentSession", () => {
  it("throws a clear error for an unknown model", async () => {
    await expect(
      createNovelAgentSession({
        provider: "missing-provider",
        modelId: "missing-model",
        agentDir: mkdtempSync(join(tmpdir(), "novelbuilder-agent-")),
        projectDir: mkdtempSync(join(tmpdir(), "novelbuilder-project-")),
        systemPrompt: "test",
      }),
    ).rejects.toThrow(/Model not found: missing-provider\/missing-model/);
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```powershell
npm test -- test/runtime.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3：实现 `src/runtime.ts`**

```ts
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, type AgentRuntimeConfig } from "./config.js";
import { echoTool } from "./tools/echo.js";

export interface NovelAgentSession {
  session: AgentSession;
  dispose(): void;
}

export async function createNovelAgentSession(
  config: AgentRuntimeConfig = loadConfig(),
  options: { customTools?: ToolDefinition[] } = {},
): Promise<NovelAgentSession> {
  mkdirSync(config.agentDir, { recursive: true });
  mkdirSync(config.projectDir, { recursive: true });

  const modelsPath =
    config.modelsPath && existsSync(config.modelsPath) ? config.modelsPath : undefined;

  const modelRuntime = await ModelRuntime.create({
    authPath: resolve(config.agentDir, "auth.json"),
    ...(modelsPath ? { modelsPath } : {}),
    refreshOnCreate: false,
  });

  if (config.apiKey) {
    await modelRuntime.setRuntimeApiKey(config.provider, config.apiKey);
  }

  const model = modelRuntime.getModel(config.provider, config.modelId);
  if (!model) {
    throw new Error(`Model not found: ${config.provider}/${config.modelId}`);
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.projectDir,
    agentDir: config.agentDir,
    settingsManager,
    systemPromptOverride: () => config.systemPrompt,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: config.projectDir,
    agentDir: config.agentDir,
    model,
    modelRuntime,
    resourceLoader,
    noTools: "builtin",
    customTools: options.customTools ?? [echoTool],
    sessionManager: SessionManager.create(config.projectDir, resolve(config.agentDir, "sessions")),
    settingsManager,
  });

  return {
    session,
    dispose: () => session.dispose(),
  };
}
```

- [ ] **Step 4：运行测试，确认通过**

```powershell
npm test -- test/runtime.test.ts
```

预期：PASS，1 test passed。

- [ ] **Step 5：类型检查**

```powershell
npm run typecheck
```

预期：exit 0。如果 `ToolDefinition` 或 `AgentSession` 的导出名与 1.4.0 不符，以 `npm ls` 安装版本的 `dist/index.d.ts` 为准修正；不要降级依赖。

---

## Task 6：CLI 与 dry-run

**Files：**

- Create：`agent-runtime/src/cli.ts`

- [ ] **Step 1：实现 `src/cli.ts`**

```ts
import { loadConfig } from "./config.js";
import { normalizePiEvent, type PiEventLike } from "./events.js";
import { createNovelAgentSession } from "./runtime.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const premise =
  args.filter((arg) => arg !== "--dry-run").join(" ").trim() ||
  "写一个少年剑修在旧王朝崩塌后重建秩序的故事";

const config = loadConfig();
const agent = await createNovelAgentSession(config);

try {
  agent.session.subscribe((event) => {
    const normalized = normalizePiEvent(event as PiEventLike);
    if (!normalized) return;
    if (normalized.type === "agent.delta") {
      process.stdout.write(normalized.text);
    }
    if (normalized.type === "tool.start") {
      process.stderr.write(`\n[tool] ${normalized.toolName}\n`);
    }
  });

  if (dryRun) {
    console.log("dry-run ok");
    console.log(`model: ${config.provider}/${config.modelId}`);
    console.log(`tools: ${agent.session.getActiveToolNames().join(", ")}`);
  } else {
    await agent.session.prompt(premise);
    process.stdout.write("\n");
  }
} finally {
  agent.dispose();
}
```

- [ ] **Step 2：准备本地模型配置**

```powershell
New-Item -ItemType Directory -Force -Path agent | Out-Null
Copy-Item agent/models.example.json .agent/models.json -ErrorAction SilentlyContinue
```

如果 `.agent` 不存在，先创建：

```powershell
New-Item -ItemType Directory -Force -Path .agent | Out-Null
Copy-Item agent/models.example.json .agent/models.json
```

- [ ] **Step 3：准备 `.env`**

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，至少设置：

```text
NOVELBUILDER_PROVIDER=novelbuilder
NOVELBUILDER_MODEL=deepseek-chat
NOVELBUILDER_API_KEY=<你的 key>
```

- [ ] **Step 4：运行 dry-run**

```powershell
npm run smoke -- --dry-run
```

预期：

```text
dry-run ok
model: novelbuilder/deepseek-chat
tools: echo
```

如果报 `Model not found`，检查：

1. `.agent/models.json` 是否存在。
2. `NOVELBUILDER_PROVIDER` / `NOVELBUILDER_MODEL` 是否与 `models.json` 一致。
3. `NOVELBUILDER_MODELS_PATH` 是否指向正确文件。

- [ ] **Step 5：确认真实模型调用（需要 key）**

```powershell
npm run smoke -- "用一句话介绍你自己"
```

预期：终端流式输出模型回复，最后换行，exit 0。

如果只验证工具调用，用：

```powershell
npm run smoke -- "请调用 echo 工具，参数 text 为 hello，然后说 done。"
```

预期：stderr 出现 `[tool] echo`，模型随后输出 done/类似文本。若模型没有调用工具，不算失败；工具本身已在 Task 4 单测通过。

---

## Task 7：Pi 自定义 Provider 示例

**Files：**

- Create：`agent-runtime/agent/models.example.json`

- [ ] **Step 1：创建示例**

```json
{
  "$schema": "https://pi.dev/schemas/models.schema.json",
  "providers": {
    "novelbuilder": {
      "baseUrl": "https://api.deepseek.com/v1",
      "api": "openai-completions",
      "apiKey": "$NOVELBUILDER_API_KEY",
      "models": [
        {
          "id": "deepseek-chat"
        }
      ]
    }
  }
}
```

- [ ] **Step 2：切换到其他 OpenAI 兼容端点**

修改 `.agent/models.json` 的 `baseUrl` 和 `models[].id`，同时修改 `.env` 的 `NOVELBUILDER_PROVIDER` / `NOVELBUILDER_MODEL`。不要改代码。

支持的常见端点：

```text
DeepSeek:  https://api.deepseek.com/v1
Qwen:      https://dashscope.aliyuncs.com/compatible-mode/v1
Moonshot:  https://api.moonshot.cn/v1
Ollama:    http://localhost:11434/v1
```

- [ ] **Step 3：重新 dry-run**

```powershell
npm run smoke -- --dry-run
```

预期：`tools: echo`，模型名与修改后一致。

---

## Task 8：Pi SDK API 守卫

**Files：**

- Create：`agent-runtime/scripts/check-pi-api.ts`

- [ ] **Step 1：创建脚本**

```ts
import * as pi from "@earendil-works/pi-coding-agent";

const required = [
  "createAgentSession",
  "defineTool",
  "DefaultResourceLoader",
  "ModelRuntime",
  "SessionManager",
  "SettingsManager",
] as const;

for (const name of required) {
  if (!(name in pi)) {
    throw new Error(`Missing Pi SDK export: ${name}`);
  }
}

console.log(`Pi SDK exports OK: ${required.join(", ")}`);
```

- [ ] **Step 2：运行**

```powershell
npm run check:pi
```

预期：

```text
Pi SDK exports OK: createAgentSession, defineTool, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager
```

---

## Task 9：验收记录与 Phase 0 Gate

**Files：**

- Create：`agent-runtime/PI_SDK_NOTES.md`
- Create：`agent-runtime/PHASE0_ACCEPTANCE.md`

- [ ] **Step 1：写 `PI_SDK_NOTES.md`**

必须记录以下已验证事实（按实际结果修正）：

```markdown
# Pi SDK Notes

- Node: 24.19.0
- pi-coding-agent: 1.4.0
- pi-ai: 1.4.0
- Session creation: createAgentSession({ modelRuntime, model, noTools: "builtin", customTools, sessionManager, settingsManager, resourceLoader })
- Custom tools: defineTool({ name, label, description, parameters: Type.Object(...), execute })
- Model lookup: modelRuntime.getModel(provider, modelId)
- API key: await modelRuntime.setRuntimeApiKey(provider, key)
- Sessions: SessionManager.create(cwd, sessionDir) writes JSONL under the given sessionDir
- Events: agent_start, turn_start, message_update(text_delta), tool_execution_start/update/end, turn_end, agent_end
- Cleanup: session.dispose() is required
- Custom OpenAI-compatible endpoint: models.json with api: "openai-completions"
- Gotcha: `noTools: "builtin"` disables read/bash/edit/write but keeps customTools active
- Gotcha: story write serialization must be handled by Story Engine locks/idempotency, not by createAgentSession options
```

- [ ] **Step 2：写 `PHASE0_ACCEPTANCE.md`**

```markdown
# Phase 0 Acceptance

- [ ] Node 版本：`node --version` 输出 `v24.19.0` 或更高（>= 22.19.0）。
- [ ] 依赖版本：`npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai typebox --depth=0` 输出 `1.4.0`、`1.4.0`、`1.3.27`。
- [ ] 类型检查：`npm run typecheck` 退出码 0。
- [ ] 单元测试：`npm test` 全部通过。
- [ ] SDK 导出：`npm run check:pi` 输出 `Pi SDK exports OK`。
- [ ] dry-run：`npm run smoke -- --dry-run` 输出 `tools: echo`。
- [ ] 真实模型：`npm run smoke -- "用一句话介绍你自己"` 输出非空文本，退出码 0。
- [ ] 会话落盘：`Get-ChildItem .agent/sessions` 能看到本次生成的 `.jsonl` 文件。
- [ ] npm cache：`npm config get cache` 输出 `F:\project\novel-generator\.cache\npm`。
- [ ] C 盘写入：`~/.pi/agent/sessions` 没有出现本次新会话；`C:\Users\kenly\AppData\Local\npm-cache` 没有本次新增 cache。
- [ ] 实际输出已追加到 `PHASE0_RUN.log`（命令 + 关键输出 + 时间）。
```

- [ ] **Step 3：执行全部验收并记录输出**

```powershell
$env:npm_config_cache="F:\project\novel-generator\.cache\npm"
$env:TMP="F:\project\novel-generator\.cache\tmp"
$env:TEMP="F:\project\novel-generator\.cache\tmp"
$log = "PHASE0_RUN.log"
"== $(Get-Date -Format o) ==" | Out-File $log -Append
node --version *>&1 | Tee-Object -FilePath $log -Append
npm config get cache *>&1 | Tee-Object -FilePath $log -Append
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai typebox --depth=0 *>&1 | Tee-Object -FilePath $log -Append
npm run typecheck *>&1 | Tee-Object -FilePath $log -Append
npm test *>&1 | Tee-Object -FilePath $log -Append
npm run check:pi *>&1 | Tee-Object -FilePath $log -Append
npm run smoke -- --dry-run *>&1 | Tee-Object -FilePath $log -Append
npm run smoke -- "用一句话介绍你自己" *>&1 | Tee-Object -FilePath $log -Append
Get-ChildItem .agent/sessions *>&1 | Tee-Object -FilePath $log -Append
```

预期：

- typecheck exit 0。
- 所有测试通过（至少 11 个）。
- SDK 导出检查通过。
- dry-run 输出 `tools: echo`。
- 真实模型输出非空。
- `.agent/sessions` 下出现 `.jsonl` 文件。
- `~/.pi/agent/sessions` 不应出现本次新会话；如果出现，记录并在 Phase 1 前改为显式 `sessionDir` 或设置 `PI_CODING_AGENT_SESSION_DIR`。

- [ ] **Step 4：Gate 判定**

只有以下全部满足，才允许进入 Phase 1：

- [ ] `npm run typecheck` 通过。
- [ ] `npm test` 全部通过。
- [ ] `npm run check:pi` 通过。
- [ ] `npm run smoke -- --dry-run` 显示 `tools: echo`。
- [ ] 真实模型 smoke 成功（如果本机没有可用 key，Phase 0 标记为“部分验证”，不得进入 Phase 1）。
- [ ] 会话文件落在项目目录内，或已明确记录例外与修正方案。
- [ ] npm cache 和临时文件都在 `F:\project\novel-generator\.cache` 下。

---

## 执行方式

完成本计划后，Phase 1（Story Engine 最小闭环）再单独拆任务。Phase 1 的前置条件是本文件的 Gate 全部通过。

计划保存于：

`F:\project\novel-generator\docs\plans\2026-10-24-phase-0-pi-sdk-skeleton.md`

执行时不要修改旧项目 `F:\project\NovelForge\NovelForge`；不要自动 commit。
