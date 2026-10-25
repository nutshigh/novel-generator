import { isAbsolute, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, loadConfig } from "../src/config.js";

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NOVELBUILDER_PROVIDER: "novelbuilder",
    NOVELBUILDER_MODEL: "deepseek-chat",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("required values", () => {
    it("throws when provider is missing", () => {
      expect(() =>
        loadConfig({ NOVELBUILDER_MODEL: "deepseek-chat" } as NodeJS.ProcessEnv),
      ).toThrow(/NOVELBUILDER_PROVIDER/);
    });

    it("throws when provider is empty", () => {
      expect(() => loadConfig(env({ NOVELBUILDER_PROVIDER: "" }))).toThrow(
        /NOVELBUILDER_PROVIDER/,
      );
    });

    it("throws when provider is whitespace", () => {
      expect(() => loadConfig(env({ NOVELBUILDER_PROVIDER: "   " }))).toThrow(
        /NOVELBUILDER_PROVIDER/,
      );
    });

    it("throws when model is missing", () => {
      expect(() =>
        loadConfig({ NOVELBUILDER_PROVIDER: "novelbuilder" } as NodeJS.ProcessEnv),
      ).toThrow(/NOVELBUILDER_MODEL/);
    });

    it("throws when model is empty", () => {
      expect(() => loadConfig(env({ NOVELBUILDER_MODEL: "" }))).toThrow(
        /NOVELBUILDER_MODEL/,
      );
    });

    it("throws when model is whitespace", () => {
      expect(() => loadConfig(env({ NOVELBUILDER_MODEL: "   " }))).toThrow(
        /NOVELBUILDER_MODEL/,
      );
    });
  });

  describe("paths", () => {
    it("applies defaults relative to cwd", () => {
      const config = loadConfig(env());

      expect(config.provider).toBe("novelbuilder");
      expect(config.modelId).toBe("deepseek-chat");
      expect(config.agentDir).toBe(resolve(".agent"));
      expect(isAbsolute(config.agentDir)).toBe(true);
      expect(config.projectDir).toBe(resolve(".workspace"));
      expect(isAbsolute(config.projectDir)).toBe(true);
      expect(config.modelsPath).toBeUndefined();
    });

    it("resolves explicit agent and models paths", () => {
      const config = loadConfig(
        env({
          NOVELBUILDER_AGENT_DIR: "custom-agent",
          NOVELBUILDER_MODELS_PATH: "custom-agent/models.json",
        }),
      );

      expect(config.agentDir).toBe(resolve("custom-agent"));
      expect(isAbsolute(config.agentDir)).toBe(true);
      expect(config.modelsPath).toBe(resolve("custom-agent/models.json"));
      expect(isAbsolute(config.modelsPath ?? "")).toBe(true);
    });

    it("resolves an explicit project dir", () => {
      const config = loadConfig(env({ NOVELBUILDER_PROJECT_DIR: "custom-project" }));

      expect(config.projectDir).toBe(resolve("custom-project"));
      expect(isAbsolute(config.projectDir)).toBe(true);
    });

    it("treats an empty models path as absent", () => {
      expect(loadConfig(env({ NOVELBUILDER_MODELS_PATH: "" })).modelsPath).toBeUndefined();
    });

    it("treats a whitespace models path as absent", () => {
      expect(
        loadConfig(env({ NOVELBUILDER_MODELS_PATH: "   " })).modelsPath,
      ).toBeUndefined();
    });
  });

  describe("apiKey", () => {
    it("is undefined when absent", () => {
      expect(loadConfig(env()).apiKey).toBeUndefined();
    });

    it("is undefined when empty", () => {
      expect(loadConfig(env({ NOVELBUILDER_API_KEY: "" })).apiKey).toBeUndefined();
    });

    it("is undefined when whitespace", () => {
      expect(loadConfig(env({ NOVELBUILDER_API_KEY: "   " })).apiKey).toBeUndefined();
    });

    it("is trimmed when provided", () => {
      expect(loadConfig(env({ NOVELBUILDER_API_KEY: "  secret-key  " })).apiKey).toBe(
        "secret-key",
      );
    });
  });

  describe("systemPrompt", () => {
    it("defaults when absent", () => {
      expect(loadConfig(env()).systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it("defaults when empty", () => {
      expect(loadConfig(env({ NOVELBUILDER_SYSTEM_PROMPT: "" })).systemPrompt).toBe(
        DEFAULT_SYSTEM_PROMPT,
      );
    });

    it("defaults when whitespace", () => {
      expect(
        loadConfig(env({ NOVELBUILDER_SYSTEM_PROMPT: "   " })).systemPrompt,
      ).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it("is trimmed when provided", () => {
      expect(
        loadConfig(env({ NOVELBUILDER_SYSTEM_PROMPT: "  custom prompt  " })).systemPrompt,
      ).toBe("custom prompt");
    });
  });

  describe("process.env fallback", () => {
    it("reads process.env when no env argument is supplied", () => {
      vi.stubEnv("NOVELBUILDER_PROVIDER", "from-process");
      vi.stubEnv("NOVELBUILDER_MODEL", "process-model");

      const config = loadConfig();

      expect(config.provider).toBe("from-process");
      expect(config.modelId).toBe("process-model");
    });
  });
});
