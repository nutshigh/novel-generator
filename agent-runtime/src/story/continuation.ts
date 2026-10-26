import type { AiGateway } from "../ai/gateway.js";
import type {
  Chapter,
  Outline,
  Project,
  RunProgress,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";
import { buildBookGraph } from "../graph/build.js";
import type { NovelGraphStore } from "../graph/types.js";
import {
  PipelineAbortError,
  PipelineError,
  errorMessage,
  initialStoryState,
  throwIfAborted,
} from "./chapterRunner.js";
import {
  runDirectorRange,
  type DirectorSessionFactory,
} from "./director.js";
import {
  assembleManuscript,
  saveBookArtifacts,
  type Manuscript,
} from "./export.js";
import {
  flattenOutlineChapters,
  loadStoredChapters,
} from "./library.js";
import { extendOutline } from "./outlineExtension.js";
import {
  PromptLogWriter,
  withPromptLogging,
} from "./promptLog.js";
import { loadStorySetup } from "./setup.js";
import { smoothChapterBoundaries } from "./smoothing.js";

export interface ContinueNovelInput {
  projectId: string;
  fromChapter?: number;
  additionalChapters?: number;
  chapterCount?: number;
  ai: AiGateway;
  store: ProjectStore;
  graph?: NovelGraphStore;
  directorSessionFactory?: DirectorSessionFactory;
  reviewEnabled?: boolean;
  onProgress?: (event: RunProgress) => void;
  signal?: AbortSignal;
}

export interface ContinueNovelResult {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapters: Chapter[];
  manuscript: Manuscript;
  fromChapter: number;
  toChapter: number;
  extended: boolean;
}

export class ContinuationError extends PipelineError {
  readonly code: string;

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, undefined, options);
    this.name = "ContinuationError";
    this.code = code;
  }
}

interface ResolvedState {
  state: StoryState;
  warning?: string;
}

function resolveStateAt(
  chapters: readonly Chapter[],
  startChapter: number,
  bible: StoryBible,
): ResolvedState {
  if (startChapter <= 1) {
    return { state: initialStoryState(bible) };
  }

  const prior = [...chapters]
    .filter((chapter) => chapter.number < startChapter)
    .sort((left, right) => left.number - right.number);
  const snapshot = prior.filter((chapter) => chapter.stateSnapshot).at(-1);

  if (!snapshot?.stateSnapshot) {
    return {
      state: initialStoryState(bible),
      warning: `缺少第 ${startChapter - 1} 章之前的状态快照，已使用初始状态。`,
    };
  }

  if (snapshot.number === startChapter - 1) {
    return { state: snapshot.stateSnapshot };
  }

  return {
    state: snapshot.stateSnapshot,
    warning: `连续性状态来自第 ${snapshot.number} 章，第 ${
      snapshot.number + 1
    } 到 ${startChapter - 1} 章缺少状态快照。`,
  };
}

function isChapterWritten(chapter: Chapter): boolean {
  return chapter.text.trim().length > 0;
}

function validateRequestedRange(
  fromChapter: number,
  plannedChapters: number,
): void {
  if (!Number.isInteger(fromChapter) || fromChapter < 1) {
    throw new ContinuationError(
      "fromChapter must be a positive integer.",
      "invalid_chapter",
    );
  }
  if (fromChapter > plannedChapters) {
    throw new ContinuationError(
      `第 ${fromChapter} 章超出当前大纲范围（共 ${plannedChapters} 章）。`,
      "invalid_chapter",
    );
  }
}

function selectStartChapter(
  chapters: readonly Chapter[],
  outlineChapters: readonly { number: number }[],
  fromChapter: number | undefined,
): number {  if (fromChapter !== undefined) {
    validateRequestedRange(fromChapter, outlineChapters.length);
    return fromChapter;
  }

  const written = new Set(chapters.filter(isChapterWritten).map((chapter) => chapter.number));
  const firstMissing = outlineChapters.find((chapter) => !written.has(chapter.number));
  if (!firstMissing) {
    throw new ContinuationError(
      "当前大纲已全部写完。请使用“续写新章节”扩展大纲。",
      "outline_exhausted",
    );
  }
  return firstMissing.number;
}

function resolveEndChapter(
  startChapter: number,
  totalChapters: number,
  chapterCount: number | undefined,
): number {
  if (chapterCount === undefined) return totalChapters;
  if (!Number.isInteger(chapterCount) || chapterCount < 1) {
    throw new ContinuationError(
      "chapterCount must be a positive integer.",
      "invalid_chapter_count",
    );
  }
  return Math.min(totalChapters, startChapter + chapterCount - 1);
}

export async function continueNovel(
  input: ContinueNovelInput,
): Promise<ContinueNovelResult> {
  const {
    projectId,
    fromChapter,
    additionalChapters,
    chapterCount,
    ai,
    store,
    graph,
    onProgress,
    signal,
  } = input;
  const emit = (event: RunProgress): void => {
    onProgress?.(event);
  };
  const promptLog = new PromptLogWriter(store, projectId);
  const loggedAi = withPromptLogging(ai, promptLog);

  emit({ phase: "resume", message: "正在读取项目、大纲与既有章节…" });

  const existingProject = await store.getProject(projectId);
  if (!existingProject) {
    throw new ContinuationError("Project not found.", "project_not_found");
  }

  let setup: Awaited<ReturnType<typeof loadStorySetup>>;
  try {
    setup = await loadStorySetup(store, projectId);
  } catch (error) {
    throw new ContinuationError(
      `无法读取故事圣经或大纲：${errorMessage(error)}`,
      "outline_unavailable",
      { cause: error },
    );
  }

  let project =
    input.reviewEnabled === undefined
      ? setup.project
      : { ...setup.project, reviewEnabled: input.reviewEnabled };
  let outline = setup.outline;
  let bible = setup.bible;
  const outlineChapters = flattenOutlineChapters(outline);
  const stored = await loadStoredChapters(store, projectId, outlineChapters);
  let chapters = stored.chapters;

  emit({
    phase: "resume",
    message: `已读取 ${chapters.filter(isChapterWritten).length}/${
      outlineChapters.length
    } 章；本次从第 ${
      fromChapter ?? "第一个未完成章节"
    } 章开始。`,
  });

  let startChapter: number;
  let extended = false;

  if (additionalChapters !== undefined) {
    const written = new Set(
      chapters.filter(isChapterWritten).map((chapter) => chapter.number),
    );
    const missing = outlineChapters.filter((chapter) => !written.has(chapter.number));
    if (missing.length > 0) {
      throw new ContinuationError(
        `还有 ${missing.length} 章尚未写完，请先续写补齐第 ${missing[0]!.number} 章起的内容。`,
        "outline_incomplete",
      );
    }

    const lastChapter = [...chapters]
      .sort((left, right) => left.number - right.number)
      .at(-1);
    emit({
      phase: "outline",
      message: `正在扩展章节大纲（新增 ${additionalChapters} 章）…`,
    });
    const extensionStartedAt = Date.now();
    const extension = await extendOutline({
      project,
      bible,
      outline,
      chapters,
      additionalChapters,
      state: lastChapter?.stateSnapshot,
      ai: loggedAi,
      signal,
      onAttempt: (attempt, maxAttempts) => {
        emit({
          phase: "outline",
          message: `正在扩展大纲：等待模型返回（第 ${attempt}/${maxAttempts} 次尝试）…`,
        });
      },
    });

    project = extension.project;
    outline = extension.outline;
    bible = setup.bible;
    startChapter = extension.startChapter;
    extended = true;

    await store.saveArtifact(
      projectId,
      "outline.json",
      JSON.stringify(outline, null, 2),
    );
    emit({
      phase: "outline",
      message: `章节大纲已扩展：新增 ${additionalChapters} 章，共 ${flattenOutlineChapters(outline).length} 章。`,
      durationMs: Date.now() - extensionStartedAt,
    });
  } else {
    startChapter = selectStartChapter(chapters, outlineChapters, fromChapter);
  }

  const totalChapters = flattenOutlineChapters(outline).length;
  const endChapter = resolveEndChapter(startChapter, totalChapters, chapterCount);

  if (graph && graph.name !== "disabled") {
    emit({ phase: "graph", message: "正在同步知识图谱。" });
    try {
      await graph.rebuildBook(
        buildBookGraph({
          project,
          bible,
          outline,
          chapters: chapters.filter((chapter) => chapter.number < startChapter),
        }),
      );
      emit({ phase: "graph", message: "知识图谱已同步。" });
    } catch (error) {
      emit({
        phase: "graph",
        message: `知识图谱同步失败：${errorMessage(error)}`,
        error: errorMessage(error),
      });
    }
  }

  const invalidBeforeStart = stored.invalid.filter(
    (issue) => issue.number > 0 && issue.number < startChapter,
  );
  if (invalidBeforeStart.length > 0) {
    throw new ContinuationError(
      `第 ${invalidBeforeStart[0]!.number} 章的存档无法读取，无法保证续写连续性：${
        invalidBeforeStart[0]!.message
      }`,
      "artifact_invalid",
    );
  }

  let runningProject: Project = { ...project, status: "running" };
  await store.saveProject(runningProject);

  try {
    const resolved = resolveStateAt(chapters, startChapter, bible);
    if (resolved.warning) {
      emit({
        phase: "resume",
        message: resolved.warning,
        error: resolved.warning,
      });
    }

    emit({
      phase: "resume",
      message: extended
        ? `已扩展大纲，本次从第 ${startChapter} 章写到第 ${endChapter} 章。`
        : `本次从第 ${startChapter} 章写到第 ${endChapter} 章。`,
      chapterNumber: startChapter,
    });

    const result = await runDirectorRange({
      project,
      bible,
      outline,
      ai: loggedAi,
      store,
      chapters,
      state: resolved.state,
      startChapterNumber: startChapter,
      endChapterNumber: endChapter,
      ...(graph ? { graph } : {}),
      ...(input.directorSessionFactory === undefined
        ? {}
        : { sessionFactory: input.directorSessionFactory }),
      promptLogger: promptLog,
      signal,
      emit,
    });
    chapters = result.chapters;
    let finalState = result.state;

    const boundaries: Array<{ fromChapter: number; toChapter: number }> = [];
    if (startChapter > 1) {
      boundaries.push({
        fromChapter: startChapter - 1,
        toChapter: startChapter,
      });
    }
    for (let number = startChapter; number < endChapter; number += 1) {
      boundaries.push({ fromChapter: number, toChapter: number + 1 });
    }

    if (boundaries.length > 0 && project.reviewEnabled) {
      emit({
        phase: "continuity",
        message: `正在检查 ${boundaries.length} 处章节接缝…`,
      });
      try {
        const smoothed = await smoothChapterBoundaries({
          project,
          bible,
          outline,
          chapters,
          boundaries,
          ai: loggedAi,
          store,
          ...(signal === undefined ? {} : { signal }),
          emit,
          mode: "auto",
          refreshState: true,
        });
        chapters = smoothed.chapters;
        finalState = smoothed.state;
      } catch (error) {
        emit({
          phase: "continuity",
          message: `章节接缝检查失败，保留原文：${errorMessage(error)}`,
          error: errorMessage(error),
        });
      }
    }

    const orderedChapters = [...chapters].sort(
      (left, right) => left.number - right.number,
    );
    finalState =
      orderedChapters.filter((chapter) => chapter.stateSnapshot).at(-1)
        ?.stateSnapshot ?? finalState;

    throwIfAborted(signal);
    emit({ phase: "export", message: "正在整理手稿并写入项目档案。" });

    const writtenNumbers = new Set(
      chapters.filter(isChapterWritten).map((chapter) => chapter.number),
    );
    const allDone = flattenOutlineChapters(outline).every((chapter) =>
      writtenNumbers.has(chapter.number),
    );
    const manuscript = assembleManuscript(project, bible, outline, chapters);
    await saveBookArtifacts(store, projectId, manuscript);
    await store.saveArtifact(
      projectId,
      "outline.json",
      JSON.stringify(outline, null, 2),
    );
    await store.saveArtifact(
      projectId,
      "chapters.json",
      JSON.stringify(chapters, null, 2),
    );
    await store.saveArtifact(
      projectId,
      "state.json",
      JSON.stringify(finalState, null, 2),
    );

    runningProject = { ...project, status: allDone ? "completed" : "draft" };
    await store.saveProject(runningProject);
    emit({
      phase: "done",
      message: allDone
        ? "Novel completed."
        : `本次写作完成：第 ${startChapter} 至 ${endChapter} 章，全书已完成 ${writtenNumbers.size}/${totalChapters} 章。`,
    });

    return {
      project: runningProject,
      bible,
      outline,
      chapters,
      manuscript,
      fromChapter: startChapter,
      toChapter: endChapter,
      extended,
    };
  } catch (error) {
    let failure = error;
    if (signal?.aborted && !(error instanceof PipelineAbortError)) {
      failure = new PipelineAbortError(
        `Novel pipeline aborted during continuation from chapter ${startChapter}.`,
        startChapter,
        { cause: error },
      );
    }

    await store
      .saveProject({ ...runningProject, status: "failed" })
      .catch(() => undefined);
    emit({
      phase: "error",
      message: "续写失败。",
      error: errorMessage(failure),
    });
    throw failure;
  }
}
