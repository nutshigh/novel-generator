import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const tmpRoot = join(repoRoot, ".cache", "tmp");

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

describe("cli --dry-run", () => {
  it("loads config and reports the active tools without a model call", async () => {
    mkdirSync(tmpRoot, { recursive: true });
    const root = mkdtempSync(join(tmpRoot, "novelbuilder-cli-"));
    const agentDir = join(root, "agent");
    const projectDir = join(root, "workspace");
    const modelsPath = join(root, "models.json");

    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          novelbuilder: {
            baseUrl: "https://api.deepseek.com/v1",
            api: "openai-completions",
            models: [{ id: "deepseek-chat" }],
          },
        },
      }),
    );

    try {
      const result = await runCli(["--dry-run"], {
        ...process.env,
        NOVELBUILDER_PROVIDER: "novelbuilder",
        NOVELBUILDER_MODEL: "deepseek-chat",
        NOVELBUILDER_API_KEY: "",
        NOVELBUILDER_AGENT_DIR: agentDir,
        NOVELBUILDER_PROJECT_DIR: projectDir,
        NOVELBUILDER_MODELS_PATH: modelsPath,
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
        TMP: tmpRoot,
        TEMP: tmpRoot,
      });

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("dry-run ok");
      expect(result.stdout).toContain("model: novelbuilder/deepseek-chat");
      expect(result.stdout).toContain("tools: echo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
