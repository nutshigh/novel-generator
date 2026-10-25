import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "./temp.js";
import {
  startServer,
  type StartedServer,
} from "../src/server.js";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import type { ModelConfigInput } from "../src/ai/piGateway.js";
import type { Chapter, Project } from "../src/domain/schemas.js";

interface CreateProjectResponse {
  projectId: string;
  runId: string;
}

interface ProjectResponse {
  project: Project;
  artifacts: string[];
}

interface ErrorResponse {
  error: string;
}

interface SettingsResponse {
  protocol: "openai" | "anthropic" | null;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  complete: boolean;
  usable: boolean;
  updatedAt: string | null;
  envConfigured: boolean;
  envModel: string;
}

class BlockingGateway implements AiGateway {
  async generateText(req: GenerateRequest): Promise<string> {
    return await new Promise<string>((_resolve, reject) => {
      const abort = (): void => reject(new Error("blocking gateway aborted"));

      if (req.signal?.aborted) {
        abort();
        return;
      }

      req.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

describe("NovelBuilder HTTP server", () => {
  let root: string;
  let started: StartedServer;
  let baseUrl: string;

  beforeAll(async () => {
    root = createTempDir("novelbuilder-server-");
    started = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      fakeDefault: true,
      settingsPath: join(root, "settings.json"),
    });
    baseUrl = `http://127.0.0.1:${started.port}`;
  }, 30_000);

  afterAll(async () => {
    await started.close();
    removeTempDir(root);
  }, 30_000);

  async function createRun(
    body: Record<string, unknown> = {
      premise: "一个少年在旧城意外觉醒。",
      fake: true,
      maxChapters: 1,
      chapterWords: 300,
    },
  ): Promise<CreateProjectResponse> {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(202);
    return (await response.json()) as CreateProjectResponse;
  }

  async function waitForProjectOn(
    base: string,
    projectId: string,
    timeoutMs = 20_000,
  ): Promise<ProjectResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await fetch(`${base}/api/projects/${projectId}`);
      if (response.status === 200) {
        const payload = (await response.json()) as ProjectResponse;
        if (
          payload.project.status === "completed" ||
          payload.project.status === "failed" ||
          (payload.project.status === "draft" &&
            payload.artifacts.includes("outline.json"))
        ) {
          return payload;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Project ${projectId} did not finish within ${timeoutMs}ms.`);
  }

  async function waitForProject(
    projectId: string,
    timeoutMs = 20_000,
  ): Promise<ProjectResponse> {
    return waitForProjectOn(baseUrl, projectId, timeoutMs);
  }

  async function readSseUntil(
    base: string,
    runId: string,
    marker: string,
    timeoutMs = 10_000,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let buffer = "";

    try {
      const response = await fetch(
        `${base}/api/runs/${encodeURIComponent(runId)}/events`,
        {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      if (!response.body) throw new Error("SSE response has no body.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (!buffer.includes(marker)) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          if (done) break;
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    return buffer;
  }

  async function readSseUntilDone(
    runId: string,
    timeoutMs = 10_000,
  ): Promise<string> {
    return readSseUntil(baseUrl, runId, '"phase":"done"', timeoutMs);
  }

  it("serves health", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("serves the local cytoscape bundle", async () => {
    const response = await fetch(`${baseUrl}/vendor/cytoscape.min.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const body = await response.text();
    expect(body).toContain("cytoscape");
  });

  it("serves the NovelBuilder page without a demo mode", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();

    expect(html).toContain("NovelBuilder");

    const requiredIds = [
      "novel-form",
      "premise",
      "premise-count",
      "maxChapters",
      "chapterWords",
      "total-words",
      "model-pill",
      "model-pill-text",
      "model-hint",
      "model-hint-text",
      "settings-button",
      "settings-overlay",
      "settings-drawer",
      "settings-title",
      "settings-close",
      "settings-done",
      "settings-clear",
      "settings-current",
      "settings-current-title",
      "settings-current-sub",
      "settings-current-tag",
      "settings-model",
      "settings-baseUrl",
      "settings-apiKey",
      "settings-apiKey-hint",
      "settings-clear-key",
      "settings-key-state",
      "settings-save-state",
      "settings-save-text",
      "settings-save-time",
      "protocol-openai",
      "protocol-anthropic",
      "submit-button",
      "abort-button",
      "form-error",
      "status-badge",
      "status-text",
      "progress-ring",
      "ring-text",
      "phase-title",
      "phase-sub",
      "timeline",
      "live-words",
      "elapsed",
      "log-count",
      "event-log",
      "run-error",
      "result-panel",
      "result-eyebrow",
      "result-title",
      "result-chapters",
      "result-words",
      "manuscript-link",
      "result-library-link",
      "project-link",
      "result-preview",
      "create-view",
      "library-view",
      "graph-view",
      "view-tab-create",
      "view-tab-library",
      "view-tab-graph",
      "library-count",
      "library-refresh",
      "library-run",
      "library-status",
      "library-status-text",
      "library-run-title",
      "library-run-sub",
      "library-progress",
      "library-abort",
      "library-log",
      "library-log-empty",
      "library-error",
      "library-loading",
      "library-empty",
      "library-empty-create",
      "book-list",
      "continue-overlay",
      "continue-dialog",
      "continue-title",
      "continue-sub",
      "continue-close",
      "continue-copy",
      "continue-batch",
      "continue-chapters",
      "continue-batch-estimate",
      "continue-extension",
      "continue-count",
      "continue-estimate",
      "continue-error",
      "continue-cancel",
      "continue-confirm",
      "reader-overlay",
      "reader-drawer",
      "reader-close",
      "reader-title",
      "reader-meta",
      "reader-text",
      "reader-prev",
      "reader-next",
      "reader-position",
      "graph-refresh",
      "graph-search",
      "graph-book-list",
      "graph-error",
      "graph-page-sub",
      "graph-canvas",
      "graph-unavailable",
      "graph-status",
      "graph-node-count",
      "graph-edge-count",
      "graph-chapter-range",
      "graph-chapter-label",
      "graph-show-history",
      "graph-show-chapters",
      "graph-layout",
      "graph-fit",
      "graph-zoom-in",
      "graph-zoom-out",
      "graph-detail",
      "graph-detail-empty",
      "graph-detail-title",
      "graph-detail-meta",
      "graph-detail-body",
      "graph-kind-character",
      "graph-kind-event",
      "graph-kind-thread",
      "graph-kind-location",
      "graph-kind-item",
      "graph-kind-concept",
      "graph-kind-faction",
    ];

    for (const id of requiredIds) {
      expect(html).toContain(`id="${id}"`);
    }

    expect(html).toMatch(/id="settings-overlay"[^>]*hidden/);
    expect(html).toMatch(/id="settings-drawer"[^>]*hidden/);
    expect(html).toMatch(/id="result-panel"[^>]*hidden/);
    expect(html).toMatch(/id="abort-button"[^>]*hidden/);
    expect(html).toMatch(/id="form-error"[^>]*hidden/);
    expect(html).toMatch(/id="run-error"[^>]*hidden/);
    expect(html).toMatch(/id="library-view"[^>]*hidden/);
    expect(html).toMatch(/id="graph-view"[^>]*hidden/);
    expect(html).toMatch(/id="library-run"[^>]*hidden/);
    expect(html).toMatch(/id="library-error"[^>]*hidden/);
    expect(html).toMatch(/id="library-empty"[^>]*hidden/);
    expect(html).toMatch(/id="continue-overlay"[^>]*hidden/);
    expect(html).toMatch(/id="continue-dialog"[^>]*hidden/);
    expect(html).toMatch(/id="reader-overlay"[^>]*hidden/);
    expect(html).toMatch(/id="reader-drawer"[^>]*hidden/);
    expect(html).toMatch(/id="status-badge"[^>]*data-state="idle"/);
    expect(html).toMatch(/id="settings-current"[^>]*data-state="warn"/);
    expect(html).toMatch(/id="settings-save-state"[^>]*data-state="idle"/);
    expect(html).toContain("等待开始");
    expect(html).toMatch(/id="event-log"[^>]*>\s*<li class="log-empty"/);
    const timelineMatch = /<ol[^>]*id="timeline"[^>]*>([\s\S]*?)<\/ol>/.exec(html);
    expect(timelineMatch).not.toBeNull();
    expect(timelineMatch![1]).not.toMatch(/class="[^"]*(done|active|error)/);

    expect(html).toContain('lang="zh-CN"');
    expect(html).toMatch(/id="settings-drawer"[^>]*role="dialog"/);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="settings-title"');
    expect(html).toMatch(/id="premise"[^>]*required/);
    expect(html).toMatch(/id="model-pill"[^>]*data-state="loading"/);
    expect(html).toMatch(/id="model-hint"[^>]*data-state="loading"/);
    expect(html).toMatch(/id="settings-key-state"[^>]*hidden/);
    expect(html).toMatch(/id="settings-clear-key"[^>]*hidden/);
    expect(html).toMatch(/id="event-log"[^>]*aria-live="polite"/);

    const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);

    for (const match of html.matchAll(/(?:aria-labelledby|aria-describedby)="([^"]+)"/g)) {
      for (const target of (match[1] ?? "").split(/\s+/).filter(Boolean)) {
        expect(ids, `missing aria target ${target}`).toContain(target);
      }
    }

    expect(html).not.toContain("演示模式");
    expect(html).not.toContain("运行模式");
    expect(html).not.toContain('id="mode-demo"');
    expect(html).not.toContain('id="mode-real"');
    expect(html).not.toContain("modelSettings");
    expect(html).not.toContain("localStorage");

    expect(html).not.toContain("<link");
    const scriptSources = Array.from(
      html.matchAll(/<script[^>]+src="([^"]+)"/gi),
      (match) => match[1],
    );
    expect(scriptSources).toEqual(["/vendor/cytoscape.min.js"]);
    expect(html).not.toContain("url(http");
  });

  describe("settings API", () => {
    beforeEach(async () => {
      const response = await fetch(`${baseUrl}/api/settings`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
    });

    it("returns empty settings when nothing is saved", async () => {
      vi.stubEnv("NOVELBUILDER_PROVIDER", "");
      vi.stubEnv("NOVELBUILDER_MODEL", "");
      try {
        const response = await fetch(`${baseUrl}/api/settings`);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual({
          protocol: null,
          model: "",
          baseUrl: "",
          hasApiKey: false,
          complete: false,
          usable: false,
          updatedAt: null,
          envConfigured: false,
          envModel: "",
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("reports env configuration separately from saved settings", async () => {
      vi.stubEnv("NOVELBUILDER_PROVIDER", "novelbuilder");
      vi.stubEnv("NOVELBUILDER_MODEL", "  env-model  ");
      try {
        const response = await fetch(`${baseUrl}/api/settings`);
        const payload = await response.json();
        expect(payload).toMatchObject({
          protocol: null,
          complete: false,
          usable: true,
          envConfigured: true,
          envModel: "env-model",
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("returns null updatedAt for an empty patch on a missing file", async () => {
      const response = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as SettingsResponse;
      expect(payload.updatedAt).toBeNull();
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

      const fetched = await fetch(`${baseUrl}/api/settings`);
      const fetchedText = await fetched.text();
      expect(fetchedText).not.toContain(secret);
      expect(JSON.parse(fetchedText)).toMatchObject({
        hasApiKey: true,
        complete: true,
      });
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
      expect(((await update.json()) as SettingsResponse).hasApiKey).toBe(true);

      const cleared = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearApiKey: true }),
      });
      const clearedPayload = (await cleared.json()) as SettingsResponse;
      expect(clearedPayload.hasApiKey).toBe(false);
      expect(clearedPayload.model).toBe("m2");

      const both = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "new-key", clearApiKey: true }),
      });
      expect(((await both.json()) as SettingsResponse).hasApiKey).toBe(false);
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

      const longModel = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m".repeat(201) }),
      });
      expect(longModel.status).toBe(400);

      const longBaseUrl = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "h".repeat(2001) }),
      });
      expect(longBaseUrl.status).toBe(400);

      const longApiKey = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "k".repeat(10_001) }),
      });
      expect(longApiKey.status).toBe(400);

      const badClear = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearApiKey: "yes" }),
      });
      expect(badClear.status).toBe(400);
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

      const deleted = await fetch(`${baseUrl}/api/settings`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(200);
      const payload = await deleted.json();
      expect(payload).toMatchObject({
        protocol: null,
        model: "",
        baseUrl: "",
        hasApiKey: false,
        complete: false,
      });

      expect(existsSync(join(root, "settings.json"))).toBe(false);
      const after = await fetch(`${baseUrl}/api/settings`);
      expect(((await after.json()) as SettingsResponse).hasApiKey).toBe(false);
    });

    it("rejects unsupported settings methods", async () => {
      const wrongMethod = await fetch(`${baseUrl}/api/settings`, {
        method: "POST",
      });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET, PUT, DELETE");
    });

    it("rejects cross-origin settings mutations", async () => {
      const put = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://evil.example",
        },
        body: JSON.stringify({ model: "evil" }),
      });
      expect(put.status).toBe(403);

      const del = await fetch(`${baseUrl}/api/settings`, {
        method: "DELETE",
        headers: { origin: "http://evil.example" },
      });
      expect(del.status).toBe(403);
    });
  });

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
      expect(payload.project.status).toBe("draft");
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
      const payload = await response.json();
      expect(payload).toEqual({
        error: "未配置模型。请先在全局设置中填写模型配置。",
        code: "model_not_configured",
      });
      expect(await noneServer.store.listProjects()).toHaveLength(0);
      expect(existsSync(join(noneRoot, "output"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      await noneServer.close();
      removeTempDir(noneRoot);
    }
  }, 15_000);

  it("prefers request modelConfig over saved settings", async () => {
    const root = createTempDir("novelbuilder-body-priority-");
    const captured: Array<ModelConfigInput | undefined> = [];
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: join(root, "settings.json"),
      fakeDefault: false,
      gatewayFactory: (_project, modelConfig) => {
        captured.push(modelConfig);
        return new FakeAiGateway();
      },
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocol: "openai",
          model: "saved-model",
          baseUrl: "https://saved.example/v1",
          apiKey: "saved-key",
        }),
      });

      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "请求体配置优先。",
          maxChapters: 1,
          chapterWords: 300,
          modelConfig: {
            protocol: "anthropic",
            model: "body-model",
            baseUrl: "https://body.example",
            apiKey: "body-key",
          },
        }),
      });

      expect(response.status).toBe(202);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        protocol: "anthropic",
        model: "body-model",
        baseUrl: "https://body.example",
        apiKey: "body-key",
      });
    } finally {
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("does not read settings when request modelConfig is provided", async () => {
    const root = createTempDir("novelbuilder-body-no-read-");
    const settingsDir = join(root, "settings-as-dir");
    mkdirSync(settingsDir);
    const captured: Array<ModelConfigInput | undefined> = [];
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: settingsDir,
      fakeDefault: false,
      gatewayFactory: (_project, modelConfig) => {
        captured.push(modelConfig);
        return new FakeAiGateway();
      },
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "请求体配置存在时不应读取设置。",
          maxChapters: 1,
          chapterWords: 300,
          modelConfig: {
            protocol: "openai",
            model: "body-model",
            baseUrl: "https://body.example/v1",
            apiKey: "body-key",
          },
        }),
      });

      expect(response.status).toBe(202);
      expect(captured[0]).toEqual({
        protocol: "openai",
        model: "body-model",
        baseUrl: "https://body.example/v1",
        apiKey: "body-key",
      });
    } finally {
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("does not read settings for fake runs", async () => {
    const root = createTempDir("novelbuilder-fake-skip-");
    const settingsDir = join(root, "settings-as-dir");
    mkdirSync(settingsDir);
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: settingsDir,
      fakeDefault: false,
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "演示运行不应读取设置文件。",
          fake: true,
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(202);
      const created = (await response.json()) as CreateProjectResponse;
      const payload = await waitForProjectOn(base, created.projectId);
      expect(payload.project.status).toBe("draft");
    } finally {
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("does not borrow the env API key for saved settings", async () => {
    const root = createTempDir("novelbuilder-no-env-key-");
    const captured: Array<ModelConfigInput | undefined> = [];
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: join(root, "settings.json"),
      fakeDefault: false,
      gatewayFactory: (_project, modelConfig) => {
        captured.push(modelConfig);
        return new FakeAiGateway();
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    vi.stubEnv("NOVELBUILDER_API_KEY", "env-secret-key");

    try {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocol: "openai",
          model: "saved-model",
          baseUrl: "https://example.com/v1",
        }),
      });

      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "不借用环境变量里的 Key。",
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(202);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        protocol: "openai",
        model: "saved-model",
        baseUrl: "https://example.com/v1",
      });
      expect(captured[0]).not.toHaveProperty("apiKey");
    } finally {
      vi.unstubAllEnvs();
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("ignores incomplete saved settings when generating", async () => {
    const root = createTempDir("novelbuilder-incomplete-settings-");
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: join(root, "settings.json"),
      fakeDefault: false,
    });
    const base = `http://127.0.0.1:${server.port}`;

    vi.stubEnv("NOVELBUILDER_PROVIDER", "");
    vi.stubEnv("NOVELBUILDER_MODEL", "");

    try {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocol: "openai",
          model: "partial-model",
          baseUrl: "",
        }),
      });

      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "不完整设置不应被使用。",
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "未配置模型。请先在全局设置中填写模型配置。",
        code: "model_not_configured",
      });
      expect(await server.store.listProjects()).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("ignores saved settings with an invalid baseUrl", async () => {
    const root = createTempDir("novelbuilder-invalid-url-");
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: join(root, "settings.json"),
      fakeDefault: false,
    });
    const base = `http://127.0.0.1:${server.port}`;

    vi.stubEnv("NOVELBUILDER_PROVIDER", "");
    vi.stubEnv("NOVELBUILDER_MODEL", "");

    try {
      await fetch(`${base}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocol: "openai",
          model: "invalid-url-model",
          baseUrl: "not-a-url",
        }),
      });

      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "非法 Base URL 不应被使用。",
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(400);
      const payload = (await response.json()) as { code?: string };
      expect(payload.code).toBe("model_not_configured");
    } finally {
      vi.unstubAllEnvs();
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("fails closed when the settings file cannot be read", async () => {
    const root = createTempDir("novelbuilder-settings-read-error-");
    const settingsDir = join(root, "settings-as-dir");
    mkdirSync(settingsDir);
    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      settingsPath: settingsDir,
      fakeDefault: false,
    });
    const base = `http://127.0.0.1:${server.port}`;

    try {
      const response = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "设置文件不可读时失败关闭。",
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal error" });
    } finally {
      await server.close();
      removeTempDir(root);
    }
  }, 20_000);

  it("creates a fake project with an outline, then writes chapters on demand", async () => {
    const created = await createRun();

    const outlinePayload = await waitForProject(created.projectId);
    const run = started.runs.get(created.runId);
    expect(outlinePayload.project.status, run?.error).toBe("draft");
    expect(outlinePayload.artifacts).toContain("outline.json");
    expect(outlinePayload.artifacts).toContain("bible.json");
    expect(outlinePayload.artifacts).not.toContain("book.md");
    expect(outlinePayload.artifacts).not.toContain("chapters.json");

    const continueResponse = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 1 }),
      },
    );
    expect(continueResponse.status).toBe(202);
    const continued = (await continueResponse.json()) as {
      runId: string;
      fromChapter: number;
      toChapter: number;
    };
    expect(continued).toMatchObject({ fromChapter: 1, toChapter: 1 });
    await readSseUntilDone(continued.runId);

    const payload = await waitForProject(created.projectId);
    expect(payload.project.status).toBe("completed");
    expect(payload.artifacts).toContain("book.md");
    expect(payload.artifacts).toContain("chapters.json");

    const manuscript = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/manuscript`,
    );
    expect(manuscript.status).toBe(200);
    expect(manuscript.headers.get("content-type")).toContain("text/markdown");
    const markdown = await manuscript.text();
    expect(markdown).toContain("## 第1章");

    const chaptersResponse = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/chapters`,
    );
    expect(chaptersResponse.status).toBe(200);
    const chapters = (await chaptersResponse.json()) as Chapter[];
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.wordCount).toBeGreaterThan(0);
  }, 20_000);

  it("streams setup progress events over SSE", async () => {
    const created = await createRun({
      premise: "深夜里，一封没有署名的信出现在门口。",
      fake: true,
      maxChapters: 1,
      chapterWords: 300,
    });

    const stream = await readSseUntilDone(created.runId);
    expect(stream).toContain('"phase":"setup"');
    expect(stream).toContain('"phase":"outline"');
    expect(stream).toContain('"phase":"done"');
    expect(stream).not.toContain('"phase":"chapter"');
  }, 15_000);

  it("streams detailed, timestamped progress for each setup step", async () => {
    const created = await createRun({
      premise: "一个需要细粒度进度的事件流测试。",
      fake: true,
      maxChapters: 1,
      chapterWords: 300,
    });

    const stream = await readSseUntilDone(created.runId);
    for (const phase of ["queued", "setup", "bible", "outline", "done"]) {
      expect(stream, phase).toContain(`"phase":"${phase}"`);
    }
    expect(stream).toContain('"at":"');
    expect(stream).toContain('"durationMs":');
    expect(stream).toContain("正在等待模型返回");
  }, 15_000);

  it("lists run history and exposes a run detail for reattachment", async () => {
    const created = await createRun({
      premise: "一个运行记录查询测试。",
      fake: true,
      maxChapters: 1,
      chapterWords: 300,
    });
    await readSseUntilDone(created.runId);

    const listResponse = await fetch(
      `${baseUrl}/api/runs?projectId=${created.projectId}&limit=5`,
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      runs: Array<Record<string, unknown>>;
    };
    expect(list.runs.length).toBeGreaterThan(0);
    expect(list.runs[0]).toMatchObject({
      runId: created.runId,
      projectId: created.projectId,
      kind: "setup",
      status: "completed",
    });

    const detailResponse = await fetch(
      `${baseUrl}/api/runs/${created.runId}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      status: string;
      events: Array<{ phase: string; at?: string }>;
    };
    expect(detail.status).toBe("completed");
    expect(detail.events.some((event) => event.phase === "bible")).toBe(true);
    expect(detail.events.every((event) => typeof event.at === "string")).toBe(true);
    expect(existsSync(join(root, "runs", `${created.runId}.json`))).toBe(true);
  }, 15_000);

  it("lists an in-flight run so a refreshed page can reattach", async () => {
    const runRoot = createTempDir("novelbuilder-running-runs-");
    const runServer = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(runRoot, "output"),
      settingsPath: join(runRoot, "settings.json"),
      fakeDefault: false,
      gatewayFactory: () => new BlockingGateway(),
    });
    const runBase = `http://127.0.0.1:${runServer.port}`;

    try {
      const response = await fetch(`${runBase}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "一个仍在运行的生成请求。",
          fake: false,
          maxChapters: 1,
          chapterWords: 300,
        }),
      });
      expect(response.status).toBe(202);
      const created = (await response.json()) as CreateProjectResponse;

      const stream = await readSseUntil(
        runBase,
        created.runId,
        '"phase":"bible"',
        8_000,
      );
      expect(stream).toContain('"phase":"queued"');
      expect(stream).toContain('"phase":"setup"');

      const listResponse = await fetch(
        `${runBase}/api/runs?status=running&projectId=${created.projectId}`,
      );
      expect(listResponse.status).toBe(200);
      const list = (await listResponse.json()) as {
        runs: Array<Record<string, unknown>>;
      };
      expect(list.runs).toHaveLength(1);
      expect(list.runs[0]).toMatchObject({
        runId: created.runId,
        kind: "setup",
        status: "running",
      });

      const detailResponse = await fetch(
        `${runBase}/api/runs/${created.runId}`,
      );
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()) as {
        status: string;
        events: Array<{ phase: string }>;
      };
      expect(detail.status).toBe("running");
      expect(detail.events.some((event) => event.phase === "bible")).toBe(true);

      const abortResponse = await fetch(
        `${runBase}/api/runs/${created.runId}/abort`,
        { method: "POST" },
      );
      expect(abortResponse.status).toBe(202);
    } finally {
      await runServer.close();
      removeTempDir(runRoot);
    }
  }, 20_000);

  it("marks persisted running records as failed after a restart", async () => {
    const restartRoot = createTempDir("novelbuilder-run-restart-");
    const options = {
      port: 0,
      host: "127.0.0.1",
      outputDir: join(restartRoot, "output"),
      settingsPath: join(restartRoot, "settings.json"),
      fakeDefault: true,
    };

    const first = await startServer(options);
    const project = await first.store.createProject({
      premise: "一个中断后需要恢复提示的项目。",
      targetWords: 300,
      chapterWords: 300,
      maxChapters: 1,
    });
    await first.store.saveProject({ ...project, status: "running" });
    const startedAt = new Date().toISOString();
    await first.runStore.save({
      runId: "interrupted-run",
      projectId: project.id,
      kind: "setup",
      status: "running",
      startedAt,
      updatedAt: startedAt,
      events: [{ phase: "setup", message: "测试中断", at: startedAt }],
    });
    await first.close();

    const second = await startServer(options);
    try {
      const detailResponse = await fetch(
        `http://127.0.0.1:${second.port}/api/runs/interrupted-run`,
      );
      expect(detailResponse.status).toBe(200);
      const detail = (await detailResponse.json()) as {
        status: string;
        error?: string;
        events: Array<{ phase: string; message: string }>;
      };
      expect(detail.status).toBe("failed");
      expect(detail.error).toContain("服务重启");
      expect(detail.events.at(-1)?.phase).toBe("error");

      const saved = await second.store.getProject(project.id);
      expect(saved?.status).toBe("failed");
    } finally {
      await second.close();
      removeTempDir(restartRoot);
    }
  }, 20_000);

  it("rejects invalid bodies and unknown resources", async () => {
    const emptyPremise = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ premise: "   ", fake: true }),
    });
    expect(emptyPremise.status).toBe(400);
    expect(((await emptyPremise.json()) as ErrorResponse).error).toBeTruthy();

    const malformed = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);

    const missingRun = await fetch(`${baseUrl}/api/runs/missing/events`);
    expect(missingRun.status).toBe(404);

    const missingProject = await fetch(`${baseUrl}/api/projects/missing`);
    expect(missingProject.status).toBe(404);

    const wrongMethod = await fetch(`${baseUrl}/api/health`, {
      method: "POST",
    });
    expect(wrongMethod.status).toBe(405);
  });

  it("passes modelConfig to the gateway factory without exposing the API key", async () => {
    const captureRoot = createTempDir("novelbuilder-model-config-");
    const captured: Array<ModelConfigInput | undefined> = [];
    const modelServer = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(captureRoot, "output"),
      fakeDefault: true,
      settingsPath: join(captureRoot, "settings.json"),
      gatewayFactory: (_project, modelConfig) => {
        captured.push(modelConfig);
        return new FakeAiGateway();
      },
    });
    const modelBase = `http://127.0.0.1:${modelServer.port}`;
    const secret = "test-secret-key-not-persisted";

    try {
      const response = await fetch(`${modelBase}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "一个使用页面模型配置的生成请求。",
          fake: false,
          maxChapters: 1,
          chapterWords: 300,
          modelConfig: {
            protocol: "openai",
            baseUrl: "https://example.com/v1",
            model: "test-model",
            apiKey: secret,
          },
        }),
      });

      expect(response.status).toBe(202);
      const responseText = await response.text();
      expect(responseText).not.toContain(secret);
      const created = JSON.parse(responseText) as CreateProjectResponse;

      expect(captured).toHaveLength(1);
      expect(captured[0]).toEqual({
        protocol: "openai",
        baseUrl: "https://example.com/v1",
        model: "test-model",
        apiKey: secret,
      });

      const payload = await waitForProjectOn(modelBase, created.projectId);
      expect(payload.project.status).toBe("draft");
      expect(JSON.stringify(payload)).not.toContain(secret);
    } finally {
      await modelServer.close();
      removeTempDir(captureRoot);
    }
  }, 20_000);

  it("does not persist an orphan project when gateway creation fails", async () => {
    const orphanRoot = createTempDir("novelbuilder-orphan-");
    let received: Project | undefined;
    const orphanServer = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(orphanRoot, "output"),
      fakeDefault: false,
      settingsPath: join(orphanRoot, "settings.json"),
      gatewayFactory: (project) => {
        received = project;
        throw new Error("gateway creation failed");
      },
    });
    const orphanBase = `http://127.0.0.1:${orphanServer.port}`;

    try {
      const response = await fetch(`${orphanBase}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "一个网关创建失败的请求。",
          fake: false,
          maxChapters: 1,
          chapterWords: 300,
        }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal error" });
      expect(received).toBeDefined();

      expect(await orphanServer.store.getProject(received!.id)).toBeUndefined();
      const projectResponse = await fetch(
        `${orphanBase}/api/projects/${received!.id}`,
      );
      expect(projectResponse.status).toBe(404);
    } finally {
      await orphanServer.close();
      removeTempDir(orphanRoot);
    }
  }, 15_000);

  it("rejects invalid model configs", async () => {
    const cases: Array<{ label: string; modelConfig: unknown }> = [
      {
        label: "bad protocol",
        modelConfig: {
          protocol: "google",
          baseUrl: "https://example.com/v1",
          model: "test-model",
        },
      },
      {
        label: "empty base URL",
        modelConfig: {
          protocol: "openai",
          baseUrl: "   ",
          model: "test-model",
        },
      },
      {
        label: "non-http base URL",
        modelConfig: {
          protocol: "openai",
          baseUrl: "ftp://example.com/v1",
          model: "test-model",
        },
      },
      {
        label: "empty model",
        modelConfig: {
          protocol: "anthropic",
          baseUrl: "https://example.com",
          model: "  ",
        },
      },
      {
        label: "non-object modelConfig",
        modelConfig: "openai",
      },
      {
        label: "non-string api key",
        modelConfig: {
          protocol: "openai",
          baseUrl: "https://example.com/v1",
          model: "test-model",
          apiKey: 42,
        },
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "一个模型配置无效的生成请求。",
          fake: true,
          modelConfig: testCase.modelConfig,
        }),
      });
      expect(response.status, testCase.label).toBe(400);
      const payload = (await response.json()) as ErrorResponse;
      expect(payload.error, testCase.label).toContain("modelConfig");
    }
  });

  it("requires JSON and same-origin state-changing requests", async () => {
    const body = JSON.stringify({
      premise: "一次受保护的生成请求。",
      fake: true,
      maxChapters: 1,
      chapterWords: 300,
    });

    const missingContentType = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      body,
    });
    expect(missingContentType.status).toBe(415);

    const wrongContentType = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });
    expect(wrongContentType.status).toBe(415);

    const sameOrigin = `http://127.0.0.1:${started.port}`;
    const createdResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: sameOrigin,
      },
      body,
    });
    expect(createdResponse.status).toBe(202);
    const created = (await createdResponse.json()) as CreateProjectResponse;

    const maliciousOrigin = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://evil.example:${started.port}`,
      },
      body,
    });
    expect(maliciousOrigin.status).toBe(403);

    const wrongPortOrigin = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${started.port + 1}`,
      },
      body,
    });
    expect(wrongPortOrigin.status).toBe(403);

    const maliciousAbort = await fetch(
      `${baseUrl}/api/runs/${created.runId}/abort`,
      {
        method: "POST",
        headers: { origin: `http://evil.example:${started.port}` },
      },
    );
    expect(maliciousAbort.status).toBe(403);

    const sameOriginAbort = await fetch(
      `${baseUrl}/api/runs/${created.runId}/abort`,
      {
        method: "POST",
        headers: { origin: sameOrigin },
      },
    );
    expect(sameOriginAbort.status).toBe(202);
  }, 15_000);

  it("distinguishes missing projects from missing chapter artifacts", async () => {
    const missingProject = await fetch(
      `${baseUrl}/api/projects/missing/chapters`,
    );
    expect(missingProject.status).toBe(404);

    const project = await started.store.createProject({
      premise: "一个尚未开始写作的项目。",
      targetWords: 4800,
      chapterWords: 800,
      maxChapters: 6,
    });

    const existingProject = await fetch(
      `${baseUrl}/api/projects/${project.id}/chapters`,
    );
    expect(existingProject.status).toBe(200);
    expect(await existingProject.json()).toEqual([]);
  });

  it("returns 500 for corrupt project data without leaking details", async () => {
    const project = await started.store.createProject({
      premise: "一个项目文件被破坏的项目。",
      targetWords: 4800,
      chapterWords: 800,
      maxChapters: 6,
    });
    await started.store.saveArtifact(project.id, "project.json", "{broken json");

    for (const path of [
      `/api/projects/${project.id}`,
      `/api/projects/${project.id}/manuscript`,
      `/api/projects/${project.id}/chapters`,
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(500);
      expect(await response.json()).toEqual({ error: "internal error" });
    }
  }, 15_000);

  it("accepts abort for an existing run", async () => {
    const created = await createRun();
    const response = await fetch(
      `${baseUrl}/api/runs/${created.runId}/abort`,
      { method: "POST" },
    );
    expect(response.status).toBe(202);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);

    const missing = await fetch(`${baseUrl}/api/runs/missing/abort`, {
      method: "POST",
    });
    expect(missing.status).toBe(404);
  }, 15_000);

  it("aborts a blocked run and emits an error event", async () => {
    const abortRoot = createTempDir("novelbuilder-abort-");
    const abortServer = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(abortRoot, "output"),
      fakeDefault: false,
      settingsPath: join(abortRoot, "settings.json"),
      gatewayFactory: () => new BlockingGateway(),
    });
    const abortBase = `http://127.0.0.1:${abortServer.port}`;

    try {
      const createdResponse = await fetch(`${abortBase}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          premise: "一个被阻塞的生成请求。",
          fake: false,
          maxChapters: 1,
          chapterWords: 300,
        }),
      });
      expect(createdResponse.status).toBe(202);
      const created = (await createdResponse.json()) as CreateProjectResponse;

      const streamPromise = readSseUntil(
        abortBase,
        created.runId,
        '"phase":"error"',
        8_000,
      );

      await new Promise((resolve) => setTimeout(resolve, 75));

      const abortResponse = await fetch(
        `${abortBase}/api/runs/${created.runId}/abort`,
        { method: "POST" },
      );
      expect(abortResponse.status).toBe(202);

      const stream = await streamPromise;
      expect(stream).toContain('"phase":"error"');
      expect(stream.toLowerCase()).toContain("abort");

      const payload = await waitForProjectOn(
        abortBase,
        created.projectId,
        5_000,
      );
      expect(payload.project.status).toBe("failed");
    } finally {
      await abortServer.close();
      removeTempDir(abortRoot);
    }
  }, 15_000);
});
