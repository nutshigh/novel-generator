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
import { flattenChapters } from "./outline.js";
import {
  PromptLogWriter,
  withPromptLogging,
} from "./promptLog.js";
import { generateStorySetup } from "./setup.js";
import { smoothChapterBoundaries } from "./smoothing.js";

export { PipelineAbortError, PipelineError };

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function setupStepMessage(
  step: "bible" | "outline",
  status: "start" | "done",
  durationMs?: number,
  chapterCount?: number,
): string {
  const label = step === "bible" ? "故事圣经" : "章节大纲";
  if (status === "start") return `开始生成${label}`;
  const duration =
    durationMs === undefined ? "" : `，用时 ${formatDuration(durationMs)}`;
  if (step === "outline" && chapterCount !== undefined) {
    return `章节大纲已生成：${chapterCount} 章${duration}`;
  }
  return `${label}已生成${duration}`;
}

export interface RunNovelPipelineInput {
  project: Project;
  ai: AiGateway;
  store: ProjectStore;
  graph?: NovelGraphStore;
  directorSessionFactory?: DirectorSessionFactory;
  reviewEnabled?: boolean;
  onProgress?: (event: RunProgress) => void;
  signal?: AbortSignal;
}

export interface SetupPipelineInput {
  project: Project;
  ai: AiGateway;
  store: ProjectStore;
  graph?: NovelGraphStore;
  onProgress?: (event: RunProgress) => void;
  signal?: AbortSignal;
}

export interface SetupPipelineResult {
  project: Project;
  bible: StoryBible;
  outline: Outline;
}

/**
 * Generates only the story bible and outline. Chapters are written later from
 * the bookshelf, in user-selected batches.
 */
export async function runSetupPipeline(
  input: SetupPipelineInput,
): Promise<SetupPipelineResult> {
  const { project, ai, store, graph, onProgress, signal } = input;
  const emit = (event: RunProgress): void => {
    onProgress?.(event);
  };
  const promptLog = new PromptLogWriter(store, project.id);
  const loggedAi = withPromptLogging(ai, promptLog);

  const runningProject: Project = { ...project, status: "running" };
  await store.saveProject(runningProject);
  let currentProject = runningProject;
  let activeStep: "bible" | "outline" = "bible";

  try {
    throwIfAborted(signal);
    emit({ phase: "setup", message: "正在准备故事圣经与章节大纲。" });

    const setup = await generateStorySetup(currentProject, loggedAi, store, {
      signal,
      onStep: (step) => {
        if (step.status === "start") activeStep = step.step;
        emit({
          phase: step.step,
          message: setupStepMessage(
            step.step,
            step.status,
            step.durationMs,
            step.chapterCount,
          ),
          ...(step.durationMs === undefined
            ? {}
            : { durationMs: step.durationMs }),
        });
      },
      onAttempt: (attempt, maxAttempts) => {
        emit({
          phase: activeStep,
          message: `正在等待模型返回（第 ${attempt}/${maxAttempts} 次尝试）…`,
        });
      },
    });
    currentProject = setup.project;

    if (graph && graph.name !== "disabled") {
      emit({ phase: "graph", message: "正在同步知识图谱。" });
      try {
        await graph.rebuildBook(
          buildBookGraph({
            project: setup.project,
            bible: setup.bible,
            outline: setup.outline,
            chapters: [],
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

    const chapterCount = flattenChapters(setup.outline).length;
    emit({
      phase: "outline",
      message: `大纲就绪：共 ${chapterCount} 章。`,
    });

    const readyProject: Project = { ...setup.project, status: "draft" };
    await store.saveProject(readyProject);
    emit({ phase: "done", message: "大纲已就绪。" });

    return {
      project: readyProject,
      bible: setup.bible,
      outline: setup.outline,
    };
  } catch (error) {
    let failure = error;
    if (signal?.aborted && !(error instanceof PipelineAbortError)) {
      failure = new PipelineAbortError("Novel setup aborted.", undefined, {
        cause: error,
      });
    }

    await store
      .saveProject({ ...currentProject, status: "failed" })
      .catch(() => undefined);
    emit({
      phase: "error",
      message: "故事圣经或大纲生成失败。",
      error: errorMessage(failure),
    });
    throw failure;
  }
}


export interface PipelineResult {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapters: Chapter[];
  manuscript: Manuscript;
}

export async function runNovelPipeline(
  input: RunNovelPipelineInput,
): Promise<PipelineResult> {
  const { project, ai, store, graph, onProgress, signal } = input;
  const emit = (event: RunProgress): void => {
    onProgress?.(event);
  };
  const promptLog = new PromptLogWriter(store, project.id);
  const loggedAi = withPromptLogging(ai, promptLog);
  const configuredProject: Project =
    input.reviewEnabled === undefined
      ? project
      : { ...project, reviewEnabled: input.reviewEnabled };

  const runningProject: Project = { ...configuredProject, status: "running" };
  await store.saveProject(runningProject);
  let currentProject = runningProject;
  let activeStep: "bible" | "outline" = "bible";

  try {
    throwIfAborted(signal);
    emit({ phase: "setup", message: "正在准备故事圣经与章节大纲。" });

    const setup = await generateStorySetup(currentProject, loggedAi, store, {
      signal,
      onStep: (step) => {
        if (step.status === "start") activeStep = step.step;
        emit({
          phase: step.step,
          message: setupStepMessage(
            step.step,
            step.status,
            step.durationMs,
            step.chapterCount,
          ),
          ...(step.durationMs === undefined
            ? {}
            : { durationMs: step.durationMs }),
        });
      },
      onAttempt: (attempt, maxAttempts) => {
        emit({
          phase: activeStep,
          message: `正在等待模型返回（第 ${attempt}/${maxAttempts} 次尝试）…`,
        });
      },
    });
    currentProject = setup.project;

    if (graph && graph.name !== "disabled") {
      emit({ phase: "graph", message: "正在同步知识图谱。" });
      try {
        await graph.rebuildBook(
          buildBookGraph({
            project: setup.project,
            bible: setup.bible,
            outline: setup.outline,
            chapters: [],
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

    const outlineChapters = flattenChapters(setup.outline);
    emit({
      phase: "outline",
      message: `大纲就绪：共 ${outlineChapters.length} 章。`,
    });

    const state: StoryState = initialStoryState(setup.bible);
    const range = await runDirectorRange({
      project: setup.project,
      bible: setup.bible,
      outline: setup.outline,
      ai: loggedAi,
      store,
      chapters: [],
      state,
      startChapterNumber: 1,
      ...(graph ? { graph } : {}),
      ...(input.directorSessionFactory === undefined
        ? {}
        : { sessionFactory: input.directorSessionFactory }),
      promptLogger: promptLog,
      signal,
      emit,
    });
    let chapters = range.chapters;
    let finalState = range.state;

    const boundaries = [...chapters]
      .sort((left, right) => left.number - right.number)
      .slice(1)
      .map((chapter) => ({
        fromChapter: chapter.number - 1,
        toChapter: chapter.number,
      }));

    if (boundaries.length > 0 && setup.project.reviewEnabled) {
      emit({
        phase: "continuity",
        message: `正在检查 ${boundaries.length} 处章节接缝…`,
      });
      try {
        const smoothed = await smoothChapterBoundaries({
          project: setup.project,
          bible: setup.bible,
          outline: setup.outline,
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

    throwIfAborted(signal);
    emit({ phase: "export", message: "正在整理手稿并写入项目档案。" });

    const manuscript = assembleManuscript(
      setup.project,
      setup.bible,
      setup.outline,
      chapters,
    );
    await saveBookArtifacts(store, project.id, manuscript);
    await store.saveArtifact(
      project.id,
      "bible.json",
      JSON.stringify(setup.bible, null, 2),
    );
    await store.saveArtifact(
      project.id,
      "outline.json",
      JSON.stringify(setup.outline, null, 2),
    );
    await store.saveArtifact(
      project.id,
      "chapters.json",
      JSON.stringify(chapters, null, 2),
    );
    await store.saveArtifact(
      project.id,
      "state.json",
      JSON.stringify(finalState, null, 2),
    );

    const completedProject: Project = { ...setup.project, status: "completed" };
    await store.saveProject(completedProject);
    emit({ phase: "done", message: "任务已完成。" });

    return {
      project: completedProject,
      bible: setup.bible,
      outline: setup.outline,
      chapters,
      manuscript,
    };
  } catch (error) {
    let failure = error;
    if (signal?.aborted && !(error instanceof PipelineAbortError)) {
      const chapterNumber =
        error instanceof PipelineError ? error.chapterNumber : undefined;
      failure = new PipelineAbortError(
        chapterNumber === undefined
          ? "Novel pipeline aborted."
          : `Novel pipeline aborted during chapter ${chapterNumber}.`,
        chapterNumber,
        { cause: error },
      );
    }

    const failedProject: Project = { ...currentProject, status: "failed" };
    await store.saveProject(failedProject).catch(() => undefined);
    emit({
      phase: "error",
      message: "小说生成失败。",
      error: errorMessage(failure),
    });
    throw failure;
  }
}
