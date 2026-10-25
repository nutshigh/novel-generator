import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunProgress } from "./domain/schemas.js";

export type RunKind = "setup" | "continuation";
export type RunStatus = "running" | "completed" | "failed";

export interface StoredRun {
  runId: string;
  projectId: string;
  projectTitle?: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  events: RunProgress[];
  error?: string;
  fromChapter?: number;
  toChapter?: number;
  extended?: boolean;
}

const MAX_STORED_EVENTS = 500;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isRetryableRenameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  const delays = [0, 10, 25, 50, 100, 200];
  let lastError: unknown;

  for (const wait of delays) {
    if (wait > 0) {
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, wait);
      });
    }
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRenameError(error)) throw error;
    }
  }

  throw lastError;
}

function isStoredRun(value: unknown): value is StoredRun {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<StoredRun>;
  return (
    typeof record.runId === "string" &&
    typeof record.projectId === "string" &&
    (record.kind === "setup" || record.kind === "continuation") &&
    (record.status === "running" ||
      record.status === "completed" ||
      record.status === "failed") &&
    typeof record.startedAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.events)
  );
}

function trimEvents(events: RunProgress[]): RunProgress[] {
  return events.length > MAX_STORED_EVENTS
    ? events.slice(events.length - MAX_STORED_EVENTS)
    : events;
}

/**
 * Persists run snapshots so a browser refresh (or a server restart) can still
 * tell what happened to a generation task. Writes are serialized per run.
 */
export class RunRecordStore {
  private readonly dir: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  private filePath(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`);
    }
    return join(this.dir, `${runId}.json`);
  }

  save(record: StoredRun): Promise<void> {
    const snapshot: StoredRun = {
      ...record,
      events: trimEvents(record.events.map((event) => ({ ...event }))),
    };
    return this.enqueue(record.runId, async () => {
      await mkdir(this.dir, { recursive: true });
      const target = this.filePath(record.runId);
      const tempPath = join(
        this.dir,
        `.${record.runId}.${process.pid}.${randomUUID()}.tmp`,
      );
      try {
        await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
        await renameWithRetry(tempPath, target);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async read(runId: string): Promise<StoredRun | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(runId), "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredRun(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Waits until all queued writes have settled. */
  async flush(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.allSettled(Array.from(this.queues.values()));
    }
  }

  async list(): Promise<StoredRun[]> {    let entries;
    try {
      entries = await readdir(this.dir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const records: StoredRun[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const runId = entry.name.slice(0, -".json".length);
      if (!RUN_ID_PATTERN.test(runId)) continue;
      const record = await this.read(runId).catch(() => undefined);
      if (record) records.push(record);
    }

    return records.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  /**
   * Marks runs that were still "running" when the process stopped as failed.
   * Returns the records that were changed.
   */
  async failInterrupted(reason: string): Promise<StoredRun[]> {
    const records = await this.list();
    const interrupted: StoredRun[] = [];
    const now = new Date().toISOString();

    for (const record of records) {
      if (record.status !== "running") continue;
      const failed: StoredRun = {
        ...record,
        status: "failed",
        updatedAt: now,
        error: reason,
        events: trimEvents([
          ...record.events,
          { phase: "error", message: reason, error: reason, at: now },
        ]),
      };
      await this.save(failed).catch(() => undefined);
      interrupted.push(failed);
    }

    return interrupted;
  }

  private enqueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(runId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.catch(() => undefined);
    this.queues.set(runId, tail);
    void tail.then(() => {
      if (this.queues.get(runId) === tail) this.queues.delete(runId);
    });
    return result;
  }
}
