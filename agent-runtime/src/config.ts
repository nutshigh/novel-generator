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
