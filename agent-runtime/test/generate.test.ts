import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempDir, removeTempDir } from "./temp.js";

function runGenerate(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/generate.ts", ...args],
      {
        cwd: process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

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

describe("generate CLI --fake", () => {
  it("generates a complete project without real model calls", async () => {
    const root = createTempDir("novelbuilder-generate-");
    const outDir = join(root, "output");

    try {
      const result = await runGenerate(
        [
          "一个少年在旧城意外觉醒。",
          "--fake",
          "--chapters",
          "2",
          "--words",
          "300",
          "--out",
          outDir,
        ],
        {
          ...process.env,
          TMP: resolve(process.cwd(), "..", ".cache", "tmp"),
          TEMP: resolve(process.cwd(), "..", ".cache", "tmp"),
        },
      );

      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain("[setup]");
      expect(result.stderr).toContain("[chapter 1]");
      expect(result.stderr).toContain("words");
      expect(result.stdout).toContain("output:");
      expect(result.stdout).toContain("manuscript:");

      const projectDirs = readdirSync(outDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      expect(projectDirs).toHaveLength(1);

      const projectDir = join(outDir, projectDirs[0]!);
      for (const name of [
        "project.json",
        "bible.json",
        "outline.json",
        "book.md",
        "book.txt",
      ]) {
        expect(existsSync(join(projectDir, name)), name).toBe(true);
      }

      const project = JSON.parse(
        readFileSync(join(projectDir, "project.json"), "utf8"),
      ) as { status: string; maxChapters: number; chapterWords: number };
      expect(project.status).toBe("completed");
      expect(project.maxChapters).toBe(2);
      expect(project.chapterWords).toBe(300);
    } finally {
      removeTempDir(root);
    }
  }, 45_000);
});
