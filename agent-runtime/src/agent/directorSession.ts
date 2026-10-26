import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  UI_PROVIDER,
  normalizeModelConfig,
  type ModelConfigInput,
} from "../ai/piGateway.js";
import { loadConfig, type AgentRuntimeConfig } from "../config.js";
import type { PiEventLike } from "../events.js";
import { createNovelAgentSession } from "../runtime.js";
import type { DirectorSessionFactory } from "../story/director.js";

export interface DirectorModelHandle {
  config: AgentRuntimeConfig;
  cleanup(): Promise<void>;
}

export function createPiDirectorSessionFactory(
  config: AgentRuntimeConfig,
): DirectorSessionFactory {
  return {
    async create(input) {
      const runtime = await createNovelAgentSession(
        { ...config, projectDir: input.cwd },
        {
          customTools: input.tools,
          systemPrompt: input.systemPrompt,
          sessionManager: SessionManager.inMemory(),
        },
      );
      const onAbort = (): void => {
        void runtime.session.abort().catch(() => undefined);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      if (input.signal.aborted) onAbort();

      return {
        prompt: (text) => runtime.session.prompt(text),
        subscribe: (listener) =>
          runtime.session.subscribe((event) => {
            listener(event as unknown as PiEventLike);
          }),
        abort: () => runtime.session.abort(),
        dispose: () => {
          input.signal.removeEventListener("abort", onAbort);
          runtime.dispose();
        },
      };
    },
  };
}

/**
 * Builds an AgentRuntimeConfig for the models configured in the web UI. The
 * temporary models file must stay on disk while chapter sessions are created,
 * so the caller owns cleanup().
 */
export async function createDirectorModelHandle(
  modelConfig: ModelConfigInput,
  agentDir: string,
): Promise<DirectorModelHandle> {
  const normalized = normalizeModelConfig(modelConfig);
  const runtimeModelsDir = resolve(agentDir, "runtime-models");
  await mkdir(runtimeModelsDir, { recursive: true });
  const tempDir = await mkdtemp(join(runtimeModelsDir, "director-models-"));
  const modelsPath = join(tempDir, "models.json");
  const models = {
    $schema: "https://pi.dev/schemas/models.schema.json",
    providers: {
      [UI_PROVIDER]: {
        baseUrl: normalized.baseUrl,
        api: normalized.api,
        models: [
          {
            id: normalized.model,
            contextWindow: 1_048_576,
            maxTokens: MAX_OUTPUT_TOKENS,
          },
        ],
      },
    },
  };

  await writeFile(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf8");

  return {
    config: {
      provider: UI_PROVIDER,
      modelId: normalized.model,
      ...(normalized.apiKey === undefined ? {} : { apiKey: normalized.apiKey }),
      agentDir: resolve(agentDir),
      projectDir: resolve(agentDir),
      modelsPath,
      systemPrompt: "",
    },
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export function createEnvDirectorModelHandle(
  env: NodeJS.ProcessEnv = process.env,
): DirectorModelHandle {
  return {
    config: loadConfig(env),
    cleanup: async () => undefined,
  };
}
