import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { GenerateKind } from "../src/ai/gateway.js";
import { parseWithSchema } from "../src/ai/json.js";
import {
  EndingAuditSchema,
  OutlineSchema,
  ReviewSchema,
  StoryBibleSchema,
  StoryStateSchema,
  countWords,
} from "../src/domain/schemas.js";

const gateway = new FakeAiGateway();

function request(kind: GenerateKind, user: string): Parameters<typeof gateway.generateText>[0] {
  return { kind, system: "test", user };
}

async function bible() {
  return parseWithSchema(
    StoryBibleSchema,
    await gateway.generateText(
      request("bible", "PREMISE=一个少年在旧城觉醒。\nMAX_CHAPTERS=4"),
    ),
  );
}

function nonTrivialParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 10);
}

describe("FakeAiGateway", () => {
  it("returns a valid bible with deterministic story elements", async () => {
    const storyBible = await bible();

    expect(storyBible.characters).toHaveLength(3);
    expect(storyBible.world.factions).toHaveLength(1);
    expect(storyBible.items).toHaveLength(1);
    expect(storyBible.concepts).toHaveLength(1);
    expect(storyBible.foreshadowLedger).toHaveLength(3);
    for (const entry of storyBible.foreshadowLedger) {
      expect(entry.payoffChapter).toBeLessThanOrEqual(4);
      expect(entry.payoffChapter).toBeGreaterThanOrEqual(entry.setupChapter);
    }
  });

  it("returns a contiguous outline with the requested chapters and cast", async () => {
    const storyBible = await bible();
    const outline = parseWithSchema(
      OutlineSchema,
      await gateway.generateText(
        request("outline", "MAX_CHAPTERS=5\nCHAPTER_WORDS=700"),
      ),
    );

    const chapters = outline.volumes.flatMap((volume) =>
      volume.stages.flatMap((stage) => stage.chapters),
    );
    const names = new Set(storyBible.characters.map((character) => character.name));

    expect(outline.volumes).toHaveLength(1);
    expect(outline.volumes[0]!.stages).toHaveLength(2);
    expect(chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4, 5]);
    expect(chapters.every((chapter) => chapter.targetWords === 700)).toBe(true);
    expect(chapters.every((chapter) => chapter.cast.every((name) => names.has(name)))).toBe(
      true,
    );
  });

  it("uses one non-empty stage for a one-chapter outline", async () => {
    const outline = parseWithSchema(
      OutlineSchema,
      await gateway.generateText(
        request("outline", "MAX_CHAPTERS=1\nCHAPTER_WORDS=700"),
      ),
    );
    const stages = outline.volumes[0]!.stages;

    expect(stages).toHaveLength(1);
    expect(stages[0]!.chapters.map((chapter) => chapter.number)).toEqual([1]);
  });

  it("uses varied chapter and stage titles", async () => {
    const outline = parseWithSchema(
      OutlineSchema,
      await gateway.generateText(
        request("outline", "MAX_CHAPTERS=6\nCHAPTER_WORDS=800"),
      ),
    );
    const stages = outline.volumes[0]!.stages;
    const chapters = stages.flatMap((stage) => stage.chapters);
    const baseTitles = chapters.map((chapter) =>
      chapter.title.replace(/^第\d+章\s*/, ""),
    );

    expect(new Set(baseTitles).size).toBe(6);
    expect(new Set(stages.map((stage) => stage.title)).size).toBe(stages.length);
  });

  it("generates varied paragraphs without repeating one more than twice", async () => {
    const text = await gateway.generateText(
      request(
        "chapter",
        "CHAPTER_NUMBER=2\nCHAPTER_TARGET_WORDS=800\nROUND_WORDS=800\nROUND=1",
      ),
    );
    const paragraphs = nonTrivialParagraphs(text);
    const counts = new Map<string, number>();

    expect(countWords(text)).toBeGreaterThanOrEqual(800);
    expect(new Set(paragraphs).size).toBeGreaterThanOrEqual(5);

    for (const paragraph of paragraphs) {
      counts.set(paragraph, (counts.get(paragraph) ?? 0) + 1);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it("is deterministic for the same chapter and round", async () => {
    const input =
      "CHAPTER_NUMBER=3\nCHAPTER_TARGET_WORDS=800\nROUND_WORDS=800\nROUND=2";
    const first = await gateway.generateText(request("chapter", input));
    const second = await gateway.generateText(request("chapter", input));
    const nextRound = await gateway.generateText(
      request("chapter", input.replace("ROUND=2", "ROUND=3")),
    );

    expect(second).toBe(first);
    expect(nextRound).not.toBe(first);
  });

  it("returns Chinese prose of at least the requested chapter length without a title", async () => {
    const text = await gateway.generateText(
      request("chapter", "CHAPTER_NUMBER=3\nCHAPTER_TARGET_WORDS=120"),
    );

    expect(countWords(text)).toBeGreaterThanOrEqual(120);
    expect(countWords(text)).toBeLessThan(320);
    expect(text.startsWith("第3章")).toBe(false);
  });

  it("prefers ROUND_WORDS over CHAPTER_TARGET_WORDS for continuation", async () => {
    const text = await gateway.generateText(
      request(
        "chapter",
        "CHAPTER_NUMBER=3\nCHAPTER_TARGET_WORDS=120\nROUND_WORDS=20",
      ),
    );

    expect(countWords(text)).toBeGreaterThanOrEqual(20);
    expect(countWords(text)).toBeLessThan(120);
  });

  it("returns a passing review", async () => {
    const review = parseWithSchema(
      ReviewSchema,
      await gateway.generateText(request("review", "review this chapter")),
    );

    expect(review.gate).toBe("pass");
    expect(review.issues).toEqual([]);
  });

  it("returns a complete ending audit", async () => {
    const audit = parseWithSchema(
      EndingAuditSchema,
      await gateway.generateText(request("ending_audit", "audit this ending")),
    );

    expect(audit.complete).toBe(true);
    expect(audit.missing).toBe("");
  });

  it("returns valid state with at least one event", async () => {
    const state = parseWithSchema(
      StoryStateSchema,
      await gateway.generateText(request("state", "CHAPTER_NUMBER=2")),
    );

    expect(state.entities[0]!.entityName).toBe("林砚");
    expect(state.entities[0]!.updatedAtChapter).toBe(2);
    expect(state.events.length).toBeGreaterThanOrEqual(1);
    expect(state.events[0]!.chapterNumber).toBe(2);
  });

  it("returns revised prose of at least the requested length", async () => {
    const text = await gateway.generateText(
      request("revise", "TARGET_WORDS=90"),
    );

    expect(countWords(text)).toBeGreaterThanOrEqual(90);
  });
});
