import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import { StoryBibleSchema, type Project, type StoryBible } from "../domain/schemas.js";
import {
  BIBLE_SYSTEM_PROMPT,
  buildBibleRetryPrompt,
  buildBibleUserPrompt,
} from "../prompts/defaults.js";

const MAX_ATTEMPTS = 2;

export interface GenerateBibleOptions {
  signal?: AbortSignal;
  /** Called before each model attempt, so long retries are visible. */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
}

export class BibleGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BibleGenerationError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function validateBible(bible: StoryBible, maxChapters: number): string[] {
  const issues: string[] = [];

  if (bible.characters.length === 0) {
    issues.push("Story bible must contain at least one character.");
  }

  if (
    !bible.characters.some((character) =>
      /主角|主人公|男主|女主|protagonist/i.test(character.role),
    )
  ) {
    issues.push("Story bible must include a protagonist character.");
  }

  if (bible.ending.trim().length === 0) {
    issues.push("Story bible must define a non-empty ending.");
  }

  bible.foreshadowLedger.forEach((entry, index) => {
    const label = entry.title.trim() || `#${index + 1}`;

    if (entry.setupChapter < 1 || entry.setupChapter > maxChapters) {
      issues.push(
        `Foreshadow ${label} setupChapter ${entry.setupChapter} is outside 1..${maxChapters}.`,
      );
    }

    if (entry.payoffChapter < 1 || entry.payoffChapter > maxChapters) {
      issues.push(
        `Foreshadow ${label} payoffChapter ${entry.payoffChapter} is outside 1..${maxChapters}.`,
      );
    }

    if (entry.payoffChapter < entry.setupChapter) {
      issues.push(`Foreshadow ${label} pays off before it is set up.`);
    }
  });

  return issues;
}

export async function generateBible(
  project: Project,
  ai: AiGateway,
  options?: GenerateBibleOptions,
): Promise<StoryBible> {
  const baseUser = buildBibleUserPrompt(project);
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    options?.onAttempt?.(attempt, MAX_ATTEMPTS);
    const user =
      attempt === 1 ? baseUser : buildBibleRetryPrompt(baseUser, lastError);

    const raw = await ai.generateText({
      kind: "bible",
      system: BIBLE_SYSTEM_PROMPT,
      user,
      temperature: 0.7,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: options?.signal,
    });

    try {
      const bible = parseWithSchema(StoryBibleSchema, raw);
      const issues = validateBible(bible, project.maxChapters);
      if (issues.length === 0) return bible;
      lastError = issues.join("\n");
    } catch (error) {
      lastError = errorMessage(error);
    }
  }

  throw new BibleGenerationError(
    `Story bible generation failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
  );
}
