import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createNovelAgentSession } from "../src/runtime.js";
import { createTempDir, removeTempDir } from "./temp.js";

function tempDirs(): { agentDir: string; projectDir: string } {
  return {
    agentDir: createTempDir("novelbuilder-agent-"),
    projectDir: createTempDir("novelbuilder-project-"),
  };
}

describe("createNovelAgentSession", () => {
  it("throws a clear error for an unknown model", async () => {
    const { agentDir, projectDir } = tempDirs();

    try {
      await expect(
        createNovelAgentSession({
          provider: "missing-provider",
          modelId: "missing-model",
          agentDir,
          projectDir,
          systemPrompt: "test",
        }),
      ).rejects.toThrow(/Model not found: missing-provider\/missing-model/);
    } finally {
      removeTempDir(agentDir);
      removeTempDir(projectDir);
    }
  });

  it("throws a clear error when the configured models file is missing", async () => {
    const { agentDir, projectDir } = tempDirs();
    const modelsPath = join(agentDir, "missing-models.json");

    try {
      await expect(
        createNovelAgentSession({
          provider: "missing-provider",
          modelId: "missing-model",
          agentDir,
          projectDir,
          modelsPath,
          systemPrompt: "test",
        }),
      ).rejects.toThrow(`Models file not found: ${modelsPath}`);
    } finally {
      removeTempDir(agentDir);
      removeTempDir(projectDir);
    }
  });

  it("creates a session with only the echo tool", async () => {
    const probe = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    const model = probe.getModelsOfType("chat")[0];
    if (!model) {
      throw new Error("No chat model is available in the built-in catalog to test session creation.");
    }

    const { agentDir, projectDir } = tempDirs();

    try {
      const runtime = await createNovelAgentSession({
        provider: model.provider,
        modelId: model.id,
        agentDir,
        projectDir,
        systemPrompt: "test",
      });

      expect(runtime.session.getActiveToolNames()).toEqual(["echo"]);
      expect(() => runtime.dispose()).not.toThrow();
    } finally {
      removeTempDir(agentDir);
      removeTempDir(projectDir);
    }
  });
});
