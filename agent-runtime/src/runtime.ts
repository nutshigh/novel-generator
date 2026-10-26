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
  options: {
    customTools?: ToolDefinition[];
    systemPrompt?: string;
    sessionManager?: SessionManager;
  } = {},
): Promise<NovelAgentSession> {
  mkdirSync(config.agentDir, { recursive: true });
  mkdirSync(config.projectDir, { recursive: true });

  let modelsPath: string | null;
  if (config.modelsPath) {
    if (!existsSync(config.modelsPath)) {
      throw new Error(`Models file not found: ${config.modelsPath}`);
    }
    modelsPath = config.modelsPath;
  } else {
    modelsPath = null;
  }

  const modelRuntime = await ModelRuntime.create({
    authPath: resolve(config.agentDir, "auth.json"),
    modelsPath,
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
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    systemPromptOverride: () => options.systemPrompt ?? config.systemPrompt,
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
    sessionManager:
      options.sessionManager ??
      SessionManager.create(
        config.projectDir,
        resolve(config.agentDir, "sessions"),
      ),
    settingsManager,
  });

  return {
    session,
    dispose: () => session.dispose(),
  };
}
