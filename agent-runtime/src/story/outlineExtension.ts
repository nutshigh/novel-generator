import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  MAX_EXTENSION_BATCH,
  OutlineExtensionSchema,
  OutlineSchema,
  validateOutline,
  type Chapter,
  type Outline,
  type OutlineExtension,
  type Project,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import {
  OUTLINE_EXTENSION_SYSTEM_PROMPT,
  buildOutlineExtensionRetryPrompt,
  buildOutlineExtensionUserPrompt,
} from "../prompts/defaults.js";

const MAX_ATTEMPTS = 2;

export interface ExtendOutlineInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapters: Chapter[];
  additionalChapters: number;
  state?: StoryState;
  ai: AiGateway;
  signal?: AbortSignal;
  onAttempt?: (attempt: number, maxAttempts: number) => void;
}

export interface ExtendedOutline {
  project: Project;
  outline: Outline;
  startChapter: number;
  endChapter: number;
}

export class OutlineExtensionError extends Error {
  readonly code: string;

  constructor(message: string, code = "outline_extension_failed") {
    super(message);
    this.name = "OutlineExtensionError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeExtension(
  outline: Outline,
  extension: OutlineExtension,
): Outline {
  const volumeNumber =
    Math.max(0, ...outline.volumes.map((volume) => volume.number)) + 1;

  return OutlineSchema.parse({
    volumes: [
      ...outline.volumes,
      {
        number: volumeNumber,
        title: extension.volume.title,
        summary: extension.volume.summary,
        stages: [
          {
            number: 1,
            title: extension.stage.title,
            summary: extension.stage.summary,
            chapters: extension.chapters,
          },
        ],
      },
    ],
  });
}

export async function extendOutline(
  input: ExtendOutlineInput,
): Promise<ExtendedOutline> {
  const {
    project,
    bible,
    outline,
    chapters,
    additionalChapters,
    state,
    ai,
    signal,
    onAttempt,
  } = input;
  if (
    !Number.isInteger(additionalChapters) ||
    additionalChapters < 1 ||
    additionalChapters > MAX_EXTENSION_BATCH
  ) {
    throw new OutlineExtensionError(
      `每次最多追加 ${MAX_EXTENSION_BATCH} 章，最少 1 章。`,
      "invalid_extension_count",
    );
  }

  const startChapter =
    Math.max(0, ...outline.volumes.flatMap((volume) =>
      volume.stages.flatMap((stage) => stage.chapters.map((chapter) => chapter.number)),
    )) + 1;
  const endChapter = startChapter + additionalChapters - 1;
  const totalChapters = endChapter;
  const targetWords = totalChapters * project.chapterWords;

  const baseUser = buildOutlineExtensionUserPrompt(
    project,
    bible,
    outline,
    chapters,
    startChapter,
    endChapter,
    state,
  );
  const maxTokens = MAX_OUTPUT_TOKENS;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    onAttempt?.(attempt, MAX_ATTEMPTS);
    const user =
      attempt === 1
        ? baseUser
        : buildOutlineExtensionRetryPrompt(baseUser, lastIssues);

    const raw = await ai.generateText({
      kind: "outline_extension",
      system: OUTLINE_EXTENSION_SYSTEM_PROMPT,
      user,
      temperature: 0.45,
      maxTokens,
      signal,
    });

    try {
      const extension = parseWithSchema(OutlineExtensionSchema, raw);
      const issues: string[] = [];

      if (extension.chapters.length !== additionalChapters) {
        issues.push(
          `Expected ${additionalChapters} chapters, received ${extension.chapters.length}.`,
        );
      }

      extension.chapters.forEach((chapter, index) => {
        const expected = startChapter + index;
        if (chapter.number !== expected) {
          issues.push(
            `Chapter ${chapter.number} is out of sequence; expected ${expected}.`,
          );
        }
        for (const field of ["goal", "conflict", "turn", "reveal", "hook"] as const) {
          if (chapter[field].trim().length === 0) {
            issues.push(`Chapter ${chapter.number} has an empty ${field}.`);
          }
        }
        if (chapter.targetWords < project.chapterWords * 0.8) {
          issues.push(
            `Chapter ${chapter.number} targetWords ${chapter.targetWords} is below ${
              project.chapterWords * 0.8
            }.`,
          );
        }
        if (chapter.targetWords > project.chapterWords * 2) {
          issues.push(
            `Chapter ${chapter.number} targetWords ${chapter.targetWords} exceeds ${
              project.chapterWords * 2
            }.`,
          );
        }
      });

      if (issues.length > 0) {
        lastIssues = issues;
        continue;
      }

      const merged = mergeExtension(outline, extension);
      const mergedIssues = validateOutline(merged, bible, {
        maxChapters: totalChapters,
        chapterWords: project.chapterWords,
      });

      if (mergedIssues.length > 0) {
        lastIssues = mergedIssues;
        continue;
      }

      const nextProject: Project = {
        ...project,
        maxChapters: totalChapters,
        targetWords,
      };

      return {
        project: nextProject,
        outline: merged,
        startChapter,
        endChapter,
      };
    } catch (error) {
      lastIssues = [errorMessage(error)];
    }
  }

  throw new OutlineExtensionError(
    `大纲扩展失败（已尝试 ${MAX_ATTEMPTS} 次）：\n${lastIssues.join("\n")}`,
  );
}
