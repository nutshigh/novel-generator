import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model, ModelsSimpleStreamOptions, TextContent } from "@earendil-works/pi-ai";
import type { AgentRuntimeConfig } from "../config.js";
import type { ModelProtocol } from "../settings.js";
import type { AiGateway, GenerateRequest } from "./gateway.js";
import { MAX_OUTPUT_TOKENS } from "./limits.js";

export interface ModelConfigInput {
  protocol: ModelProtocol;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface CustomModelConfig extends ModelConfigInput {
  agentDir: string;
}

export const UI_PROVIDER = "novelbuilder-ui";
/**
 * Permissive context ceiling for UI-configured models. The provider still
 * enforces its real limits; this only prevents the pi SDK from clamping the
 * requested output budget based on its conservative 128k default.
 */
const UI_MODEL_CONTEXT_WINDOW = 1_048_576;
/** An empty answer is usually transient; retry once before failing a chapter. */
const MAX_EMPTY_TEXT_ATTEMPTS = 2;
const PROTOCOL_APIS: Record<ModelProtocol, "openai-completions" | "anthropic-messages"> = {
  openai: "openai-completions",
  anthropic: "anthropic-messages",
};

export function modelApiForProtocol(
  protocol: ModelProtocol,
): "openai-completions" | "anthropic-messages" {
  return PROTOCOL_APIS[protocol];
}

export interface NormalizedModelConfig {
  api: "openai-completions" | "anthropic-messages";
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface PiGatewayConfig {
  provider: string;
  modelId: string;
  apiKey?: string;
  agentDir: string;
  modelsPath?: string;
}

export type PiGatewayConfigInput = PiGatewayConfig | AgentRuntimeConfig;

export class PiAiGateway implements AiGateway {
  private readonly config: Required<Pick<PiGatewayConfig, "provider" | "modelId" | "agentDir">> &
    Pick<PiGatewayConfig, "apiKey" | "modelsPath">;
  private runtime?: ModelRuntime;
  private model?: Model<Api>;
  private initializing?: Promise<void>;

  constructor(config: PiGatewayConfigInput) {
    this.config = {
      provider: config.provider,
      modelId: config.modelId,
      apiKey: config.apiKey,
      agentDir: resolve(config.agentDir),
      modelsPath: config.modelsPath ? resolve(config.modelsPath) : undefined,
    };
  }

  async initialize(): Promise<void> {
    if (this.runtime && this.model) return;

    if (!this.initializing) {
      this.initializing = this.load();
    }

    try {
      await this.initializing;
    } catch (error) {
      this.initializing = undefined;
      throw error;
    }
  }

  async generateText(req: GenerateRequest): Promise<string> {
    await this.initialize();

    if (!this.runtime || !this.model) {
      throw new Error("Pi gateway failed to initialize.");
    }

    const options: ModelsSimpleStreamOptions = {};
    if (req.temperature !== undefined) options.temperature = req.temperature;
    if (req.maxTokens !== undefined) options.maxTokens = req.maxTokens;
    if (req.signal !== undefined) options.signal = req.signal;

    let lastStopReason: string | undefined;

    for (let attempt = 1; attempt <= MAX_EMPTY_TEXT_ATTEMPTS; attempt += 1) {
      if (req.signal?.aborted) {
        throw new Error("Model request aborted.");
      }

      const response = await this.runtime.completeSimple(
        this.model,
        {
          systemPrompt: req.system,
          messages: [{ role: "user", content: req.user, timestamp: Date.now() }],
        },
        options,
      );

      if (response.stopReason === "error") {
        throw new Error(
          response.errorMessage?.trim() || "Model request failed.",
        );
      }

      if (response.stopReason === "aborted") {
        throw new Error("Model request aborted.");
      }

      const text = response.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      if (text.trim().length > 0) {
        return text;
      }

      lastStopReason = response.stopReason;
    }

    throw new Error(
      `Model returned no text.${
        lastStopReason === undefined ? "" : ` stopReason=${lastStopReason}.`
      }`,
    );
  }

  private async load(): Promise<void> {
    await mkdir(this.config.agentDir, { recursive: true });

    const runtime = await ModelRuntime.create({
      authPath: resolve(this.config.agentDir, "auth.json"),
      modelsPath: this.config.modelsPath ?? null,
      refreshOnCreate: false,
    });

    if (this.config.apiKey) {
      await runtime.setRuntimeApiKey(this.config.provider, this.config.apiKey);
    }

    const model = runtime.getModel(this.config.provider, this.config.modelId);
    if (!model) {
      throw new Error(
        `Model not found: ${this.config.provider}/${this.config.modelId}`,
      );
    }

    this.runtime = runtime;
    this.model = model;
  }
}

export async function createPiGateway(
  config: PiGatewayConfigInput,
): Promise<PiAiGateway> {
  const gateway = new PiAiGateway(config);
  await gateway.initialize();
  return gateway;
}

export function normalizeModelConfig(config: ModelConfigInput): NormalizedModelConfig {
  const protocol = config.protocol;
  if (protocol !== "openai" && protocol !== "anthropic") {
    throw new Error('protocol must be either "openai" or "anthropic".');
  }

  const model = config.model?.trim();
  if (!model) {
    throw new Error("model must be a non-empty string.");
  }

  const baseUrlInput = config.baseUrl?.trim();
  if (!baseUrlInput) {
    throw new Error("baseUrl must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrlInput);
  } catch {
    throw new Error("baseUrl must be a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must be a valid http(s) URL.");
  }

  if (config.apiKey !== undefined && typeof config.apiKey !== "string") {
    throw new Error("apiKey must be a string when provided.");
  }
  const apiKey = config.apiKey?.trim() || undefined;

  return {
    api: modelApiForProtocol(protocol),
    baseUrl: parsed.toString().replace(/\/+$/, ""),
    model,
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

export async function createPiGatewayFromModelConfig(
  config: CustomModelConfig,
): Promise<PiAiGateway> {
  const normalized = normalizeModelConfig(config);
  const agentDir = resolve(config.agentDir);
  const runtimeModelsDir = resolve(agentDir, "runtime-models");

  await mkdir(runtimeModelsDir, { recursive: true });
  const tempDir = await mkdtemp(join(runtimeModelsDir, "models-"));
  const modelsPath = join(tempDir, "models.json");

  try {
    const models = {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers: {
        [UI_PROVIDER]: {
          baseUrl: normalized.baseUrl,
          api: normalized.api,
          models: [
            {
              id: normalized.model,
              contextWindow: UI_MODEL_CONTEXT_WINDOW,
              maxTokens: MAX_OUTPUT_TOKENS,
            },
          ],
        },
      },
    };
    await writeFile(modelsPath, `${JSON.stringify(models, null, 2)}\n`, "utf8");

    return await createPiGateway({
      provider: UI_PROVIDER,
      modelId: normalized.model,
      ...(normalized.apiKey === undefined ? {} : { apiKey: normalized.apiKey }),
      agentDir,
      modelsPath,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
