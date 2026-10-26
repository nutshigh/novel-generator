import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import type { ForeshadowRecord } from "../domain/foreshadowStore.js";
import {
  ChapterMemorySchema,
  type Chapter,
  type ChapterDigest,
  type ChapterSummary,
} from "../domain/schemas.js";
import {
  CHAPTER_MEMORY_SYSTEM_PROMPT,
  buildChapterMemoryUserPrompt,
} from "../prompts/defaults.js";

const MAX_MEMORY_ATTEMPTS = 2;

export interface ExtractChapterMemoryInput {
  chapter: Chapter;
  previousChapters: readonly Chapter[];
  foreshadows: readonly ForeshadowRecord[];
  ai: AiGateway;
  signal?: AbortSignal;
}

export interface ChapterMemoryResult {
  digest: ChapterDigest;
  brief: string;
  summary: ChapterSummary;
}

export class ChapterMemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterMemoryError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSummary(
  summary: ChapterSummary,
  chapterNumber: number,
): ChapterSummary {
  const fromChapter = Math.max(1, chapterNumber - 4);
  return {
    ...summary,
    fromChapter,
    toChapter: chapterNumber,
    text: summary.text.trim(),
  };
}

/**
 * Builds the searchable chapter digest and the rolling five-chapter summary.
 * This runs after the final chapter text is known, so revisions and ending
 * repairs are always reflected in the stored memory.
 */
export async function extractChapterMemory(
  input: ExtractChapterMemoryInput,
): Promise<ChapterMemoryResult> {
  const { chapter, previousChapters, foreshadows, ai, signal } = input;
  const fromChapter = Math.max(1, chapter.number - 4);
  const baseUser = buildChapterMemoryUserPrompt({
    chapter,
    previousChapters,
    foreshadows,
    fromChapter,
    toChapter: chapter.number,
  });
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_MEMORY_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过校验：
${lastError}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须完全符合 ChapterMemory schema。`;

    const raw = await ai.generateText({
      kind: "chapter_memory",
      system: CHAPTER_MEMORY_SYSTEM_PROMPT,
      user,
      temperature: 0.1,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });

    try {
      const parsed = parseWithSchema(ChapterMemorySchema, raw);
      const summary = normalizeSummary(parsed.summary, chapter.number);
      if (summary.text.length === 0) {
        throw new Error("summary.text must not be empty.");
      }
      const brief = parsed.brief.trim();
      if (brief.length === 0) {
        throw new Error("brief must not be empty.");
      }
      const digest = {
        ...parsed.digest,
        foreshadows: parsed.digest.foreshadows.map((entry) => ({
          ...entry,
          note: entry.note ?? "",
        })),
      };
      return { digest, brief, summary };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new ChapterMemoryError(
    `Chapter memory extraction failed after ${MAX_MEMORY_ATTEMPTS} attempts: ${lastError}`,
  );
}
