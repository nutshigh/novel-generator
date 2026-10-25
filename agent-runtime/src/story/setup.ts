import type { ZodType } from "zod";
import type { AiGateway } from "../ai/gateway.js";
import {
  OutlineSchema,
  ProjectSchema,
  StoryBibleSchema,
  validateOutline,
  type Outline,
  type Project,
  type StoryBible,
} from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";
import { generateBible, validateBible } from "./bible.js";
import {
  MAX_SUPPORTED_CHAPTERS,
  OutlineGenerationError,
  flattenChapters,
  generateOutline,
  type OutlineGenerationOptions,
} from "./outline.js";

const BIBLE_ARTIFACT = "bible.json";
const OUTLINE_ARTIFACT = "outline.json";

export interface StorySetup {
  project: Project;
  bible: StoryBible;
  outline: Outline;
}

export type StorySetupStep = "bible" | "outline";

export interface StorySetupStepEvent {
  step: StorySetupStep;
  status: "start" | "done";
  /** Wall-clock duration of the finished step. */
  durationMs?: number;
  /** Number of chapters in the finished outline. */
  chapterCount?: number;
}

export interface StorySetupOptions extends OutlineGenerationOptions {
  onStep?: (event: StorySetupStepEvent) => void;
}

export class StorySetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorySetupError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readArtifact<T>(
  store: ProjectStore,
  projectId: string,
  name: string,
  schema: ZodType<T>,
): Promise<T> {
  const raw = await store.readArtifact(projectId, name);
  if (raw === undefined) {
    throw new StorySetupError(
      `Missing artifact ${name} for project ${projectId}.`,
    );
  }

  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new StorySetupError(
      `Invalid artifact ${name} for project ${projectId}: ${errorMessage(error)}`,
    );
  }
}

export async function generateStorySetup(
  project: Project,
  ai: AiGateway,
  store: ProjectStore,
  options?: StorySetupOptions,
): Promise<StorySetup> {
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

  const parsedProject = ProjectSchema.safeParse(effectiveProject);
  if (!parsedProject.success) {
    const issues = parsedProject.error.issues
      .map(
        (issue) =>
          `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("; ");
    throw new StorySetupError(
      `Invalid effective project for ${project.id}: ${issues}`,
    );
  }

  const setupProject = parsedProject.data;

  const bibleStartedAt = Date.now();
  options?.onStep?.({ step: "bible", status: "start" });
  const bible = await generateBible(setupProject, ai, {
    signal: options?.signal,
    ...(options?.onAttempt === undefined
      ? {}
      : { onAttempt: options.onAttempt }),
  });
  options?.onStep?.({
    step: "bible",
    status: "done",
    durationMs: Date.now() - bibleStartedAt,
  });

  const outlineStartedAt = Date.now();
  options?.onStep?.({ step: "outline", status: "start" });
  const outline = await generateOutline(setupProject, bible, ai, options);
  options?.onStep?.({
    step: "outline",
    status: "done",
    durationMs: Date.now() - outlineStartedAt,
    chapterCount: flattenChapters(outline).length,
  });

  await store.saveProject(setupProject);
  await store.saveArtifact(project.id, BIBLE_ARTIFACT, JSON.stringify(bible, null, 2));
  await store.saveArtifact(
    project.id,
    OUTLINE_ARTIFACT,
    JSON.stringify(outline, null, 2),
  );

  return { project: setupProject, bible, outline };
}

export async function loadStorySetup(
  store: ProjectStore,
  projectId: string,
): Promise<StorySetup> {
  const project = await store.getProject(projectId);
  if (!project) {
    throw new StorySetupError(`Project not found: ${projectId}.`);
  }

  const bible = await readArtifact(store, projectId, BIBLE_ARTIFACT, StoryBibleSchema);
  const outline = await readArtifact(
    store,
    projectId,
    OUTLINE_ARTIFACT,
    OutlineSchema,
  );

  const bibleIssues = validateBible(bible, project.maxChapters);
  if (bibleIssues.length > 0) {
    throw new StorySetupError(
      `Invalid ${BIBLE_ARTIFACT} for project ${projectId}:\n${bibleIssues.join(
        "\n",
      )}`,
    );
  }

  const outlineIssues = validateOutline(outline, bible, {
    maxChapters: project.maxChapters,
    chapterWords: project.chapterWords,
  });
  if (outlineIssues.length > 0) {
    throw new StorySetupError(
      `Invalid ${OUTLINE_ARTIFACT} for project ${projectId}:\n${outlineIssues.join(
        "\n",
      )}`,
    );
  }

  return { project, bible, outline };
}
