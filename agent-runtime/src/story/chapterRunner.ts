import type { AiGateway } from "../ai/gateway.js";
import type {
  Chapter,
  EndingAudit,
  Outline,
  Project,
  Review,
  ReviewIssue,
  RunProgress,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";
import {
  openForeshadowStore,
  type ForeshadowStore,
} from "../domain/foreshadowStore.js";
import type { ProjectStore } from "../domain/store.js";
import type { NovelGraphStore } from "../graph/types.js";
import {
  auditChapterEnding,
  finishChapter,
  reviewChapter,
  reviseChapter,
  writeChapter,
} from "./chapter.js";
import { extractChapterMemory } from "./chapterMemory.js";
import {
  recentChaptersFor,
  selectChapterBriefBlocks,
  selectRollingSummaryBlocks,
} from "./context.js";
import { chapterArtifactName } from "./library.js";
import { flattenChapters } from "./outline.js";
import {
  appendReviewLog,
  type ReviewLogEntry,
  type ReviewLogStage,
} from "./reviewLog.js";
import { applyStateToChapter, extractState, mergeState } from "./state.js";

export class PipelineError extends Error {
  readonly chapterNumber?: number;

  constructor(message: string, chapterNumber?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "PipelineError";
    this.chapterNumber = chapterNumber;
  }
}

export class PipelineAbortError extends PipelineError {
  constructor(message: string, chapterNumber?: number, options?: ErrorOptions) {
    super(message, chapterNumber, options);
    this.name = "PipelineAbortError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  chapterNumber?: number,
): void {
  if (!signal?.aborted) return;

  throw new PipelineAbortError(
    chapterNumber === undefined
      ? "Novel pipeline aborted."
      : `Novel pipeline aborted before chapter ${chapterNumber}.`,
    chapterNumber,
  );
}

export function initialStoryState(bible: StoryBible): StoryState {
  return {
    entities: [],
    relationships: [],
    foreshadows: bible.foreshadowLedger.map((entry) => ({
      title: entry.title,
      status:
        entry.status === "planned"
          ? entry.setupChapter <= 1
            ? "open"
            : "planned"
          : entry.status,
    })),
    events: [],
  };
}

function gateRank(gate: Review["gate"]): number {
  switch (gate) {
    case "pass":
      return 3;
    case "revise":
      return 2;
    case "block":
      return 1;
  }
}

function completedStatus(chapter: Chapter, review: Review): Chapter["status"] {
  if (review.gate !== "pass") return "needs_attention";
  if (chapter.status === "needs_attention") return "needs_attention";
  return "committed";
}

const MAX_REVISION_ROUNDS = 2;

const ISSUE_WEIGHTS = {
  low: 1,
  medium: 3,
  high: 9,
} as const;

function reviewSeverityScore(review: Review): number {
  return review.issues.reduce(
    (total, issue) => total + ISSUE_WEIGHTS[issue.severity],
    0,
  );
}

interface RevisionDecision {
  accept: boolean;
  reason: string;
}

function countSeverity(review: Review, severity: ReviewIssue["severity"]): number {
  return review.issues.filter((issue) => issue.severity === severity).length;
}

/**
 * A re-review often finds a different set of issues than the first review.
 * Comparing only weighted totals rejects drafts that fixed the original
 * problems but traded them for new low-weight notes. Compare the severity
 * composition first, then use issue count and target length as tie-breakers.
 */
export function compareRevision(
  original: Chapter,
  originalReview: Review,
  revised: Chapter,
  revisedReview: Review,
): RevisionDecision {
  const originalScore = reviewSeverityScore(originalReview);
  const revisedScore = reviewSeverityScore(revisedReview);
  const summary = `问题权重 ${originalScore} → ${revisedScore}，字数 ${original.wordCount} → ${revised.wordCount}`;

  if (revisedReview.gate === "block") {
    return { accept: false, reason: `复审结论为阻断（${summary}）` };
  }

  const gateDelta =
    gateRank(revisedReview.gate) - gateRank(originalReview.gate);
  if (gateDelta !== 0) {
    return {
      accept: gateDelta > 0,
      reason: gateDelta > 0 ? `复审结论升级（${summary}）` : `复审结论降级（${summary}）`,
    };
  }

  const originalHigh = countSeverity(originalReview, "high");
  const revisedHigh = countSeverity(revisedReview, "high");
  if (revisedHigh !== originalHigh) {
    return {
      accept: revisedHigh < originalHigh,
      reason: `高严重度问题 ${originalHigh} → ${revisedHigh}（${summary}）`,
    };
  }

  if (revisedScore !== originalScore) {
    return {
      accept: revisedScore < originalScore,
      reason: `问题权重${revisedScore < originalScore ? "下降" : "上升"}（${summary}）`,
    };
  }

  const wordFloor = Math.max(
    1,
    Math.floor(original.outline.targetWords * 0.9),
  );
  if (
    revisedReview.issues.length < originalReview.issues.length &&
    revised.wordCount >= wordFloor
  ) {
    return {
      accept: true,
      reason: `问题数 ${originalReview.issues.length} → ${revisedReview.issues.length}，字数仍达目标下限`,
    };
  }

  if (
    revised.wordCount >= Math.floor(original.wordCount * 0.98) &&
    revised.wordCount >= wordFloor
  ) {
    return {
      accept: true,
      reason: `问题严重度持平，字数未见明显缩水（${summary}）`,
    };
  }

  return {
    accept: false,
    reason: `问题严重度持平且修订稿更短（目标下限 ${wordFloor} 字，${summary}）`,
  };
}

function withEndingIssue(
  review: Review,
  audit: EndingAudit,
  chapter: Chapter,
): Review {
  const issue: ReviewIssue = {
    severity: "high",
    type: "hook",
    quote: chapter.text.slice(-120),
    problem: `结尾审计未通过：${audit.reason}`,
    fix:
      audit.missing.trim() ||
      "补完最后一场戏的动作—反应，再收束并落地 hook。",
  };

  return {
    ...review,
    gate: review.gate === "pass" ? "revise" : review.gate,
    issues: [...review.issues, issue],
  };
}

export interface RunChapterRangeInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  ai: AiGateway;
  store: ProjectStore;
  /** Existing chapters before startChapterNumber, sorted by number. */
  chapters: Chapter[];
  state: StoryState;
  startChapterNumber: number;
  /** Inclusive last chapter to write. Defaults to the end of the outline. */
  endChapterNumber?: number;
  graph?: NovelGraphStore;
  foreshadows?: ForeshadowStore;
  /** Overrides project.reviewEnabled when provided. */
  reviewEnabled?: boolean;
  signal?: AbortSignal;
  emit?: (event: RunProgress) => void;
}

export interface RunChapterRangeResult {
  chapters: Chapter[];
  state: StoryState;
}

/**
 * Writes every outline chapter at or after startChapterNumber, preserving the
 * provided earlier chapters. Shared by the initial pipeline and continuation.
 */
export async function runChapterRange(
  input: RunChapterRangeInput,
): Promise<RunChapterRangeResult> {
  const { project, bible, outline, ai, store, startChapterNumber, signal } = input;
  const endChapterNumber = input.endChapterNumber ?? Number.MAX_SAFE_INTEGER;
  const emit = input.emit ?? (() => undefined);
  const chapters = [...input.chapters];
  let state = input.state;
  const reviewEnabled = input.reviewEnabled ?? project.reviewEnabled;
  const ownsForeshadows = input.foreshadows === undefined;
  const foreshadows =
    input.foreshadows ?? openForeshadowStore(store, project.id);

  const logReview = async (entry: ReviewLogEntry): Promise<void> => {
    try {
      await appendReviewLog(store, entry);
    } catch (error) {
      emit({
        phase: "review",
        message: `第 ${entry.chapterNumber} 章审校日志写入失败：${errorMessage(error)}`,
        chapterNumber: entry.chapterNumber,
        error: errorMessage(error),
      });
    }
  };

  try {
    foreshadows.seed(project.id, bible.foreshadowLedger);
    if (state.foreshadows.length > 0) {
      foreshadows.importState(project.id, 0, state.foreshadows);
    }
    if (chapters.some((chapter) => chapter.number >= startChapterNumber)) {
      foreshadows.resetFromChapter(project.id, startChapterNumber);
    }

    for (const outlineChapter of flattenChapters(outline)) {
      if (outlineChapter.number < startChapterNumber) continue;
      if (outlineChapter.number > endChapterNumber) continue;
      throwIfAborted(signal, outlineChapter.number);

    try {
      const contextChapters = recentChaptersFor(chapters, outlineChapter.number);
      const memoryChapters = recentChaptersFor(
        chapters,
        outlineChapter.number,
        4,
      );
      const chapterBriefs = selectChapterBriefBlocks(
        chapters,
        outlineChapter.number,
      );
      const summaries = selectRollingSummaryBlocks(
        chapters,
        outline,
        outlineChapter.number,
      );
      const previousChapterText = contextChapters[0]?.text;
      const foreshadowLedger = foreshadows.listForChapter(
        project.id,
        outlineChapter.number,
      );

      let graphContext: string | undefined;
      if (input.graph) {
        try {
          graphContext = await input.graph.buildChapterContext({
            bookId: project.id,
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

      const writeStartedAt = Date.now();
      emit({
        phase: "write",
        message: `第 ${outlineChapter.number} 章开始写作（目标 ${outlineChapter.targetWords} 字）。`,
        chapterNumber: outlineChapter.number,
      });

      let chapter = await writeChapter({
        project,
        bible,
        outline,
        chapter: outlineChapter,
        ai,
        previousChapterText,
        recentChapters: contextChapters,
        chapterBriefs,
        summaries,
        foreshadowLedger,
        state,
        ...(graphContext ? { graphContext } : {}),
        signal,
      });

      emit({
        phase: "write",
        message: `第 ${outlineChapter.number} 章初稿完成（${chapter.wordCount} 字），准备审校。`,
        chapterNumber: outlineChapter.number,
        draftWords: chapter.wordCount,
        durationMs: Date.now() - writeStartedAt,
      });

      const gateLabel: Record<Review["gate"], string> = {
        pass: "通过",
        revise: "需要修订",
        block: "阻断",
      };

      const recordReview = async (
        review: Review,
        round: number,
        stage: ReviewLogStage,
        wordCount: number,
      ): Promise<void> => {
        emit({
          phase: "review",
          message: `第 ${outlineChapter.number} 章审校${gateLabel[review.gate]}${
            review.summary ? `：${review.summary}` : ""
          }`,
          chapterNumber: outlineChapter.number,
          gate: review.gate,
        });
        await logReview({
          type: "review",
          at: new Date().toISOString(),
          projectId: project.id,
          chapterNumber: outlineChapter.number,
          chapterTitle: outlineChapter.title,
          round,
          stage,
          wordCount,
          review,
        });
      };

      let review: Review = {
        gate: "pass",
        summary: reviewEnabled ? "" : "导演模式：未启用审核。",
        issues: [],
      };
      let revisionRounds = 0;

      if (reviewEnabled) {
        emit({
          phase: "review",
          message: `第 ${outlineChapter.number} 章审校中…`,
          chapterNumber: outlineChapter.number,
        });

        review = await reviewChapter({
          project,
          bible,
          chapter,
          ai,
          signal,
        });
        await recordReview(review, 0, "initial", chapter.wordCount);

        while (
          review.gate === "revise" &&
          revisionRounds < MAX_REVISION_ROUNDS
        ) {
          emit({
            phase: "revise",
            message: `第 ${outlineChapter.number} 章正在按审校意见修订（第 ${
              revisionRounds + 1
            } 轮）…`,
            chapterNumber: outlineChapter.number,
            gate: review.gate,
          });
          const originalChapter = chapter;
          const originalReview = review;
          const revisedChapter = await reviseChapter({
            project,
            bible,
            chapter: originalChapter,
            review: originalReview,
            ai,
            signal,
          });
          emit({
            phase: "review",
            message: `第 ${outlineChapter.number} 章修订完成，重新审校中…`,
            chapterNumber: outlineChapter.number,
          });
          const revisedReview = await reviewChapter({
            project,
            bible,
            chapter: revisedChapter,
            previousReview: originalReview,
            ai,
            signal,
          });
          const revisionRound = revisionRounds + 1;
          await recordReview(
            revisedReview,
            revisionRound,
            "rereview",
            revisedChapter.wordCount,
          );

          const decision = compareRevision(
            originalChapter,
            originalReview,
            revisedChapter,
            revisedReview,
          );
          await logReview({
            type: "revision_decision",
            at: new Date().toISOString(),
            projectId: project.id,
            chapterNumber: outlineChapter.number,
            chapterTitle: outlineChapter.title,
            round: revisionRound,
            accepted: decision.accept,
            reason: decision.reason,
            originalWordCount: originalChapter.wordCount,
            revisedWordCount: revisedChapter.wordCount,
          });
          if (!decision.accept) {
            emit({
              phase: "revise",
              message: `第 ${outlineChapter.number} 章修订未改善，保留原稿（${decision.reason}）。`,
              chapterNumber: outlineChapter.number,
              gate: revisedReview.gate,
            });
            break;
          }

          chapter = revisedChapter;
          review = revisedReview;
          revisionRounds += 1;
          emit({
            phase: "revise",
            message: `第 ${outlineChapter.number} 章修订已采纳（${chapter.wordCount} 字，${decision.reason}）。`,
            chapterNumber: outlineChapter.number,
            wordCount: chapter.wordCount,
          });
        }
      }

      if (reviewEnabled) {
        let endingAudit: EndingAudit | undefined;
        try {
          endingAudit = await auditChapterEnding({ chapter, ai, signal });
          await logReview({
            type: "ending_audit",
            at: new Date().toISOString(),
            projectId: project.id,
            chapterNumber: outlineChapter.number,
            chapterTitle: outlineChapter.title,
            round: revisionRounds,
            audit: endingAudit,
          });
        } catch (error) {
          emit({
            phase: "review",
            message: `第 ${outlineChapter.number} 章结尾审计失败，跳过：${errorMessage(
              error,
            )}`,
            chapterNumber: outlineChapter.number,
            error: errorMessage(error),
          });
        }

        if (endingAudit && !endingAudit.complete) {
        const audit = endingAudit;
        emit({
          phase: "revise",
          message: `第 ${outlineChapter.number} 章最后一场戏未收束（${audit.reason}），正在补写结尾…`,
          chapterNumber: outlineChapter.number,
          gate: review.gate,
        });

        let repaired = false;
        try {
          chapter = await finishChapter({
            project,
            bible,
            outline,
            chapter,
            ai,
            ...(previousChapterText === undefined
              ? {}
              : { previousChapterText }),
            recentChapters: contextChapters,
            chapterBriefs,
            summaries,
            foreshadowLedger,
            state,
            ...(graphContext === undefined ? {} : { graphContext }),
            reason: audit.reason,
            missing: audit.missing,
            signal,
          });
          repaired = true;
          emit({
            phase: "write",
            message: `第 ${outlineChapter.number} 章结尾补写完成（${chapter.wordCount} 字），重新审校…`,
            chapterNumber: outlineChapter.number,
            draftWords: chapter.wordCount,
          });
        } catch (error) {
          emit({
            phase: "review",
            message: `第 ${outlineChapter.number} 章结尾补写失败：${errorMessage(
              error,
            )}`,
            chapterNumber: outlineChapter.number,
            error: errorMessage(error),
          });
          review = withEndingIssue(review, audit, chapter);
        }

        if (repaired) {
          try {
            review = await reviewChapter({
              project,
              bible,
              chapter,
              previousReview: review,
              ai,
              signal,
            });
            await recordReview(
              review,
              revisionRounds + 1,
              "ending_repair",
              chapter.wordCount,
            );
          } catch (error) {
            emit({
              phase: "review",
              message: `第 ${outlineChapter.number} 章补写后审校失败：${errorMessage(
                error,
              )}`,
              chapterNumber: outlineChapter.number,
              error: errorMessage(error),
            });
          }

          try {
            const recheck = await auditChapterEnding({
              chapter,
              ai,
              signal,
            });
            await logReview({
              type: "ending_audit",
              at: new Date().toISOString(),
              projectId: project.id,
              chapterNumber: outlineChapter.number,
              chapterTitle: outlineChapter.title,
              round: revisionRounds + 1,
              audit: recheck,
            });
            if (!recheck.complete) {
              review = withEndingIssue(review, recheck, chapter);
              emit({
                phase: "review",
                message: `第 ${outlineChapter.number} 章结尾审计仍未通过：${recheck.reason}`,
                chapterNumber: outlineChapter.number,
                gate: review.gate,
              });
            }
          } catch (error) {
            emit({
              phase: "review",
              message: `第 ${outlineChapter.number} 章结尾复审失败，保留补写稿：${errorMessage(
                error,
              )}`,
              chapterNumber: outlineChapter.number,
              error: errorMessage(error),
            });
          }
        }
      }
      }

      chapter = {
        ...chapter,
        review,
        status: completedStatus(chapter, review),
      };

      try {
        const memory = await extractChapterMemory({
          chapter,
          previousChapters: memoryChapters,
          foreshadows: foreshadows.listForChapter(
            project.id,
            outlineChapter.number,
          ),
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
          outlineChapter.number,
          memory.digest.foreshadows,
        );
      } catch (error) {
        emit({
          phase: "state",
          message: `第 ${outlineChapter.number} 章档案提取失败，继续保存正文：${errorMessage(
            error,
          )}`,
          chapterNumber: outlineChapter.number,
          error: errorMessage(error),
        });
      }

      emit({
        phase: "state",
        message: `第 ${outlineChapter.number} 章正在提取连续性状态…`,
        chapterNumber: outlineChapter.number,
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
              message: `第 ${outlineChapter.number} 章状态警告：${message}`,
              chapterNumber: outlineChapter.number,
              error: message,
            });
          },
        });
        const merged = mergeState(state, extracted);
        merged.foreshadows = foreshadows.toStoryState(
          project.id,
          outlineChapter.number,
        );
        chapter = applyStateToChapter(chapter, merged);
        state = merged;
        emit({
          phase: "state",
          message: `第 ${outlineChapter.number} 章状态已更新。`,
          chapterNumber: outlineChapter.number,
        });
      } catch (error) {
        emit({
          phase: "state",
          message: `第 ${outlineChapter.number} 章状态提取失败，继续使用上一章状态。`,
          chapterNumber: outlineChapter.number,
          error: errorMessage(error),
        });
      }

      const existingIndex = chapters.findIndex(
        (candidate) => candidate.number === chapter.number,
      );
      if (existingIndex >= 0) chapters[existingIndex] = chapter;
      else chapters.push(chapter);
      chapters.sort((left, right) => left.number - right.number);

      await store.saveArtifact(
        project.id,
        chapterArtifactName(outlineChapter.number),
        JSON.stringify(chapter, null, 2),
      );
      await store.saveArtifact(
        project.id,
        "chapters.json",
        JSON.stringify(chapters, null, 2),
      );

      if (input.graph) {
        try {
          await input.graph.indexChapter(project.id, bible, chapter);
        } catch (error) {
          emit({
            phase: "graph",
            message: `第 ${outlineChapter.number} 章知识图谱更新失败：${errorMessage(
              error,
            )}`,
            chapterNumber: outlineChapter.number,
            error: errorMessage(error),
          });
        }
      }

      emit({
        phase: "chapter",
        message: `第 ${outlineChapter.number} 章完成（${chapter.wordCount} 字，审校 ${gateLabel[review.gate]}）。`,
        chapterNumber: outlineChapter.number,
        wordCount: chapter.wordCount,
        gate: review.gate,
      });
    } catch (error) {
      if (error instanceof PipelineAbortError) throw error;
      if (signal?.aborted) {
        throw new PipelineAbortError(
          `Novel pipeline aborted during chapter ${outlineChapter.number}.`,
          outlineChapter.number,
          { cause: error },
        );
      }
      if (error instanceof PipelineError) throw error;

      throw new PipelineError(
        `Chapter ${outlineChapter.number} failed: ${errorMessage(error)}`,
        outlineChapter.number,
        { cause: error },
      );
    }
    }

    for (const chapter of chapters) {
      if (chapter.number <= endChapterNumber) continue;
      if (!chapter.digest) continue;
      foreshadows.applyDigest(
        project.id,
        chapter.number,
        chapter.digest.foreshadows,
      );
    }
  } finally {
    if (ownsForeshadows) foreshadows.close();
  }

  return { chapters, state };
}
