import { describe, expect, it } from "vitest";
import type { ForeshadowRecord } from "../src/domain/foreshadowStore.js";
import type { Chapter, ChapterSummary } from "../src/domain/schemas.js";
import {
  buildChapterContext,
  recentChaptersFor,
  selectCast,
  selectChapterBriefBlocks,
  selectRollingSummaryBlocks,
} from "../src/story/context.js";
import { makeBible, makeChapter, makeOutline, makeProject } from "./story-fixtures.js";

function makeStoredChapter(
  number: number,
  summary?: ChapterSummary,
  brief?: string,
): Chapter {
  const outline = makeChapter(number, 300);
  return {
    number,
    title: outline.title,
    outline,
    text: `第${number}章正文。这里是第${number}章的关键内容。`,
    wordCount: 20,
    status: "committed",
    ...(summary === undefined ? {} : { summary }),
    ...(brief === undefined ? {} : { brief }),
  };
}

function summaryAt(toChapter: number): ChapterSummary {
  return {
    fromChapter: Math.max(1, toChapter - 4),
    toChapter,
    text: `第${Math.max(1, toChapter - 4)}到${toChapter}章发生了什么。`,
  };
}

function record(
  title: string,
  status: ForeshadowRecord["status"],
  setupChapter: number,
  resolvedChapter?: number,
): ForeshadowRecord {
  return {
    id: 1,
    projectId: "project-1",
    title,
    setupChapter,
    status,
    note: `${title}备注`,
    updatedAtChapter: resolvedChapter ?? setupChapter,
    ...(resolvedChapter === undefined
      ? { plannedPayoffChapter: 8 }
      : { resolvedChapter }),
  };
}

describe("story memory injection", () => {
  it("selects only the previous chapter as full text", () => {
    const chapters = [1, 2, 3, 4, 5, 6].map((number) =>
      makeStoredChapter(number),
    );

    expect(recentChaptersFor(chapters, 6).map((chapter) => chapter.number)).toEqual([
      5,
    ]);
  });

  it("selects per-chapter briefs for N-2 through N-9", () => {
    const chapters = Array.from({ length: 12 }, (_, index) => {
      const number = index + 1;
      return makeStoredChapter(number, undefined, `第${number}章逐章摘要。`);
    });

    const blocks = selectChapterBriefBlocks(chapters, 12);

    expect(blocks.map((block) => block.chapterNumber)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(blocks.every((block) => block.source === "chapter")).toBe(true);
  });

  it("selects rolling blocks [1-5], [6-10] for chapter 20", () => {
    const chapters = [
      makeStoredChapter(5, summaryAt(5)),
      makeStoredChapter(10, summaryAt(10)),
      makeStoredChapter(15, summaryAt(15)),
    ];
    const outline = makeOutline(20, 300);

    const blocks = selectRollingSummaryBlocks(chapters, outline, 20);

    expect(blocks.map((block) => `${block.fromChapter}-${block.toChapter}`)).toEqual(
      ["1-5", "6-10"],
    );
    expect(blocks.every((block) => block.source === "chapter")).toBe(true);
  });

  it("falls back to outline rolling summaries when a block endpoint is missing", () => {
    const chapters = [makeStoredChapter(10, summaryAt(10))];
    const outline = makeOutline(20, 300);

    const blocks = selectRollingSummaryBlocks(chapters, outline, 20);

    expect(blocks.map((block) => `${block.fromChapter}-${block.toChapter}`)).toEqual(
      ["1-5", "6-10"],
    );
    expect(blocks[0]!.source).toBe("outline");
    expect(blocks[1]!.source).toBe("chapter");
  });

  it("injects full text, briefs, rolling summaries and both foreshadow groups in order", () => {
    const project = makeProject();
    const bible = makeBible(12);
    const outlineChapter = makeChapter(12, 300);
    const recentChapters = [makeStoredChapter(11)];
    const chapterBriefs = [
      {
        chapterNumber: 10,
        title: makeChapter(10, 300).title,
        text: "第10章逐章摘要。",
        source: "chapter" as const,
      },
    ];
    const summaries = [
      {
        fromChapter: 1,
        toChapter: 2,
        text: "第1到2章的滚动摘要。",
        source: "chapter" as const,
      },
    ];
    const ledger = [
      record("地脉印的裂纹", "resolved", 1, 4),
      record("旧城大火的目击者", "progressed", 2),
    ];

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      recentChapters,
      chapterBriefs,
      summaries,
      foreshadowLedger: ledger,
      cast: selectCast(bible, outlineChapter),
      state: {
        entities: [],
        relationships: [],
        foreshadows: [],
        events: [],
      },
      foreshadow: [],
      targetWords: 300,
    });

    const fullTextIndex = context.indexOf("上一章全文（第11章");
    const briefIndex = context.indexOf("逐章摘要（第10-10章");
    const rollingIndex = context.indexOf("更早章节滚动摘要（第1-2章");
    expect(fullTextIndex).toBeGreaterThan(-1);
    expect(briefIndex).toBeGreaterThan(fullTextIndex);
    expect(rollingIndex).toBeGreaterThan(briefIndex);
    expect(context).toContain("第11章正文");
    expect(context).not.toContain("第10章正文");
    expect(context).toContain("第10章逐章摘要。");
    expect(context).toContain("1-2章滚动摘要：第1到2章的滚动摘要。");
    expect(context).toContain("已回收伏笔：");
    expect(context).toContain("地脉印的裂纹");
    expect(context).toContain("未回收伏笔（");
    expect(context).toContain("旧城大火的目击者");
  });
});
