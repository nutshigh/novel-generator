import { randomUUID } from "node:crypto";
import {
  MAX_INITIAL_CHAPTERS,
  ProjectSchema,
  type Project,
} from "../domain/schemas.js";

export interface CreateStoryProjectInput {
  premise: string;
  language?: string;
  targetWords?: number;
  chapterWords?: number;
  maxChapters?: number;
  reviewEnabled?: boolean;
}

const DEFAULT_LANGUAGE = "简体中文";
const DEFAULT_CHAPTER_WORDS = 800;
const DEFAULT_MAX_CHAPTERS = 6;
const MIN_TARGET_WORDS = 200;

export function createProject(input: CreateStoryProjectInput): Project {
  const premise = input.premise.trim();
  if (premise.length === 0) {
    throw new Error("Project premise must not be empty.");
  }

  const chapterWords = input.chapterWords ?? DEFAULT_CHAPTER_WORDS;
  const maxChapters = input.maxChapters ?? DEFAULT_MAX_CHAPTERS;
  if (maxChapters > MAX_INITIAL_CHAPTERS) {
    throw new Error(
      `A new book can start with at most ${MAX_INITIAL_CHAPTERS} chapters; use continuation to extend it later.`,
    );
  }
  const targetWords =
    input.targetWords ??
    Math.max(MIN_TARGET_WORDS, chapterWords * maxChapters);
  const language = input.language?.trim();

  return ProjectSchema.parse({
    id: randomUUID(),
    premise,
    language: language && language.length > 0 ? language : DEFAULT_LANGUAGE,
    targetWords,
    chapterWords,
    maxChapters,
    reviewEnabled: input.reviewEnabled ?? false,
    status: "draft",
    createdAt: new Date().toISOString(),
  });
}
