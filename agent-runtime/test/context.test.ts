import { describe, expect, it } from "vitest";
import type { StoryState } from "../src/domain/schemas.js";
import {
  buildChapterContext,
  previousTail,
  selectCast,
} from "../src/story/context.js";
import { makeBible, makeChapter, makeProject } from "./story-fixtures.js";

function makeState(): StoryState {
  return {
    entities: [
      {
        entityName: "林砚",
        state: { location: "旧城石阶", condition: "左臂擦伤" },
        updatedAtChapter: 2,
      },
    ],
    relationships: [
      { source: "林砚", target: "苏晚", kind: "同伴", description: "暂时结盟" },
    ],
    foreshadows: [{ title: "地脉印的裂纹", status: "open" }],
    events: [{ summary: "两人在石阶发现新的脚印。", chapterNumber: 2 }],
  };
}

describe("selectCast", () => {
  it("returns only characters listed in the chapter cast", () => {
    const bible = makeBible(6);
    const chapter = makeChapter(2);

    const cast = selectCast(bible, chapter);

    expect(cast.map((character) => character.name)).toEqual(["林砚", "苏晚"]);
  });

  it("throws a clear error when a cast name is missing from the bible", () => {
    const bible = makeBible(6);
    const chapter = { ...makeChapter(2), cast: ["林砚", "陌生人"] };

    expect(() => selectCast(bible, chapter)).toThrow(/陌生人/);
    expect(() => selectCast(bible, chapter)).toThrow(/not found in story bible/i);
  });
});

describe("previousTail", () => {
  it("returns the last characters of the text", () => {
    const text = `${"前".repeat(2200)}结尾标记`;

    const tail = previousTail(text);

    expect(Array.from(tail)).toHaveLength(2000);
    expect(tail.endsWith("结尾标记")).toBe(true);
  });

  it("honors a custom character limit by code point", () => {
    const tail = previousTail(`${"甲".repeat(20)}😀乙`, 2);

    expect(tail).toBe("😀乙");
    expect(Array.from(tail)).toHaveLength(2);
  });

  it("returns short text unchanged and empty text for a zero limit", () => {
    expect(previousTail("短文。", 100)).toBe("短文。");
    expect(previousTail("短文。", 0)).toBe("");
  });
});

describe("buildChapterContext", () => {
  it("includes style, outline, next summary, previous tail, cast, state, and foreshadow", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const nextOutlineChapter = makeChapter(3, 500);
    const cast = selectCast(bible, outlineChapter);
    const previousChapterText = `${"前".repeat(2100)}上一章结尾`;

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      nextOutlineChapter,
      previousChapterText,
      cast,
      state: makeState(),
      foreshadow: bible.foreshadowLedger,
      targetWords: 500,
    });

    expect(context).toContain("CHAPTER_TARGET_WORDS=500");
    expect(context).toContain("ROUND_WORDS=500");
    expect(context).toContain("CHAPTER_NUMBER=2");
    expect(context).toContain(bible.logline);
    expect(context).toContain(bible.synopsis);
    expect(context).toContain(bible.world.rules[0]!);
    expect(context).toContain(bible.world.powerSystem.costs[0]!);
    expect(context).toContain(bible.styleGuide.aiFlavorBlacklist[0]!);
    expect(context).toContain(outlineChapter.title);
    expect(context).toContain(outlineChapter.goal);
    expect(context).toContain(outlineChapter.conflict);
    expect(context).toContain(outlineChapter.turn);
    expect(context).toContain(outlineChapter.reveal);
    expect(context).toContain(outlineChapter.hook);
    expect(context).toContain("下一章");
    expect(context).toContain(nextOutlineChapter.summary);
    expect(context).not.toContain(nextOutlineChapter.reveal);
    expect(context).toContain("上一章结尾");
    expect(context).toContain("林砚");
    expect(context).toContain("苏晚");
    expect(context).toContain(cast[0]!.goal);
    expect(context).not.toContain("角色：顾沉");
    expect(context).toContain("旧城石阶");
    expect(context).toContain("地脉印的裂纹");
  });

  it("includes bible items, concepts, and matching item state", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);
    const state = makeState();
    state.entities.push({
      entityName: bible.items[0]!,
      state: { holder: "林砚", condition: "裂纹加深" },
      updatedAtChapter: 2,
    });

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state,
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain("物品/概念状态");
    expect(context).toContain(bible.items[0]!);
    expect(context).toContain(bible.concepts[0]!);
    expect(context).toContain("condition=裂纹加深");
  });

  it("matches item state names by safe containment", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);
    const state = makeState();
    state.entities.push({
      entityName: "地脉印",
      state: { condition: "裂纹继续扩大" },
      updatedAtChapter: 2,
    });

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state,
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain(bible.items[0]!);
    expect(context).toContain("condition=裂纹继续扩大");
  });

  it("does not attribute an item to a character whose name it contains", () => {
    const project = makeProject();
    const bible = makeBible(6);
    bible.items.push("林砚的剑");
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);
    const state = makeState();
    state.entities.push({
      entityName: "林砚",
      state: { itemState: "不应归到剑上" },
      updatedAtChapter: 2,
    });

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state,
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain("- 林砚的剑｜状态：（无）");
    expect(context).not.toContain("- 林砚的剑｜itemState=");
  });

  it("excludes extra cast members that are not in the chapter outline", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast: bible.characters,
      state: makeState(),
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain("角色：林砚");
    expect(context).toContain("角色：苏晚");
    expect(context).not.toContain("角色：顾沉");
    expect(context).not.toContain("礼貌而压迫");
  });

  it("excludes non-cast entities and relationships from state", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);
    const state = makeState();
    state.entities.push({
      entityName: "顾沉",
      state: { location: "钟楼密道" },
      updatedAtChapter: 2,
    });
    state.relationships.push({
      source: "林砚",
      target: "顾沉",
      kind: "秘密交易",
      description: "暗线接触",
    });

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state,
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain("暂时结盟");
    expect(context).not.toContain("钟楼密道");
    expect(context).not.toContain("秘密交易");
    expect(context).not.toContain("暗线接触");
  });

  it("filters future events, sorts by chapter, and caps to the latest ten", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(20, 500);
    const cast = selectCast(bible, outlineChapter);
    const state = makeState();
    state.events = [
      { summary: "E12", chapterNumber: 12 },
      { summary: "E25", chapterNumber: 25 },
      { summary: "E01", chapterNumber: 1 },
      ...Array.from({ length: 10 }, (_, index) => ({
        summary: `E${String(index + 2).padStart(2, "0")}`,
        chapterNumber: index + 2,
      })),
    ];

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state,
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).not.toContain("E01");
    expect(context).not.toContain("E02");
    expect(context).not.toContain("E25");
    for (let index = 3; index <= 12; index += 1) {
      expect(context).toContain(`E${String(index).padStart(2, "0")}`);
    }
  });

  it("treats planned foreshadows with reached setup as open continuity", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state: makeState(),
      foreshadow: [
        {
          setupChapter: 1,
          payoffChapter: 20,
          title: "已埋设但回收尚远",
          status: "planned",
        },
      ],
      targetWords: 500,
    });

    expect(context).toContain("已埋设但回收尚远");
  });

  it("excludes closed and future foreshadows while including near-payoff entries", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(2, 500);
    const cast = selectCast(bible, outlineChapter);

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state: makeState(),
      foreshadow: [
        {
          setupChapter: 1,
          payoffChapter: 2,
          title: "已解决伏笔",
          status: "resolved",
        },
        {
          setupChapter: 1,
          payoffChapter: 2,
          title: "已放弃伏笔",
          status: "abandoned",
        },
        {
          setupChapter: 2,
          payoffChapter: 7,
          title: "临近回收伏笔",
          status: "planned",
        },
        {
          setupChapter: 5,
          payoffChapter: 12,
          title: "未来设置伏笔",
          status: "planned",
        },
        {
          setupChapter: 8,
          payoffChapter: 20,
          title: "未来开启伏笔",
          status: "open",
        },
      ],
      targetWords: 500,
    });

    expect(context).toContain("临近回收伏笔");
    expect(context).not.toContain("已解决伏笔");
    expect(context).not.toContain("已放弃伏笔");
    expect(context).not.toContain("未来设置伏笔");
    expect(context).not.toContain("未来开启伏笔");
  });

  it("does not include a next chapter when the outline ends", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(6, 500);
    const cast = selectCast(bible, outlineChapter);

    const context = buildChapterContext({
      project,
      bible,
      outlineChapter,
      cast,
      state: makeState(),
      foreshadow: [],
      targetWords: 500,
    });

    expect(context).toContain("下一章");
    expect(context).toContain("无");
    expect(context).not.toContain("上一章结尾");
  });
});
