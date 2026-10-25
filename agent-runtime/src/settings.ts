import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ModelProtocol = "openai" | "anthropic";

export interface StoredSettings {
  protocol: ModelProtocol | null;
  model: string;
  baseUrl: string;
  apiKey?: string;
  updatedAt: string;
}

export interface SettingsPatch {
  protocol?: ModelProtocol | null | "";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface SettingsStore {
  read(): Promise<StoredSettings | undefined>;
  patch(patch: SettingsPatch): Promise<StoredSettings>;
  clear(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const queues = new Map<string, Promise<unknown>>();

function sameSettings(left: StoredSettings, right: StoredSettings): boolean {
  return (
    left.protocol === right.protocol &&
    left.model === right.model &&
    left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey
  );
}

function parseStored(value: unknown): StoredSettings | undefined {
  if (!isRecord(value)) return undefined;

  const rawProtocol =
    typeof value.protocol === "string" ? value.protocol.trim() : "";
  const protocol: ModelProtocol | null =
    rawProtocol === "openai" || rawProtocol === "anthropic"
      ? rawProtocol
      : null;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const baseUrl =
    typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const apiKey =
    typeof value.apiKey === "string" && value.apiKey.trim().length > 0
      ? value.apiKey.trim()
      : undefined;
  const updatedAt =
    typeof value.updatedAt === "string"
      ? value.updatedAt
      : new Date(0).toISOString();

  return {
    protocol,
    model,
    baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    updatedAt,
  };
}

export class JsonSettingsStore implements SettingsStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = resolve(filePath);
  }

  async read(): Promise<StoredSettings | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }

    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      process.stderr.write(
        `NovelBuilder: ignoring unreadable settings file ${this.filePath}\n`,
      );
      return undefined;
    }
    const parsed = parseStored(parsedJson);
    if (!parsed) {
      process.stderr.write(
        `NovelBuilder: ignoring invalid settings file ${this.filePath}\n`,
      );
    }
    return parsed;
  }

  async patch(patch: SettingsPatch): Promise<StoredSettings> {
    return this.enqueue(async () => {
      const current: StoredSettings = (await this.read()) ?? {
        protocol: null,
        model: "",
        baseUrl: "",
        updatedAt: new Date(0).toISOString(),
      };

      if (Object.keys(patch).length === 0) {
        return current;
      }

      const protocol =
        patch.protocol === undefined
          ? current.protocol
          : patch.protocol === ""
            ? null
            : patch.protocol;
      const next: StoredSettings = {
        protocol,
        model:
          patch.model === undefined ? current.model : patch.model.trim(),
        baseUrl:
          patch.baseUrl === undefined
            ? current.baseUrl
            : patch.baseUrl.trim(),
        updatedAt: new Date().toISOString(),
        ...(current.apiKey === undefined ? {} : { apiKey: current.apiKey }),
      };

      if (patch.clearApiKey) {
        delete next.apiKey;
      } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
        next.apiKey = patch.apiKey.trim();
      }

      if (sameSettings(next, current)) {
        return current;
      }

      await this.write(next);
      return next;
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.filePath, { force: true });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.filePath) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.catch(() => undefined);
    queues.set(this.filePath, tail);
    void tail.then(() => {
      if (queues.get(this.filePath) === tail) queues.delete(this.filePath);
    });
    return result;
  }

  private async write(settings: StoredSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await rename(tempPath, this.filePath);
          return;
        } catch (error) {
          lastError = error;
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? (error as { code?: unknown }).code
              : undefined;
          if (
            code !== "EEXIST" &&
            code !== "EPERM" &&
            code !== "EACCES" &&
            code !== "EBUSY"
          ) {
            throw error;
          }
          if (attempt < 2) {
            await new Promise<void>((resolvePromise) => {
              setTimeout(resolvePromise, 10 * (attempt + 1));
            });
          }
        }
      }
      throw lastError;
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
