import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DigestForeshadow,
  ForeshadowLedgerEntry,
  ForeshadowState,
  ForeshadowStatus,
} from "./schemas.js";

export type ForeshadowAction =
  | "setup"
  | "progress"
  | "payoff"
  | "abandon"
  | "update"
  | "mention";

export interface ForeshadowRecord {
  id: number;
  projectId: string;
  title: string;
  setupChapter: number;
  plannedPayoffChapter?: number;
  resolvedChapter?: number;
  status: ForeshadowStatus;
  note: string;
  updatedAtChapter: number;
}

export interface ForeshadowUpdateInput {
  title: string;
  chapterNumber: number;
  action: ForeshadowAction;
  note?: string;
  setupChapter?: number;
  payoffChapter?: number;
  status?: ForeshadowStatus;
}

export interface ListForeshadowsOptions {
  upToChapter?: number;
  statuses?: readonly ForeshadowStatus[];
}

export interface ForeshadowStore {
  seed(projectId: string, entries: readonly ForeshadowLedgerEntry[]): void;
  importState(
    projectId: string,
    chapterNumber: number,
    entries: readonly ForeshadowState[],
  ): void;
  list(projectId: string, options?: ListForeshadowsOptions): ForeshadowRecord[];
  listForChapter(projectId: string, chapterNumber: number): ForeshadowRecord[];
  upsert(projectId: string, input: ForeshadowUpdateInput): ForeshadowRecord;
  applyDigest(
    projectId: string,
    chapterNumber: number,
    entries: readonly DigestForeshadow[],
  ): void;
  resetFromChapter(projectId: string, chapterNumber: number): void;
  toStoryState(projectId: string, chapterNumber: number): ForeshadowState[];
  close(): void;
}

interface ForeshadowRow {
  id: number;
  project_id: string;
  title: string;
  setup_chapter: number;
  planned_payoff_chapter: number | null;
  resolved_chapter: number | null;
  status: string;
  note: string;
  updated_at_chapter: number;
}

interface EventRow {
  title: string;
  chapter_number: number;
  action: string;
  from_status: string | null;
  to_status: string;
  note: string;
}

const OPEN_STATUSES: readonly ForeshadowStatus[] = [
  "planned",
  "open",
  "progressed",
];

function now(): string {
  return new Date().toISOString();
}

function isClosed(status: ForeshadowStatus): boolean {
  return status === "resolved" || status === "abandoned";
}

function statusAfter(
  current: ForeshadowStatus | undefined,
  action: ForeshadowAction,
  explicit?: ForeshadowStatus,
): ForeshadowStatus {
  if (action === "update" && explicit) return explicit;

  switch (action) {
    case "setup":
      return "open";
    case "progress":
      return "progressed";
    case "payoff":
      return "resolved";
    case "abandon":
      return "abandoned";
    case "update":
    case "mention":
      return current ?? "open";
  }
}

function toRecord(row: ForeshadowRow): ForeshadowRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    setupChapter: row.setup_chapter,
    ...(row.planned_payoff_chapter === null
      ? {}
      : { plannedPayoffChapter: row.planned_payoff_chapter }),
    ...(row.resolved_chapter === null
      ? {}
      : { resolvedChapter: row.resolved_chapter }),
    status: row.status as ForeshadowStatus,
    note: row.note,
    updatedAtChapter: row.updated_at_chapter,
  };
}

/**
 * SQLite-backed foreshadow ledger. A project gets its own database file under
 * its artifact directory; in-memory stores use an in-memory database.
 */
export class SqliteForeshadowStore implements ForeshadowStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string | undefined) {
    const path = databasePath ?? ":memory:";
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS foreshadows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        setup_chapter INTEGER NOT NULL DEFAULT 1,
        planned_payoff_chapter INTEGER,
        resolved_chapter INTEGER,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        updated_at_chapter INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, title)
      );

      CREATE TABLE IF NOT EXISTS foreshadow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        action TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(project_id, title, chapter_number, action, note)
      );

      CREATE INDEX IF NOT EXISTS idx_foreshadows_project
        ON foreshadows(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_foreshadow_events_project
        ON foreshadow_events(project_id, chapter_number);
    `);
  }

  seed(projectId: string, entries: readonly ForeshadowLedgerEntry[]): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO foreshadows (
        project_id, title, setup_chapter, planned_payoff_chapter,
        status, note, updated_at_chapter, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', 0, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE foreshadows
      SET setup_chapter = ?,
          planned_payoff_chapter = CASE WHEN ? IS NULL THEN planned_payoff_chapter ELSE ? END,
          updated_at = ?
      WHERE project_id = ? AND title = ?
    `);
    const timestamp = now();

    for (const entry of entries) {
      const status: ForeshadowStatus =
        entry.status === "planned" && entry.setupChapter <= 1
          ? "open"
          : entry.status;
      insert.run(
        projectId,
        entry.title,
        entry.setupChapter,
        entry.payoffChapter,
        status,
        timestamp,
        timestamp,
      );
      update.run(
        entry.setupChapter,
        entry.payoffChapter,
        entry.payoffChapter,
        timestamp,
        projectId,
        entry.title,
      );
    }
  }

  importState(
    projectId: string,
    chapterNumber: number,
    entries: readonly ForeshadowState[],
  ): void {
    const timestamp = now();
    const select = this.db.prepare(
      "SELECT id FROM foreshadows WHERE project_id = ? AND title = ?",
    );
    const insert = this.db.prepare(`
      INSERT INTO foreshadows (
        project_id, title, setup_chapter, planned_payoff_chapter,
        resolved_chapter, status, note, updated_at_chapter, created_at, updated_at
      ) VALUES (?, ?, 1, NULL, NULL, ?, ?, ?, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE foreshadows
      SET status = ?, note = CASE WHEN ? = '' THEN note ELSE ? END,
          updated_at_chapter = CASE WHEN ? = 0 THEN updated_at_chapter ELSE ? END,
          updated_at = ?
      WHERE project_id = ? AND title = ?
    `);

    for (const entry of entries) {
      const existing = select.get(projectId, entry.title) as
        | { id: number }
        | undefined;
      const note = entry.note ?? "";
      if (!existing) {
        insert.run(
          projectId,
          entry.title,
          entry.status,
          note,
          chapterNumber,
          timestamp,
          timestamp,
        );
        continue;
      }
      update.run(
        entry.status,
        note,
        note,
        chapterNumber,
        chapterNumber,
        timestamp,
        projectId,
        entry.title,
      );
    }
  }

  list(
    projectId: string,
    options: ListForeshadowsOptions = {},
  ): ForeshadowRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM foreshadows WHERE project_id = ? ORDER BY setup_chapter, id",
      )
      .all(projectId) as unknown as ForeshadowRow[];
    const statuses = options.statuses;

    return rows
      .map(toRecord)
      .map((record) => this.projectForChapter(projectId, record, options.upToChapter))
      .filter((record) => {
        if (
          options.upToChapter !== undefined &&
          record.setupChapter > options.upToChapter
        ) {
          return false;
        }
        if (statuses && !statuses.includes(record.status)) return false;
        return true;
      });
  }

  /**
   * A rewritten or replayed run may know that a foreshadow pays off later.
   * Earlier chapter contexts must still see its earlier state, not the future
   * status or a missing record.
   */
  private projectForChapter(
    projectId: string,
    record: ForeshadowRecord,
    upToChapter: number | undefined,
  ): ForeshadowRecord {
    if (
      upToChapter === undefined ||
      record.resolvedChapter === undefined ||
      record.resolvedChapter <= upToChapter
    ) {
      return record;
    }

    const last = this.db
      .prepare(
        `SELECT title, chapter_number, action, from_status, to_status, note
         FROM foreshadow_events
         WHERE project_id = ? AND title = ? AND chapter_number <= ?
         ORDER BY chapter_number DESC, id DESC LIMIT 1`,
      )
      .get(projectId, record.title, upToChapter) as EventRow | undefined;

    if (!last) {
      return {
        ...record,
        status: record.setupChapter <= upToChapter ? "open" : "planned",
        resolvedChapter: undefined,
        note: "",
      };
    }

    return {
      ...record,
      status: last.to_status as ForeshadowStatus,
      resolvedChapter:
        last.to_status === "resolved" ? last.chapter_number : undefined,
      note: last.note,
      updatedAtChapter: last.chapter_number,
    };
  }

  listForChapter(projectId: string, chapterNumber: number): ForeshadowRecord[] {
    return this.list(projectId, { upToChapter: chapterNumber });
  }

  upsert(projectId: string, input: ForeshadowUpdateInput): ForeshadowRecord {
    const timestamp = now();
    const existing = this.find(projectId, input.title);
    const fromStatus = existing?.status;
    const toStatus = statusAfter(fromStatus, input.action, input.status);
    const requestedSetupChapter =
      input.setupChapter ?? input.chapterNumber;
    const setupChapter =
      existing === undefined
        ? requestedSetupChapter
        : Math.min(existing.setupChapter, requestedSetupChapter);
    const plannedPayoffChapter =
      input.payoffChapter ?? existing?.plannedPayoffChapter ?? null;
    const resolvedChapter =
      input.action === "payoff"
        ? input.chapterNumber
        : input.action === "progress" || input.action === "setup"
          ? null
          : (existing?.resolvedChapter ?? null);
    const note = input.note?.trim() ?? "";
    const effectiveNote = note.length > 0 ? note : (existing?.note ?? "");

    if (!existing) {
      this.db
        .prepare(`
          INSERT INTO foreshadows (
            project_id, title, setup_chapter, planned_payoff_chapter,
            resolved_chapter, status, note, updated_at_chapter,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          projectId,
          input.title,
          setupChapter,
          plannedPayoffChapter,
          resolvedChapter,
          toStatus,
          effectiveNote,
          input.chapterNumber,
          timestamp,
          timestamp,
        );
    } else {
      this.db
        .prepare(`
          UPDATE foreshadows
          SET setup_chapter = ?, planned_payoff_chapter = ?,
              resolved_chapter = ?, status = ?, note = ?,
              updated_at_chapter = ?, updated_at = ?
          WHERE project_id = ? AND title = ?
        `)
        .run(
          setupChapter,
          plannedPayoffChapter,
          resolvedChapter,
          toStatus,
          effectiveNote,
          input.chapterNumber,
          timestamp,
          projectId,
          input.title,
        );
    }

    this.appendEvent(
      projectId,
      input.title,
      input.chapterNumber,
      input.action,
      fromStatus ?? null,
      toStatus,
      note,
      timestamp,
    );

    return this.find(projectId, input.title)!;
  }

  applyDigest(
    projectId: string,
    chapterNumber: number,
    entries: readonly DigestForeshadow[],
  ): void {
    for (const entry of entries) {
      if (entry.action === "mention") {
        const existing = this.find(projectId, entry.title);
        if (!existing) continue;

        this.appendEvent(
          projectId,
          entry.title,
          chapterNumber,
          "mention",
          existing.status,
          existing.status,
          entry.note,
          now(),
        );
        continue;
      }

      this.upsert(projectId, {
        title: entry.title,
        chapterNumber,
        action: entry.action,
        note: entry.note,
        ...(entry.action === "setup"
          ? { setupChapter: chapterNumber }
          : {}),
        ...(entry.action === "payoff"
          ? { payoffChapter: chapterNumber }
          : {}),
      });
    }
  }

  resetFromChapter(projectId: string, chapterNumber: number): void {
    const affected = this.db
      .prepare(
        "SELECT DISTINCT title FROM foreshadow_events WHERE project_id = ? AND chapter_number >= ?",
      )
      .all(projectId, chapterNumber) as unknown as Array<{ title: string }>;

    this.db
      .prepare(
        "DELETE FROM foreshadow_events WHERE project_id = ? AND chapter_number >= ?",
      )
      .run(projectId, chapterNumber);

    for (const { title } of affected) {
      const last = this.db
        .prepare(
          `SELECT title, chapter_number, action, from_status, to_status, note
           FROM foreshadow_events
           WHERE project_id = ? AND title = ? AND chapter_number < ?
           ORDER BY chapter_number DESC, id DESC LIMIT 1`,
        )
        .get(projectId, title, chapterNumber) as EventRow | undefined;
      const record = this.find(projectId, title);
      if (!record) continue;

      if (last) {
        this.db
          .prepare(
            `UPDATE foreshadows
             SET status = ?, resolved_chapter = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
                 note = ?, updated_at_chapter = ?, updated_at = ?
             WHERE project_id = ? AND title = ?`,
          )
          .run(
            last.to_status,
            last.to_status,
            last.chapter_number,
            last.note,
            last.chapter_number,
            now(),
            projectId,
            title,
          );
        continue;
      }

      const fallbackStatus: ForeshadowStatus =
        record.setupChapter < chapterNumber ? "open" : "planned";
      this.db
        .prepare(
          `UPDATE foreshadows
           SET status = ?, resolved_chapter = NULL, note = '',
               updated_at_chapter = 0, updated_at = ?
           WHERE project_id = ? AND title = ?`,
        )
        .run(fallbackStatus, now(), projectId, title);
    }

    // Remove only foreshadows introduced by the rewritten range. Future
    // planned entries from the bible ledger must survive a middle rewrite.
    this.db
      .prepare(
        `DELETE FROM foreshadows
         WHERE project_id = ? AND setup_chapter >= ?
           AND id IN (
             SELECT f.id FROM foreshadows f
             JOIN foreshadow_events e
               ON e.project_id = f.project_id AND e.title = f.title
             WHERE f.project_id = ? AND e.chapter_number >= ?
           )
           AND id NOT IN (
             SELECT f.id FROM foreshadows f
             JOIN foreshadow_events e
               ON e.project_id = f.project_id AND e.title = f.title
             WHERE f.project_id = ? AND e.chapter_number < ?
           )`,
      )
      .run(
        projectId,
        chapterNumber,
        projectId,
        chapterNumber,
        projectId,
        chapterNumber,
      );
  }

  toStoryState(
    projectId: string,
    chapterNumber: number,
  ): ForeshadowState[] {
    return this.listForChapter(projectId, chapterNumber).map((record) => ({
      title: record.title,
      status: record.status,
      ...(record.note.length > 0 ? { note: record.note } : {}),
    }));
  }

  close(): void {
    this.db.close();
  }

  private find(projectId: string, title: string): ForeshadowRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM foreshadows WHERE project_id = ? AND title = ?")
      .get(projectId, title) as ForeshadowRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  private appendEvent(
    projectId: string,
    title: string,
    chapterNumber: number,
    action: ForeshadowAction,
    fromStatus: ForeshadowStatus | null,
    toStatus: ForeshadowStatus,
    note: string,
    timestamp: string,
  ): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO foreshadow_events (
          project_id, title, chapter_number, action,
          from_status, to_status, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        projectId,
        title,
        chapterNumber,
        action,
        fromStatus,
        toStatus,
        note,
        timestamp,
      );
  }
}

export function openForeshadowStore(
  store: { getProjectDir(id: string): string | undefined },
  projectId: string,
): ForeshadowStore {
  const projectDir = store.getProjectDir(projectId);
  return new SqliteForeshadowStore(
    projectDir === undefined ? undefined : join(projectDir, "story.db"),
  );
}

export function isResolvedForeshadow(record: ForeshadowRecord): boolean {
  return isClosed(record.status);
}

export function isOpenForeshadow(record: ForeshadowRecord): boolean {
  return OPEN_STATUSES.includes(record.status);
}
