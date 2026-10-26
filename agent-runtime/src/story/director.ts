import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AiGateway } from "../ai/gateway.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  openForeshadowStore,
  type ForeshadowRecord,
  type ForeshadowStore,
} from "../domain/foreshadowStore.js";
import type { ProjectStore } from "../domain/store.js";
import {
  countWords,
  type Chapter,
  type Outline,
  type OutlineChapter,
  type Project,
  type Review,
  type RunProgress,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import { normalizePiEvent, type PiEventLike } from "../events.js";
import type { NovelGraphStore } from "../graph/types.js";
import {
  CHAPTER_SYSTEM_PROMPT,
  DIRECTOR_SYSTEM_PROMPT,
  buildDirectorChapterUserPrompt,
} from "../prompts/defaults.js";
import {
  auditChapterEnding,
  finishChapter,
  reviewChapter,
  reviseChapter,
} from "./chapter.js";
import { PipelineError, compareRevision } from "./chapterRunner.js";
import { extractChapterMemory } from "./chapterMemory.js";
import {
  recentChaptersFor,
  selectChapterBriefBlocks,
  selectRollingSummaryBlocks,
  type ChapterBriefBlock,
  type ChapterSummaryBlock,
} from "./context.js";
import { chapterArtifactName } from "./library.js";
import { flattenChapters } from "./outline.js";
import {
  PromptLogWriter,
  promptLogReply,
  promptLogToolResults,
  type PromptLogReply,
  type PromptLogToolResult,
} from "./promptLog.js";
import { appendReviewLog } from "./reviewLog.js";
import { applyStateToChapter, extractState, mergeState } from "./state.js";
import { createChapterTools, type ChapterToolContext } from "../tools/story.js";

const DEFAULT_MAX_TOOL_CALLS = 40;
const DEFAULT_CHAPTER_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REVISION_ROUNDS = 2;

export interface DirectorSession {
  prompt(text: string): Promise<void>;
  subscribe?(listener: (event: PiEventLike) => void): () => void;
  abort?(): Promise<void>;
  dispose(): void;
}

export interface DirectorSessionCreateInput {
  systemPrompt: string;
  tools: ToolDefinition[];
  cwd: string;
  signal: AbortSignal;
}

export interface DirectorSessionFactory {
  create(input: DirectorSessionCreateInput): Promise<DirectorSession>;
  cleanup?(): Promise<void>;
}

export interface RunDirectorInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  ai: AiGateway;
  store: ProjectStore;
  chapters: Chapter[];
  state: StoryState;
  startChapterNumber: number;
  endChapterNumber?: number;
  foreshadows?: ForeshadowStore;
  graph?: NovelGraphStore;
  sessionFactory?: DirectorSessionFactory;
  promptLogger?: PromptLogWriter;
  signal?: AbortSignal;
  emit?: (event: RunProgress) => void;
  maxToolCalls?: number;
  chapterTimeoutMs?: number;
}

export interface RunDirectorResult {
  chapters: Chapter[];
  state: StoryState;
}

export class DirectorError extends PipelineError {
  constructor(message: string, chapterNumber?: number, options?: ErrorOptions) {
    super(message, chapterNumber, options);
    this.name = "DirectorError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  chapterNumber: number,
): void {
  if (signal?.aborted) {
    throw new DirectorError(
      `Director aborted before chapter ${chapterNumber}.`,
      chapterNumber,
    );
  }
}

function completedStatus(chapter: Chapter, review: Review): Chapter["status"] {
  if (review.gate !== "pass") return "needs_attention";
  if (chapter.status === "needs_attention") return "needs_attention";
  return "committed";
}

async function applyQualityGate(input: {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  store: ProjectStore;
  chapter: Chapter;
  ai: AiGateway;
  recentChapters: Chapter[];
  chapterBriefs: ChapterBriefBlock[];
  summaries: ChapterSummaryBlock[];
  foreshadowLedger: ForeshadowRecord[];
  state: StoryState;
  emit: (event: RunProgress) => void;
  signal?: AbortSignal;
}): Promise<{ chapter: Chapter; review: Review }> {
  let chapter = input.chapter;
  let review = await reviewChapter({
    project: input.project,
    bible: input.bible,
    chapter,
    ai: input.ai,
    signal: input.signal,
  });
  let rounds = 0;
  const recordReview = async (
    current: Review,
    stage: "initial" | "rereview" | "ending_repair",
  ): Promise<void> => {
    input.emit({
      phase: "review",
      message: `第 ${chapter.number} 章审校${current.gate === "pass" ? "通过" : "需要关注"}${
        current.summary ? `：${current.summary}` : ""
      }`,
      chapterNumber: chapter.number,
      gate: current.gate,
    });
    try {
      await appendReviewLog(input.store, {
        type: "review",
        at: new Date().toISOString(),
        projectId: input.project.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        round: rounds,
        stage,
        wordCount: chapter.wordCount,
        review: current,
      });
    } catch {
      // Review logging must not block the chapter.
    }
  };

  await recordReview(review, "initial");

  while (review.gate === "revise" && rounds < MAX_REVISION_ROUNDS) {
    const originalChapter = chapter;
    const originalReview = review;
    const revisedChapter = await reviseChapter({
      project: input.project,
      bible: input.bible,
      chapter,
      review,
      ai: input.ai,
      signal: input.signal,
    });
    const revisedReview = await reviewChapter({
      project: input.project,
      bible: input.bible,
      chapter: revisedChapter,
      previousReview: originalReview,
      ai: input.ai,
      signal: input.signal,
    });
    const decision = compareRevision(
      originalChapter,
      originalReview,
      revisedChapter,
      revisedReview,
    );
    input.emit({
      phase: "revise",
      message: `第 ${chapter.number} 章修订${
        decision.accept ? "已采纳" : "未改善，保留原稿"
      }（${decision.reason}）。`,
      chapterNumber: chapter.number,
      gate: revisedReview.gate,
    });
    try {
      await appendReviewLog(input.store, {
        type: "revision_decision",
        at: new Date().toISOString(),
        projectId: input.project.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        round: rounds + 1,
        accepted: decision.accept,
        reason: decision.reason,
        originalWordCount: originalChapter.wordCount,
        revisedWordCount: revisedChapter.wordCount,
      });
    } catch {
      // Best effort.
    }
    if (!decision.accept) break;
    chapter = revisedChapter;
    review = revisedReview;
    rounds += 1;
    await recordReview(review, "rereview");
  }

  try {
    const audit = await auditChapterEnding({
      chapter,
      ai: input.ai,
      signal: input.signal,
    });
    try {
      await appendReviewLog(input.store, {
        type: "ending_audit",
        at: new Date().toISOString(),
        projectId: input.project.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        round: rounds,
        audit,
      });
    } catch {
      // Best effort.
    }
    if (!audit.complete) {
      chapter = await finishChapter({
        project: input.project,
        bible: input.bible,
        outline: input.outline,
        chapter,
        ai: input.ai,
        recentChapters: input.recentChapters,
        chapterBriefs: input.chapterBriefs,
        summaries: input.summaries,
        foreshadowLedger: input.foreshadowLedger,
        state: input.state,
        reason: audit.reason,
        missing: audit.missing,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      try {
        review = await reviewChapter({
          project: input.project,
          bible: input.bible,
          chapter,
          previousReview: review,
          ai: input.ai,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        await recordReview(review, "ending_repair");
      } catch {
        // Keep the previous review when the post-repair review fails.
      }
      try {
        const recheck = await auditChapterEnding({
          chapter,
          ai: input.ai,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        try {
          await appendReviewLog(input.store, {
            type: "ending_audit",
            at: new Date().toISOString(),
            projectId: input.project.id,
            chapterNumber: chapter.number,
            chapterTitle: chapter.title,
            round: rounds + 1,
            audit: recheck,
          });
        } catch {
          // Best effort.
        }
      } catch {
        // Keep the repaired chapter when the recheck fails.
      }
    }
  } catch {
    // Ending audit is best effort; a short chapter still keeps its review gate.
  }

  return {
    chapter: {
      ...chapter,
      review,
      status: completedStatus(chapter, review),
    },
    review,
  };
}

async function finalizeChapter(input: {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  store: ProjectStore;
  chapter: Chapter;
  chapters: readonly Chapter[];
  state: StoryState;
  foreshadows: ForeshadowStore;
  ai: AiGateway;
  graph?: NovelGraphStore;
  emit: (event: RunProgress) => void;
  signal?: AbortSignal;
}): Promise<{ chapter: Chapter; state: StoryState }> {
  const {
    project,
    bible,
    outline,
    chapters,
    foreshadows,
    ai,
    graph,
    emit,
    signal,
  } = input;
  const chapterNumber = input.chapter.number;
  const contextChapters = recentChaptersFor(chapters, chapterNumber);
  const memoryChapters = recentChaptersFor(chapters, chapterNumber, 4);
  const chapterBriefs = selectChapterBriefBlocks([...chapters], chapterNumber);
  const summaries = selectRollingSummaryBlocks(
    [...chapters],
    outline,
    chapterNumber,
  );
  const foreshadowLedger = foreshadows.listForChapter(project.id, chapterNumber);
  let chapter = input.chapter;
  let state = input.state;

  if (project.reviewEnabled) {
    try {
      const gated = await applyQualityGate({
        project,
        bible,
        outline,
        store: input.store,
        chapter,
        ai,
        recentChapters: contextChapters,
        chapterBriefs,
        summaries,
        foreshadowLedger,
        state,
        emit,
        ...(signal === undefined ? {} : { signal }),
      });
      chapter = gated.chapter;
    } catch (error) {
      emit({
        phase: "review",
        message: `第 ${chapterNumber} 章审核失败，保留导演稿：${errorMessage(error)}`,
        chapterNumber,
        error: errorMessage(error),
      });
    }
  }

  try {
    const memory = await extractChapterMemory({
      chapter,
      previousChapters: memoryChapters,
      foreshadows: foreshadows.listForChapter(project.id, chapterNumber),
      ai,
      signal,
    });
    chapter = {
      ...chapter,
      digest: memory.digest,
      brief: memory.brief,
      summary: memory.summary,
    };
    foreshadows.applyDigest(
      project.id,
      chapterNumber,
      memory.digest.foreshadows,
    );
  } catch (error) {
    emit({
      phase: "state",
      message: `第 ${chapterNumber} 章档案提取失败，继续保存正文：${errorMessage(
        error,
      )}`,
      chapterNumber,
      error: errorMessage(error),
    });
  }

  emit({
    phase: "state",
    message: `第 ${chapterNumber} 章正在提取连续性状态…`,
    chapterNumber,
  });
  try {
    const extracted = await extractState({
      project,
      chapter,
      currentState: state,
      bible,
      ai,
      signal,
      onWarning: (message) => {
        emit({
          phase: "state",
          message: `第 ${chapterNumber} 章状态警告：${message}`,
          chapterNumber,
          error: message,
        });
      },
    });
    const merged = mergeState(state, extracted);
    merged.foreshadows = foreshadows.toStoryState(project.id, chapterNumber);
    chapter = applyStateToChapter(chapter, merged);
    state = merged;
    emit({
      phase: "state",
      message: `第 ${chapterNumber} 章状态已更新。`,
      chapterNumber,
    });
  } catch (error) {
    state = {
      ...state,
      foreshadows: foreshadows.toStoryState(project.id, chapterNumber),
    };
    emit({
      phase: "state",
      message: `第 ${chapterNumber} 章状态提取失败，继续使用上一章状态：${errorMessage(
        error,
      )}`,
      chapterNumber,
      error: errorMessage(error),
    });
  }

  if (
    !project.reviewEnabled &&
    chapter.status !== "needs_attention" &&
    chapter.wordCount >= chapter.outline.targetWords * 0.9
  ) {
    chapter = { ...chapter, status: "committed" };
  }

  await saveChapterArtifacts(input.project, input.store, chapter, chapters);
  if (graph) {
    try {
      await graph.indexChapter(project.id, bible, chapter);
    } catch (error) {
      emit({
        phase: "graph",
        message: `第 ${chapterNumber} 章知识图谱更新失败：${errorMessage(error)}`,
        chapterNumber,
        error: errorMessage(error),
      });
    }
  }

  return { chapter, state };
}

async function saveChapterArtifacts(
  project: Project,
  store: ProjectStore,
  chapter: Chapter,
  chapters: readonly Chapter[],
): Promise<void> {
  const next = [...chapters];
  const index = next.findIndex((candidate) => candidate.number === chapter.number);
  if (index >= 0) next[index] = chapter;
  else next.push(chapter);
  next.sort((left, right) => left.number - right.number);

  await store.saveArtifact(
    project.id,
    chapterArtifactName(chapter.number),
    JSON.stringify(chapter, null, 2),
  );
  await store.saveArtifact(
    project.id,
    "chapters.json",
    JSON.stringify(next, null, 2),
  );
}

async function runScriptedChapter(input: {
  prompt: string;
  chapter: OutlineChapter;
  ai: AiGateway;
  tools: ToolDefinition[];
  signal?: AbortSignal;
}): Promise<void> {
  const text = await input.ai.generateText({
    kind: "chapter",
    system: CHAPTER_SYSTEM_PROMPT,
    user: input.prompt,
    temperature: 0.8,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const commit = input.tools.find((tool) => tool.name === "chapter_commit");
  if (!commit) {
    throw new Error("chapter_commit tool is not registered.");
  }
  const execute = commit.execute as unknown as (
    id: string,
    params: unknown,
  ) => Promise<unknown>;
  await execute("scripted-chapter", {
    chapterNumber: input.chapter.number,
    text,
  });
}

/**
 * Director loop: one agent session per chapter. The session writes prose and
 * submits it through chapter_commit; the host then builds memory, updates the
 * foreshadow ledger and extracts continuity state.
 */
export async function runDirectorRange(
  input: RunDirectorInput,
): Promise<RunDirectorResult> {
  const emit = input.emit ?? (() => undefined);
  const endChapterNumber =
    input.endChapterNumber ?? flattenChapters(input.outline).length;
  const chapters = [...input.chapters];
  let state = input.state;
  const ownsForeshadows = input.foreshadows === undefined;
  const foreshadows =
    input.foreshadows ?? openForeshadowStore(input.store, input.project.id);
  const maxToolCalls = input.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const chapterTimeoutMs =
    input.chapterTimeoutMs ?? DEFAULT_CHAPTER_TIMEOUT_MS;
  const promptLog =
    input.promptLogger ??
    new PromptLogWriter(input.store, input.project.id);

  try {
    foreshadows.seed(input.project.id, input.bible.foreshadowLedger);
    if (state.foreshadows.length > 0) {
      foreshadows.importState(input.project.id, 0, state.foreshadows);
    }

    const rewriting = chapters.some(
      (chapter) => chapter.number >= input.startChapterNumber,
    );
    if (rewriting) {
      foreshadows.resetFromChapter(input.project.id, input.startChapterNumber);
    }

    for (const outlineChapter of flattenChapters(input.outline)) {
      if (outlineChapter.number < input.startChapterNumber) continue;
      if (outlineChapter.number > endChapterNumber) continue;
      throwIfAborted(input.signal, outlineChapter.number);

      const contextChapters = recentChaptersFor(chapters, outlineChapter.number);
      const chapterBriefs = selectChapterBriefBlocks(
        chapters,
        outlineChapter.number,
      );
      const summaries = selectRollingSummaryBlocks(
        chapters,
        input.outline,
        outlineChapter.number,
      );
      const foreshadowLedger = foreshadows.listForChapter(
        input.project.id,
        outlineChapter.number,
      );
      let graphContext: string | undefined;
      if (input.graph) {
        try {
          graphContext = await input.graph.buildChapterContext({
            bookId: input.project.id,
            chapterNumber: outlineChapter.number,
            cast: outlineChapter.cast,
          });
        } catch (error) {
          emit({
            phase: "graph",
            message: `第 ${outlineChapter.number} 章知识图谱上下文不可用：${errorMessage(
              error,
            )}`,
            chapterNumber: outlineChapter.number,
            error: errorMessage(error),
          });
        }
      }

      const basePrompt = buildDirectorChapterUserPrompt({
        project: input.project,
        bible: input.bible,
        outlineChapter,
        nextOutlineChapter: flattenChapters(input.outline).find(
          (chapter) => chapter.number === outlineChapter.number + 1,
        ),
        recentChapters: contextChapters,
        chapterBriefs,
        summaries,
        foreshadowLedger,
        cast: input.bible.characters.filter((character) =>
          outlineChapter.cast.includes(character.name),
        ),
        state,
        foreshadow: [],
        targetWords: outlineChapter.targetWords,
      });
      const prompt =
        graphContext === undefined
          ? basePrompt
          : `${basePrompt}\n\n${graphContext}`;

      emit({
        phase: "write",
        message: `第 ${outlineChapter.number} 章导演会话开始（目标 ${outlineChapter.targetWords} 字）。`,
        chapterNumber: outlineChapter.number,
      });

      const chapterAi: AiGateway = {
        generateText: (req) =>
          input.ai.generateText({
            ...req,
            chapterNumber: outlineChapter.number,
          }),
      };

      const toolContext: ChapterToolContext = {
        project: input.project,
        bible: input.bible,
        outline: input.outline,
        store: input.store,
        foreshadows,
        ...(input.graph === undefined ? {} : { graph: input.graph }),
        chapters,
        state,
        targetChapter: outlineChapter,
        startChapterNumber: input.startChapterNumber,
        endChapterNumber,
        maxToolCalls,
        toolCallCount: 0,
        emit: (event) => emit(event),
      };
      const toolset = createChapterTools(toolContext);
      let session: DirectorSession | undefined;
      let promptRound = 0;
      let activeRound:
        | { replies: PromptLogReply[]; toolResults: PromptLogToolResult[] }
        | undefined;
      const sessionAbort = new AbortController();
      const onAbort = (): void => sessionAbort.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(
        () => sessionAbort.abort(),
        chapterTimeoutMs,
      );

      try {
        if (input.sessionFactory) {
          const activeSession = await input.sessionFactory.create({
            systemPrompt: DIRECTOR_SYSTEM_PROMPT,
            tools: toolset.tools,
            cwd:
              input.store.getProjectDir(input.project.id) ?? process.cwd(),
            signal: sessionAbort.signal,
          });
          session = activeSession;

          if (activeSession.subscribe) {
            activeSession.subscribe((event) => {
              if (event.type === "turn_end" && activeRound) {
                activeRound.replies.push(promptLogReply(event.message));
                activeRound.toolResults.push(
                  ...promptLogToolResults(event.toolResults),
                );
              }

              const normalized = normalizePiEvent(event);
              if (!normalized) return;
              if (normalized.type === "tool.start") {
                emit({
                  phase: "director",
                  message: `第 ${outlineChapter.number} 章导演调用 ${normalized.toolName}…`,
                  chapterNumber: outlineChapter.number,
                });
              }
              if (normalized.type === "tool.end") {
                emit({
                  phase: "director",
                  message: `第 ${outlineChapter.number} 章导演工具 ${normalized.toolName} ${
                    normalized.isError ? "失败" : "完成"
                  }。`,
                  chapterNumber: outlineChapter.number,
                  ...(normalized.isError ? { error: "tool failed" } : {}),
                });
              }
            });
          }

          const sendPrompt = async (text: string): Promise<void> => {
            promptRound += 1;
            const round = promptRound;
            const startedAt = Date.now();
            const capture = {
              replies: [] as PromptLogReply[],
              toolResults: [] as PromptLogToolResult[],
            };
            activeRound = capture;
            const entry = {
              at: new Date().toISOString(),
              projectId: input.project.id,
              source: "director" as const,
              kind: "chapter",
              chapterNumber: outlineChapter.number,
              round,
              ...(round === 1
                ? { systemPrompt: DIRECTOR_SYSTEM_PROMPT }
                : {}),
              prompt: text,
            };

            try {
              await activeSession.prompt(text);
              await promptLog.append({
                ...entry,
                replies: capture.replies,
                ...(capture.toolResults.length === 0
                  ? {}
                  : { toolResults: capture.toolResults }),
                durationMs: Date.now() - startedAt,
              });
            } catch (error) {
              await promptLog.append({
                ...entry,
                replies: capture.replies,
                ...(capture.toolResults.length === 0
                  ? {}
                  : { toolResults: capture.toolResults }),
                durationMs: Date.now() - startedAt,
                error: errorMessage(error),
              });
              throw error;
            } finally {
              activeRound = undefined;
            }
          };

          await sendPrompt(prompt);
          if (toolset.getDraft() === undefined) {
            await sendPrompt(
              `你还没有提交正文。请现在只调用 chapter_commit({ chapterNumber: ${outlineChapter.number}, text: "完整正文" })，不要输出其他内容。`,
            );
          }

          const firstDraft = toolset.getDraft();
          if (
            firstDraft !== undefined &&
            countWords(firstDraft) < outlineChapter.targetWords * 0.9
          ) {
            await sendPrompt(
              `本章目前只有 ${countWords(firstDraft)} 字，低于目标 ${outlineChapter.targetWords} 字。请继续补写本章剩余内容，并调用 chapter_commit({ chapterNumber: ${outlineChapter.number}, text: "补写部分", append: true })。不要重写已经提交的正文。`,
            );
          }
        } else {
          await runScriptedChapter({
            prompt,
            chapter: outlineChapter,
            ai: chapterAi,
            tools: toolset.tools,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
        }

        const draft = toolset.getDraft();
        if (draft === undefined || draft.trim().length === 0) {
          throw new DirectorError(
            `Director did not commit chapter ${outlineChapter.number}.`,
            outlineChapter.number,
          );
        }

        const draftChapter: Chapter = {
          number: outlineChapter.number,
          title: outlineChapter.title,
          outline: outlineChapter,
          text: draft,
          wordCount: countWords(draft),
          status:
            countWords(draft) < outlineChapter.targetWords * 0.9
              ? "needs_attention"
              : "drafted",
        };

        const finalized = await finalizeChapter({
          project: input.project,
          bible: input.bible,
          outline: input.outline,
          store: input.store,
          chapter: draftChapter,
          chapters,
          state,
          foreshadows,
          ai: chapterAi,
          ...(input.graph === undefined ? {} : { graph: input.graph }),
          emit,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });

        const existingIndex = chapters.findIndex(
          (chapter) => chapter.number === finalized.chapter.number,
        );
        if (existingIndex >= 0) chapters[existingIndex] = finalized.chapter;
        else chapters.push(finalized.chapter);
        chapters.sort((left, right) => left.number - right.number);
        state = finalized.state;

        emit({
          phase: "chapter",
          message: `第 ${outlineChapter.number} 章完成（${finalized.chapter.wordCount} 字，${
            input.project.reviewEnabled ? "审校完成" : "导演模式"
          }）。`,
          chapterNumber: outlineChapter.number,
          wordCount: finalized.chapter.wordCount,
          gate: finalized.chapter.review?.gate ?? "pass",
        });
      } catch (error) {
        if (sessionAbort.signal.aborted && !input.signal?.aborted) {
          throw new DirectorError(
            `Director chapter ${outlineChapter.number} timed out after ${chapterTimeoutMs} ms.`,
            outlineChapter.number,
            { cause: error },
          );
        }
        throw new DirectorError(
          `Director chapter ${outlineChapter.number} failed: ${errorMessage(error)}`,
          outlineChapter.number,
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        session?.dispose();
      }
    }

    // Later chapters may have been preserved when rewriting a middle chapter.
    // Replay their digests so the ledger reflects them again after the reset.
    for (const chapter of chapters) {
      if (chapter.number <= endChapterNumber) continue;
      if (!chapter.digest) continue;
      foreshadows.applyDigest(
        input.project.id,
        chapter.number,
        chapter.digest.foreshadows,
      );
    }
  } finally {
    if (ownsForeshadows) foreshadows.close();
  }

  return { chapters, state };
}
