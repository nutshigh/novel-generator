import {
  ChapterSchema,
  OutlineSchema,
  type Chapter,
  type Outline,
  type OutlineChapter,
  type Project,
  type ProjectStatus,
} from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";

const OUTLINE_ARTIFACT = "outline.json";
const CHAPTERS_ARTIFACT = "chapters.json";

export type TocChapterStatus = "written" | "needs_attention" | "missing";

export interface BookSummary {
  id: string;
  title: string;
  premise: string;
  status: ProjectStatus;
  createdAt: string;
  plannedChapters: number;
  writtenChapters: number;
  wordCount: number;
  needsAttention: number;
  chapterWords: number;
  firstUnwrittenChapter: number | null;
  outlineReady: boolean;
  canExtend: boolean;
}

export interface TocChapter {
  number: number;
  title: string;
  summary: string;
  pov: string;
  cast: string[];
  goal: string;
  conflict: string;
  turn: string;
  reveal: string;
  hook: string;
  targetWords: number;
  status: TocChapterStatus;
  wordCount: number;
  hasText: boolean;
}

export interface TocStage {
  number: number;
  title: string;
  summary: string;
  chapters: TocChapter[];
}

export interface TocVolume {
  number: number;
  title: string;
  summary: string;
  stages: TocStage[];
}

export interface BookToc {
  project: Project;
  title: string;
  outlineReady: boolean;
  plannedChapters: number;
  writtenChapters: number;
  wordCount: number;
  needsAttention: number;
  firstUnwrittenChapter: number | null;
  canExtend: boolean;
  volumes: TocVolume[];
}

export interface InvalidChapter {
  number: number;
  message: string;
}

export interface StoredChapters {
  chapters: Chapter[];
  invalid: InvalidChapter[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function chapterArtifactName(chapterNumber: number): string {
  return `chapter-${String(chapterNumber).padStart(3, "0")}.json`;
}

export function flattenOutlineChapters(outline: Outline): OutlineChapter[] {
  return outline.volumes.flatMap((volume) =>
    volume.stages.flatMap((stage) => stage.chapters),
  );
}

function parseChapter(
  raw: string | undefined,
  expectedNumber: number,
  invalid: InvalidChapter[],
): Chapter | undefined {
  if (raw === undefined) return undefined;

  try {
    const chapter = ChapterSchema.parse(JSON.parse(raw));
    if (chapter.number !== expectedNumber) {
      invalid.push({
        number: expectedNumber,
        message: `Chapter artifact number ${chapter.number} does not match ${expectedNumber}.`,
      });
      return undefined;
    }
    return chapter;
  } catch (error) {
    invalid.push({ number: expectedNumber, message: errorMessage(error) });
    return undefined;
  }
}

async function loadLegacyChapters(
  store: ProjectStore,
  projectId: string,
  invalid: InvalidChapter[],
): Promise<Map<number, Chapter>> {
  const raw = await store.readArtifact(projectId, CHAPTERS_ARTIFACT);
  const chapters = new Map<number, Chapter>();
  if (raw === undefined) return chapters;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    invalid.push({ number: 0, message: `chapters.json: ${errorMessage(error)}` });
    return chapters;
  }

  if (!Array.isArray(parsed)) {
    invalid.push({ number: 0, message: "chapters.json is not an array." });
    return chapters;
  }

  for (const entry of parsed) {
    try {
      const chapter = ChapterSchema.parse(entry);
      chapters.set(chapter.number, chapter);
    } catch (error) {
      const number =
        typeof entry === "object" &&
        entry !== null &&
        "number" in entry &&
        typeof (entry as { number?: unknown }).number === "number"
          ? (entry as { number: number }).number
          : 0;
      invalid.push({ number, message: errorMessage(error) });
    }
  }

  return chapters;
}

/**
 * Loads chapters using per-chapter artifacts first, with chapters.json as a
 * fallback for older projects. Invalid artifacts are reported instead of
 * throwing so the library can still show the rest of the book.
 */
export async function loadStoredChapters(
  store: ProjectStore,
  projectId: string,
  outlineChapters: readonly OutlineChapter[],
): Promise<StoredChapters> {
  const invalid: InvalidChapter[] = [];
  const legacy = await loadLegacyChapters(store, projectId, invalid);
  const artifacts = new Set(await store.listArtifacts(projectId));
  const chapters: Chapter[] = [];
  const expectedNumbers =
    outlineChapters.length > 0
      ? outlineChapters.map((chapter) => chapter.number)
      : Array.from(legacy.keys()).sort((left, right) => left - right);

  for (const number of expectedNumbers) {
    const name = chapterArtifactName(number);
    if (!artifacts.has(name)) {
      const fallback = legacy.get(number);
      if (fallback) chapters.push(fallback);
      continue;
    }

    const chapter = parseChapter(
      await store.readArtifact(projectId, name),
      number,
      invalid,
    );
    if (chapter) {
      chapters.push(chapter);
      continue;
    }

    const fallback = legacy.get(number);
    if (fallback) chapters.push(fallback);
  }

  chapters.sort((left, right) => left.number - right.number);
  return { chapters, invalid };
}

async function readOutline(
  store: ProjectStore,
  projectId: string,
): Promise<Outline | undefined> {
  const raw = await store.readArtifact(projectId, OUTLINE_ARTIFACT);
  if (raw === undefined) return undefined;

  try {
    return OutlineSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function chapterStatus(chapter: Chapter): TocChapterStatus {
  if (chapter.status === "needs_attention") return "needs_attention";
  if (chapter.review !== undefined && chapter.review.gate !== "pass") {
    return "needs_attention";
  }
  return chapter.text.trim().length > 0 ? "written" : "missing";
}

function summarizeChapter(
  outlineChapter: OutlineChapter,
  stored: Chapter | undefined,
): TocChapter {
  if (!stored) {
    return {
      number: outlineChapter.number,
      title: outlineChapter.title,
      summary: outlineChapter.summary,
      pov: outlineChapter.pov,
      cast: outlineChapter.cast,
      goal: outlineChapter.goal,
      conflict: outlineChapter.conflict,
      turn: outlineChapter.turn,
      reveal: outlineChapter.reveal,
      hook: outlineChapter.hook,
      targetWords: outlineChapter.targetWords,
      status: "missing",
      wordCount: 0,
      hasText: false,
    };
  }

  return {
    number: outlineChapter.number,
    title: stored.title || outlineChapter.title,
    summary: outlineChapter.summary,
    pov: outlineChapter.pov,
    cast: outlineChapter.cast,
    goal: outlineChapter.goal,
    conflict: outlineChapter.conflict,
    turn: outlineChapter.turn,
    reveal: outlineChapter.reveal,
    hook: outlineChapter.hook,
    targetWords: outlineChapter.targetWords,
    status: chapterStatus(stored),
    wordCount: stored.wordCount,
    hasText: stored.text.trim().length > 0,
  };
}

function computedSummary(project: Project, toc: BookToc): BookSummary {
  return {
    id: project.id,
    title: toc.title,
    premise: project.premise,
    status: project.status,
    createdAt: project.createdAt,
    plannedChapters: toc.plannedChapters,
    writtenChapters: toc.writtenChapters,
    wordCount: toc.wordCount,
    needsAttention: toc.needsAttention,
    chapterWords: project.chapterWords,
    firstUnwrittenChapter: toc.firstUnwrittenChapter,
    outlineReady: toc.outlineReady,
    canExtend: toc.canExtend,
  };
}

async function buildToc(
  store: ProjectStore,
  project: Project,
): Promise<BookToc> {
  const outline = await readOutline(store, project.id);
  if (!outline) {
    return {
      project,
      title: project.premise.trim() || project.id,
      outlineReady: false,
      plannedChapters: 0,
      writtenChapters: 0,
      wordCount: 0,
      needsAttention: 0,
      firstUnwrittenChapter: null,
      canExtend: false,
      volumes: [],
    };
  }

  const outlineChapters = flattenOutlineChapters(outline);
  const stored = await loadStoredChapters(store, project.id, outlineChapters);
  const byNumber = new Map(stored.chapters.map((chapter) => [chapter.number, chapter]));
  let writtenChapters = 0;
  let wordCount = 0;
  let needsAttention = 0;
  let firstUnwrittenChapter: number | null = null;

  const volumes: TocVolume[] = outline.volumes.map((volume) => ({
    number: volume.number,
    title: volume.title,
    summary: volume.summary,
    stages: volume.stages.map((stage) => ({
      number: stage.number,
      title: stage.title,
      summary: stage.summary,
      chapters: stage.chapters.map((outlineChapter) => {
        const chapter = summarizeChapter(
          outlineChapter,
          byNumber.get(outlineChapter.number),
        );
        if (chapter.status === "missing") {
          if (firstUnwrittenChapter === null) {
            firstUnwrittenChapter = chapter.number;
          }
        } else {
          writtenChapters += 1;
          wordCount += chapter.wordCount;
          if (chapter.status === "needs_attention") needsAttention += 1;
        }
        return chapter;
      }),
    })),
  }));

  const plannedChapters = outlineChapters.length;
  const title =
    outline.volumes[0]?.title.trim() || project.premise.trim() || project.id;

  return {
    project,
    title,
    outlineReady: true,
    plannedChapters,
    writtenChapters,
    wordCount,
    needsAttention,
    firstUnwrittenChapter,
    canExtend: firstUnwrittenChapter === null,
    volumes,
  };
}

export async function loadBookToc(
  store: ProjectStore,
  projectId: string,
): Promise<BookToc | undefined> {
  const project = await store.getProject(projectId);
  if (!project) return undefined;
  return buildToc(store, project);
}

export async function listBooks(store: ProjectStore): Promise<BookSummary[]> {
  const projects = await store.listProjects();
  const books: BookSummary[] = [];

  for (const project of projects) {
    const toc = await buildToc(store, project);
    books.push(computedSummary(project, toc));
  }

  return books.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

export async function loadChapter(
  store: ProjectStore,
  projectId: string,
  chapterNumber: number,
): Promise<Chapter | undefined> {
  const raw = await store.readArtifact(
    projectId,
    chapterArtifactName(chapterNumber),
  );
  if (raw !== undefined) {
    try {
      const chapter = ChapterSchema.parse(JSON.parse(raw));
      if (chapter.number === chapterNumber) return chapter;
    } catch {
      // Fall back to chapters.json below.
    }
  }

  const legacy = await loadLegacyChapters(store, projectId, []);
  return legacy.get(chapterNumber);
}
