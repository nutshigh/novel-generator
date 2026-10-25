import { describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "./temp.js";
import { JsonSettingsStore } from "../src/settings.js";

function createStore(prefix = "novelbuilder-settings-"): {
  dir: string;
  file: string;
  store: JsonSettingsStore;
} {
  const dir = createTempDir(prefix);
  const file = join(dir, "settings.json");
  return { dir, file, store: new JsonSettingsStore(file) };
}

describe("JsonSettingsStore", () => {
  it("returns undefined when the file does not exist", async () => {
    const { dir, store } = createStore();
    try {
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("persists and reads all fields", async () => {
    const { dir, file, store } = createStore();
    try {
      const saved = await store.patch({
        protocol: "openai",
        model: "  deepseek-chat  ",
        baseUrl: "  https://api.deepseek.com/v1  ",
        apiKey: "  sk-test  ",
      });

      expect(saved.protocol).toBe("openai");
      expect(saved.model).toBe("deepseek-chat");
      expect(saved.baseUrl).toBe("https://api.deepseek.com/v1");
      expect(saved.apiKey).toBe("sk-test");
      expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
        apiKey?: string;
      };
      expect(onDisk.apiKey).toBe("sk-test");

      expect(await store.read()).toMatchObject({
        protocol: "openai",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("merges partial patches and preserves an existing key", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({
        protocol: "anthropic",
        model: "claude-sonnet-4-5",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
      });

      await store.patch({ model: "claude-haiku-4-5" });
      await store.patch({ apiKey: "   " });

      expect(await store.read()).toMatchObject({
        protocol: "anthropic",
        model: "claude-haiku-4-5",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("clears the key with clearApiKey", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test", apiKey: "secret" });
      await store.patch({ clearApiKey: true });
      const stored = await store.read();
      expect(stored?.apiKey).toBeUndefined();
      expect(stored?.model).toBe("m");
    } finally {
      removeTempDir(dir);
    }
  });

  it("clears the whole file", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test", apiKey: "secret" });
      await store.clear();
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("treats malformed JSON as unconfigured", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(file, "{not json", "utf8");
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("treats an empty file as unconfigured", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(file, "", "utf8");
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("returns defaults for an empty object", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(file, "{}", "utf8");
      expect(await store.read()).toEqual({
        protocol: null,
        model: "",
        baseUrl: "",
        updatedAt: new Date(0).toISOString(),
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("trims padded values read from disk", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(
        file,
        JSON.stringify({
          protocol: " openai ",
          model: "  padded-model  ",
          baseUrl: "  https://padded.test/v1  ",
          apiKey: "  padded-key  ",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        "utf8",
      );
      expect(await store.read()).toEqual({
        protocol: "openai",
        model: "padded-model",
        baseUrl: "https://padded.test/v1",
        apiKey: "padded-key",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("strips a utf-8 bom before parsing", async () => {
    const { dir, file, store } = createStore();
    try {
      writeFileSync(
        file,
        `\uFEFF${JSON.stringify({
          protocol: "anthropic",
          model: "claude-sonnet-4-5",
          baseUrl: "https://api.anthropic.com",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })}`,
        "utf8",
      );
      expect((await store.read())?.model).toBe("claude-sonnet-4-5");
    } finally {
      removeTempDir(dir);
    }
  });

  it("does not create a file for an empty patch", async () => {
    const { dir, file, store } = createStore();
    try {
      const saved = await store.patch({});
      expect(saved.model).toBe("");
      expect(await store.read()).toBeUndefined();
      expect(existsSync(file)).toBe(false);
    } finally {
      removeTempDir(dir);
    }
  });

  it("treats clear on a missing file as a no-op", async () => {
    const { dir, store } = createStore();
    try {
      await store.clear();
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("does not bump updatedAt for an identical patch", async () => {
    const { dir, store } = createStore();
    try {
      const first = await store.patch({ model: "same-model" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await store.patch({ model: "same-model" });
      expect(second.updatedAt).toBe(first.updatedAt);
    } finally {
      removeTempDir(dir);
    }
  });

  it("writes the settings file with owner-only permissions", async () => {
    if (process.platform === "win32") return;

    const { dir, file, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      removeTempDir(dir);
    }
  });

  it("recovers the queue after a failed patch", async () => {
    const { dir, file, store } = createStore();
    try {
      mkdirSync(file);
      await expect(
        store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" }),
      ).rejects.toBeDefined();
      rmdirSync(file);
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" });
      expect((await store.read())?.model).toBe("m");
    } finally {
      removeTempDir(dir);
    }
  });

  it("applies clear after queued patches", async () => {
    const { dir, store } = createStore();
    try {
      const patching = store.patch({
        protocol: "openai",
        model: "m",
        baseUrl: "https://x.test",
      });
      const clearing = store.clear();
      await Promise.all([patching, clearing]);
      expect(await store.read()).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("clears the protocol when patched with an empty string", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" });
      await store.patch({ protocol: "" });
      expect((await store.read())?.protocol).toBeNull();
    } finally {
      removeTempDir(dir);
    }
  });

  it("lets clearApiKey win over a simultaneous apiKey", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test", apiKey: "old" });
      await store.patch({ apiKey: "new", clearApiKey: true });
      expect((await store.read())?.apiKey).toBeUndefined();
    } finally {
      removeTempDir(dir);
    }
  });

  it("creates missing parent directories", async () => {
    const { dir } = createStore();
    try {
      const nested = join(dir, "nested", "deeper", "settings.json");
      const nestedStore = new JsonSettingsStore(nested);
      await nestedStore.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" });
      expect((await nestedStore.read())?.model).toBe("m");
    } finally {
      removeTempDir(dir);
    }
  });

  it("leaves no temp files behind after a write", async () => {
    const { dir, store } = createStore();
    try {
      await store.patch({ protocol: "openai", model: "m", baseUrl: "https://x.test" });
      expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    } finally {
      removeTempDir(dir);
    }
  });

  it("never writes the api key to stderr", async () => {
    const { dir, file, store } = createStore();
    const secret = "stderr-secret-never-log";
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      writeFileSync(file, `{"apiKey":"${secret}",not json`, "utf8");
      expect(await store.read()).toBeUndefined();
      const logged = spy.mock.calls.map((call) => String(call[0])).join("");
      expect(logged).not.toContain(secret);
    } finally {
      spy.mockRestore();
      removeTempDir(dir);
    }
  });

  it("serializes concurrent patches", async () => {
    const { dir, store } = createStore();
    try {
      await Promise.all([
        store.patch({ model: "model-a" }),
        store.patch({ baseUrl: "https://example.com/v1" }),
        store.patch({ protocol: "anthropic" }),
      ]);

      expect(await store.read()).toMatchObject({
        protocol: "anthropic",
        model: "model-a",
        baseUrl: "https://example.com/v1",
      });
    } finally {
      removeTempDir(dir);
    }
  });

  it("serializes patches across store instances for the same file", async () => {
    const { dir, file } = createStore();
    const first = new JsonSettingsStore(file);
    const second = new JsonSettingsStore(file);
    try {
      await Promise.all([
        first.patch({ model: "model-a" }),
        second.patch({ baseUrl: "https://example.com/v1" }),
        first.patch({ protocol: "anthropic" }),
      ]);

      expect(await first.read()).toMatchObject({
        protocol: "anthropic",
        model: "model-a",
        baseUrl: "https://example.com/v1",
      });
    } finally {
      removeTempDir(dir);
    }
  });
});
