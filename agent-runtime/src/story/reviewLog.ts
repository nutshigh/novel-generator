import type { EndingAudit, Review } from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";

export const REVIEW_LOG_ARTIFACT = "review-log.jsonl";

export type ReviewLogStage = "initial" | "rereview" | "ending_repair";

interface ReviewLogBase {
  at: string;
  projectId: string;
  chapterNumber: number;
  chapterTitle: string;
  round: number;
}

export type ReviewLogEntry =
  | (ReviewLogBase & {
      type: "review";
      stage: ReviewLogStage;
      wordCount: number;
      review: Review;
    })
  | (ReviewLogBase & {
      type: "revision_decision";
      accepted: boolean;
      reason: string;
      originalWordCount: number;
      revisedWordCount: number;
    })
  | (ReviewLogBase & {
      type: "ending_audit";
      audit: EndingAudit;
    });

export async function appendReviewLog(
  store: ProjectStore,
  entry: ReviewLogEntry,
): Promise<void> {
  await store.appendArtifact(
    entry.projectId,
    REVIEW_LOG_ARTIFACT,
    `${JSON.stringify(entry)}\n`,
  );
}
