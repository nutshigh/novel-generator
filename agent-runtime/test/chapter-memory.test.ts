import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { Chapter } from "../src/domain/schemas.js";
import { extractChapterMemory } from "../src/story/chapterMemory.js";
import { makeChapter } from "./story-fixtures.js";

function makeStoredChapter(number: number): Chapter {
  const outline = makeChapter(number, 300);
  return {
    number,
    title: outline.title,
    outline,
    text: `第${number}章正文。林砚继续调查地脉印。`,
    wordCount: 18,
    status: "committed",
  };
}

describe("extractChapterMemory", () => {
  it("builds a digest, a per-chapter brief and a five-chapter rolling summary", async () => {
    const chapterNumber = 6;
    const chapter = makeStoredChapter(chapterNumber);
    const previousChapters = [2, 3, 4, 5].map(makeStoredChapter);

    const memory = await extractChapterMemory({
      chapter,
      previousChapters,
      foreshadows: [],
      ai: new FakeAiGateway(),
    });

    expect(memory.digest.coreSettings.length).toBeGreaterThan(0);
    expect(memory.digest.characters[0]?.name).toBe("林砚");
    expect(memory.brief).toContain("第6章");
    expect(memory.summary.fromChapter).toBe(2);
    expect(memory.summary.toChapter).toBe(6);
    expect(memory.summary.text.length).toBeGreaterThan(0);
  });
});
