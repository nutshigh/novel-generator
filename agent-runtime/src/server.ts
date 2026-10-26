import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeAiGateway } from "./ai/fakeGateway.js";
import type { AiGateway } from "./ai/gateway.js";
import type { ModelConfigInput } from "./ai/piGateway.js";
import {
  createDirectorModelHandle,
  createEnvDirectorModelHandle,
  createPiDirectorSessionFactory,
} from "./agent/directorSession.js";
import { envModelName, hasEnvModelConfig, loadConfig } from "./config.js";
import { openForeshadowStore } from "./domain/foreshadowStore.js";
import { MAX_EXTENSION_BATCH } from "./domain/schemas.js";
import type { Project, RunProgress } from "./domain/schemas.js";
import { JsonProjectStore, type ProjectStore } from "./domain/store.js";
import { createNovelGraph } from "./graph/index.js";
import { buildBookGraph } from "./graph/build.js";
import type { NovelGraphStore } from "./graph/types.js";
import {
  JsonSettingsStore,
  type ModelProtocol,
  type SettingsPatch,
  type SettingsStore,
  type StoredSettings,
} from "./settings.js";
import {
  RunRecordStore,
  type RunKind,
  type StoredRun,
} from "./runStore.js";
import { continueNovel } from "./story/continuation.js";
import type { DirectorSessionFactory } from "./story/director.js";
import { readPromptLog } from "./story/promptLog.js";
import { listBooks, loadBookToc, loadChapter } from "./story/library.js";
import {
  flattenOutlineChapters,
  loadStoredChapters,
} from "./story/library.js";
import { runSetupPipeline } from "./story/pipeline.js";
import { loadStorySetup } from "./story/setup.js";
import type { CreateStoryProjectInput } from "./story/project.js";
import { createProject } from "./story/project.js";
import { renderHomePage } from "./ui.js";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_OUTPUT_DIR = "output";
const BODY_LIMIT_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 15_000;
const SSE_CLOSE_DELAY_MS = 120;
const INTERNAL_ERROR = "internal error";
const ALLOWED_ORIGIN_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface StartServerOptions {
  port?: number;
  host?: string;
  outputDir?: string;
  fakeDefault?: boolean;
  settingsPath?: string;
  runsDir?: string;
  graph?: NovelGraphStore;
  directorSessionFactory?: DirectorSessionFactory;
  gatewayFactory?: (
    project: Project,
    modelConfig?: ModelConfigInput,
  ) => AiGateway;
}

export interface RunState {
  runId: string;
  projectId: string;
  projectTitle?: string;
  kind: RunKind;
  status: "running" | "completed" | "failed";
  events: RunProgress[];
  startedAt: string;
  updatedAt: string;
  error?: string;
  fromChapter?: number;
  toChapter?: number;
  extended?: boolean;
  controller: AbortController;
  clients: Set<ServerResponse>;
  heartbeat?: NodeJS.Timeout;
  completion: Promise<void>;
  runStore: RunRecordStore;
}

export interface StartedServer {
  server: Server;
  port: number;
  close(): Promise<void>;
  store: ProjectStore;
  graph: NovelGraphStore;
  runs: Map<string, RunState>;
  runStore: RunRecordStore;
}

interface ServerContext {
  store: ProjectStore;
  settings: SettingsStore;
  graph: NovelGraphStore;
  runs: Map<string, RunState>;
  runStore: RunRecordStore;
  outputDir: string;
  fakeDefault: boolean;
  port: number;
  directorSessionFactory?: DirectorSessionFactory;
  gatewayFactory?: (
    project: Project,
    modelConfig?: ModelConfigInput,
  ) => AiGateway;
}

interface ParsedProjectBody {
  input: CreateStoryProjectInput;
  fake: boolean | undefined;
  modelConfig?: ModelConfigInput;
}

class RequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function isAllowedOrigin(origin: string, serverPort: number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (!ALLOWED_ORIGIN_HOSTS.has(parsed.hostname)) return false;

  const originPort =
    parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  return originPort === String(serverPort);
}

function rejectCrossOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  serverPort: number,
): boolean {
  const origin = headerValue(req.headers.origin);
  if (origin === undefined) return false;
  if (isAllowedOrigin(origin, serverPort)) return false;

  sendJson(res, 403, { error: "Cross-origin request rejected." });
  return true;
}

function parseLastEventId(
  value: string | string[] | undefined,
): number | undefined {
  const raw = headerValue(value)?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function logServerError(error: unknown): void {
  process.stderr.write(`NovelBuilder: ${errorMessage(error)}\n`);
}

function optionalInteger(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RequestError(400, `${key} must be an integer.`);
  }
  return value;
}

function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new RequestError(400, `${key} must be a boolean.`);
  }
  return value;
}

function parseModelConfig(value: unknown): ModelConfigInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new RequestError(400, "modelConfig must be an object.");
  }

  const protocol = value.protocol;
  if (protocol !== "openai" && protocol !== "anthropic") {
    throw new RequestError(
      400,
      'modelConfig.protocol must be "openai" or "anthropic".',
    );
  }

  const baseUrl = value.baseUrl;
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new RequestError(
      400,
      "modelConfig.baseUrl must be a non-empty http(s) URL.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl.trim());
  } catch {
    throw new RequestError(
      400,
      "modelConfig.baseUrl must be a non-empty http(s) URL.",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new RequestError(
      400,
      "modelConfig.baseUrl must be a non-empty http(s) URL.",
    );
  }

  const model = value.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new RequestError(
      400,
      "modelConfig.model must be a non-empty string.",
    );
  }

  const rawApiKey = value.apiKey;
  if (rawApiKey !== undefined && typeof rawApiKey !== "string") {
    throw new RequestError(400, "modelConfig.apiKey must be a string.");
  }
  const apiKey = rawApiKey?.trim() || undefined;

  return {
    protocol,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

function parseCreateProjectBody(value: unknown): ParsedProjectBody {
  if (!isRecord(value)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }

  const premise = value.premise;
  if (typeof premise !== "string" || premise.trim().length === 0) {
    throw new RequestError(400, "premise must be a non-empty string.");
  }

  const fake = value.fake;
  if (fake !== undefined && typeof fake !== "boolean") {
    throw new RequestError(400, "fake must be a boolean.");
  }

  const maxChapters = optionalInteger(value, "maxChapters");
  const chapterWords = optionalInteger(value, "chapterWords");
  const reviewEnabled = optionalBoolean(value, "reviewEnabled");
  const modelConfig = parseModelConfig(value.modelConfig);

  return {
    input: {
      premise,
      ...(maxChapters === undefined ? {} : { maxChapters }),
      ...(chapterWords === undefined ? {} : { chapterWords }),
      ...(reviewEnabled === undefined ? {} : { reviewEnabled }),
    },
    fake,
    ...(modelConfig === undefined ? {} : { modelConfig }),
  };
}

interface ParsedContinueBody {
  fromChapter?: number;
  additionalChapters?: number;
  chapterCount?: number;
  reviewEnabled?: boolean;
  fake?: boolean;
  modelConfig?: ModelConfigInput;
}

function parseContinueBody(value: unknown): ParsedContinueBody {
  if (!isRecord(value)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }

  const fake = value.fake;
  if (fake !== undefined && typeof fake !== "boolean") {
    throw new RequestError(400, "fake must be a boolean.");
  }

  const fromChapter = optionalInteger(value, "fromChapter");
  const additionalChapters = optionalInteger(value, "additionalChapters");
  const chapterCount = optionalInteger(value, "chapterCount");
  const reviewEnabled = optionalBoolean(value, "reviewEnabled");

  if (fromChapter !== undefined && additionalChapters !== undefined) {
    throw new RequestError(
      400,
      "fromChapter and additionalChapters cannot be used together.",
    );
  }

  if (fromChapter !== undefined && fromChapter < 1) {
    throw new RequestError(400, "fromChapter must be a positive integer.");
  }

  if (
    additionalChapters !== undefined &&
    (additionalChapters < 1 || additionalChapters > MAX_EXTENSION_BATCH)
  ) {
    throw new RequestError(
      400,
      `additionalChapters must be between 1 and ${MAX_EXTENSION_BATCH}.`,
    );
  }

  if (chapterCount !== undefined && chapterCount < 1) {
    throw new RequestError(400, "chapterCount must be a positive integer.");
  }

  const modelConfig = parseModelConfig(value.modelConfig);

  return {
    ...(fromChapter === undefined ? {} : { fromChapter }),
    ...(additionalChapters === undefined ? {} : { additionalChapters }),
    ...(chapterCount === undefined ? {} : { chapterCount }),
    ...(reviewEnabled === undefined ? {} : { reviewEnabled }),
    ...(fake === undefined ? {} : { fake }),
    ...(modelConfig === undefined ? {} : { modelConfig }),
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > BODY_LIMIT_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new RequestError(413, "Request body exceeds 1 MB."));
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolvePromise(JSON.parse(raw));
      } catch {
        reject(new RequestError(400, "Invalid JSON body."));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendInternalError(res: ServerResponse): void {
  sendJson(res, 500, { error: INTERNAL_ERROR });
}

function sendMethodNotAllowed(
  res: ServerResponse,
  allowed: readonly string[],
): void {
  sendJson(
    res,
    405,
    { error: "Method not allowed." },
    { allow: allowed.join(", ") },
  );
}

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

function sseFrame(index: number, event: RunProgress): string {
  return `id: ${index}\ndata: ${JSON.stringify(event)}\n\n`;
}

function runRecord(run: RunState): StoredRun {
  return {
    runId: run.runId,
    projectId: run.projectId,
    ...(run.projectTitle === undefined
      ? {}
      : { projectTitle: run.projectTitle }),
    kind: run.kind,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    events: run.events,
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.fromChapter === undefined ? {} : { fromChapter: run.fromChapter }),
    ...(run.toChapter === undefined ? {} : { toChapter: run.toChapter }),
    ...(run.extended === undefined ? {} : { extended: run.extended }),
  };
}

function persistRun(run: RunState): void {
  void run.runStore.save(runRecord(run)).catch(logServerError);
}

function pushEvent(run: RunState, event: RunProgress): void {
  const stamped: RunProgress =
    event.at === undefined
      ? { ...event, at: new Date().toISOString() }
      : event;
  const index = run.events.length;
  run.events.push(stamped);
  run.updatedAt = stamped.at ?? new Date().toISOString();
  persistRun(run);

  const frame = sseFrame(index, stamped);

  for (const client of [...run.clients]) {
    if (client.writableEnded || client.destroyed) {
      run.clients.delete(client);
      continue;
    }
    client.write(frame);
  }
}

function runTitle(project: Project): string {
  const premise = project.premise.trim().replace(/\s+/g, " ");
  return premise.length > 60 ? `${premise.slice(0, 60)}…` : premise;
}

interface CreateRunInput {
  projectId: string;
  projectTitle?: string;
  kind: RunKind;
  fromChapter?: number;
  toChapter?: number;
  extended?: boolean;
}

function createRun(context: ServerContext, input: CreateRunInput): RunState {
  const now = new Date().toISOString();
  const run: RunState = {
    runId: randomUUID(),
    projectId: input.projectId,
    ...(input.projectTitle === undefined
      ? {}
      : { projectTitle: input.projectTitle }),
    kind: input.kind,
    status: "running",
    events: [],
    startedAt: now,
    updatedAt: now,
    ...(input.fromChapter === undefined
      ? {}
      : { fromChapter: input.fromChapter }),
    ...(input.toChapter === undefined ? {} : { toChapter: input.toChapter }),
    ...(input.extended === undefined ? {} : { extended: input.extended }),
    controller: new AbortController(),
    clients: new Set(),
    completion: Promise.resolve(),
    runStore: context.runStore,
  };

  context.runs.set(run.runId, run);
  persistRun(run);
  return run;
}

function runSummary(record: StoredRun): Record<string, unknown> {
  const last = record.events.at(-1);
  return {
    runId: record.runId,
    projectId: record.projectId,
    ...(record.projectTitle === undefined
      ? {}
      : { projectTitle: record.projectTitle }),
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    eventCount: record.events.length,
    ...(last === undefined ? {} : { lastMessage: last.message }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.fromChapter === undefined
      ? {}
      : { fromChapter: record.fromChapter }),
    ...(record.toChapter === undefined ? {} : { toChapter: record.toChapter }),
    ...(record.extended === undefined ? {} : { extended: record.extended }),
  };
}

function startHeartbeat(run: RunState): void {
  if (run.heartbeat) return;

  const timer = setInterval(() => {
    for (const client of [...run.clients]) {
      if (client.writableEnded || client.destroyed) {
        run.clients.delete(client);
        continue;
      }
      client.write(": ping\n\n");
    }
  }, HEARTBEAT_MS);

  timer.unref();
  run.heartbeat = timer;
}

function clearHeartbeat(run: RunState): void {
  if (!run.heartbeat) return;
  clearInterval(run.heartbeat);
  run.heartbeat = undefined;
}

function clearHeartbeatIfIdle(run: RunState): void {
  if (run.clients.size === 0) clearHeartbeat(run);
}

function endClients(run: RunState): void {
  clearHeartbeat(run);
  for (const client of run.clients) {
    try {
      if (!client.writableEnded) client.end();
    } catch {
      continue;
    }
  }
  run.clients.clear();
}

function finalizeRun(
  run: RunState,
  status: "completed" | "failed",
  error?: string,
): void {
  if (run.status !== "running") return;

  run.status = status;
  if (error !== undefined) run.error = error;

  const finalPhase = status === "completed" ? "done" : "error";
  const last = run.events.at(-1);
  if (last?.phase !== finalPhase) {
    pushEvent(
      run,
      status === "completed"
        ? { phase: "done", message: "任务已完成。" }
        : {
            phase: "error",
            message: "任务失败。",
            ...(error === undefined ? {} : { error }),
          },
    );
  }

  run.updatedAt = new Date().toISOString();
  persistRun(run);
  clearHeartbeat(run);
  const timer = setTimeout(() => endClients(run), SSE_CLOSE_DELAY_MS);
  timer.unref();
}

async function executeRun(
  run: RunState,
  project: Project,
  ai: AiGateway,
  store: ProjectStore,
  graph: NovelGraphStore,
): Promise<void> {
  try {
    await runSetupPipeline({
      project,
      ai,
      store,
      graph,
      signal: run.controller.signal,
      onProgress: (event) => pushEvent(run, event),
    });
    finalizeRun(run, "completed");
  } catch (error) {
    finalizeRun(run, "failed", errorMessage(error));
  }
}

async function createRealGateway(): Promise<AiGateway> {
  const { createPiGateway } = await import("./ai/piGateway.js");
  return createPiGateway(loadConfig());
}

async function resolveGateway(
  context: ServerContext,
  project: Project,
  fakeOption: boolean | undefined,
  requestedConfig: ModelConfigInput | undefined,
): Promise<AiGateway> {
  const useFake = fakeOption ?? context.fakeDefault;
  let modelConfig = requestedConfig;

  if (!useFake && !modelConfig) {
    let stored: StoredSettings | undefined;
    try {
      stored = await context.settings.read();
    } catch (error) {
      logServerError(error);
      throw new RequestError(500, INTERNAL_ERROR);
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

  if (context.gatewayFactory) {
    return context.gatewayFactory(project, modelConfig);
  }
  if (useFake) {
    return new FakeAiGateway();
  }
  if (modelConfig) {
    const { createPiGatewayFromModelConfig } = await import(
      "./ai/piGateway.js"
    );
    return createPiGatewayFromModelConfig({
      ...modelConfig,
      agentDir: resolve(
        process.env.NOVELBUILDER_AGENT_DIR?.trim() || ".agent",
      ),
    });
  }
  if (!hasEnvModelConfig()) {
    throw new RequestError(
      400,
      "未配置模型。请先在全局设置中填写模型配置。",
      "model_not_configured",
    );
  }
  return createRealGateway();
}

async function resolveDirectorSessionFactory(
  context: ServerContext,
  fakeOption: boolean | undefined,
  requestedConfig: ModelConfigInput | undefined,
): Promise<DirectorSessionFactory | undefined> {
  if (context.directorSessionFactory) return context.directorSessionFactory;

  const useFake = fakeOption ?? context.fakeDefault;
  if (useFake || context.gatewayFactory) return undefined;

  let modelConfig = requestedConfig;
  if (!modelConfig) {
    let stored: StoredSettings | undefined;
    try {
      stored = await context.settings.read();
    } catch (error) {
      logServerError(error);
      throw new RequestError(500, INTERNAL_ERROR);
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

  const agentDir = resolve(
    process.env.NOVELBUILDER_AGENT_DIR?.trim() || ".agent",
  );
  if (modelConfig) {
    const handle = await createDirectorModelHandle(modelConfig, agentDir);
    return {
      ...createPiDirectorSessionFactory(handle.config),
      cleanup: handle.cleanup,
    };
  }

  if (!hasEnvModelConfig()) {
    throw new RequestError(
      400,
      "未配置模型。请先在全局设置中填写模型配置。",
      "model_not_configured",
    );
  }
  const handle = createEnvDirectorModelHandle();
  return createPiDirectorSessionFactory(handle.config);
}

async function handleCreateProject(
  req: IncomingMessage,
  res: ServerResponse,
  context: ServerContext,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  let parsed: ParsedProjectBody;
  try {
    parsed = parseCreateProjectBody(body);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  let project: Project;
  try {
    project = createProject(parsed.input);
  } catch (error) {
    sendJson(res, 400, { error: errorMessage(error) });
    return;
  }

  let ai: AiGateway;
  try {
    ai = await resolveGateway(
      context,
      project,
      parsed.fake,
      parsed.modelConfig,
    );
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, {
        error: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
      });
      return;
    }
    logServerError(error);
    sendInternalError(res);
    return;
  }

  let saved: Project;
  try {
    saved = await context.store.createProject(project);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  const run = createRun(context, {
    projectId: saved.id,
    projectTitle: runTitle(saved),
    kind: "setup",
  });
  pushEvent(run, {
    phase: "queued",
    message: `任务已创建，准备生成故事圣经与章节大纲（${saved.maxChapters} 章，每章 ${saved.chapterWords} 字）。`,
  });

  sendJson(res, 202, { projectId: saved.id, runId: run.runId });
  run.completion = executeRun(run, saved, ai, context.store, context.graph);
}

async function executeContinuationRun(
  run: RunState,
  input: {
    projectId: string;
    fromChapter?: number;
    additionalChapters?: number;
    chapterCount?: number;
    reviewEnabled?: boolean;
    ai: AiGateway;
    store: ProjectStore;
    graph: NovelGraphStore;
    directorSessionFactory?: DirectorSessionFactory;
  },
): Promise<void> {
  try {
    await continueNovel({
      projectId: input.projectId,
      ...(input.fromChapter === undefined
        ? {}
        : { fromChapter: input.fromChapter }),
      ...(input.additionalChapters === undefined
        ? {}
        : { additionalChapters: input.additionalChapters }),
      ...(input.chapterCount === undefined
        ? {}
        : { chapterCount: input.chapterCount }),
      ...(input.reviewEnabled === undefined
        ? {}
        : { reviewEnabled: input.reviewEnabled }),
      ai: input.ai,
      store: input.store,
      graph: input.graph,
      ...(input.directorSessionFactory === undefined
        ? {}
        : { directorSessionFactory: input.directorSessionFactory }),
      signal: run.controller.signal,
      onProgress: (event) => pushEvent(run, event),
    });
    finalizeRun(run, "completed");
  } catch (error) {
    finalizeRun(run, "failed", errorMessage(error));
  } finally {
    const cleanup = input.directorSessionFactory?.cleanup;
    if (cleanup) {
      await cleanup.call(input.directorSessionFactory).catch(() => undefined);
    }
  }
}

function hasActiveRun(context: ServerContext, projectId: string): boolean {
  for (const run of context.runs.values()) {
    if (run.projectId === projectId && run.status === "running") return true;
  }
  return false;
}

async function handleContinueProject(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  let parsed: ParsedContinueBody;
  try {
    parsed = parseContinueBody(body);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    throw error;
  }

  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  if (hasActiveRun(context, projectId)) {
    sendJson(res, 409, {
      error: "这本书已有生成任务在运行，请等待完成或先停止。",
      code: "run_in_progress",
    });
    return;
  }

  let toc: Awaited<ReturnType<typeof loadBookToc>>;
  try {
    toc = await loadBookToc(context.store, projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!toc || !toc.outlineReady) {
    sendJson(res, 409, {
      error: "这本书还没有可用的章节大纲，无法续写。",
      code: "outline_unavailable",
    });
    return;
  }

  let fromChapter: number;
  let toChapter: number;
  let extended = false;

  if (parsed.additionalChapters !== undefined) {
    if (toc.firstUnwrittenChapter !== null) {
      sendJson(res, 409, {
        error: `还有章节没有写完，请先从第 ${toc.firstUnwrittenChapter} 章继续写作。`,
        code: "outline_incomplete",
      });
      return;
    }

    const total = toc.plannedChapters + parsed.additionalChapters;
    fromChapter = toc.plannedChapters + 1;
    toChapter = parsed.chapterCount === undefined
      ? total
      : Math.min(total, fromChapter + parsed.chapterCount - 1);
    extended = true;
  } else if (parsed.fromChapter !== undefined) {
    if (parsed.fromChapter > toc.plannedChapters) {
      sendJson(res, 400, {
        error: `第 ${parsed.fromChapter} 章超出当前大纲范围（共 ${toc.plannedChapters} 章）。`,
        code: "invalid_chapter",
      });
      return;
    }
    fromChapter = parsed.fromChapter;
    toChapter = parsed.chapterCount === undefined
      ? toc.plannedChapters
      : Math.min(
          toc.plannedChapters,
          fromChapter + parsed.chapterCount - 1,
        );
  } else {
    if (toc.firstUnwrittenChapter === null) {
      sendJson(res, 409, {
        error: "当前大纲已全部写完。请使用“续写新章节”扩展大纲。",
        code: "outline_exhausted",
      });
      return;
    }
    fromChapter = toc.firstUnwrittenChapter;
    toChapter = parsed.chapterCount === undefined
      ? toc.plannedChapters
      : Math.min(
          toc.plannedChapters,
          fromChapter + parsed.chapterCount - 1,
        );
  }

  let ai: AiGateway;
  let directorSessionFactory: DirectorSessionFactory | undefined;
  try {
    ai = await resolveGateway(context, project, parsed.fake, parsed.modelConfig);
    directorSessionFactory = await resolveDirectorSessionFactory(
      context,
      parsed.fake,
      parsed.modelConfig,
    );
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.status, {
        error: error.message,
        ...(error.code === undefined ? {} : { code: error.code }),
      });
      return;
    }
    logServerError(error);
    sendInternalError(res);
    return;
  }

  const run = createRun(context, {
    projectId,
    projectTitle: runTitle(project),
    kind: "continuation",
    fromChapter,
    toChapter,
    extended,
  });
  pushEvent(run, {
    phase: "queued",
    message: extended
      ? `任务已创建：扩展大纲并写作第 ${fromChapter} 至 ${toChapter} 章。`
      : `任务已创建：写作第 ${fromChapter} 至 ${toChapter} 章。`,
    chapterNumber: fromChapter,
  });

  sendJson(res, 202, {
    projectId,
    runId: run.runId,
    fromChapter,
    toChapter,
    extended,
  });
  run.completion = executeContinuationRun(run, {
    projectId,
    ...(parsed.additionalChapters === undefined
      ? { fromChapter }
      : { additionalChapters: parsed.additionalChapters }),
    ...(parsed.chapterCount === undefined
      ? {}
      : { chapterCount: parsed.chapterCount }),
    ...(parsed.reviewEnabled === undefined
      ? {}
      : { reviewEnabled: parsed.reviewEnabled }),
    ai,
    store: context.store,
    graph: context.graph,
    ...(directorSessionFactory === undefined
      ? {}
      : { directorSessionFactory }),
  });
}

function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
}

function replayEvents(
  res: ServerResponse,
  events: RunProgress[],
  lastEventId?: number,
): void {
  const startIndex = lastEventId === undefined ? 0 : lastEventId + 1;
  events.forEach((event, index) => {
    if (index >= startIndex) res.write(sseFrame(index, event));
  });
}

function handleStoredEventStream(
  res: ServerResponse,
  record: StoredRun,
  lastEventId?: number,
): void {
  writeSseHeaders(res);
  replayEvents(res, record.events, lastEventId);

  const timer = setTimeout(() => {
    if (!res.writableEnded) res.end();
  }, SSE_CLOSE_DELAY_MS);
  timer.unref();
}

function handleEventStream(
  res: ServerResponse,
  run: RunState,
  lastEventId?: number,
): void {
  writeSseHeaders(res);
  replayEvents(res, run.events, lastEventId);

  if (run.status !== "running") {
    const timer = setTimeout(() => {
      if (!res.writableEnded) res.end();
      run.clients.delete(res);
      clearHeartbeatIfIdle(run);
    }, SSE_CLOSE_DELAY_MS);
    timer.unref();
    return;
  }

  res.on("close", () => {
    run.clients.delete(res);
    clearHeartbeatIfIdle(run);
  });

  run.clients.add(res);
  startHeartbeat(run);
}

async function handleGetProject(
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  let artifacts: string[] = [];
  try {
    const entries = await readdir(join(context.outputDir, projectId), {
      withFileTypes: true,
    });
    artifacts = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (!isMissing(error)) {
      logServerError(error);
      sendInternalError(res);
      return;
    }
  }

  sendJson(res, 200, { project, artifacts });
}

async function handleGetManuscript(
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  let markdown: string | undefined;
  try {
    markdown = await context.store.readArtifact(projectId, "book.md");
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (markdown === undefined) {
    sendJson(res, 404, { error: "Manuscript not found." });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(markdown);
}

async function handleGetChapters(
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  let raw: string | undefined;
  try {
    raw = await context.store.readArtifact(projectId, "chapters.json");
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (raw === undefined) {
    sendJson(res, 200, []);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!Array.isArray(parsed)) {
    sendInternalError(res);
    return;
  }

  sendJson(res, 200, parsed);
}

async function handleGetToc(
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let toc: Awaited<ReturnType<typeof loadBookToc>>;
  try {
    toc = await loadBookToc(context.store, projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!toc) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  sendJson(res, 200, {
    project: toc.project,
    title: toc.title,
    outlineReady: toc.outlineReady,
    plannedChapters: toc.plannedChapters,
    writtenChapters: toc.writtenChapters,
    wordCount: toc.wordCount,
    needsAttention: toc.needsAttention,
    firstUnwrittenChapter: toc.firstUnwrittenChapter,
    canExtend: toc.canExtend,
    volumes: toc.volumes,
  });
}

async function handleGetPromptLog(
  res: ServerResponse,
  projectId: string,
  url: URL,
  context: ServerContext,
): Promise<void> {
  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  const rawChapter = url.searchParams.get("chapterNumber");
  let chapterNumber: number | undefined;
  if (rawChapter !== null) {
    const parsed = Number.parseInt(rawChapter, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      sendJson(res, 400, { error: "Invalid chapter number." });
      return;
    }
    chapterNumber = parsed;
  }

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? 50 : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(500, Math.max(1, parsedLimit))
    : 50;

  try {
    const result = await readPromptLog(context.store, projectId, {
      ...(chapterNumber === undefined ? {} : { chapterNumber }),
      limit,
    });
    sendJson(res, 200, {
      projectId,
      chapterNumber: chapterNumber ?? null,
      total: result.total,
      entries: result.entries,
    });
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
  }
}

async function handleGetForeshadows(
  res: ServerResponse,
  projectId: string,
  url: URL,
  context: ServerContext,
): Promise<void> {
  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  const rawChapter = url.searchParams.get("chapterNumber");
  let chapterNumber: number | undefined;
  if (rawChapter !== null) {
    const parsed = Number.parseInt(rawChapter, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      sendJson(res, 400, { error: "Invalid chapter number." });
      return;
    }
    chapterNumber = parsed;
  }

  const projectDir = context.store.getProjectDir(projectId);
  if (projectDir === undefined || !existsSync(join(projectDir, "story.db"))) {
    sendJson(res, 200, {
      projectId,
      chapterNumber: chapterNumber ?? null,
      available: false,
      records: [],
      counts: { total: 0, open: 0, resolved: 0, abandoned: 0 },
    });
    return;
  }

  const foreshadows = openForeshadowStore(context.store, projectId);
  try {
    const records =
      chapterNumber === undefined
        ? foreshadows.list(projectId)
        : foreshadows.listForChapter(projectId, chapterNumber);
    const open = records.filter(
      (record) =>
        record.status === "planned" ||
        record.status === "open" ||
        record.status === "progressed",
    ).length;
    const resolved = records.filter(
      (record) => record.status === "resolved",
    ).length;
    const abandoned = records.filter(
      (record) => record.status === "abandoned",
    ).length;

    sendJson(res, 200, {
      projectId,
      chapterNumber: chapterNumber ?? null,
      available: true,
      records,
      counts: { total: records.length, open, resolved, abandoned },
    });
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
  } finally {
    foreshadows.close();
  }
}

async function handleGetChapter(
  res: ServerResponse,
  projectId: string,
  chapterNumber: number,
  context: ServerContext,
): Promise<void> {  let project: Project | undefined;
  try {
    project = await context.store.getProject(projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!project) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }

  let chapter;
  try {
    chapter = await loadChapter(context.store, projectId, chapterNumber);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!chapter) {
    sendJson(res, 404, { error: "Chapter not found." });
    return;
  }

  sendJson(res, 200, chapter);
}

async function handleGetGraph(
  res: ServerResponse,
  projectId: string,
  context: ServerContext,
): Promise<void> {
  let toc: Awaited<ReturnType<typeof loadBookToc>>;
  try {
    toc = await loadBookToc(context.store, projectId);
  } catch (error) {
    logServerError(error);
    sendInternalError(res);
    return;
  }

  if (!toc) {
    sendJson(res, 404, { error: "Project not found." });
    return;
  }
  if (!toc.outlineReady) {
    sendJson(res, 409, {
      error: "这本书还没有章节大纲，无法建立知识图谱。",
      code: "outline_unavailable",
    });
    return;
  }

  try {
    const setup = await loadStorySetup(context.store, projectId);
    const stored = await loadStoredChapters(
      context.store,
      projectId,
      flattenOutlineChapters(setup.outline),
    );
    await context.graph.rebuildBook(
      buildBookGraph({
        project: setup.project,
        bible: setup.bible,
        outline: setup.outline,
        chapters: stored.chapters,
      }),
    );
    const graph = await context.graph.getGraph(projectId);
    if (!graph) {
      const summary = await context.graph.getSummary(projectId);
      sendJson(res, 200, {
        available: false,
        reason: summary.reason ?? "知识图谱暂不可用",
        graph: context.graph.name,
        book: {
          id: projectId,
          title: toc.title,
          writtenChapters: toc.writtenChapters,
          plannedChapters: toc.plannedChapters,
        },
        nodeCount: 0,
        edgeCount: 0,
        nodes: [],
        edges: [],
      });
      return;
    }

    sendJson(res, 200, {
      available: true,
      graph: context.graph.name,
      book: {
        id: projectId,
        title: toc.title,
        writtenChapters: toc.writtenChapters,
        plannedChapters: toc.plannedChapters,
      },
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        name: node.name,
        ...(node.chapter === undefined ? {} : { chapter: node.chapter }),
        ...(node.status === undefined ? {} : { status: node.status }),
        data: node.data ?? {},
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromId,
        target: edge.toId,
        kind: edge.kind,
        ...(edge.description === undefined
          ? {}
          : { description: edge.description }),
        ...(edge.fromChapter === undefined
          ? {}
          : { fromChapter: edge.fromChapter }),
        ...(edge.toChapter === undefined ? {} : { toChapter: edge.toChapter }),
        ...(edge.evidenceChapter === undefined
          ? {}
          : { evidenceChapter: edge.evidenceChapter }),
        ...(edge.status === undefined ? {} : { status: edge.status }),
        data: edge.data ?? {},
      })),
    });
  } catch (error) {
    logServerError(error);
    sendJson(res, 200, {
      available: false,
      reason: errorMessage(error),
      graph: context.graph.name,
      book: {
        id: projectId,
        title: toc.title,
        writtenChapters: toc.writtenChapters,
        plannedChapters: toc.plannedChapters,
      },
      nodeCount: 0,
      edgeCount: 0,
      nodes: [],
      edges: [],
    });
  }
}

const CYTOSCAPE_SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "cytoscape",
  "dist",
  "cytoscape.min.js",
);
let cytoscapeScript: Promise<Buffer> | undefined;

function loadCytoscapeScript(): Promise<Buffer> {
  cytoscapeScript ??= readFile(CYTOSCAPE_SCRIPT_PATH);
  return cytoscapeScript;
}

async function handleCytoscapeScript(res: ServerResponse): Promise<void> {
  try {
    const content = await loadCytoscapeScript();
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=86400",
    });
    res.end(content);
  } catch (error) {
    logServerError(error);
    sendJson(res, 404, { error: "Cytoscape bundle not found." });
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: ServerContext,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname === "/") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(renderHomePage());
    return;
  }

  if (pathname === "/vendor/cytoscape.min.js") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    await handleCytoscapeScript(res);
    return;
  }

  if (pathname === "/api/health") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/projects") {
    if (method === "GET") {
      try {
        sendJson(res, 200, { projects: await listBooks(context.store) });
      } catch (error) {
        logServerError(error);
        sendInternalError(res);
      }
      return;
    }

    if (method !== "POST") {
      sendMethodNotAllowed(res, ["GET", "POST"]);
      return;
    }
    if (rejectCrossOrigin(req, res, context.port)) return;
    if (!isJsonContentType(headerValue(req.headers["content-type"]))) {
      sendJson(res, 415, {
        error: "Content-Type must be application/json.",
      });
      return;
    }
    await handleCreateProject(req, res, context);
    return;
  }

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
        await context.settings.patch(patch);
        sendJson(res, 200, settingsView(await context.settings.read()));
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

  if (pathname === "/api/runs") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }

    try {
      const statusFilter = url.searchParams.get("status");
      const projectFilter = url.searchParams.get("projectId");
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit =
        rawLimit === null ? 20 : Number.parseInt(rawLimit, 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(100, Math.max(1, parsedLimit))
        : 20;

      const records = new Map<string, StoredRun>();
      for (const record of await context.runStore.list()) {
        records.set(record.runId, record);
      }
      for (const run of context.runs.values()) {
        records.set(run.runId, runRecord(run));
      }

      let list = Array.from(records.values());
      if (statusFilter) {
        const wanted =
          statusFilter === "active" ? "running" : statusFilter;
        list = list.filter((record) => record.status === wanted);
      }
      if (projectFilter) {
        list = list.filter((record) => record.projectId === projectFilter);
      }
      list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      sendJson(res, 200, {
        runs: list.slice(0, limit).map((record) => runSummary(record)),
      });
    } catch (error) {
      logServerError(error);
      sendInternalError(res);
    }
    return;
  }

  const runMatch = /^\/api\/runs\/([^/]+)\/(events|abort)$/.exec(pathname);
  if (runMatch) {
    const runId = runMatch[1]!;
    const action = runMatch[2]!;

    if (action === "events") {
      if (method !== "GET") {
        sendMethodNotAllowed(res, ["GET"]);
        return;
      }
      const run = context.runs.get(runId);
      if (run) {
        handleEventStream(
          res,
          run,
          parseLastEventId(headerValue(req.headers["last-event-id"])),
        );
        return;
      }

      const stored = await context.runStore.read(runId).catch(() => undefined);
      if (!stored) {
        sendJson(res, 404, { error: "Run not found." });
        return;
      }
      handleStoredEventStream(
        res,
        stored,
        parseLastEventId(headerValue(req.headers["last-event-id"])),
      );
      return;
    }

    if (method !== "POST") {
      sendMethodNotAllowed(res, ["POST"]);
      return;
    }
    if (rejectCrossOrigin(req, res, context.port)) return;
    const run = context.runs.get(runId);
    if (!run) {
      sendJson(res, 404, { error: "Run not found." });
      return;
    }
    if (run.status === "running") {
      pushEvent(run, {
        phase: "abort",
        message: "已收到停止请求，正在结束当前模型调用…",
      });
      run.controller.abort();
    }
    sendJson(res, 202, { ok: true });
    return;
  }

  const runDetailMatch = /^\/api\/runs\/([^/]+)$/.exec(pathname);
  if (runDetailMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    const runId = runDetailMatch[1]!;
    const run = context.runs.get(runId);
    const record = run
      ? runRecord(run)
      : await context.runStore.read(runId).catch(() => undefined);

    if (!record) {
      sendJson(res, 404, { error: "Run not found." });
      return;
    }
    sendJson(res, 200, record);
    return;
  }

  const continueMatch = /^\/api\/projects\/([^/]+)\/continue$/.exec(pathname);
  if (continueMatch) {
    if (method !== "POST") {
      sendMethodNotAllowed(res, ["POST"]);
      return;
    }
    if (rejectCrossOrigin(req, res, context.port)) return;
    if (!isJsonContentType(headerValue(req.headers["content-type"]))) {
      sendJson(res, 415, {
        error: "Content-Type must be application/json.",
      });
      return;
    }
    await handleContinueProject(req, res, continueMatch[1]!, context);
    return;
  }

  const chapterMatch = /^\/api\/projects\/([^/]+)\/chapters\/(\d+)$/.exec(
    pathname,
  );
  if (chapterMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    const chapterNumber = Number.parseInt(chapterMatch[2]!, 10);
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      sendJson(res, 400, { error: "Invalid chapter number." });
      return;
    }
    await handleGetChapter(res, chapterMatch[1]!, chapterNumber, context);
    return;
  }

  const promptLogMatch = /^\/api\/projects\/([^/]+)\/prompt-log$/.exec(
    pathname,
  );
  if (promptLogMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    await handleGetPromptLog(res, promptLogMatch[1]!, url, context);
    return;
  }

  const foreshadowMatch = /^\/api\/projects\/([^/]+)\/foreshadows$/.exec(
    pathname,
  );
  if (foreshadowMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }
    await handleGetForeshadows(res, foreshadowMatch[1]!, url, context);
    return;
  }

  const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(manuscript|chapters|toc|graph))?$/.exec(
    pathname,
  );
  if (projectMatch) {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"]);
      return;
    }

    const projectId = projectMatch[1]!;
    const artifact = projectMatch[2];

    if (artifact === "manuscript") {
      await handleGetManuscript(res, projectId, context);
      return;
    }
    if (artifact === "chapters") {
      await handleGetChapters(res, projectId, context);
      return;
    }
    if (artifact === "toc") {
      await handleGetToc(res, projectId, context);
      return;
    }
    if (artifact === "graph") {
      await handleGetGraph(res, projectId, context);
      return;
    }

    await handleGetProject(res, projectId, context);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  const host = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const outputDir = resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const fakeDefault = options.fakeDefault ?? process.env.NOVELBUILDER_FAKE === "1";
  const settingsPath = options.settingsPath
    ? resolve(options.settingsPath)
    : resolve(
        process.env.NOVELBUILDER_AGENT_DIR?.trim() || ".agent",
        "settings.json",
      );
  const runsDir = options.runsDir
    ? resolve(options.runsDir)
    : resolve(dirname(settingsPath), "runs");

  const store = new JsonProjectStore(outputDir);
  const runStore = new RunRecordStore(runsDir);
  const graph = options.graph ?? createNovelGraph();
  const runs = new Map<string, RunState>();

  // A "running" record left on disk means the previous process stopped while
  // the task was in flight. Surface it as a failure instead of hiding it.
  try {
    const interrupted = await runStore.failInterrupted(
      "服务重启，任务已中断。请重新开始或从书架继续。",
    );
    for (const record of interrupted) {
      const project = await store
        .getProject(record.projectId)
        .catch(() => undefined);
      if (project?.status === "running") {
        await store
          .saveProject({ ...project, status: "failed" })
          .catch(() => undefined);
      }
    }
  } catch (error) {
    logServerError(error);
  }

  const context: ServerContext = {
    store,
    settings: new JsonSettingsStore(settingsPath),
    graph,
    runs,
    runStore,
    outputDir,
    fakeDefault,
    port: requestedPort,
    ...(options.gatewayFactory === undefined
      ? {}
      : { gatewayFactory: options.gatewayFactory }),
    ...(options.directorSessionFactory === undefined
      ? {}
      : { directorSessionFactory: options.directorSessionFactory }),
  };

  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    void handleRequest(req, res, context).catch((error: unknown) => {
      logServerError(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendInternalError(res);
    });
  });

  server.on("error", (error) => {
    logServerError(error);
  });

  const port = await new Promise<number>((resolvePromise, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP address."));
        return;
      }
      resolvePromise(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(requestedPort, host);
  });

  context.port = port;

  let closePromise: Promise<void> | undefined;

  function close(): Promise<void> {
    if (!closePromise) {
      closePromise = (async () => {
        for (const run of runs.values()) {
          if (run.status === "running") run.controller.abort();
          clearHeartbeat(run);
        }

        await Promise.allSettled(
          Array.from(runs.values(), (run) => run.completion),
        );

        await runStore.flush().catch(() => undefined);

        for (const run of runs.values()) endClients(run);

        await new Promise<void>((resolvePromise, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolvePromise();
          });
          server.closeIdleConnections();
          server.closeAllConnections();
        });

        await graph.close().catch(() => undefined);
      })();
    }

    return closePromise;
  }

  return { server, port, close, store, graph, runs, runStore };
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath !== undefined && resolve(invokedPath) === resolve(modulePath)) {
  try {
    const started = await startServer();
    process.stdout.write(
      `NovelBuilder listening on http://${DEFAULT_HOST}:${started.port}\n`,
    );
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
