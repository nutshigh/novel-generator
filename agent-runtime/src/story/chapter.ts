import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  EndingAuditSchema,
  ReviewSchema,
  countWords,
  type Chapter,
  type EndingAudit,
  type Outline,
  type OutlineChapter,
  type Project,
  type Review,
  type ReviewIssue,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import {
  CHAPTER_SYSTEM_PROMPT,
  ENDING_AUDIT_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  REVISE_SYSTEM_PROMPT,
  buildChapterUserPrompt,
  buildEndingAuditUserPrompt,
  buildReviewUserPrompt,
  buildReviseUserPrompt,
} from "../prompts/defaults.js";
import type { ForeshadowRecord } from "../domain/foreshadowStore.js";
import {
  previousTail,
  selectCast,
  type ChapterBriefBlock,
  type ChapterSummaryBlock,
  type ForeshadowContextEntry,
} from "./context.js";
import { flattenChapters } from "./outline.js";
import {
  planContinuation,
  shouldContinue,
  trimToWordLimit,
} from "./wordBudget.js";

const MAX_CONTINUATION_ROUNDS = 2;
const MAX_REVIEW_ATTEMPTS = 2;

export interface WriteChapterInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapter: OutlineChapter;
  ai: AiGateway;
  previousChapterText?: string;
  recentChapters?: Chapter[];
  chapterBriefs?: ChapterBriefBlock[];
  summaries?: ChapterSummaryBlock[];
  foreshadowLedger?: ForeshadowRecord[];
  state: StoryState;
  graphContext?: string;
  signal?: AbortSignal;
}

export interface ReviewChapterInput {
  project: Project;
  bible: StoryBible;
  chapter: Chapter;
  /** Issues from the draft this chapter was revised from, when re-reviewing. */
  previousReview?: Review;
  ai: AiGateway;
  signal?: AbortSignal;
}

export interface ReviseChapterInput {
  project: Project;
  bible: StoryBible;
  chapter: Chapter;
  review: Review;
  ai: AiGateway;
  signal?: AbortSignal;
}

export class ChapterReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterReviewError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openForeshadows(
  bible: StoryBible,
  state: StoryState,
): ForeshadowContextEntry[] {
  const stateByTitle = new Map(
    state.foreshadows.map((entry) => [entry.title, entry]),
  );
  const ledgerTitles = new Set(bible.foreshadowLedger.map((entry) => entry.title));

  const ledgerEntries = bible.foreshadowLedger.map((entry) => {
    const current = stateByTitle.get(entry.title);
    return current ? { ...entry, status: current.status } : entry;
  });
  const extraEntries = state.foreshadows.filter(
    (entry) => !ledgerTitles.has(entry.title),
  );

  return [...ledgerEntries, ...extraEntries];
}

function joinContinuation(existing: string, continuation: string): string {
  if (existing.length === 0) return continuation;
  if (continuation.length === 0) return existing;
  const separator = existing.endsWith("\n") ? "" : "\n\n";
  return `${existing}${separator}${continuation.trimStart()}`;
}

function buildContinuationUserPrompt(
  baseUser: string,
  existingText: string,
  isFinalRound: boolean,
): string {
  const finalRule = isFinalRound
    ? "\n这是最后一轮续写：必须收束本章冲突，并留下本章大纲要求的钩子。"
    : "";

  return `${baseUser}

已有正文结尾（仅用于承接）：
${previousTail(existingText)}

继续写，不要重复已有内容。
只输出接在已有正文之后的续写部分，不要重写、复述或总结已有段落。${finalRule}`;
}

export async function writeChapter(input: WriteChapterInput): Promise<Chapter> {
  const {
    project,
    bible,
    outline,
    chapter,
    ai,
    previousChapterText,
    recentChapters,
    chapterBriefs,
    summaries,
    foreshadowLedger,
    state,
    graphContext,
    signal,
  } = input;
  const chapters = flattenChapters(outline);
  const nextOutlineChapter = chapters.find(
    (candidate) => candidate.number === chapter.number + 1,
  );
  const cast = selectCast(bible, chapter);
  const targetWords = chapter.targetWords;
  const promptInput = {
    project,
    bible,
    outlineChapter: chapter,
    nextOutlineChapter,
    previousChapterText,
    ...(recentChapters === undefined ? {} : { recentChapters }),
    ...(chapterBriefs === undefined ? {} : { chapterBriefs }),
    ...(summaries === undefined ? {} : { summaries }),
    ...(foreshadowLedger === undefined ? {} : { foreshadowLedger }),
    cast,
    state,
    foreshadow: openForeshadows(bible, state),
    targetWords,
  };
  const baseUser = buildChapterUserPrompt({
    ...promptInput,
    roundWords: targetWords,
    remainingWords: targetWords,
  });
  const promptWithGraph = (prompt: string): string =>
    graphContext ? `${prompt}\n\n${graphContext}` : prompt;

  let text = await ai.generateText({
    kind: "chapter",
    system: CHAPTER_SYSTEM_PROMPT,
    user: promptWithGraph(baseUser),
    temperature: 0.8,
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  });

  let rounds = 0;
  while (
    rounds < MAX_CONTINUATION_ROUNDS &&
    shouldContinue(targetWords, countWords(text))
  ) {
    const plan = planContinuation(
      targetWords,
      countWords(text),
      rounds,
      MAX_CONTINUATION_ROUNDS,
    );
    const roundUser = buildChapterUserPrompt({
      ...promptInput,
      roundWords: plan.suggestedWords,
      isFinalRound: plan.isFinalRound,
      remainingWords: plan.remaining,
    });
    const continuation = await ai.generateText({
      kind: "chapter",
      system: CHAPTER_SYSTEM_PROMPT,
      user: buildContinuationUserPrompt(
        promptWithGraph(roundUser),
        text,
        plan.isFinalRound,
      ),
      temperature: 0.8,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });
    text = joinContinuation(text, continuation);
    rounds += 1;
  }

  const finalText = trimToWordLimit(text, Math.ceil(targetWords * 1.3));
  const wordCount = countWords(finalText);
  return {
    number: chapter.number,
    title: chapter.title,
    outline: chapter,
    text: finalText,
    wordCount,
    status: wordCount < targetWords * 0.9 ? "needs_attention" : "drafted",
  };
}

export interface AuditChapterEndingInput {
  chapter: Chapter;
  ai: AiGateway;
  signal?: AbortSignal;
}

/**
 * Focused audit for the one failure mode a general review tends to miss:
 * the chapter stops right after a character starts an action.
 */
export async function auditChapterEnding(
  input: AuditChapterEndingInput,
): Promise<EndingAudit> {
  const baseUser = buildEndingAuditUserPrompt(input.chapter);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过 EndingAudit 校验：
${lastError}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须包含 complete、reason、missing 三个字段。`;

    const raw = await input.ai.generateText({
      kind: "ending_audit",
      system: ENDING_AUDIT_SYSTEM_PROMPT,
      user,
      temperature: 0.1,
      maxTokens: 8_000,
      signal: input.signal,
    });

    try {
      return parseWithSchema(EndingAuditSchema, raw);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new ChapterReviewError(
    `Ending audit failed after ${MAX_REVIEW_ATTEMPTS} attempts: ${lastError}`,
  );
}

export interface FinishChapterInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapter: Chapter;
  ai: AiGateway;
  previousChapterText?: string;
  recentChapters?: Chapter[];
  chapterBriefs?: ChapterBriefBlock[];
  summaries?: ChapterSummaryBlock[];
  foreshadowLedger?: ForeshadowRecord[];
  state: StoryState;
  graphContext?: string;
  reason: string;
  missing?: string;
  signal?: AbortSignal;
}

/**
 * Appends one closing beat to an already-written chapter. It never rewrites
 * the existing text, so the repaired chapter keeps its established voice.
 */
export async function finishChapter(
  input: FinishChapterInput,
): Promise<Chapter> {
  const {
    project,
    bible,
    outline,
    chapter,
    ai,
    previousChapterText,
    recentChapters,
    chapterBriefs,
    summaries,
    foreshadowLedger,
    state,
    graphContext,
    signal,
  } = input;
  const outlineChapter = chapter.outline;
  const chapters = flattenChapters(outline);
  const nextOutlineChapter = chapters.find(
    (candidate) => candidate.number === outlineChapter.number + 1,
  );
  const cast = selectCast(bible, outlineChapter);
  const targetWords = outlineChapter.targetWords;
  const currentWords = countWords(chapter.text);
  const remaining = Math.max(0, targetWords - currentWords);
  const roundWords = Math.min(800, Math.max(200, remaining));
  const promptInput = {
    project,
    bible,
    outlineChapter,
    nextOutlineChapter,
    previousChapterText,
    ...(recentChapters === undefined ? {} : { recentChapters }),
    ...(chapterBriefs === undefined ? {} : { chapterBriefs }),
    ...(summaries === undefined ? {} : { summaries }),
    ...(foreshadowLedger === undefined ? {} : { foreshadowLedger }),
    cast,
    state,
    foreshadow: openForeshadows(bible, state),
    targetWords,
  };
  const baseUser = buildChapterUserPrompt({
    ...promptInput,
    roundWords,
    isFinalRound: true,
    remainingWords: Math.max(remaining, roundWords),
  });
  const promptWithGraph = (prompt: string): string =>
    graphContext ? `${prompt}\n\n${graphContext}` : prompt;
  const missingBeat = input.missing?.trim()
    ? `\n需要补的节拍：${input.missing.trim()}`
    : "";
  const closure = `

本章结尾审计未通过：${input.reason}${missingBeat}

这次续写只做一件事：补完最后一场戏。必须写出对方对最后一句的回应或明确中断、人物的明确决定或结果，并让本章 goal 落地；不要另起新场景，不要重写、复述或总结已有内容。最后一句必须是完整句子，并留下大纲要求的 hook。`;

  const continuation = await ai.generateText({
    kind: "chapter",
    system: CHAPTER_SYSTEM_PROMPT,
    user: `${buildContinuationUserPrompt(
      promptWithGraph(baseUser),
      chapter.text,
      true,
    )}${closure}`,
    temperature: 0.7,
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  });
  const text = joinContinuation(chapter.text, continuation);
  const finalText = trimToWordLimit(text, Math.ceil(targetWords * 1.3));
  const wordCount = countWords(finalText);

  return {
    ...chapter,
    text: finalText,
    wordCount,
    status:
      wordCount < targetWords * 0.9 || chapter.status === "needs_attention"
        ? "needs_attention"
        : "drafted",
  };
}

export async function reviewChapter(
  input: ReviewChapterInput,
): Promise<Review> {
  const { chapter, previousReview, ai, signal } = input;
  const baseUser = buildReviewUserPrompt(
    chapter,
    chapter.outline,
    previousReview,
  );
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过 Review 校验：
${lastError}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须完全符合 Review schema。`;

    const raw = await ai.generateText({
      kind: "review",
      system: REVIEW_SYSTEM_PROMPT,
      user,
      temperature: 0.2,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });

    try {
      return parseWithSchema(ReviewSchema, raw);
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new ChapterReviewError(
    `Review failed after ${MAX_REVIEW_ATTEMPTS} attempts: ${lastError}`,
  );
}

export async function reviseChapter(
  input: ReviseChapterInput,
): Promise<Chapter> {
  const { chapter, review, ai, signal } = input;
  if (review.gate !== "revise") {
    throw new Error(
      `reviseChapter requires review.gate "revise"; received "${review.gate}".`,
    );
  }

  const issues: ReviewIssue[] = review.issues;
  const raw = await ai.generateText({
    kind: "revise",
    system: REVISE_SYSTEM_PROMPT,
    user: buildReviseUserPrompt(chapter, issues),
    temperature: 0.7,
    maxTokens: MAX_OUTPUT_TOKENS,
    signal,
  });
  const finalText = trimToWordLimit(
    raw,
    Math.ceil(chapter.outline.targetWords * 1.3),
  );
  const wordCount = countWords(finalText);

  return {
    number: chapter.number,
    title: chapter.title,
    outline: chapter.outline,
    text: finalText,
    wordCount,
    status:
      wordCount < chapter.outline.targetWords * 0.9
        ? "needs_attention"
        : "drafted",
  };
}
