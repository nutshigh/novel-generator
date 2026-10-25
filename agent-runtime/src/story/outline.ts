import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  MAX_INITIAL_CHAPTERS,
  OutlineSchema,
  validateOutline,
  type Outline,
  type OutlineChapter,
  type Project,
  type StoryBible,
} from "../domain/schemas.js";
import {
  OUTLINE_SYSTEM_PROMPT,
  buildOutlineRetryPrompt,
  buildOutlineUserPrompt,
} from "../prompts/defaults.js";

const MAX_ATTEMPTS = 2;

export const MAX_SUPPORTED_CHAPTERS = MAX_INITIAL_CHAPTERS;

export interface OutlineGenerationOptions {
  maxChapters?: number;
  chapterWords?: number;
  signal?: AbortSignal;
  /** Called before each model attempt, so long retries are visible. */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
}

export class OutlineGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlineGenerationError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function flattenChapters(outline: Outline): OutlineChapter[] {
  return outline.volumes.flatMap((volume) =>
    volume.stages.flatMap((stage) => stage.chapters),
  );
}

export async function generateOutline(
  project: Project,
  bible: StoryBible,
  ai: AiGateway,
  options?: OutlineGenerationOptions,
): Promise<Outline> {
  const maxChapters = options?.maxChapters ?? project.maxChapters;
  const chapterWords = options?.chapterWords ?? project.chapterWords;
  if (maxChapters > MAX_SUPPORTED_CHAPTERS) {
    throw new OutlineGenerationError(
      `maxChapters ${maxChapters} exceeds MAX_SUPPORTED_CHAPTERS ${MAX_SUPPORTED_CHAPTERS}.`,
    );
  }

  const hasBudgetOverride =
    options?.maxChapters !== undefined || options?.chapterWords !== undefined;
  const effectiveProject: Project = {
    ...project,
    maxChapters,
    chapterWords,
    targetWords: hasBudgetOverride
      ? maxChapters * chapterWords
      : project.targetWords,
  };
  const baseUser = buildOutlineUserPrompt(effectiveProject, bible);
  const maxTokens = MAX_OUTPUT_TOKENS;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    options?.onAttempt?.(attempt, MAX_ATTEMPTS);
    const user =
      attempt === 1 ? baseUser : buildOutlineRetryPrompt(baseUser, lastIssues);

    const raw = await ai.generateText({
      kind: "outline",
      system: OUTLINE_SYSTEM_PROMPT,
      user,
      temperature: 0.4,
      maxTokens,
      signal: options?.signal,
    });

    try {
      const outline = parseWithSchema(OutlineSchema, raw);
      const issues = validateOutline(outline, bible, {
        maxChapters: effectiveProject.maxChapters,
        chapterWords: effectiveProject.chapterWords,
      });
      if (issues.length === 0) return outline;
      lastIssues = issues;
    } catch (error) {
      lastIssues = [errorMessage(error)];
    }
  }

  throw new OutlineGenerationError(
    `Outline generation failed after ${MAX_ATTEMPTS} attempts:\n${lastIssues.join(
      "\n",
    )}`,
  );
}
