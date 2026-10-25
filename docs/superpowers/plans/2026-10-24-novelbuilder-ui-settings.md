# NovelBuilder UI 改版与全局模型设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web UI 重做为 NovelBuilder 的「现代编辑室」风格，移除运行模式，将真实模型配置收进自动保存的全局设置抽屉。

**Architecture:** 新增服务端 `JsonSettingsStore` 管理 `.agent/settings.json`，通过 `/api/settings` 读写并脱敏；`POST /api/projects` 按「请求体 → 已保存设置 → `.env`」选择模型。前端仍是 `src/ui.ts` 内联的单页应用，去掉 localStorage 模型配置，改为防抖调用设置接口。

**Tech Stack:** TypeScript 5.9、Node 22、`node:http`、原生 HTML/CSS/JS、Vitest 4、Zod 3（本次不改）

**VCS:** 当前目录不是 git 仓库，因此不执行 commit；每个任务用 `npm run typecheck` / `npm test` / 页面断言作为检查点。

**Spec:** `docs/superpowers/specs/2026-10-24-novelbuilder-ui-settings-design.md`

---

## Task 0: 建立基线

**Files:** 无

- [ ] **Step 1: 确认目录与现有测试状态**

Run:

```powershell
cd F:\project\novel-generator\agent-runtime
npm run typecheck
npm test
```

Expected: typecheck 无输出；测试 24 个文件、261 个用例全部通过。

- [ ] **Step 2: 记录当前 8787 端口是否被占用**

Run:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
```

Expected: 可能为空，也可能有旧服务。后面手工验收前需要先停掉旧进程。

---

## Task 1: NovelForge → NovelBuilder 全量改名

**Files:**
- Modify: `agent-runtime/src/**/*.ts`
- Modify: `agent-runtime/test/**/*.ts`
- Modify: `agent-runtime/package.json`
- Modify: `agent-runtime/package-lock.json`
- Modify: `agent-runtime/.env`
- Modify: `agent-runtime/.env.example`
- Modify: `agent-runtime/agent/models.example.json`
- Modify: `agent-runtime/.agent/models.json`
- Modify: `README.md`
- Modify: `agent-runtime/PHASE0_ACCEPTANCE.md`
- Modify: `agent-runtime/PI_SDK_NOTES.md`
- Modify: `docs/plans/*.md`

- [ ] **Step 1: 执行改名脚本（保护旧项目真实路径）**

```powershell
$root = "F:\project\novel-generator"
$files = @()
$files += Get-ChildItem "$root\agent-runtime\src" -Recurse -File -Filter *.ts
$files += Get-ChildItem "$root\agent-runtime\test" -Recurse -File -Filter *.ts
$files += Get-Item "$root\agent-runtime\package.json",
  "$root\agent-runtime\package-lock.json",
  "$root\agent-runtime\.env",
  "$root\agent-runtime\.env.example",
  "$root\agent-runtime\agent\models.example.json",
  "$root\agent-runtime\.agent\models.json",
  "$root\README.md",
  "$root\agent-runtime\PHASE0_ACCEPTANCE.md",
  "$root\agent-runtime\PI_SDK_NOTES.md"
$files += Get-ChildItem "$root\docs\plans" -File -Filter *.md

foreach ($file in $files) {
  $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $text = $text.Replace('F:\project\NovelForge\NovelForge', '__OLD_PROJECT_PATH__')
  $text = $text.Replace('F:\project\NovelForge', '__OLD_PROJECT_ROOT__')
  $text = $text.Replace('@novelforge/agent-runtime', '@novelbuilder/agent-runtime')
  $text = $text.Replace('NOVELFORGE_', 'NOVELBUILDER_')
  $text = $text.Replace('novelforge-ui', 'novelbuilder-ui')
  $text = $text.Replace('novelforge-next', 'novelbuilder-next')
  $text = $text.Replace('novelforge', 'novelbuilder')
  $text = $text.Replace('NovelForge', 'NovelBuilder')
  $text = $text.Replace('__OLD_PROJECT_PATH__', 'F:\project\NovelForge\NovelForge')
  $text = $text.Replace('__OLD_PROJECT_ROOT__', 'F:\project\NovelForge')
  [System.IO.File]::WriteAllText($file.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
}
```

- [ ] **Step 2: 确认活跃文件里没有旧名称**

Run:

```powershell
Get-ChildItem "F:\project\novel-generator" -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.cache|output|demo|\.superpowers)\\' } |
  Select-String -Pattern 'NovelForge|NOVELFORGE|novelforge'
```

Expected: 只剩三类历史引用：`docs/plans` 中指向旧外部项目路径 `F:\project\NovelForge\NovelForge` 的行、`agent-runtime/PHASE0_RUN.log` 的旧日志、`docs/superpowers/{plans,specs}` 中的改名说明。

- [ ] **Step 3: 验证改名后测试仍通过**

Run:

```powershell
cd F:\project\novel-generator\agent-runtime
npm run typecheck
npm test
```

Expected: 全部通过；`config.test.ts`、`cli.test.ts` 已经使用 `NOVELBUILDER_*` 与 `novelbuilder`。

---

## Task 2: 设置存储模块

**Files:**
- Create: `agent-runtime/src/settings.ts`
- Test: `agent-runtime/test/settings.test.ts`

- [ ] **Step 1: 写失败测试**

Create `agent-runtime/test/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "./temp.js";
import { JsonSettingsStore } from "../src/settings.js";

function createStore(prefix = "novelbuilder-settings-"): {
  dir: string;
  file: string;
  store: JsonSettingsStore;
} {
  const dir = createTempDir(prefix);
  const file = join(dir, "settings.json");
  return { dir, file, store: new JsonSettingsStore(file) };
}

describe("JsonSettingsStore", () => {
  it("returns undefined when the file does not exist", async () => {
    const { dir, store } = createStore();
    try {
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("persists and reads all fields", async () => {
    const { dir, file, store } = createStore();
    try {
      const saved = await store.patch({
        protocol: "openai",
        model: "  deepseek-chat  ",
        baseUrl: "  https://api.deepseek.com/v1  ",
        apiKey: "  sk-test  ",
      });

      expect(saved.protocol).toBe("openai");
      expect(saved.model).toBe("deepseek-chat");
      expect(saved.baseUrl).toBe("https://api.deepseek.com/v1");
      expect(saved.apiKey).toBe("sk-test");
      expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
        apiKey?: string;
      };
      expect(onDisk.apiKey).toBe("sk-test");

      expect(await store.read()).toMatchObject({
        protocol: "openai",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("merges partial patches and preserves an existing key", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({
        protocol: "anthropic",
        model: "claude-sonnet-4-5",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
      });

      await store.patch({ model: "claude-haiku-4-5" });
      await store.patch({ apiKey: "   " });

      expect(await store.read()).toMatchObject({
        protocol: "anthropic",
        model: "claude-haiku-4-5",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("clears the key with clearApiKey", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test", apiKey: "secret" });
      await store.patch({ clearApiKey: true });
      const stored = await store.read();
      expect(stored?.apiKey).toBeUndefined();
      expect(stored?.model).toBe("m");
    } finally {
      removeTempDir(dir);
    }
  });

  it("clears the whole file", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test", apiKey: "secret" });
      await store.clear();
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("treats malformed JSON as unconfigured", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(file, "{not json", "utf8");
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("serializes concurrent patches", async () => {
    const { dir, store } = createStore();
    try {
      await Promise.all([
        store.patch({ model: "model-a" }),
        store.patch({ baseUrl: "https://example.com/v1" }),
        store.patch({ protocol: "anthropic" }),
      ]);

      expect(await store.read()).toMatchObject({
        protocol: "anthropic",
        model: "model-a",
        baseUrl: "https://example.com/v1",
      });
    } finally {
      removeTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cd F:\project\novel-generator\agent-runtime
npx vitest run test/settings.test.ts
```

Expected: FAIL，提示找不到 `../src/settings.js`。

- [ ] **Step 3: 实现 `src/settings.ts`**

```ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ModelProtocol = "openai" | "anthropic";

export interface StoredSettings {
  protocol: ModelProtocol | null;
  model: string;
  baseUrl: string;
  apiKey?: string;
  updatedAt: string;
}

export interface SettingsPatch {
  protocol?: ModelProtocol | null | "";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface SettingsStore {
  read(): Promise<StoredSettings | undefined>;
  patch(patch: SettingsPatch): Promise<StoredSettings>;
  clear(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStored(value: unknown): StoredSettings | undefined {
  if (!isRecord(value)) return undefined;

  const protocol =
    value.protocol === "openai" || value.protocol === "anthropic"
      ? value.protocol
      : null;
  const model = typeof value.model === "string" ? value.model : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : "";
  const apiKey =
    typeof value.apiKey === "string" && value.apiKey.trim().length > 0
      ? value.apiKey
      : undefined;
  const updatedAt =
    typeof value.updatedAt === "string"
      ? value.updatedAt
      : new Date(0).toISOString();

  return {
    protocol,
    model,
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    updatedAt,
  };
}

export class JsonSettingsStore implements SettingsStore {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async read(): Promise<StoredSettings | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }

    try {
      const parsed = parseStored(JSON.parse(raw));
      if (!parsed) {
        process.stderr.write(
          `NovelBuilder: ignoring invalid settings file ${this.filePath}\n`,
        );
      }
      return parsed;
    } catch {
      process.stderr.write(
        `NovelBuilder: ignoring unreadable settings file ${this.filePath}\n`,
      );
      return undefined;
    }
  }

  async patch(patch: SettingsPatch): Promise<StoredSettings> {
    return this.enqueue(async () => {
      const current: StoredSettings = (await this.read()) ?? {
        protocol: null,
        model: "",
        baseUrl: "",
        updatedAt: new Date(0).toISOString(),
      };

      const protocol =
        patch.protocol === undefined
          ? current.protocol
          : patch.protocol === ""
            ? null
            : patch.protocol;
      const next: StoredSettings = {
        protocol,
        model:
          patch.model === undefined ? current.model : patch.model.trim(),
        baseUrl:
          patch.baseUrl === undefined
            ? current.baseUrl
            : patch.baseUrl.trim(),
        updatedAt: new Date().toISOString(),
        ...(current.apiKey === undefined ? {} : { apiKey: current.apiKey }),
      };

      if (patch.clearApiKey) {
        delete next.apiKey;
      } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
        next.apiKey = patch.apiKey.trim();
      }

      await this.write(next);
      return next;
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.filePath, { force: true });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async write(settings: StoredSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await rename(tempPath, this.filePath);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code !== "EEXIST" && code !== "EPERM") throw error;
      await rm(this.filePath, { force: true });
      await rename(tempPath, this.filePath);
    }
  }
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run:

```powershell
npx vitest run test/settings.test.ts
npm run typecheck
```

Expected: 7 个用例通过，typecheck 无输出。

---

## Task 3: 设置读取、保存、清除接口

**Files:**
- Modify: `agent-runtime/src/config.ts`
- Modify: `agent-runtime/src/server.ts`
- Test: `agent-runtime/test/server.test.ts`

- [ ] **Step 1: 在 `server.test.ts` 中补设置接口测试**

在 `describe("NovelBuilder HTTP server", ...)` 内新增一个嵌套 `describe`。先补 import：

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
```

把主测试服务器的启动参数改为：

```ts
started = await startServer({
  port: 0,
  host: "127.0.0.1",
  outputDir: join(root, "output"),
  settingsPath: join(root, "settings.json"),
  fakeDefault: true,
});
```

新增测试：

```ts
describe("settings API", () => {
  beforeEach(async () => {
    await fetch(`${baseUrl}/api/settings`, { method: "DELETE" });
  });

  it("returns empty settings when nothing is saved", async () => {
    const response = await fetch(`${baseUrl}/api/settings`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      protocol: null,
      model: "",
      baseUrl: "",
      hasApiKey: false,
      complete: false,
      updatedAt: null,
    });
  });

  it("saves settings and never returns the API key", async () => {
    const secret = "server-settings-secret";
    const response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: "openai",
        model: "saved-model",
        baseUrl: "https://example.com/v1",
        apiKey: secret,
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    const payload = JSON.parse(text);
    expect(payload).toMatchObject({
      protocol: "openai",
      model: "saved-model",
      baseUrl: "https://example.com/v1",
      hasApiKey: true,
      complete: true,
      usable: true,
    });

    const onDisk = JSON.parse(
      readFileSync(join(root, "settings.json"), "utf8"),
    ) as { apiKey?: string };
    expect(onDisk.apiKey).toBe(secret);
  });

  it("preserves the saved key when apiKey is omitted and clears it on request", async () => {
    await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: "openai",
        model: "m1",
        baseUrl: "https://example.com/v1",
        apiKey: "keep-me",
      }),
    });

    const update = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m2" }),
    });
    expect((await update.json()).hasApiKey).toBe(true);

    const cleared = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearApiKey: true }),
    });
    const clearedPayload = await cleared.json();
    expect(clearedPayload.hasApiKey).toBe(false);
    expect(clearedPayload.model).toBe("m2");
  });

  it("rejects invalid settings payloads", async () => {
    const wrongProtocol = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol: "grpc" }),
    });
    expect(wrongProtocol.status).toBe(400);

    const wrongType = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: 42 }),
    });
    expect(wrongType.status).toBe(400);

    const notJson = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: "protocol=openai",
    });
    expect(notJson.status).toBe(415);
  });

  it("clears settings with DELETE", async () => {
    await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: "openai",
        model: "m",
        baseUrl: "https://example.com/v1",
        apiKey: "secret",
      }),
    });

    const deleted = await fetch(`${baseUrl}/api/settings`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const payload = await deleted.json();
    expect(payload).toMatchObject({
      protocol: null,
      model: "",
      baseUrl: "",
      hasApiKey: false,
      complete: false,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run test/server.test.ts
```

Expected: 设置相关用例 FAIL（404 或缺少 `settingsPath` 类型）。

- [ ] **Step 3: 在 `src/config.ts` 增加 env 辅助函数**

在 `loadConfig` 后追加：

```ts
export function hasEnvModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.NOVELBUILDER_PROVIDER?.trim() && env.NOVELBUILDER_MODEL?.trim(),
  );
}

export function envModelName(env: NodeJS.ProcessEnv = process.env): string {
  return env.NOVELBUILDER_MODEL?.trim() ?? "";
}
```

- [ ] **Step 4: 在 `src/server.ts` 接入设置存储**

补 import：

```ts
import { envModelName, hasEnvModelConfig, loadConfig } from "./config.js";
import {
  JsonSettingsStore,
  type ModelProtocol,
  type SettingsPatch,
  type SettingsStore,
  type StoredSettings,
} from "./settings.js";
```

`StartServerOptions` 增加：

```ts
settingsPath?: string;
```

`ServerContext` 增加：

```ts
settings: SettingsStore;
```

新增辅助函数（放在 `sendMethodNotAllowed` 附近）：

```ts
function isCompleteSettings(
  settings: StoredSettings | undefined,
): settings is StoredSettings & { protocol: ModelProtocol } {
  if (!settings || !settings.protocol) return false;
  if (!settings.model.trim() || !settings.baseUrl.trim()) return false;
  try {
    const url = new URL(settings.baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function settingsView(stored: StoredSettings | undefined): {
  protocol: ModelProtocol | null;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  complete: boolean;
  usable: boolean;
  updatedAt: string | null;
  envConfigured: boolean;
  envModel: string;
} {
  const envConfigured = hasEnvModelConfig();
  const complete = isCompleteSettings(stored);
  return {
    protocol: stored?.protocol ?? null,
    model: stored?.model ?? "",
    baseUrl: stored?.baseUrl ?? "",
    hasApiKey: Boolean(stored?.apiKey),
    complete,
    usable: complete || envConfigured,
    updatedAt: stored?.updatedAt ?? null,
    envConfigured,
    envModel: envConfigured ? envModelName() : "",
  };
}

function parseSettingsPatch(value: unknown): SettingsPatch {
  if (!isRecord(value)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }

  const patch: SettingsPatch = {};

  if ("protocol" in value) {
    const protocol = value.protocol;
    if (protocol === null || protocol === "") patch.protocol = null;
    else if (protocol === "openai" || protocol === "anthropic") {
      patch.protocol = protocol;
    } else {
      throw new RequestError(
        400,
        'protocol must be "openai", "anthropic", or null.',
      );
    }
  }

  if ("model" in value) {
    if (typeof value.model !== "string") {
      throw new RequestError(400, "model must be a string.");
    }
    if (value.model.length > 200) {
      throw new RequestError(400, "model must be at most 200 characters.");
    }
    patch.model = value.model;
  }

  if ("baseUrl" in value) {
    if (typeof value.baseUrl !== "string") {
      throw new RequestError(400, "baseUrl must be a string.");
    }
    if (value.baseUrl.length > 2000) {
      throw new RequestError(400, "baseUrl must be at most 2000 characters.");
    }
    patch.baseUrl = value.baseUrl;
  }

  if ("apiKey" in value) {
    if (typeof value.apiKey !== "string") {
      throw new RequestError(400, "apiKey must be a string.");
    }
    if (value.apiKey.length > 10_000) {
      throw new RequestError(400, "apiKey must be at most 10000 characters.");
    }
    patch.apiKey = value.apiKey;
  }

  if ("clearApiKey" in value) {
    if (typeof value.clearApiKey !== "boolean") {
      throw new RequestError(400, "clearApiKey must be a boolean.");
    }
    patch.clearApiKey = value.clearApiKey;
  }

  return patch;
}
```

在 `startServer` 中创建设置存储：

```ts
const settingsPath = options.settingsPath
  ? resolve(options.settingsPath)
  : resolve(
      process.env.NOVELBUILDER_AGENT_DIR?.trim() || ".agent",
      "settings.json",
    );
```

把 `settings: new JsonSettingsStore(settingsPath)` 放进 `context` 对象。

在 `handleRequest` 中，`/api/projects` 分支之后加入：

```ts
if (pathname === "/api/settings") {
  if (method === "GET") {
    try {
      sendJson(res, 200, settingsView(await context.settings.read()));
    } catch (error) {
      logServerError(error);
      sendInternalError(res);
    }
    return;
  }

  if (method === "PUT") {
    if (rejectCrossOrigin(req, res, context.port)) return;
    if (!isJsonContentType(headerValue(req.headers["content-type"]))) {
      sendJson(res, 415, {
        error: "Content-Type must be application/json.",
      });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const patch = parseSettingsPatch(body);
      const saved = await context.settings.patch(patch);
      sendJson(res, 200, settingsView(saved));
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      logServerError(error);
      sendInternalError(res);
    }
    return;
  }

  if (method === "DELETE") {
    if (rejectCrossOrigin(req, res, context.port)) return;
    try {
      await context.settings.clear();
      sendJson(res, 200, settingsView(await context.settings.read()));
    } catch (error) {
      logServerError(error);
      sendInternalError(res);
    }
    return;
  }

  sendMethodNotAllowed(res, ["GET", "PUT", "DELETE"]);
  return;
}
```

- [ ] **Step 5: 运行设置接口测试**

Run:

```powershell
npx vitest run test/server.test.ts
npm run typecheck
```

Expected: 设置接口用例通过；已有用例继续通过。

- [ ] **Step 6: 隔离其他测试服务器的设置文件**

在 `test/server.test.ts` 中检查每一处 `startServer({`，确保都补了设置文件路径：

| 测试服务器 | 临时根目录 | 要补的字段 |
| --- | --- | --- |
| 主服务器（`root`） | `root` | `settingsPath: join(root, "settings.json")` |
| `modelServer` | `captureRoot` | `settingsPath: join(captureRoot, "settings.json")` |
| `orphanServer` | `orphanRoot` | `settingsPath: join(orphanRoot, "settings.json")` |
| `abortServer` | `abortRoot` | `settingsPath: join(abortRoot, "settings.json")` |

避免测试读取开发者真实的 `.agent/settings.json`。Run:

```powershell
Select-String -Path test\server.test.ts -Pattern "startServer\(|settingsPath"
```

Expected: 4 个 `startServer(` 附近都有对应的 `settingsPath`。

Run:

```powershell
npm test
```

Expected: 全部通过。

---

## Task 4: 生成请求使用已保存设置

**Files:**
- Modify: `agent-runtime/src/server.ts`
- Test: `agent-runtime/test/server.test.ts`

- [ ] **Step 1: 写失败测试**

在设置接口测试后新增：

```ts
it("uses saved settings for a real generation request", async () => {
  const savedRoot = createTempDir("novelbuilder-saved-settings-");
  const captured: Array<ModelConfigInput | undefined> = [];
  const savedServer = await startServer({
    port: 0,
    host: "127.0.0.1",
    outputDir: join(savedRoot, "output"),
    settingsPath: join(savedRoot, "settings.json"),
    fakeDefault: false,
    gatewayFactory: (_project, modelConfig) => {
      captured.push(modelConfig);
      return new FakeAiGateway();
    },
  });
  const savedBase = `http://127.0.0.1:${savedServer.port}`;

  try {
    await fetch(`${savedBase}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol: "openai",
        model: "saved-model",
        baseUrl: "https://example.com/v1",
        apiKey: "saved-secret",
      }),
    });

    const response = await fetch(`${savedBase}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        premise: "一个使用已保存设置的生成请求。",
        maxChapters: 1,
        chapterWords: 300,
      }),
    });

    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).not.toContain("saved-secret");

    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      protocol: "openai",
      model: "saved-model",
      baseUrl: "https://example.com/v1",
      apiKey: "saved-secret",
    });

    const created = JSON.parse(text) as CreateProjectResponse;
    const payload = await waitForProjectOn(savedBase, created.projectId);
    expect(payload.project.status).toBe("completed");
  } finally {
    await savedServer.close();
    removeTempDir(savedRoot);
  }
}, 20_000);

it("rejects real generation when nothing is configured", async () => {
  const noneRoot = createTempDir("novelbuilder-no-settings-");
  const noneServer = await startServer({
    port: 0,
    host: "127.0.0.1",
    outputDir: join(noneRoot, "output"),
    settingsPath: join(noneRoot, "settings.json"),
    fakeDefault: false,
  });
  const noneBase = `http://127.0.0.1:${noneServer.port}`;

  vi.stubEnv("NOVELBUILDER_PROVIDER", "");
  vi.stubEnv("NOVELBUILDER_MODEL", "");

  try {
    const response = await fetch(`${noneBase}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        premise: "没有配置模型的请求。",
        maxChapters: 1,
        chapterWords: 300,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "model_not_configured",
    });
  } finally {
    vi.unstubAllEnvs();
    await noneServer.close();
    removeTempDir(noneRoot);
  }
}, 15_000);
```

- [ ] **Step 2: 运行确认失败**

Run:

```powershell
npx vitest run test/server.test.ts
```

Expected: 「uses saved settings」用例失败，捕获到的 `modelConfig` 是 `undefined`，或真实请求返回 500。

- [ ] **Step 3: 修改 `handleCreateProject` 的模型解析**

把原来的：

```ts
let ai: AiGateway;
const useFake = parsed.fake ?? context.fakeDefault;
try {
  if (context.gatewayFactory) {
    ai = context.gatewayFactory(project, parsed.modelConfig);
  } else if (useFake) {
    ai = new FakeAiGateway();
  } else if (parsed.modelConfig) {
    const { createPiGatewayFromModelConfig } = await import(
      "./ai/piGateway.js"
    );
    ai = await createPiGatewayFromModelConfig({
      ...parsed.modelConfig,
      agentDir: resolve(process.env.NOVELBUILDER_AGENT_DIR || ".agent"),
    });
  } else {
    ai = await createRealGateway();
  }
} catch (error) {
  logServerError(error);
  sendInternalError(res);
  return;
}
```

替换为：

```ts
let ai: AiGateway;
const useFake = parsed.fake ?? context.fakeDefault;
let modelConfig = parsed.modelConfig;

if (!useFake && !modelConfig) {
  let stored: StoredSettings | undefined;
  try {
    stored = await context.settings.read();
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (isCompleteSettings(stored)) {
    modelConfig = {
      protocol: stored.protocol,
      model: stored.model,
      baseUrl: stored.baseUrl,
      ...(stored.apiKey === undefined ? {} : { apiKey: stored.apiKey }),
    };
  }
}

try {
  if (context.gatewayFactory) {
    ai = context.gatewayFactory(project, modelConfig);
  } else if (useFake) {
    ai = new FakeAiGateway();
  } else if (modelConfig) {
    const { createPiGatewayFromModelConfig } = await import(
      "./ai/piGateway.js"
    );
    ai = await createPiGatewayFromModelConfig({
      ...modelConfig,
      agentDir: resolve(process.env.NOVELBUILDER_AGENT_DIR || ".agent"),
    });
  } else if (!hasEnvModelConfig()) {
    sendJson(res, 400, {
      error: "未配置模型。请先在全局设置中填写模型配置。",
      code: "model_not_configured",
    });
    return;
  } else {
    ai = await createRealGateway();
  }
} catch (error) {
  logServerError(error);
  sendInternalError(res);
  return;
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run:

```powershell
npx vitest run test/server.test.ts
npm run typecheck
```

Expected: 全部通过，且响应文本不含测试 Key。

---

## Task 5: 页面重写（方案 C）

**Files:**
- Modify: `agent-runtime/src/ui.ts`
- Test: `agent-runtime/test/server.test.ts`

**视觉源文件：** `.superpowers/brainstorm/design/content/design-c-settings.html`。CSS 以该文件为准，移除假数据、演示状态和未实现的导航。

- [ ] **Step 1: 先更新首页断言**

把 `test/server.test.ts` 的 `serves the home page` 用例替换为：

```ts
it("serves the NovelBuilder page without a demo mode", async () => {
  const response = await fetch(`${baseUrl}/`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();

  expect(html).toContain("NovelBuilder");
  expect(html).toContain('id="novel-form"');
  expect(html).toContain('id="premise"');
  expect(html).toContain('id="maxChapters"');
  expect(html).toContain('id="chapterWords"');
  expect(html).toContain('id="model-pill"');
  expect(html).toContain('id="settings-button"');
  expect(html).toContain('id="settings-drawer"');
  expect(html).toContain('id="settings-model"');
  expect(html).toContain('id="settings-baseUrl"');
  expect(html).toContain('id="settings-apiKey"');
  expect(html).toContain('id="protocol-openai"');
  expect(html).toContain('id="protocol-anthropic"');
  expect(html).toContain("开始生成");

  expect(html).not.toContain("演示模式");
  expect(html).not.toContain("运行模式");
  expect(html).not.toContain('id="mode-demo"');
  expect(html).not.toContain('id="mode-real"');
  expect(html).not.toContain("modelSettings");
  expect(html).not.toContain("localStorage");

  expect(html).not.toContain("<link");
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toContain("url(http");
});
```

- [ ] **Step 2: 运行确认失败**

Run:

```powershell
npx vitest run test/server.test.ts -t "serves the NovelBuilder page"
```

Expected: FAIL，旧页面仍包含 `mode-demo`、`演示模式`。

- [ ] **Step 3: 重写 `src/ui.ts` 的 body 结构与样式**

保留文件顶部的 `const HOME_PAGE = \`<!doctype html>...\`` 与底部 `export function renderHomePage()`。

从 `design-c-settings.html` 复制 `:root` 变量、基础排版、`.topbar`、`.page`、`.intro`、`.layout`、`.composer*`、`.options`、`.panel*`、`.steps`、`.kv`、`.drawer*`、`.overlay`、`.toast` 的视觉规则，并补充：

```css
* { box-sizing: border-box; }
html, body { margin: 0; }
[hidden] { display: none !important; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
body.drawer-open { overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.segmented label { flex: 1; display: block; cursor: pointer; }
.segmented span { display: block; width: 100%; text-align: center; }
.segmented input:checked + span { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(20,24,20,.08); }
.segmented input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
.fieldset, fieldset.field { border: 0; padding: 0; margin: 0 0 17px; min-width: 0; }
.field-label { display: block; padding: 0; margin: 0 0 6px; font-size: 12px; font-weight: 600; }
.model-pill, .icon-btn { font: inherit; cursor: pointer; }
.opt { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; cursor: text; }
.opt > span { width: 100%; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.opt input { width: 76px; padding: 0; border: 0; background: transparent; color: var(--ink); font-family: var(--mono); font-size: 19px; font-weight: 600; letter-spacing: -.03em; outline: 0; }
.opt b { font-family: var(--mono); font-size: 19px; font-weight: 600; letter-spacing: -.03em; }
.opt em { font-style: normal; font-size: 11px; color: var(--muted); }
.save-hint { border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
.composer-actions { display: flex; align-items: center; gap: 9px; }
.current[data-state="warn"] { background: #fdf6e7; border-color: #ecd9ad; }
.current[data-state="warn"] .pulse { background: #c58a2a; box-shadow: 0 0 0 4px rgba(197,138,42,.14); }
.current[data-state="warn"] .tag { color: #8a5c12; border-color: #e5c98e; }
.save-state[data-state="warn"] { color: #a06a18; }
.save-state[data-state="saving"] { color: var(--muted); }
.save-state[data-state="error"] { color: var(--warm); cursor: pointer; }
.save-state[data-state="idle"] { color: var(--muted); }
.save-state { border: 0; background: none; padding: 0; font: inherit; }

.ring {
  --p: 0;
  width: 58px; height: 58px; border-radius: 50%;
  background: conic-gradient(var(--accent) calc(var(--p) * 1%), #e9eae4 0);
  display: grid; place-items: center; flex: none;
}
.ring span {
  width: 44px; height: 44px; border-radius: 50%; background: var(--surface);
  display: grid; place-items: center; font-family: var(--mono);
  font-size: 11px; font-weight: 600; color: var(--ink);
}

.steps li.done .bullet { background: var(--accent); border-color: var(--accent); color: #fff; }
.steps li.active .bullet { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(31,91,78,.1); }
.steps li.active .bullet::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.steps li.error { color: var(--warm); }
.steps li.error .bullet { border-color: var(--warm); color: var(--warm); }
.steps li.done .txt b, .steps li.active .txt b { color: var(--accent); }

.status[data-state="running"] { color: var(--accent); background: var(--accent-soft); }
.status[data-state="completed"] { color: var(--accent); background: var(--accent-soft); }
.status[data-state="failed"] { color: var(--warm); background: var(--warm-soft); }
.status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.model-pill[data-state="warn"] .dot { background: #c58a2a; box-shadow: 0 0 0 3px rgba(197,138,42,.14); }
.model-pill[data-state="loading"] .dot { background: #a4a8a2; box-shadow: none; }
.save-hint[data-state="warn"] { color: #a06a18; }

.overlay { opacity: 0; transition: opacity .18s ease; }
.overlay.is-open { opacity: 1; }
.drawer { transform: translateX(100%); transition: transform .22s ease; }
.drawer.is-open { transform: none; }

.log { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; font-family: var(--mono); font-size: 10px; line-height: 1.7; color: var(--ink-2); }
.log li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0eb; }
.log li:last-child { border-bottom: 0; }
.log time { color: #a4a8a2; white-space: nowrap; }
.log em { font-style: normal; color: var(--accent); }
.log .log-empty { color: var(--muted); font-family: var(--sans); font-size: 11.5px; }

.result-card { margin-top: 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 26px; box-shadow: 0 1px 2px rgba(20,24,20,.04); }
.result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.result-head h2 { margin: 2px 0 0; font-family: var(--serif); font-size: 24px; font-weight: 600; }
.result-stats { display: flex; gap: 24px; }
.result-stats span { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.result-stats b { display: block; font-family: var(--mono); font-size: 20px; margin-top: 2px; }
.result-links { display: flex; gap: 18px; margin-top: 18px; font-size: 13px; font-weight: 600; }
.result-links a { color: var(--accent); text-decoration: none; }
.result-links a:hover { text-decoration: underline; }
.preview { max-height: 440px; margin: 18px 0 0; padding: 18px 20px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); color: var(--ink-2); font-family: var(--sans); font-size: 13.5px; line-height: 1.9; }

.form-error, .alert { margin: 12px 0 0; padding: 10px 12px; border: 1px solid #f0c9bd; border-radius: 9px; background: var(--warm-soft); color: #8f341c; font-size: 12px; line-height: 1.6; }
.form-error { margin: 0 26px 18px; }

@media (max-width: 980px) {
  .layout { grid-template-columns: 1fr; }
  .drawer { width: 100%; }
  .page { padding: 28px 20px 44px; }
  .topbar-inner { padding: 0 20px; }
  .options { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .overlay, .drawer, .ring, .btn-primary { transition: none; animation: none; }
}
```

body 结构必须包含以下 id（顺序可按视觉稿调整）：

```html
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand"><div class="logo">N</div><div class="brand-name">NovelBuilder</div></div>
    <div class="top-actions">
      <button class="model-pill" id="model-pill" data-state="loading" type="button" aria-haspopup="dialog">
        <span class="dot" aria-hidden="true"></span>
        <span id="model-pill-text">读取设置…</span>
      </button>
      <button class="icon-btn" id="settings-button" type="button" aria-label="全局设置" aria-haspopup="dialog"><span aria-hidden="true" style="font-size:16px">⚙</span></button>
    </div>
  </div>
</header>

<main class="page">
  <section class="intro">
    <div>
      <div class="eyebrow">NEW STORY</div>
      <h1>从一个念头，<span>长出一部小说</span>。</h1>
      <p>故事圣经、分卷大纲、逐章写作与连续性维护，自动串成一条流水线。模型配置收进全局设置，这里只留给创作。</p>
    </div>
  </section>

  <div class="layout">
    <section class="composer">
      <form id="novel-form" novalidate>
        <div class="composer-top"><div class="composer-title"><span class="step-no">01</span>故事前提</div></div>
        <div class="composer-body">
          <label class="sr-only" for="premise">故事前提</label>
          <textarea id="premise" name="premise" required placeholder="例如：旧城即将沉没，一个修钟匠发现自己能听见地脉的回声。"></textarea>
          <div class="prompt-row"><span class="count" id="premise-count">0 字</span></div>
          <div class="options">
            <label class="opt" for="maxChapters"><span>章节数</span><input id="maxChapters" type="number" min="1" max="40" step="1" value="6" inputmode="numeric"><em>章</em></label>
            <label class="opt" for="chapterWords"><span>每章字数</span><input id="chapterWords" type="number" min="200" max="20000" step="100" value="800" inputmode="numeric"><em>字</em></label>
            <div class="opt"><span>全书预计</span><b id="total-words">4,800</b><em>字</em></div>
          </div>
        </div>
        <div class="composer-foot">
          <button class="save-hint" id="model-hint" type="button" data-state="loading"><span aria-hidden="true">✓</span><span id="model-hint-text">读取设置…</span></button>
          <div class="composer-actions">
            <button class="btn-ghost" id="abort-button" type="button" hidden>停止生成</button>
            <button class="btn-primary" id="submit-button" type="submit">开始生成 <span aria-hidden="true">→</span></button>
          </div>
        </div>
        <p class="form-error" id="form-error" role="alert" hidden></p>
      </form>
    </section>

    <aside>
      <section class="panel" id="progress-panel">
        <div class="panel-head"><h2>运行概览</h2><span class="status" id="status-badge" data-state="idle"><i></i><span id="status-text">待命</span></span></div>
        <div class="panel-body">
          <div class="big-stat"><div class="ring" id="progress-ring"><span id="ring-text">0/6</span></div><div><b id="phase-title">等待开始</b><span id="phase-sub">填写故事前提后开始生成</span></div></div>
          <ol class="steps" id="timeline">
            <li data-phase="setup"><span class="bullet">1</span><span class="txt"><b>故事圣经</b><span>Story bible</span></span></li>
            <li data-phase="outline"><span class="bullet">2</span><span class="txt"><b>章节大纲</b><span>Outline</span></span></li>
            <li data-phase="chapter"><span class="bullet">3</span><span class="txt"><b>逐章写作</b><span>Chapter</span></span></li>
            <li data-phase="review"><span class="bullet">4</span><span class="txt"><b>审校门禁</b><span>Review</span></span></li>
            <li data-phase="state"><span class="bullet">5</span><span class="txt"><b>状态同步</b><span>Continuity</span></span></li>
            <li data-phase="export"><span class="bullet">6</span><span class="txt"><b>导出成书</b><span>Export</span></span></li>
            <li data-phase="done"><span class="bullet">7</span><span class="txt"><b>完成</b><span>Done</span></span></li>
          </ol>
          <div class="kv">
            <div><span>实时字数</span><b id="live-words">0</b></div>
            <div><span>已用时</span><b id="elapsed">00:00</b></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>事件流</h2><span id="log-count" style="font-family:var(--mono);font-size:10px;color:var(--muted)">0 条</span></div>
        <div class="panel-body"><ol class="log" id="event-log" aria-live="polite"><li class="log-empty" id="event-empty">等待开始。填写故事前提后点击“开始生成”。</li></ol></div>
      </section>

      <p class="alert" id="run-error" role="alert" hidden></p>
    </aside>
  </div>

  <section class="result-card" id="result-panel" hidden aria-labelledby="result-title">
    <div class="result-head">
      <div><div class="eyebrow">手稿已完成</div><h2 id="result-title">未命名手稿</h2></div>
      <div class="result-stats">
        <div><span>章节</span><b id="result-chapters">—</b></div>
        <div><span>字数</span><b id="result-words">—</b></div>
      </div>
    </div>
    <div class="result-links"><a id="manuscript-link" href="#" target="_blank" rel="noopener">打开 book.md</a><a id="project-link" href="#" target="_blank" rel="noopener">查看项目档案</a></div>
    <pre class="preview" id="result-preview" aria-label="手稿预览"></pre>
  </section>

  <footer><span>NovelBuilder · 本地优先的创作工具</span><span>输出目录 agent-runtime/output</span></footer>
</main>
```

设置抽屉必须包含：

```html
<div class="overlay" id="settings-overlay" hidden></div>
<aside class="drawer" id="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden>
  <div class="drawer-head">
    <div><div class="drawer-kicker">GLOBAL SETTINGS</div><h2 id="settings-title">全局设置</h2><p>模型配置只在这里维护，填写后自动保存，之后每次创作都会复用。</p></div>
    <button class="close-btn" id="settings-close" type="button" aria-label="关闭设置">×</button>
  </div>

  <div class="drawer-body">
    <div class="current" id="settings-current" data-state="warn">
      <span class="pulse"></span>
      <div><b id="settings-current-title">尚未配置模型</b><span id="settings-current-sub">填写下方信息后开始创作</span></div>
      <span class="tag" id="settings-current-tag">需要配置</span>
    </div>

    <div class="section-label">模型配置 <span>修改后自动保存</span></div>

    <fieldset class="field">
      <legend class="field-label">API 协议</legend>
      <div class="segmented" role="radiogroup" aria-label="API 协议">
        <label><input class="sr-only" id="protocol-openai" name="protocol" type="radio" value="openai" checked><span>OpenAI 兼容</span></label>
        <label><input class="sr-only" id="protocol-anthropic" name="protocol" type="radio" value="anthropic"><span>Anthropic</span></label>
      </div>
    </fieldset>

    <div class="field"><label for="settings-model">模型名称</label><input id="settings-model" class="mono" autocomplete="off" placeholder="例如：deepseek-chat"><span class="hint">例如 deepseek-chat、qwen-plus、claude-sonnet-4-5。</span></div>
    <div class="field"><label for="settings-baseUrl">Base URL</label><input id="settings-baseUrl" class="mono" autocomplete="url" placeholder="https://api.example.com/v1"><span class="hint">需要包含 http:// 或 https://。</span></div>

    <div class="field">
      <label for="settings-apiKey">API Key</label>
      <div class="key-row">
        <input id="settings-apiKey" class="mono" type="password" autocomplete="off" placeholder="sk-…">
        <button class="link-btn" id="settings-clear-key" type="button" hidden>清除</button>
      </div>
      <span class="key-state" id="settings-key-state" hidden><span aria-hidden="true">✓</span>已保存在本机，页面不会回显明文</span>
    </div>

    <div class="divider"></div>
    <div class="auto-note"><span aria-hidden="true">+</span><div><b>设置随改随存。</b> 配置写入本机 <code>agent-runtime/.agent/settings.json</code>，不会上传，也不会写进作品文件。</div></div>
  </div>

  <div class="drawer-foot">
    <button class="save-state" id="settings-save-state" type="button" data-state="idle" aria-live="polite"><span aria-hidden="true">✓</span><span id="settings-save-text">等待填写</span><span class="sub" id="settings-save-time"></span></button>
    <div class="foot-actions"><button class="btn-ghost" id="settings-clear" type="button">清除配置</button><button class="btn-dark" id="settings-done" type="button">完成</button></div>
  </div>
</aside>
```

注意：

- 抽屉默认 `hidden`，由脚本打开。
- `fieldset` / `legend` 需要重置默认边框与 padding。
- `.segmented label` 内放真实 radio，隐藏 input，选中态用 `input:checked + span`。
- 不再出现任何 `mode` radio、`model-fields`、`localStorage` 设置代码。
- 这些代码最终位于 `ui.ts` 的模板字符串中：浏览器脚本里的 `\s` 要写成 `\\s`，`\n` 要写成 `\\n`；模板字符串内不要出现未转义的反引号。
- 图标统一用 `⚙`、`×`、`✓`、`→`、`+` 文本符号，不引入图标库或外部图片。

- [ ] **Step 4: 运行页面断言**

Run:

```powershell
npx vitest run test/server.test.ts -t "serves the NovelBuilder page"
```

Expected: PASS。

---

## Task 6: 设置抽屉、自动保存与模型状态

**Files:**
- Modify: `agent-runtime/src/ui.ts`
- Test: `agent-runtime/test/server.test.ts`（页面字符串断言）

- [ ] **Step 1: 用以下脚本替换 `<script>` 内容的前半部分**

在 `HOME_PAGE` 的 `<script>` 内保留 IIFE 结构，按下面实现设置相关逻辑；变量名与上面的 DOM id 严格一致。

> 粘贴到 `ui.ts` 的模板字符串时：正则里的 `\s` 写成 `\\s`，字符串里的 `\n` 写成 `\\n`，不要出现未转义的反引号。

```js
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var form = $("novel-form");
  var premiseInput = $("premise");
  var premiseCount = $("premise-count");
  var maxChaptersInput = $("maxChapters");
  var chapterWordsInput = $("chapterWords");
  var totalWords = $("total-words");
  var submitButton = $("submit-button");
  var abortButton = $("abort-button");
  var formError = $("form-error");
  var runError = $("run-error");
  var modelPill = $("model-pill");
  var modelPillText = $("model-pill-text");
  var modelHint = $("model-hint");
  var modelHintText = $("model-hint-text");
  var settingsButton = $("settings-button");
  var settingsOverlay = $("settings-overlay");
  var settingsDrawer = $("settings-drawer");
  var settingsClose = $("settings-close");
  var settingsDone = $("settings-done");
  var settingsClear = $("settings-clear");
  var settingsCurrent = $("settings-current");
  var settingsCurrentTitle = $("settings-current-title");
  var settingsCurrentSub = $("settings-current-sub");
  var settingsCurrentTag = $("settings-current-tag");
  var settingsModel = $("settings-model");
  var settingsBaseUrl = $("settings-baseUrl");
  var settingsApiKey = $("settings-apiKey");
  var settingsKeyState = $("settings-key-state");
  var settingsClearKey = $("settings-clear-key");
  var settingsSaveState = $("settings-save-state");
  var settingsSaveText = $("settings-save-text");
  var settingsSaveTime = $("settings-save-time");
  var protocolOpenai = $("protocol-openai");
  var protocolAnthropic = $("protocol-anthropic");

  var statusBadge = $("status-badge");
  var statusText = $("status-text");
  var progressRing = $("progress-ring");
  var ringText = $("ring-text");
  var phaseTitle = $("phase-title");
  var phaseSub = $("phase-sub");
  var timeline = $("timeline");
  var timelineItems = Array.prototype.slice.call(timeline.querySelectorAll("li"));
  var liveWords = $("live-words");
  var elapsed = $("elapsed");
  var logCount = $("log-count");
  var eventLog = $("event-log");
  var resultPanel = $("result-panel");
  var resultTitle = $("result-title");
  var resultChapters = $("result-chapters");
  var resultWords = $("result-words");
  var manuscriptLink = $("manuscript-link");
  var projectLink = $("project-link");
  var resultPreview = $("result-preview");

  var PHASE_ORDER = ["setup", "outline", "chapter", "review", "state", "export", "done"];
  var STATUS = { idle: "待命", running: "生成中", completed: "已完成", failed: "失败" };
  var PROTOCOL_LABEL = { openai: "OpenAI 兼容", anthropic: "Anthropic" };
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var settings = {
    protocol: null, model: "", baseUrl: "", hasApiKey: false,
    complete: false, usable: false, updatedAt: null,
    envConfigured: false, envModel: ""
  };
  var settingsLoaded = false;
  var settingsOpen = false;
  var settingsLoadFailed = false;
  var autoOpened = false;
  var saveTimer = null;
  var saveRevision = 0;
  var saveChain = Promise.resolve();
  var clearArmed = false;
  var clearing = false;
  var lastTrigger = null;
  var closeTimer = null;

  var source = null;
  var runId = null;
  var projectId = null;
  var finished = true;
  var reached = -1;
  var maxChapters = 6;
  var seenEvents = Object.create(null);
  var wordByChapter = {};
  var runStartedAt = 0;
  var elapsedTimer = null;

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (ignore) {}
        if (!response.ok) {
          var error = new Error(data && data.error ? data.error : "请求失败（" + response.status + "）");
          error.code = data && data.code;
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearFormError() {
    formError.textContent = "";
    formError.hidden = true;
  }

  function showRunError(message) {
    runError.textContent = message;
    runError.hidden = false;
  }

  function setStatus(state) {
    statusBadge.setAttribute("data-state", state);
    statusText.textContent = STATUS[state] || state;
  }

  function readProtocol() {
    if (protocolAnthropic.checked) return "anthropic";
    if (protocolOpenai.checked) return "openai";
    return null;
  }

  function writeProtocol(value) {
    protocolOpenai.checked = value !== "anthropic";
    protocolAnthropic.checked = value === "anthropic";
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (ignore) { return url || "未填写 Base URL"; }
  }

  function hasDraft() {
    return Boolean(settings.protocol || settings.model || settings.baseUrl);
  }

  function renderModelPill() {
    if (!settingsLoaded && !settingsLoadFailed) {
      modelPill.setAttribute("data-state", "loading");
      modelPillText.textContent = "读取设置…";
      modelHint.setAttribute("data-state", "loading");
      modelHintText.textContent = "读取设置…";
      return;
    }
    if (settingsLoadFailed) {
      modelPill.setAttribute("data-state", "warn");
      modelPillText.textContent = "设置不可用";
      modelHint.setAttribute("data-state", "warn");
      modelHintText.textContent = "设置读取失败，点击重试";
      return;
    }
    if (settings.complete) {
      modelPill.setAttribute("data-state", "ok");
      modelPillText.textContent = settings.model;
      modelHint.setAttribute("data-state", "ok");
      modelHintText.textContent = settings.model + " · 配置已自动保存";
      return;
    }
    if (settings.envConfigured) {
      modelPill.setAttribute("data-state", "ok");
      modelPillText.textContent = settings.envModel + " · env";
      modelHint.setAttribute("data-state", "ok");
      modelHintText.textContent = settings.envModel + " · 来自服务器 .env";
      return;
    }
    modelPill.setAttribute("data-state", "warn");
    modelPillText.textContent = "未配置模型";
    modelHint.setAttribute("data-state", "warn");
    modelHintText.textContent = hasDraft() ? "配置不完整，点击继续设置" : "尚未配置模型，点击设置";
  }

  function renderSettingsCurrent() {
    if (settings.complete) {
      settingsCurrent.setAttribute("data-state", "ok");
      settingsCurrentTitle.textContent = settings.model;
      settingsCurrentSub.textContent = PROTOCOL_LABEL[settings.protocol] + " · " + hostOf(settings.baseUrl);
      settingsCurrentTag.textContent = "已连接";
      return;
    }
    if (hasDraft() && settings.envConfigured) {
      settingsCurrent.setAttribute("data-state", "warn");
      settingsCurrentTitle.textContent = "配置不完整";
      settingsCurrentSub.textContent = "当前仍使用服务器 .env（" + settings.envModel + "）";
      settingsCurrentTag.textContent = "使用 .env";
      return;
    }
    if (hasDraft()) {
      settingsCurrent.setAttribute("data-state", "warn");
      settingsCurrentTitle.textContent = "配置不完整";
      settingsCurrentSub.textContent = "填写协议、模型名称和 Base URL 后生效";
      settingsCurrentTag.textContent = "需要配置";
      return;
    }
    if (settings.envConfigured) {
      settingsCurrent.setAttribute("data-state", "ok");
      settingsCurrentTitle.textContent = settings.envModel;
      settingsCurrentSub.textContent = "来自服务器 .env";
      settingsCurrentTag.textContent = "已连接";
      return;
    }
    settingsCurrent.setAttribute("data-state", "warn");
    settingsCurrentTitle.textContent = "尚未配置模型";
    settingsCurrentSub.textContent = "填写下方信息后开始创作";
    settingsCurrentTag.textContent = "需要配置";
  }

  function renderKeyState() {
    if (settings.hasApiKey) {
      settingsApiKey.placeholder = "••••••••（已保存）";
      settingsKeyState.hidden = false;
      settingsClearKey.hidden = false;
    } else {
      settingsApiKey.placeholder = "sk-…";
      settingsKeyState.hidden = true;
      settingsClearKey.hidden = true;
    }
  }

  function setSaveState(state, message) {
    settingsSaveState.setAttribute("data-state", state);
    settingsSaveText.textContent = message;
    if (state !== "saved") settingsSaveTime.textContent = "";
  }

  function reflectSaveState() {
    if (settings.complete) {
      setSaveState("saved", "已保存");
      settingsSaveTime.textContent = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit", minute: "2-digit", hour12: false
      });
    } else if (hasDraft()) {
      setSaveState("warn", "配置不完整");
    } else {
      setSaveState("idle", "等待填写");
    }
  }

  function renderSettings(payload, fillInputs) {
    settings = {
      protocol: payload.protocol || null,
      model: payload.model || "",
      baseUrl: payload.baseUrl || "",
      hasApiKey: Boolean(payload.hasApiKey),
      complete: Boolean(payload.complete),
      usable: Boolean(payload.usable),
      updatedAt: payload.updatedAt || null,
      envConfigured: Boolean(payload.envConfigured),
      envModel: payload.envModel || ""
    };
    settingsLoaded = true;
    settingsLoadFailed = false;

    if (fillInputs) {
      writeProtocol(settings.protocol);
      settingsModel.value = settings.model;
      settingsBaseUrl.value = settings.baseUrl;
      settingsApiKey.value = "";
    }

    renderModelPill();
    renderSettingsCurrent();
    renderKeyState();

    if (settings.updatedAt) {
      var date = new Date(settings.updatedAt);
      settingsSaveTime.textContent = isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }

  function loadSettings() {
    return api("/api/settings").then(function (payload) {
      renderSettings(payload, true);
      reflectSaveState();
      if (!settings.usable && !autoOpened) {
        autoOpened = true;
        openSettings(false);
      }
    }).catch(function () {
      settingsLoaded = false;
      settingsLoadFailed = true;
      renderModelPill();
      setSaveState("error", "设置读取失败，点击重试");
    });
  }

  function collectPatch() {
    var patch = {};
    var protocol = readProtocol();
    var model = settingsModel.value.trim();
    var baseUrl = settingsBaseUrl.value.trim();
    var key = settingsApiKey.value.trim();

    if (protocol !== settings.protocol) patch.protocol = protocol;
    if (model !== settings.model) patch.model = model;
    if (baseUrl !== settings.baseUrl) patch.baseUrl = baseUrl;
    if (key) patch.apiKey = key;
    return patch;
  }

  function hasPatch(patch) {
    return Object.keys(patch).length > 0;
  }

  function putSettings(patch) {
    return api("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    }).then(function (payload) {
      var sentKey = patch.apiKey;
      renderSettings(payload, false);
      if (sentKey && settingsApiKey.value.trim() === sentKey) settingsApiKey.value = "";
      return payload;
    });
  }

  function flushSave() {
    if (clearing) return Promise.resolve();
    var patch = collectPatch();
    if (!hasPatch(patch)) {
      reflectSaveState();
      return Promise.resolve();
    }

    var revision = ++saveRevision;
    setSaveState("saving", "保存中…");

    saveChain = saveChain.then(function () {
      return putSettings(patch).then(function () {
        if (revision === saveRevision) {
          settingsSaveState.title = "";
          reflectSaveState();
        }
        var pending = collectPatch();
        if (!clearing && hasPatch(pending)) scheduleSave(false);
      }).catch(function (error) {
        setSaveState("error", "保存失败，重试");
        settingsSaveState.title = error.message;
      });
    });

    return saveChain;
  }

  function scheduleSave(immediate) {
    if (clearing) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      flushSave();
    }, immediate ? 0 : 700);
  }

  function trapFocus(event) {
    if (!settingsOpen || event.key !== "Tab") return;
    var nodes = settingsDrawer.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    );
    var list = Array.prototype.filter.call(nodes, function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
    if (list.length === 0) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openSettings(triggeredByUser) {
    if (settingsOpen) return;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    lastTrigger = document.activeElement;
    settingsOpen = true;
    settingsOverlay.hidden = false;
    settingsDrawer.hidden = false;
    document.body.classList.add("drawer-open");
    if (reducedMotion.matches) {
      settingsOverlay.classList.add("is-open");
      settingsDrawer.classList.add("is-open");
    } else {
      requestAnimationFrame(function () {
        settingsOverlay.classList.add("is-open");
        settingsDrawer.classList.add("is-open");
      });
    }
    var focusTarget = settingsModel;
    if (settingsLoadFailed) focusTarget = settingsClose;
    focusTarget.focus();
    if (settingsLoadFailed || !settingsLoaded) {
      setSaveState("saving", "读取中…");
      loadSettings();
    }
  }

  function closeSettings() {
    if (!settingsOpen) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      flushSave();
    }
    settingsOpen = false;
    settingsOverlay.classList.remove("is-open");
    settingsDrawer.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    var delay = reducedMotion.matches ? 0 : 200;
    closeTimer = setTimeout(function () {
      closeTimer = null;
      settingsOverlay.hidden = true;
      settingsDrawer.hidden = true;
    }, delay);
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    clearArmed = false;
    settingsClear.textContent = "清除配置";
  }

  function clearApiKey() {
    setSaveState("saving", "保存中…");
    putSettings({ clearApiKey: true }).then(function () {
      settingsApiKey.value = "";
      reflectSaveState();
    }).catch(function (error) {
      setSaveState("error", "保存失败，重试");
      settingsSaveState.title = error.message;
    });
  }

  function clearAllSettings() {
    if (!clearArmed) {
      clearArmed = true;
      settingsClear.textContent = "确认清除？";
      return;
    }
    clearArmed = false;
    settingsClear.textContent = "清除配置";
    clearing = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveChain = saveChain.then(function () {
      return api("/api/settings", { method: "DELETE" });
    }).then(function (payload) {
      clearing = false;
      renderSettings(payload, true);
      reflectSaveState();
    }).catch(function (error) {
      clearing = false;
      setSaveState("error", "清除失败，重试");
      settingsSaveState.title = error.message;
    });
  }

  settingsButton.addEventListener("click", function () { openSettings(true); });
  modelPill.addEventListener("click", function () { openSettings(true); });
  modelHint.addEventListener("click", function () { openSettings(true); });
  settingsClose.addEventListener("click", closeSettings);
  settingsDone.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", closeSettings);
  settingsClear.addEventListener("click", clearAllSettings);
  settingsClearKey.addEventListener("click", clearApiKey);
  settingsSaveState.addEventListener("click", function () {
    if (settingsLoadFailed) {
      setSaveState("saving", "读取中…");
      loadSettings();
      return;
    }
    if (settingsSaveState.getAttribute("data-state") === "error") flushSave();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && settingsOpen) {
      event.preventDefault();
      closeSettings();
      return;
    }
    trapFocus(event);
  });

  settingsModel.addEventListener("input", function () { scheduleSave(false); });
  settingsBaseUrl.addEventListener("input", function () { scheduleSave(false); });
  settingsApiKey.addEventListener("input", function () { scheduleSave(false); });
  settingsModel.addEventListener("change", function () { scheduleSave(true); });
  settingsBaseUrl.addEventListener("change", function () { scheduleSave(true); });
  settingsApiKey.addEventListener("change", function () { scheduleSave(true); });
  protocolOpenai.addEventListener("change", function () { scheduleSave(true); });
  protocolAnthropic.addEventListener("change", function () { scheduleSave(true); });

  renderModelPill();
  loadSettings();
```

- [ ] **Step 2: 验证设置交互的静态断言**

Run:

```powershell
npx vitest run test/server.test.ts -t "serves the NovelBuilder page"
npm run typecheck
```

Expected: PASS。浏览器手工检查：

1. 打开页面，无配置时抽屉自动弹出。
2. 输入协议、模型、Base URL，底栏出现「保存中… → 已保存」。
3. 刷新页面，字段回填，Key 显示「已保存」。
4. 点「清除配置」两次，字段清空。

---

## Task 7: 生成、进度与结果

**Files:**
- Modify: `agent-runtime/src/ui.ts`

- [ ] **Step 1: 在同一个 `<script>` 中追加运行逻辑**

> 同样注意模板字符串转义：`/^#\s+(.+)$/m` 写成 `/^#\\s+(.+)$/m`，`"\n\n…"` 写成 `"\\n\\n…"`。

```js
  function updateTotal() {
    var chapters = parseInt(maxChaptersInput.value, 10);
    var words = parseInt(chapterWordsInput.value, 10);
    if (!Number.isFinite(chapters) || chapters <= 0) chapters = 6;
    if (!Number.isFinite(words) || words <= 0) words = 800;
    totalWords.textContent = (chapters * words).toLocaleString("zh-CN");
  }

  function updatePremiseCount() {
    premiseCount.textContent = premiseInput.value.trim().length + " 字";
  }

  function clampNumber(input, fallback, min, max) {
    var parsed = parseInt(input.value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.min(max, Math.max(min, parsed));
    input.value = String(parsed);
    return parsed;
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function updateElapsed() {
    if (!runStartedAt) return;
    var seconds = Math.floor((Date.now() - runStartedAt) / 1000);
    elapsed.textContent = pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
  }

  function startElapsed() {
    stopElapsed();
    runStartedAt = Date.now();
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 1000);
  }

  function stopElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function setRing(current, total) {
    var ratio = total > 0 ? Math.min(1, current / total) : 0;
    progressRing.style.setProperty("--p", String(Math.round(ratio * 100)));
    ringText.textContent = current + "/" + total;
  }

  function addEmptyLog() {
    while (eventLog.firstChild) eventLog.removeChild(eventLog.firstChild);
    var empty = document.createElement("li");
    empty.className = "log-empty";
    empty.id = "event-empty";
    empty.textContent = "等待开始。填写故事前提后点击“开始生成”。";
    eventLog.appendChild(empty);
  }

  function updateLogCount() {
    logCount.textContent = eventLog.querySelectorAll(".event-item").length + " 条";
  }

  function addEvent(message, phase) {
    var empty = eventLog.querySelector(".log-empty");
    if (empty) empty.parentNode.removeChild(empty);

    var item = document.createElement("li");
    item.className = "event-item";
    var safePhase = String(phase || "info").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "info";

    var time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    var tag = document.createElement("em");
    tag.textContent = String(phase || "info").toUpperCase();

    var text = document.createElement("span");
    text.textContent = String(message || "");

    item.appendChild(time);
    item.appendChild(tag);
    item.appendChild(text);
    eventLog.appendChild(item);

    while (eventLog.querySelectorAll(".event-item").length > 200) {
      var first = eventLog.querySelector(".event-item");
      if (!first) break;
      first.parentNode.removeChild(first);
    }
    updateLogCount();
    eventLog.scrollTop = eventLog.scrollHeight;
  }

  function resetProgress() {
    reached = -1;
    wordByChapter = {};
    timelineItems.forEach(function (item) {
      item.classList.remove("done", "active", "error");
    });
    setRing(0, maxChapters);
    liveWords.textContent = "0";
    elapsed.textContent = "00:00";
    phaseTitle.textContent = "等待开始";
    phaseSub.textContent = "填写故事前提后开始生成";
    addEmptyLog();
    updateLogCount();
    runError.hidden = true;
    runError.textContent = "";
  }

  function markPhase(phase) {
    if (phase === "error") {
      if (reached >= 0 && timelineItems[reached]) timelineItems[reached].classList.add("error");
      return;
    }
    var index = PHASE_ORDER.indexOf(phase);
    if (index < 0) return;
    if (index > reached) reached = index;
    timelineItems.forEach(function (item, itemIndex) {
      item.classList.remove("error");
      item.classList.toggle("done", itemIndex < reached || (itemIndex === reached && finished));
      item.classList.toggle("active", itemIndex === reached && !finished);
    });
  }

  function completeTimeline() {
    timelineItems.forEach(function (item) {
      item.classList.add("done");
      item.classList.remove("active", "error");
    });
  }

  function updateChapterStats(chapterNumber) {
    var total = 0;
    Object.keys(wordByChapter).forEach(function (key) { total += wordByChapter[key]; });
    liveWords.textContent = total.toLocaleString("zh-CN");
    if (typeof chapterNumber === "number") {
      phaseTitle.textContent = "第 " + chapterNumber + " 章正在写作";
      phaseSub.textContent = "已完成 " + total.toLocaleString("zh-CN") + " 字";
      setRing(chapterNumber - 1, maxChapters);
    }
  }

  function setRunningUi(isRunning) {
    submitButton.disabled = isRunning;
    if (isRunning) submitButton.setAttribute("aria-busy", "true");
    else submitButton.removeAttribute("aria-busy");
    abortButton.hidden = !isRunning;
    abortButton.disabled = false;
  }

  function failRun(message) {
    if (finished) return;
    finished = true;
    setStatus("failed");
    phaseTitle.textContent = "生成失败";
    phaseSub.textContent = String(message || "请检查模型配置后重试。");
    setRunningUi(false);
    stopElapsed();
    closeSource();
    showRunError(String(message || "生成失败。"));
  }

  function finishRun() {
    if (finished) return;
    finished = true;
    setStatus("completed");
    phaseTitle.textContent = "手稿已完成";
    phaseSub.textContent = "全部章节与导出文件已写入项目目录";
    completeTimeline();
    setRing(maxChapters, maxChapters);
    setRunningUi(false);
    stopElapsed();
    closeSource();
    if (projectId) loadResult(projectId);
  }

  function closeSource() {
    if (source) { source.close(); source = null; }
  }

  function loadResult(id) {
    var projectUrl = "/api/projects/" + encodeURIComponent(id);
    Promise.all([
      fetch(projectUrl).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(projectUrl + "/manuscript").then(function (r) { return r.ok ? r.text() : ""; }),
      fetch(projectUrl + "/chapters").then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (responses) {
      var projectPayload = responses[0];
      var markdown = responses[1] || "";
      var chapters = Array.isArray(responses[2]) ? responses[2] : [];
      var project = projectPayload && projectPayload.project ? projectPayload.project : (projectPayload || {});
      var heading = /^#\s+(.+)$/m.exec(markdown);
      var title = heading && heading[1] ? heading[1].trim() : (project.premise || "未命名手稿");
      var words = chapters.reduce(function (sum, chapter) {
        return sum + (chapter && typeof chapter.wordCount === "number" ? chapter.wordCount : 0);
      }, 0);

      resultTitle.textContent = title;
      resultChapters.textContent = String(chapters.length || project.maxChapters || 0);
      resultWords.textContent = words > 0 ? words.toLocaleString("zh-CN") : "—";
      manuscriptLink.href = projectUrl + "/manuscript";
      projectLink.href = projectUrl;
      var preview = String(markdown || "").trim();
      resultPreview.textContent = preview.length > 2400 ? preview.slice(0, 2400) + "\n\n…" : preview;
      resultPanel.hidden = false;
      resultPanel.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    }).catch(function (error) {
      addEvent("结果加载失败：" + (error instanceof Error ? error.message : String(error)), "error");
    });
  }

  function handleEvent(event) {
    if (!event || typeof event.phase !== "string") return;
    var phase = event.phase;

    if (phase === "done") {
      addEvent(event.message || "手稿完成。", "done");
      markPhase("done");
      finishRun();
      return;
    }

    if (phase === "error") {
      var message = event.error || event.message || "生成失败。";
      addEvent(message, "error");
      markPhase("error");
      failRun(message);
      return;
    }

    if (typeof event.chapterNumber === "number") {
      if (typeof event.wordCount === "number") {
        wordByChapter[String(event.chapterNumber)] = event.wordCount;
      }
      updateChapterStats(event.chapterNumber);
    }

    markPhase(phase);
    addEvent(event.message || phase, phase);
  }

  function subscribe() {
    if (!runId) return;
    closeSource();
    source = new EventSource("/api/runs/" + encodeURIComponent(runId) + "/events");
    source.onmessage = function (messageEvent) {
      if (messageEvent.lastEventId) {
        if (seenEvents[messageEvent.lastEventId]) return;
        seenEvents[messageEvent.lastEventId] = true;
      }
      var payload;
      try { payload = JSON.parse(messageEvent.data); } catch (ignore) { return; }
      handleEvent(payload);
    };
    source.onerror = function () {
      if (!finished) addEvent("SSE 连接中断，浏览器将自动重连。", "network");
    };
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!finished) return;

    var premise = premiseInput.value.trim();
    if (!premise) {
      showFormError("请先填写故事前提。");
      premiseInput.focus();
      return;
    }

    maxChapters = clampNumber(maxChaptersInput, 6, 1, 40);
    var chapterWords = clampNumber(chapterWordsInput, 800, 200, 20000);
    updateTotal();

    if (!settings.usable) {
      showFormError("请先完成模型设置，或配置服务器 .env。");
      openSettings(true);
      return;
    }

    clearFormError();
    resultPanel.hidden = true;
    finished = false;
    projectId = null;
    runId = null;
    seenEvents = Object.create(null);
    resetProgress();
    setStatus("running");
    phaseTitle.textContent = "建立项目";
    phaseSub.textContent = "正在创建故事与运行记录";
    setRunningUi(true);
    startElapsed();
    addEvent("已提交创作请求，正在建立项目…", "submit");

    api("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        premise: premise,
        maxChapters: maxChapters,
        chapterWords: chapterWords
      })
    }).then(function (data) {
      if (!data || !data.projectId || !data.runId) {
        throw new Error("服务端响应缺少 projectId 或 runId。");
      }
      projectId = data.projectId;
      runId = data.runId;
      addEvent("项目 " + String(projectId).slice(0, 8) + " · 运行 " + String(runId).slice(0, 8), "queued");
      subscribe();
    }).catch(function (error) {
      if (error && error.code === "model_not_configured") {
        showFormError("请先完成模型设置，或配置服务器 .env。");
        openSettings(true);
      }
      failRun(error instanceof Error ? error.message : String(error));
    });
  });

  abortButton.addEventListener("click", function () {
    if (finished || !runId) return;
    abortButton.disabled = true;
    addEvent("正在请求停止…", "abort");
    fetch("/api/runs/" + encodeURIComponent(runId) + "/abort", { method: "POST" })
      .then(function (response) {
        if (!response.ok) throw new Error("停止请求失败（" + response.status + "）");
      })
      .catch(function (error) {
        abortButton.disabled = false;
        addEvent(error instanceof Error ? error.message : String(error), "error");
      });
  });

  premiseInput.addEventListener("input", updatePremiseCount);
  maxChaptersInput.addEventListener("input", updateTotal);
  chapterWordsInput.addEventListener("input", updateTotal);
  maxChaptersInput.addEventListener("change", function () { maxChapters = clampNumber(maxChaptersInput, 6, 1, 40); updateTotal(); });
  chapterWordsInput.addEventListener("change", function () { clampNumber(chapterWordsInput, 800, 200, 20000); updateTotal(); });

  updatePremiseCount();
  updateTotal();
  setRing(0, 6);
  setStatus("idle");
})();
```

- [ ] **Step 2: 检查脚本没有旧引用**

Run:

```powershell
Select-String -Path src\ui.ts -Pattern "mode-demo|mode-real|modelSettings|readMode|localStorage|model-fields|apiKey-help"
```

Expected: 无输出。

- [ ] **Step 3: 运行类型检查与页面测试**

Run:

```powershell
npm run typecheck
npx vitest run test/server.test.ts
```

Expected: PASS。

---

## Task 8: 文档、全量验证与手工验收

**Files:**
- Modify: `README.md`
- Modify: `agent-runtime/PHASE0_ACCEPTANCE.md`（仅当前配置名）
- Modify: `agent-runtime/PI_SDK_NOTES.md`（仅当前配置名）

- [ ] **Step 1: 更新 README 的配置章节**

先把 README 一级标题改为 `# NovelBuilder`，并把简介中的「重构版」描述保留为当前项目说明。把「当前状态」里 Phase 4A 的描述改为「全局模型设置、自动保存、Web 端仅真实模型」。

把 README 中「页面内模型设置」整节替换为：

```markdown
#### 全局模型设置

页面右上角的齿轮打开全局设置。模型配置只需填写一次：

- **API 协议**：OpenAI 兼容（`openai-completions`）或 Anthropic（`anthropic-messages`）
- **模型名称**
- **Base URL**
- **API Key**（需要鉴权的端点必填）

修改后自动保存到 `agent-runtime/.agent/settings.json`，刷新页面、重启服务后继续复用。API Key 只保存在本机，接口不会回显明文，也不会写入作品文件或日志。

Web 页面不再提供演示模式，提交时只走真实模型。服务端与 CLI 仍保留 `--fake`，供测试和调试使用。

配置解析顺序：请求体 `modelConfig`（兼容）→ 全局设置 → `.env` 默认配置。三者都没有时，页面会提示先完成模型设置。
```

同时把 README 开头的「演示模式默认」、快速开始中的「默认选中演示模式」等描述改成「首次打开需完成全局模型设置」。

- [ ] **Step 2: 更新数据与磁盘章节**

把设置文件加入说明：

```text
- 全局模型设置：agent-runtime\.agent\settings.json
```

并注明旧 `NOVELFORGE_*` 已改名为 `NOVELBUILDER_*`。

- [ ] **Step 3: 全量验证**

Run:

```powershell
cd F:\project\novel-generator\agent-runtime
npm run typecheck
npm test
```

Expected: 所有测试文件通过；typecheck 无输出。

- [ ] **Step 4: 检查旧名称与旧模式残留**

Run:

```powershell
Get-ChildItem "F:\project\novel-generator" -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\(node_modules|\.cache|output|demo|\.superpowers)\\' } |
  Select-String -Pattern 'mode-demo|mode-real|modelSettings|演示模式|NovelForge|NOVELFORGE'
```

Expected: 只剩 `docs/plans` 中旧外部项目路径，以及 README 里对旧项目迁移历史的引用（如果保留）。

- [ ] **Step 5: 启动服务并手工验收**

Run:

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ }
npm run serve
```

打开 `http://127.0.0.1:8787`，逐项确认：

1. 首次无配置时设置抽屉自动打开。
2. 填写 OpenAI 兼容示例并保存，底栏显示「已保存」。
3. 刷新后配置回填，Key 不回显。
4. 点击开始生成，真实模型请求成功或返回可读的模型错误。
5. 停止生成可用。
6. 完成后结果卡出现，两个链接可打开。
7. 390px 宽度无横向滚动，抽屉占满宽度。
8. 键盘 Tab 在抽屉内循环，Esc 关闭。

- [ ] **Step 6: 最终检查**

Run:

```powershell
npm run typecheck
npm test
```

Expected: 全部通过。

---

## 验收对照

| Spec 要求 | 实现任务 |
| --- | --- |
| 移除运行模式 | Task 5、Task 7 |
| 模型配置移入全局设置抽屉 | Task 5、Task 6 |
| 自动保存并复用 | Task 2、Task 3、Task 6 |
| API Key 不回显 | Task 2、Task 3、Task 6 |
| 方案 C 视觉 | Task 5 |
| 首次无配置引导 | Task 6 |
| 生成/进度/结果保持可用 | Task 7 |
| NovelBuilder 全量改名 | Task 1 |
| README 与配置示例 | Task 8 |
| 测试与类型检查 | Task 2–8 |
