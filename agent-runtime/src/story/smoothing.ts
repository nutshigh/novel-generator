import { createHash } from "node:crypto";
import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import {
  BoundaryAuditSchema,
  SeamRepairSchema,
  countWords,
  type BoundaryAction,
  type BoundaryAudit,
  type BoundaryRelation,
  type Chapter,
  type Outline,
  type Project,
  type RunProgress,
  type SeamRepair,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";
import {
  BOUNDARY_AUDIT_SYSTEM_PROMPT,
  SEAM_REPAIR_SYSTEM_PROMPT,
  buildBoundaryAuditUserPrompt,
  buildSeamRepairUserPrompt,
} from "../prompts/defaults.js";
import { chapterArtifactName } from "./library.js";
import {
  firstParagraphs,
  lastParagraphs,
  replaceFirstParagraphs,
  replaceLastParagraphs,
  splitParagraphs,
} from "./paragraphs.js";
import { applyStateToChapter, extractState, mergeState } from "./state.js";
import { initialStoryState } from "./chapterRunner.js";

const MAX_ATTEMPTS = 2;
const MAX_REPAIR_CHARS = 300;
const MAX_REPAIR_PARAGRAPHS = 2;
const REPORT_ARTIFACT = "continuity-report.json";
const SENTENCE_END = /[。！？…”」』.!?）)]$/u;
const MARKDOWN_OR_CHAPTER_HEADING =
  /(?:```|^#{1,6}\s|第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*章)/mu;

export interface ChapterBoundary {
  fromChapter: number;
  toChapter: number;
}

export type ContinuityStatus =
  | "ok"
  | "repaired"
  | "flagged"
  | "failed"
  | "unavailable"
  | "reported";

export interface ContinuityReportEntry {
  fromChapter: number;
  toChapter: number;
  relation: BoundaryRelation;
  action: BoundaryAction;
  status: ContinuityStatus;
  sourceHash: string;
  reason: string;
  before: {
    previousTail: string;
    nextHead: string;
  };
  after: {
    previousTail: string;
    nextHead: string;
  };
  notes: string;
}

export interface ContinuityReport {
  generatedAt: string;
  entries: ContinuityReportEntry[];
}

export interface SmoothChapterBoundariesInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapters: Chapter[];
  boundaries: ChapterBoundary[];
  ai: AiGateway;
  store: ProjectStore;
  signal?: AbortSignal;
  emit?: (event: RunProgress) => void;
  /** auto applies safe seam repairs; report only writes the audit report. */
  mode?: "auto" | "report";
  /** Ignore cached report entries and audit every boundary again. */
  force?: boolean;
  /** Re-extract continuity state for chapters whose seam was edited. */
  refreshState?: boolean;
  /** Independent audit passes per boundary; findings are merged conservatively. */
  auditPasses?: number;
}

export interface SmoothChapterBoundariesResult {
  chapters: Chapter[];
  state: StoryState;
  report: ContinuityReport;
  changedChapters: number[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function countChars(text: string): number {
  return Array.from(text).length;
}

function boundaryKey(fromChapter: number, toChapter: number): string {
  return `${fromChapter}-${toChapter}`;
}

function seamHash(
  previous: Chapter,
  next: Chapter,
): string {
  return createHash("sha256")
    .update(
      [
        String(previous.number),
        String(next.number),
        lastParagraphs(previous.text, 10),
        firstParagraphs(next.text, 10),
      ].join("\u0000"),
    )
    .digest("hex");
}

function preview(previous: Chapter, next: Chapter): ContinuityReportEntry["before"] {
  return {
    previousTail: lastParagraphs(previous.text, 2),
    nextHead: firstParagraphs(next.text, 2),
  };
}

async function readReport(
  store: ProjectStore,
  projectId: string,
): Promise<ContinuityReport | undefined> {
  const raw = await store.readArtifact(projectId, REPORT_ARTIFACT);
  if (raw === undefined) return undefined;

  try {
    const parsed = JSON.parse(raw) as Partial<ContinuityReport>;
    if (!Array.isArray(parsed.entries)) return undefined;
    return {
      generatedAt:
        typeof parsed.generatedAt === "string"
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      entries: parsed.entries,
    };
  } catch {
    return undefined;
  }
}

async function auditOnce(input: {
  previous: Chapter;
  next: Chapter;
  state?: StoryState;
  ai: AiGateway;
  signal?: AbortSignal;
}): Promise<BoundaryAudit> {
  const baseUser = buildBoundaryAuditUserPrompt({
    previous: input.previous,
    next: input.next,
    ...(input.state === undefined ? {} : { state: input.state }),
  });
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过 BoundaryAudit 校验：
${lastError}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须包含全部字段。`;

    const raw = await input.ai.generateText({
      kind: "boundary_audit",
      system: BOUNDARY_AUDIT_SYSTEM_PROMPT,
      user,
      temperature: 0.1,
      maxTokens: 8_000,
      signal: input.signal,
    });

    try {
      return parseWithSchema(BoundaryAuditSchema, raw);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new Error(
    `Boundary audit failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
  );
}

const FACT_STATUS_RANK: Record<
  BoundaryAudit["factChecks"][number]["status"],
  number
> = {
  continued: 0,
  deferred: 1,
  ignored: 2,
  contradicted: 3,
};

function mergeBoundaryAudits(audits: BoundaryAudit[]): BoundaryAudit {
  const first = audits[0];
  if (!first) throw new Error("Boundary audit returned no results.");
  if (audits.length === 1) return first;

  const relation: BoundaryRelation = audits.some(
    (audit) => audit.relation === "broken",
  )
    ? "broken"
    : audits.some((audit) => audit.relation === "continue")
      ? "continue"
      : "cut";

  const previousEndComplete = audits.every(
    (audit) => audit.previousEndComplete,
  );
  const nextStartAnchored = audits.every((audit) => audit.nextStartAnchored);
  const previousEndHookEffective = audits.every(
    (audit) => audit.previousEndHookEffective,
  );

  const factByKey = new Map<string, BoundaryAudit["factChecks"][number]>();
  for (const audit of audits) {
    for (const check of audit.factChecks) {
      const key = check.fact.trim();
      if (!key) continue;
      const existing = factByKey.get(key);
      if (
        !existing ||
        FACT_STATUS_RANK[check.status] > FACT_STATUS_RANK[existing.status]
      ) {
        factByKey.set(key, check);
      }
    }
  }

  const contradictions = Array.from(
    new Set(audits.flatMap((audit) => audit.contradictions)),
  );
  const danglingThreads = Array.from(
    new Set(audits.flatMap((audit) => audit.danglingThreads)),
  );

  let action: BoundaryAction = "none";
  if (contradictions.length > 0) {
    action = "flag";
  } else if (!previousEndComplete && !nextStartAnchored) {
    action = "both";
  } else if (!previousEndComplete) {
    action = "close_previous";
  } else if (!nextStartAnchored) {
    action = "anchor_next";
  } else if (audits.some((audit) => audit.action === "anchor_next")) {
    action = "anchor_next";
  }

  return {
    relation,
    previousEndComplete,
    previousEndHookEffective,
    nextStartAnchored,
    factChecks: [...factByKey.values()],
    danglingThreads,
    contradictions,
    action,
    reason: Array.from(
      new Set(audits.map((audit) => audit.reason).filter(Boolean)),
    ).join("；"),
    repairBrief:
      audits.find((audit) => audit.repairBrief.trim().length > 0)?.repairBrief ??
      "",
  };
}

async function auditBoundary(input: {
  previous: Chapter;
  next: Chapter;
  state?: StoryState;
  ai: AiGateway;
  signal?: AbortSignal;
  passes: number;
}): Promise<BoundaryAudit> {
  const requested = Number.isFinite(input.passes)
    ? Math.floor(input.passes)
    : 2;
  const passes = Math.max(1, Math.min(3, requested));
  const audits: BoundaryAudit[] = [];
  for (let pass = 0; pass < passes; pass += 1) {
    audits.push(
      await auditOnce({
        previous: input.previous,
        next: input.next,
        ...(input.state === undefined ? {} : { state: input.state }),
        ai: input.ai,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    );
  }
  return mergeBoundaryAudits(audits);
}

async function repairBoundary(input: {
  previous: Chapter;
  next: Chapter;
  audit: BoundaryAudit;
  state?: StoryState;
  ai: AiGateway;
  signal?: AbortSignal;
}): Promise<SeamRepair> {
  const baseUser = buildSeamRepairUserPrompt({
    previous: input.previous,
    next: input.next,
    audit: input.audit,
    ...(input.state === undefined ? {} : { state: input.state }),
  });
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过 SeamRepair 校验：
${lastError}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须包含全部字段。`;

    const raw = await input.ai.generateText({
      kind: "seam_repair",
      system: SEAM_REPAIR_SYSTEM_PROMPT,
      user,
      temperature: 0.3,
      maxTokens: 8_000,
      signal: input.signal,
    });

    try {
      return parseWithSchema(SeamRepairSchema, raw);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new Error(
    `Seam repair failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
  );
}

function validateRepair(repair: SeamRepair): void {
  const previousTail = repair.previousTail.trim();
  const nextHead = repair.nextHead.trim();

  if (previousTail.length === 0 && nextHead.length === 0) {
    throw new Error("Repair returned no seam text.");
  }

  for (const [label, text, paragraphs] of [
    ["previousTail", previousTail, repair.previousParagraphs],
    ["nextHead", nextHead, repair.nextParagraphs],
  ] as const) {
    if (text.length === 0) {
      if (paragraphs !== 0) {
        throw new Error(`${label} is empty but paragraph count is ${paragraphs}.`);
      }
      continue;
    }

    if (countChars(text) > MAX_REPAIR_CHARS) {
      throw new Error(`${label} exceeds ${MAX_REPAIR_CHARS} characters.`);
    }
    if (splitParagraphs(text).length > MAX_REPAIR_PARAGRAPHS) {
      throw new Error(`${label} exceeds ${MAX_REPAIR_PARAGRAPHS} paragraphs.`);
    }
    if (!SENTENCE_END.test(text)) {
      throw new Error(`${label} does not end with a complete sentence.`);
    }
    if (MARKDOWN_OR_CHAPTER_HEADING.test(text)) {
      throw new Error(`${label} contains Markdown or a chapter heading.`);
    }
  }
}

function applyRepair(
  previous: Chapter,
  next: Chapter,
  repair: SeamRepair,
): { previous: Chapter; next: Chapter } {
  let updatedPrevious = previous;
  let updatedNext = next;

  if (repair.previousTail.trim().length > 0) {
    const text = replaceLastParagraphs(
      previous.text,
      repair.previousTail,
      repair.previousParagraphs,
    );
    updatedPrevious = {
      ...previous,
      text,
      wordCount: countWords(text),
    };
  }

  if (repair.nextHead.trim().length > 0) {
    const text = replaceFirstParagraphs(
      next.text,
      repair.nextHead,
      repair.nextParagraphs,
    );
    updatedNext = {
      ...next,
      text,
      wordCount: countWords(text),
    };
  }

  return { previous: updatedPrevious, next: updatedNext };
}

/**
 * Make the audit's action follow its boolean findings. A general reviewer
 * sometimes asks to rewrite a flat-but-complete ending; that is a hook
 * quality preference, not a seam break, so it is not auto-applied.
 */
function normalizeAuditAction(audit: BoundaryAudit): BoundaryAudit {
  if (audit.action === "flag") return audit;

  const needsPrevious = !audit.previousEndComplete;
  const needsNext = !audit.nextStartAnchored;

  if (needsPrevious && needsNext) {
    return {
      ...audit,
      action: "both",
      reason: `${audit.reason}（上一章未收束且下一章缺锚点）`,
    };
  }
  if (needsPrevious) {
    return {
      ...audit,
      action: "close_previous",
      reason: `${audit.reason}（上一章最后一场戏未完成）`,
    };
  }
  if (needsNext) {
    return {
      ...audit,
      action: "anchor_next",
      reason: `${audit.reason}（下一章开头缺锚点）`,
    };
  }

  if (audit.action === "close_previous" || audit.action === "both") {
    return {
      ...audit,
      action: "none",
      reason: `${audit.reason}（章末动作完整，钩子偏静不自动改写）`,
    };
  }

  return audit;
}

function factCheckNotes(audit: BoundaryAudit): string {
  return audit.factChecks
    .map(
      (check) =>
        `${check.fact}=${check.status}${
          check.evidence.trim().length > 0 ? `（${check.evidence}）` : ""
        }`,
    )
    .join("；");
}

function reportEntry(input: {
  fromChapter: number;
  toChapter: number;
  relation: BoundaryRelation;
  action: BoundaryAction;
  status: ContinuityStatus;
  sourceHash: string;
  reason: string;
  before: ContinuityReportEntry["before"];
  after: ContinuityReportEntry["after"];
  notes: string;
}): ContinuityReportEntry {
  return { ...input };
}

async function refreshChangedState(input: {
  project: Project;
  bible: StoryBible;
  chapters: Chapter[];
  changedChapters: readonly number[];
  ai: AiGateway;
  signal?: AbortSignal;
  emit: (event: RunProgress) => void;
}): Promise<{ chapters: Chapter[]; state: StoryState }> {
  const changed = new Set(input.changedChapters);
  if (changed.size === 0) {
    const state =
      [...input.chapters]
        .sort((left, right) => left.number - right.number)
        .filter((chapter) => chapter.stateSnapshot)
        .at(-1)?.stateSnapshot ?? initialStoryState(input.bible);
    return { chapters: input.chapters, state };
  }

  const sorted = [...input.chapters].sort(
    (left, right) => left.number - right.number,
  );
  const firstChanged = Math.min(...changed);
  const before = sorted.filter((chapter) => chapter.number < firstChanged).at(-1);
  let state = before?.stateSnapshot ?? initialStoryState(input.bible);
  let stateDirty = false;
  const byNumber = new Map(sorted.map((chapter) => [chapter.number, chapter]));

  const reextract = async (chapter: Chapter): Promise<void> => {
    try {
      const extracted = await extractState({
        project: input.project,
        chapter,
        currentState: state,
        bible: input.bible,
        ai: input.ai,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      state = mergeState(state, extracted);
      const updated = applyStateToChapter(chapter, state);
      byNumber.set(chapter.number, updated);
      stateDirty = true;
      input.emit({
        phase: "state",
        message: `第 ${chapter.number} 章接缝修改后已重提状态。`,
        chapterNumber: chapter.number,
      });
    } catch (error) {
      input.emit({
        phase: "state",
        message: `第 ${chapter.number} 章接缝修改后状态重提失败：${errorMessage(
          error,
        )}`,
        chapterNumber: chapter.number,
        error: errorMessage(error),
      });
      if (chapter.stateSnapshot) state = chapter.stateSnapshot;
    }
  };

  for (const chapter of sorted) {
    if (chapter.number < firstChanged) continue;

    if (changed.has(chapter.number)) {
      await reextract(chapter);
    } else if (!stateDirty && chapter.stateSnapshot) {
      state = chapter.stateSnapshot;
    }
  }

  // The last chapter's snapshot is the one future continuations load. If it
  // was not edited itself, refresh it with the post-repair running state so
  // the next run does not inherit a pre-repair snapshot.
  const last = sorted.at(-1);
  if (stateDirty && last && !changed.has(last.number)) {
    await reextract(last);
  }

  return {
    chapters: sorted.map((chapter) => byNumber.get(chapter.number) ?? chapter),
    state,
  };
}

/**
 * Audits and repairs only the seams between adjacent chapters. It never
 * rewrites a chapter body; repairs are limited to the first/last two
 * paragraphs and 300 characters per side.
 */
export async function smoothChapterBoundaries(
  input: SmoothChapterBoundariesInput,
): Promise<SmoothChapterBoundariesResult> {
  const emit = input.emit ?? (() => undefined);
  const mode = input.mode ?? "auto";
  const chapters = [...input.chapters];
  const byNumber = new Map(chapters.map((chapter) => [chapter.number, chapter]));
  const existing = await readReport(input.store, input.project.id);
  const existingByKey = new Map(
    (existing?.entries ?? []).map((entry) => [
      boundaryKey(entry.fromChapter, entry.toChapter),
      entry,
    ]),
  );
  const entries: ContinuityReportEntry[] = [];
  const changed = new Set<number>();
  const seen = new Set<string>();

  const boundaries = [...input.boundaries]
    .filter((boundary) => {
      const key = boundaryKey(boundary.fromChapter, boundary.toChapter);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => left.fromChapter - right.fromChapter);

  for (const boundary of boundaries) {
    const key = boundaryKey(boundary.fromChapter, boundary.toChapter);
    const previous = byNumber.get(boundary.fromChapter);
    const next = byNumber.get(boundary.toChapter);

    if (!previous || !next || previous.text.trim().length === 0 || next.text.trim().length === 0) {
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝缺少正文，跳过。`,
        chapterNumber: boundary.fromChapter,
      });
      continue;
    }

    const before = preview(previous, next);
    const sourceHash = seamHash(previous, next);
    const cached = existingByKey.get(key);

    if (
      !input.force &&
      cached &&
      cached.sourceHash === sourceHash &&
      (cached.status === "ok" ||
        cached.status === "repaired" ||
        cached.status === "flagged")
    ) {
      entries.push(cached);
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝已检查过，跳过。`,
        chapterNumber: boundary.fromChapter,
      });
      continue;
    }

    emit({
      phase: "continuity",
      message: `正在检查第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝…`,
      chapterNumber: boundary.fromChapter,
    });

    let audit: BoundaryAudit;
    try {
      audit = await auditBoundary({
        previous,
        next,
        ...(previous.stateSnapshot === undefined
          ? {}
          : { state: previous.stateSnapshot }),
        ai: input.ai,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        passes: input.auditPasses ?? 2,
      });
    } catch (error) {
      entries.push(
        reportEntry({
          fromChapter: boundary.fromChapter,
          toChapter: boundary.toChapter,
          relation: "broken",
          action: "flag",
          status: "unavailable",
          sourceHash,
          reason: "接缝审计不可用。",
          before,
          after: before,
          notes: errorMessage(error),
        }),
      );
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝审计失败，跳过：${errorMessage(
          error,
        )}`,
        chapterNumber: boundary.fromChapter,
        error: errorMessage(error),
      });
      continue;
    }

    audit = normalizeAuditAction(audit);

    const contradictedFacts = audit.factChecks.filter(
      (check) => check.status === "contradicted",
    );
    const ignoredFacts = audit.factChecks.filter(
      (check) => check.status === "ignored",
    );
    const hasContradiction =
      audit.contradictions.length > 0 || contradictedFacts.length > 0;

    if (hasContradiction) {
      const baseEntry = {
        fromChapter: boundary.fromChapter,
        toChapter: boundary.toChapter,
        relation: audit.relation,
        action: audit.action,
        sourceHash,
        reason: audit.reason,
        before,
        after: before,
        notes: [
          audit.repairBrief,
          ...audit.contradictions,
          factCheckNotes(audit),
        ]
          .filter((value) => value.trim().length > 0)
          .join("；"),
      } as const;
      entries.push(reportEntry({ ...baseEntry, status: "flagged" }));
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝有事实矛盾，已标记待人工确认。`,
        chapterNumber: boundary.fromChapter,
        gate: "revise",
      });
      continue;
    }

    if (audit.action === "none" && ignoredFacts.length > 0) {
      audit = {
        ...audit,
        action: "anchor_next",
        repairBrief: `下一章开头必须交代上一章留下的硬约束：${ignoredFacts
          .map((check) => check.fact)
          .join("；")}`,
      };
    }

    const baseEntry = {
      fromChapter: boundary.fromChapter,
      toChapter: boundary.toChapter,
      relation: audit.relation,
      action: audit.action,
      sourceHash,
      reason: audit.reason,
      before,
      after: before,
      notes: audit.repairBrief,
    } as const;

    if (audit.action === "flag") {
      entries.push(
        reportEntry({
          ...baseEntry,
          status: "flagged",
          notes: [audit.repairBrief, factCheckNotes(audit)]
            .filter((value) => value.trim().length > 0)
            .join("；"),
        }),
      );
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝被标记为待人工确认。`,
        chapterNumber: boundary.fromChapter,
        gate: "revise",
      });
      continue;
    }

    if (audit.action === "none") {
      entries.push(reportEntry({ ...baseEntry, status: "ok" }));
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝正常（${audit.relation}）。`,
        chapterNumber: boundary.fromChapter,
      });
      continue;
    }

    if (mode === "report") {
      entries.push(reportEntry({ ...baseEntry, status: "reported" }));
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝需要修复（${audit.action}），当前为只报告模式。`,
        chapterNumber: boundary.fromChapter,
        gate: "revise",
      });
      continue;
    }

    let repair: SeamRepair;
    try {
      repair = await repairBoundary({
        previous,
        next,
        audit,
        ...(previous.stateSnapshot === undefined
          ? {}
          : { state: previous.stateSnapshot }),
        ai: input.ai,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      validateRepair(repair);
    } catch (error) {
      entries.push(
        reportEntry({
          ...baseEntry,
          status: "failed",
          notes: errorMessage(error),
        }),
      );
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝修复失败，保留原文：${errorMessage(
          error,
        )}`,
        chapterNumber: boundary.fromChapter,
        error: errorMessage(error),
      });
      continue;
    }

    let updatedPrevious = previous;
    let updatedNext = next;
    try {
      const applied = applyRepair(previous, next, repair);
      updatedPrevious = applied.previous;
      updatedNext = applied.next;
    } catch (error) {
      entries.push(
        reportEntry({
          ...baseEntry,
          status: "failed",
          notes: errorMessage(error),
        }),
      );
      emit({
        phase: "continuity",
        message: `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝修复结果无法拼接，保留原文：${errorMessage(
          error,
        )}`,
        chapterNumber: boundary.fromChapter,
        error: errorMessage(error),
      });
      continue;
    }

    byNumber.set(updatedPrevious.number, updatedPrevious);
    byNumber.set(updatedNext.number, updatedNext);
    if (updatedPrevious.text !== previous.text) changed.add(updatedPrevious.number);
    if (updatedNext.text !== next.text) changed.add(updatedNext.number);

    const after = preview(updatedPrevious, updatedNext);
    const afterHash = seamHash(updatedPrevious, updatedNext);
    let status: ContinuityStatus = "repaired";
    let notes = repair.notes;

    try {
      const reaudit = await auditBoundary({
        previous: updatedPrevious,
        next: updatedNext,
        ...(updatedPrevious.stateSnapshot === undefined
          ? {}
          : { state: updatedPrevious.stateSnapshot }),
        ai: input.ai,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        passes: input.auditPasses ?? 2,
      });

      if (reaudit.action !== "none") {
        const reauditHasContradiction =
          reaudit.contradictions.length > 0 ||
          reaudit.factChecks.some(
            (check) => check.status === "contradicted",
          );
        status = reauditHasContradiction ? "flagged" : "failed";
        notes = `复审仍需要处理：${reaudit.reason}${
          reaudit.repairBrief ? `；${reaudit.repairBrief}` : ""
        }`;
      }
    } catch (error) {
      status = "failed";
      notes = `复审不可用：${errorMessage(error)}`;
    }

    entries.push(
      reportEntry({
        ...baseEntry,
        action: audit.action,
        sourceHash: afterHash,
        status,
        after,
        notes,
      }),
    );

    emit({
      phase: "continuity",
      message:
        status === "repaired"
          ? `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝已修复（${audit.action}）。`
          : status === "flagged"
            ? `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝已修复，但仍有事实矛盾待人工确认。`
            : `第 ${boundary.fromChapter}→${boundary.toChapter} 章接缝已改但复审未通过，标记待人工确认。`,
      chapterNumber: boundary.fromChapter,
      gate: status === "repaired" ? "pass" : "revise",
    });
  }

  let finalChapters = chapters.map(
    (chapter) => byNumber.get(chapter.number) ?? chapter,
  );
  let finalState =
    [...finalChapters]
      .sort((left, right) => left.number - right.number)
      .filter((chapter) => chapter.stateSnapshot)
      .at(-1)?.stateSnapshot ?? initialStoryState(input.bible);

  if (input.refreshState !== false && changed.size > 0) {
    const refreshed = await refreshChangedState({
      project: input.project,
      bible: input.bible,
      chapters: finalChapters,
      changedChapters: [...changed],
      ai: input.ai,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      emit,
    });
    finalChapters = refreshed.chapters;
    finalState = refreshed.state;
  }

  for (const number of changed) {
    const chapter = finalChapters.find((candidate) => candidate.number === number);
    if (!chapter) continue;
    await input.store.saveArtifact(
      input.project.id,
      chapterArtifactName(number),
      JSON.stringify(chapter, null, 2),
    );
  }

  await input.store.saveArtifact(
    input.project.id,
    "chapters.json",
    JSON.stringify(finalChapters, null, 2),
  );

  const report: ContinuityReport = {
    generatedAt: new Date().toISOString(),
    entries,
  };
  await input.store.saveArtifact(
    input.project.id,
    REPORT_ARTIFACT,
    JSON.stringify(report, null, 2),
  );

  return {
    chapters: finalChapters,
    state: finalState,
    report,
    changedChapters: [...changed].sort((left, right) => left - right),
  };
}
