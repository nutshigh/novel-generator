import { z } from "zod";

export const MAX_INITIAL_CHAPTERS = 200;
export const MAX_EXTENSION_BATCH = 20;

export const ProjectStatusSchema = z.enum([
  "draft",
  "running",
  "completed",
  "failed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().min(1),
  premise: z.string(),
  language: z.string().default("简体中文"),
  targetWords: z.number().int().min(200),
  chapterWords: z.number().int().min(200).max(20_000),
  maxChapters: z.number().int().min(1),
  status: ProjectStatusSchema,
  /**
   * Legacy quality gate. Director mode turns review, revision and ending audit
   * off; set this to true only when the deterministic pipeline should re-enable
   * those extra model calls.
   */
  reviewEnabled: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

export const PowerSystemSchema = z.object({
  levels: z.array(z.string()),
  costs: z.array(z.string()),
  limits: z.array(z.string()),
});
export type PowerSystem = z.infer<typeof PowerSystemSchema>;

export const WorldSchema = z.object({
  rules: z.array(z.string()),
  powerSystem: PowerSystemSchema,
  factions: z.array(z.string()),
  society: z.array(z.string()),
  taboos: z.array(z.string()),
});
export type World = z.infer<typeof WorldSchema>;

export const CharacterSchema = z.object({
  name: z.string(),
  role: z.string(),
  goal: z.string(),
  motivation: z.string(),
  wound: z.string(),
  arc: z.string(),
  voice: z.string(),
  secrets: z.array(z.string()),
  relationships: z.array(z.string()),
});
export type Character = z.infer<typeof CharacterSchema>;

export const StyleGuideSchema = z.object({
  pov: z.string(),
  tense: z.string(),
  sentenceRhythm: z.string(),
  dialogueRatio: z.string(),
  descriptionDensity: z.string(),
  bannedPhrases: z.array(z.string()),
  aiFlavorBlacklist: z.array(z.string()),
  webNovelPrinciples: z.array(z.string()),
});
export type StyleGuide = z.infer<typeof StyleGuideSchema>;

export const ForeshadowStatusSchema = z.enum([
  "planned",
  "open",
  "progressed",
  "resolved",
  "abandoned",
]);
export type ForeshadowStatus = z.infer<typeof ForeshadowStatusSchema>;

export const ForeshadowLedgerEntrySchema = z.object({
  setupChapter: z.number().int().positive(),
  payoffChapter: z.number().int().positive(),
  title: z.string(),
  status: ForeshadowStatusSchema,
});
export type ForeshadowLedgerEntry = z.infer<typeof ForeshadowLedgerEntrySchema>;

export const StoryBibleSchema = z.object({
  logline: z.string(),
  synopsis: z.string(),
  genre: z.array(z.string()),
  audience: z.string(),
  themes: z.array(z.string()),
  tone: z.string(),
  pov: z.string(),
  tense: z.string(),
  ending: z.string(),
  world: WorldSchema,
  characters: z.array(CharacterSchema),
  items: z.array(z.string()),
  concepts: z.array(z.string()),
  styleGuide: StyleGuideSchema,
  foreshadowLedger: z.array(ForeshadowLedgerEntrySchema),
  assumptions: z.array(z.string()),
});
export type StoryBible = z.infer<typeof StoryBibleSchema>;

export const OutlineChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  pov: z.string(),
  cast: z.array(z.string()),
  goal: z.string(),
  conflict: z.string(),
  turn: z.string(),
  reveal: z.string(),
  hook: z.string(),
  targetWords: z.number().int().positive(),
});
export type OutlineChapter = z.infer<typeof OutlineChapterSchema>;

export const OutlineStageSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  chapters: z.array(OutlineChapterSchema),
});
export type OutlineStage = z.infer<typeof OutlineStageSchema>;

export const OutlineVolumeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  stages: z.array(OutlineStageSchema),
});
export type OutlineVolume = z.infer<typeof OutlineVolumeSchema>;

export const OutlineSchema = z.object({
  volumes: z.array(OutlineVolumeSchema),
});
export type Outline = z.infer<typeof OutlineSchema>;

export const OutlineExtensionSchema = z.object({
  volume: z.object({
    title: z.string(),
    summary: z.string(),
  }),
  stage: z.object({
    title: z.string(),
    summary: z.string(),
  }),
  chapters: z.array(OutlineChapterSchema),
});
export type OutlineExtension = z.infer<typeof OutlineExtensionSchema>;

export const ReviewIssueTypeSchema = z.enum([
  "logic",
  "character",
  "setting",
  "pacing",
  "ai_flavor",
  "hook",
  "other",
]);
export type ReviewIssueType = z.infer<typeof ReviewIssueTypeSchema>;

export const ReviewIssueSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  type: ReviewIssueTypeSchema,
  quote: z.string(),
  problem: z.string(),
  fix: z.string(),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewSchema = z.object({
  gate: z.enum(["pass", "revise", "block"]),
  summary: z.string(),
  issues: z.array(ReviewIssueSchema),
});
export type Review = z.infer<typeof ReviewSchema>;

export const EndingAuditSchema = z.object({
  complete: z.boolean(),
  reason: z.string(),
  missing: z.string(),
});
export type EndingAudit = z.infer<typeof EndingAuditSchema>;

export const BoundaryRelationSchema = z.enum(["continue", "cut", "broken"]);
export type BoundaryRelation = z.infer<typeof BoundaryRelationSchema>;

export const BoundaryActionSchema = z.enum([
  "none",
  "close_previous",
  "anchor_next",
  "both",
  "flag",
]);
export type BoundaryAction = z.infer<typeof BoundaryActionSchema>;

export const BoundaryFactStatusSchema = z.enum([
  "continued",
  "deferred",
  "ignored",
  "contradicted",
]);
export type BoundaryFactStatus = z.infer<typeof BoundaryFactStatusSchema>;

export const BoundaryFactCheckSchema = z.object({
  fact: z.string(),
  status: BoundaryFactStatusSchema,
  evidence: z.string(),
});
export type BoundaryFactCheck = z.infer<typeof BoundaryFactCheckSchema>;

export const BoundaryAuditSchema = z.object({
  relation: BoundaryRelationSchema,
  previousEndComplete: z.boolean(),
  previousEndHookEffective: z.boolean(),
  nextStartAnchored: z.boolean(),
  factChecks: z.array(BoundaryFactCheckSchema),
  danglingThreads: z.array(z.string()),
  contradictions: z.array(z.string()),
  action: BoundaryActionSchema,
  reason: z.string(),
  repairBrief: z.string(),
});
export type BoundaryAudit = z.infer<typeof BoundaryAuditSchema>;

export const SeamRepairSchema = z.object({
  previousTail: z.string(),
  previousParagraphs: z.number().int().min(0).max(2),
  nextHead: z.string(),
  nextParagraphs: z.number().int().min(0).max(2),
  notes: z.string(),
});
export type SeamRepair = z.infer<typeof SeamRepairSchema>;

export const EntityStateSchema = z.object({
  entityName: z.string(),
  state: z.record(z.string()),
  updatedAtChapter: z.number().int().positive(),
});
export type EntityState = z.infer<typeof EntityStateSchema>;

export const RelationshipSchema = z.object({
  source: z.string(),
  target: z.string(),
  kind: z.string(),
  description: z.string(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const ForeshadowStateSchema = z.object({
  title: z.string(),
  status: ForeshadowStatusSchema,
  note: z.string().optional(),
});
export type ForeshadowState = z.infer<typeof ForeshadowStateSchema>;

export const StoryEventSchema = z.object({
  summary: z.string(),
  chapterNumber: z.number().int().positive(),
});
export type StoryEvent = z.infer<typeof StoryEventSchema>;

export const StoryStateSchema = z.object({
  entities: z.array(EntityStateSchema),
  relationships: z.array(RelationshipSchema),
  foreshadows: z.array(ForeshadowStateSchema),
  events: z.array(StoryEventSchema),
});
export type StoryState = z.infer<typeof StoryStateSchema>;

export const ChapterStatusSchema = z.enum([
  "planned",
  "drafted",
  "reviewed",
  "committed",
  "needs_attention",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const DigestSettingSchema = z.object({
  type: z.string(),
  name: z.string(),
  detail: z.string(),
});
export type DigestSetting = z.infer<typeof DigestSettingSchema>;

export const DigestCharacterSchema = z.object({
  name: z.string(),
  roleInChapter: z.string(),
  goal: z.string(),
  change: z.string(),
});
export type DigestCharacter = z.infer<typeof DigestCharacterSchema>;

export const DigestPlotNodeSchema = z.object({
  summary: z.string(),
  impact: z.string(),
});
export type DigestPlotNode = z.infer<typeof DigestPlotNodeSchema>;

export const DigestRelationshipSchema = z.object({
  source: z.string(),
  target: z.string(),
  change: z.string(),
  reason: z.string(),
});
export type DigestRelationship = z.infer<typeof DigestRelationshipSchema>;

export const DigestForeshadowActionSchema = z.enum([
  "setup",
  "progress",
  "payoff",
  "mention",
]);
export type DigestForeshadowAction = z.infer<
  typeof DigestForeshadowActionSchema
>;

export const DigestForeshadowSchema = z.object({
  title: z.string(),
  action: DigestForeshadowActionSchema,
  note: z.string().default(""),
});
export type DigestForeshadow = z.infer<typeof DigestForeshadowSchema>;

export const ChapterDigestSchema = z.object({
  coreSettings: z.array(DigestSettingSchema),
  characters: z.array(DigestCharacterSchema),
  plotNodes: z.array(DigestPlotNodeSchema),
  relationshipProgress: z.array(DigestRelationshipSchema),
  foreshadows: z.array(DigestForeshadowSchema),
});
export type ChapterDigest = z.infer<typeof ChapterDigestSchema>;

export const ChapterSummarySchema = z.object({
  fromChapter: z.number().int().positive(),
  toChapter: z.number().int().positive(),
  text: z.string(),
});
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;

export const ChapterMemorySchema = z.object({
  digest: ChapterDigestSchema,
  brief: z.string(),
  summary: ChapterSummarySchema,
});
export type ChapterMemory = z.infer<typeof ChapterMemorySchema>;

export const ChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  outline: OutlineChapterSchema,
  text: z.string(),
  wordCount: z.number().int().nonnegative(),
  review: ReviewSchema.optional(),
  stateSnapshot: StoryStateSchema.optional(),
  digest: ChapterDigestSchema.optional(),
  /** Two-to-three sentence summary of this chapter only. */
  brief: z.string().optional(),
  summary: ChapterSummarySchema.optional(),
  status: ChapterStatusSchema,
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const RunProgressSchema = z.object({
  phase: z.string(),
  message: z.string(),
  chapterNumber: z.number().optional(),
  wordCount: z.number().optional(),
  draftWords: z.number().optional(),
  gate: z.string().optional(),
  error: z.string().optional(),
  /** ISO timestamp assigned by the server when the event is recorded. */
  at: z.string().optional(),
  /** How long the completed step took, in milliseconds. */
  durationMs: z.number().optional(),
});
export type RunProgress = z.infer<typeof RunProgressSchema>;

export function validateOutline(
  outline: Outline,
  bible: StoryBible,
  options?: { maxChapters?: number; chapterWords?: number },
): string[] {
  const issues: string[] = [];
  const castNames = new Set(bible.characters.map((character) => character.name));
  const chapters = outline.volumes.flatMap((volume) =>
    volume.stages.flatMap((stage) => stage.chapters),
  );

  if (chapters.length === 0) {
    issues.push("Outline must contain at least one chapter.");
  }

  if (options?.maxChapters !== undefined && chapters.length !== options.maxChapters) {
    issues.push(
      `Outline has ${chapters.length} chapters; expected ${options.maxChapters}.`,
    );
  }

  chapters.forEach((chapter, index) => {
    const expected = index + 1;
    if (chapter.number !== expected) {
      issues.push(`Chapter ${chapter.number} is out of sequence; expected ${expected}.`);
    }

    for (const field of ["goal", "conflict", "turn", "reveal", "hook"] as const) {
      if (chapter[field].trim().length === 0) {
        issues.push(`Chapter ${chapter.number} has an empty ${field}.`);
      }
    }

    for (const name of chapter.cast) {
      if (!castNames.has(name)) {
        issues.push(
          `Chapter ${chapter.number} references cast member not in bible: ${name}.`,
        );
      }
    }

    if (!Number.isFinite(chapter.targetWords) || chapter.targetWords <= 0) {
      issues.push(`Chapter ${chapter.number} must have targetWords greater than 0.`);
    }

    if (
      options?.chapterWords !== undefined &&
      chapter.targetWords < options.chapterWords * 0.8
    ) {
      issues.push(
        `Chapter ${chapter.number} targetWords ${chapter.targetWords} is below ${
          options.chapterWords * 0.8
        }.`,
      );
    }

    if (
      options?.chapterWords !== undefined &&
      chapter.targetWords > options.chapterWords * 2
    ) {
      issues.push(
        `Chapter ${chapter.number} targetWords ${chapter.targetWords} exceeds ${
          options.chapterWords * 2
        }.`,
      );
    }
  });

  for (const entry of bible.foreshadowLedger) {
    if (entry.payoffChapter < entry.setupChapter) {
      issues.push(`Foreshadow ${entry.title} pays off before it is set up.`);
    }

    if (
      options?.maxChapters !== undefined &&
      entry.payoffChapter > options.maxChapters
    ) {
      issues.push(
        `Foreshadow ${entry.title} payoff chapter ${entry.payoffChapter} exceeds maxChapters ${options.maxChapters}.`,
      );
    }
  }

  return issues;
}

export function validateChapter(chapter: Chapter): string[] {
  const issues: string[] = [];

  if (chapter.number !== chapter.outline.number) {
    issues.push(
      `Chapter ${chapter.number} number does not match outline number ${chapter.outline.number}.`,
    );
  }

  const actualWordCount = countWords(chapter.text);
  if (chapter.wordCount !== actualWordCount) {
    issues.push(
      `Chapter ${chapter.number} wordCount ${chapter.wordCount} does not match text word count ${actualWordCount}.`,
    );
  }

  for (const event of chapter.stateSnapshot?.events ?? []) {
    if (event.chapterNumber > chapter.number) {
      issues.push(
        `Chapter ${chapter.number} state snapshot contains event from chapter ${event.chapterNumber}.`,
      );
    }
  }

  for (const entity of chapter.stateSnapshot?.entities ?? []) {
    if (entity.updatedAtChapter > chapter.number) {
      issues.push(
        `Chapter ${chapter.number} state snapshot contains entity ${entity.entityName} updated in chapter ${entity.updatedAtChapter}.`,
      );
    }
  }

  if (chapter.summary) {
    if (chapter.summary.toChapter !== chapter.number) {
      issues.push(
        `Chapter ${chapter.number} summary ends at chapter ${chapter.summary.toChapter}.`,
      );
    }
    if (chapter.summary.fromChapter > chapter.summary.toChapter) {
      issues.push(
        `Chapter ${chapter.number} summary starts after it ends.`,
      );
    }
  }

  return issues;
}

export function countWords(text: string): number {
  return Array.from(text).filter((character) => !/\s/u.test(character)).length;
}
