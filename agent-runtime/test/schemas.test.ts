import { describe, expect, it } from "vitest";
import {
  ChapterSchema,
  ProjectSchema,
  ReviewSchema,
  StoryBibleSchema,
  StoryStateSchema,
  countWords,
  validateChapter,
  validateOutline,
  type Chapter,
  type Outline,
  type OutlineChapter,
  type StoryBible,
} from "../src/domain/schemas.js";

function makeBible(): StoryBible {
  return {
    logline: "一个少年在旧城觉醒，被迫卷入王朝与宗门的暗战。",
    synopsis: "林砚从青石镇出发，在苏晚与顾沉的帮助下追查失落传承。",
    genre: ["东方玄幻", "成长"],
    audience: "喜欢长篇成长故事的读者",
    themes: ["成长", "选择", "责任"],
    tone: "热血而克制",
    pov: "第三人称限知",
    tense: "过去时",
    ending: "林砚付出代价守住旧城，并揭开传承的真正用途。",
    world: {
      rules: ["灵力来自地脉", "越阶施术必受反噬"],
      powerSystem: {
        levels: ["引气", "凝脉", "开府", "化神"],
        costs: ["消耗寿元", "透支经脉"],
        limits: ["无法同时操控两种地脉"],
      },
      factions: ["玄烬宗"],
      society: ["旧城行会掌握粮道"],
      taboos: ["不得唤醒地脉深处的古兽"],
    },
    characters: [
      {
        name: "林砚",
        role: "主角",
        goal: "查清师父失踪的真相",
        motivation: "保护仅存的家人",
        wound: "幼年目睹旧城大火",
        arc: "从只想自保到主动承担",
        voice: "寡言但观察细致",
        secrets: ["体内藏有半枚地脉印"],
        relationships: ["苏晚是并肩同伴"],
      },
      {
        name: "苏晚",
        role: "同伴",
        goal: "找回被夺走的宗门典籍",
        motivation: "替师门洗清污名",
        wound: "曾被同门背叛",
        arc: "学会重新信任他人",
        voice: "冷静、准确、偶尔尖锐",
        secrets: ["知道旧城大火的另一版本"],
        relationships: ["与林砚互相试探后结盟"],
      },
      {
        name: "顾沉",
        role: "对手",
        goal: "夺取地脉印",
        motivation: "证明自己配得上宗主之位",
        wound: "长期被父亲否定",
        arc: "从执念走向自我毁灭",
        voice: "礼貌而压迫",
        secrets: ["与玄烬宗禁术有关"],
        relationships: ["把林砚视为必须超越的变量"],
      },
    ],
    items: ["半枚地脉印"],
    concepts: ["地脉回响"],
    styleGuide: {
      pov: "第三人称限知",
      tense: "过去时",
      sentenceRhythm: "长短句交替，关键处短句收束",
      dialogueRatio: "约百分之三十五",
      descriptionDensity: "中等，优先动作与感官",
      bannedPhrases: ["不禁", "嘴角微扬"],
      aiFlavorBlacklist: ["仿佛", "似乎", "某种"],
      webNovelPrinciples: ["每章有钩子", "信息密度高", "冲突推动情节"],
    },
    foreshadowLedger: [
      { setupChapter: 1, payoffChapter: 2, title: "半枚地脉印的裂纹", status: "planned" },
      { setupChapter: 2, payoffChapter: 3, title: "旧城大火的目击者", status: "planned" },
      { setupChapter: 1, payoffChapter: 3, title: "顾沉的禁术印记", status: "planned" },
    ],
    assumptions: ["旧城位于地脉交汇处"],
  };
}

function makeChapter(number: number): OutlineChapter {
  return {
    number,
    title: `第 ${number} 章`,
    summary: `第 ${number} 章摘要`,
    pov: "林砚",
    cast: ["林砚", "苏晚"],
    goal: "推进调查",
    conflict: "线索被人提前清理",
    turn: "发现新的目击者",
    reveal: "地脉印与旧城大火有关",
    hook: "门外传来第二个人名的暗号",
    targetWords: 800,
  };
}

function makeOutline(): Outline {
  return {
    volumes: [
      {
        number: 1,
        title: "第一卷 旧城火",
        summary: "林砚追查师父失踪与旧城大火。",
        stages: [
          {
            number: 1,
            title: "第一阶段 觉醒",
            summary: "林砚接触地脉印。",
            chapters: [makeChapter(1), makeChapter(2), makeChapter(3)],
          },
        ],
      },
    ],
  };
}

function makeChapterRecord(): Chapter {
  return ChapterSchema.parse({
    number: 1,
    title: "第 1 章",
    outline: makeChapter(1),
    text: "你好 世界",
    wordCount: 4,
    status: "reviewed",
    stateSnapshot: {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [{ summary: "林砚进入旧城", chapterNumber: 1 }],
    },
  });
}

describe("ProjectSchema", () => {
  it("applies the default language and validates a project", () => {
    const project = ProjectSchema.parse({
      id: "p-1",
      premise: "一个少年在旧城觉醒。",
      targetWords: 4800,
      chapterWords: 800,
      maxChapters: 6,
      status: "draft",
      createdAt: "2026-10-24T00:00:00.000Z",
    });

    expect(project.language).toBe("简体中文");
    expect(project.status).toBe("draft");
  });

  it("rejects non-positive word budgets", () => {
    expect(() =>
      ProjectSchema.parse({
        id: "p-1",
        premise: "一个少年在旧城觉醒。",
        targetWords: 0,
        chapterWords: 800,
        maxChapters: 6,
        status: "draft",
        createdAt: "2026-10-24T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects out-of-range project budgets", () => {
    const valid = {
      id: "p-1",
      premise: "一个少年在旧城觉醒。",
      targetWords: 4800,
      chapterWords: 800,
      maxChapters: 6,
      status: "draft",
      createdAt: "2026-10-24T00:00:00.000Z",
    };

    const invalid = [
      { ...valid, targetWords: 199 },
      { ...valid, targetWords: 2_000_001 },
      { ...valid, chapterWords: 199 },
      { ...valid, chapterWords: 20_001 },
      { ...valid, maxChapters: 0 },
      { ...valid, maxChapters: 201 },
    ];

    for (const project of invalid) {
      expect(() => ProjectSchema.parse(project)).toThrow();
    }
  });

  it("accepts the targetWords minimum and maxChapters maximum boundaries", () => {
    const project = ProjectSchema.parse({
      id: "p-boundary",
      premise: "一个少年在旧城觉醒。",
      targetWords: 200,
      chapterWords: 200,
      maxChapters: 200,
      status: "draft",
      createdAt: "2026-10-24T00:00:00.000Z",
    });

    expect(project.targetWords).toBe(200);
    expect(project.maxChapters).toBe(200);
  });
});

describe("StoryBibleSchema", () => {
  it("accepts a complete story bible", () => {
    expect(StoryBibleSchema.parse(makeBible()).characters).toHaveLength(3);
  });
});

describe("validateOutline", () => {
  it("returns no issues for a valid outline", () => {
    expect(validateOutline(makeOutline(), makeBible())).toEqual([]);
  });

  it("rejects a gap in chapter numbering", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[1]!.number = 4;

    expect(validateOutline(outline, makeBible())).toContain(
      "Chapter 4 is out of sequence; expected 2.",
    );
  });

  it.each(["goal", "conflict", "turn", "reveal", "hook"] as const)(
    "rejects an empty %s",
    (field) => {
      const outline = makeOutline();
      outline.volumes[0]!.stages[0]!.chapters[0]![field] = "";

      expect(validateOutline(outline, makeBible())).toContain(
        `Chapter 1 has an empty ${field}.`,
      );
    },
  );

  it("rejects cast members missing from the bible", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[0]!.cast.push("陌生人");

    expect(validateOutline(outline, makeBible())).toContain(
      "Chapter 1 references cast member not in bible: 陌生人.",
    );
  });

  it("rejects a non-positive target word count", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[0]!.targetWords = 0;

    expect(validateOutline(outline, makeBible())).toContain(
      "Chapter 1 must have targetWords greater than 0.",
    );
  });

  it("accepts options that match the outline", () => {
    expect(
      validateOutline(makeOutline(), makeBible(), {
        maxChapters: 3,
        chapterWords: 800,
      }),
    ).toEqual([]);
  });

  it("rejects a total chapter count mismatch", () => {
    expect(
      validateOutline(makeOutline(), makeBible(), { maxChapters: 4 }),
    ).toContain("Outline has 3 chapters; expected 4.");
  });

  it("rejects target words above twice the chapter budget", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[0]!.targetWords = 1601;

    expect(
      validateOutline(outline, makeBible(), { chapterWords: 800 }),
    ).toContain("Chapter 1 targetWords 1601 exceeds 1600.");
  });

  it("rejects target words below eighty percent of the chapter budget", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[0]!.targetWords = 639;

    expect(
      validateOutline(outline, makeBible(), { chapterWords: 800 }),
    ).toContain("Chapter 1 targetWords 639 is below 640.");
  });

  it("accepts target words exactly at eighty percent of the chapter budget", () => {
    const outline = makeOutline();
    outline.volumes[0]!.stages[0]!.chapters[0]!.targetWords = 640;

    expect(
      validateOutline(outline, makeBible(), { chapterWords: 800 }),
    ).toEqual([]);
  });

  it("rejects a foreshadow payoff before its setup", () => {
    const bible = makeBible();
    bible.foreshadowLedger[0]!.payoffChapter = 0;

    expect(validateOutline(makeOutline(), bible)).toContain(
      "Foreshadow 半枚地脉印的裂纹 pays off before it is set up.",
    );
  });

  it("rejects a foreshadow payoff beyond maxChapters", () => {
    const bible = makeBible();
    bible.foreshadowLedger[0]!.payoffChapter = 5;

    expect(
      validateOutline(makeOutline(), bible, { maxChapters: 3 }),
    ).toContain(
      "Foreshadow 半枚地脉印的裂纹 payoff chapter 5 exceeds maxChapters 3.",
    );
  });
});

describe("validateChapter", () => {
  it("returns no issues for a valid chapter", () => {
    expect(validateChapter(makeChapterRecord())).toEqual([]);
  });

  it("rejects a chapter number that differs from the outline", () => {
    const chapter = makeChapterRecord();
    chapter.number = 2;

    expect(validateChapter(chapter)).toContain(
      "Chapter 2 number does not match outline number 1.",
    );
  });

  it("rejects a word count that differs from the text", () => {
    const chapter = makeChapterRecord();
    chapter.wordCount = 3;

    expect(validateChapter(chapter)).toContain(
      "Chapter 1 wordCount 3 does not match text word count 4.",
    );
  });

  it("rejects state snapshot events from later chapters", () => {
    const chapter = makeChapterRecord();
    chapter.stateSnapshot!.events[0]!.chapterNumber = 2;

    expect(validateChapter(chapter)).toContain(
      "Chapter 1 state snapshot contains event from chapter 2.",
    );
  });

  it("rejects state snapshot entities updated in later chapters", () => {
    const chapter = makeChapterRecord();
    chapter.stateSnapshot!.entities.push({
      entityName: "林砚",
      state: { location: "钟楼" },
      updatedAtChapter: 2,
    });

    expect(validateChapter(chapter)).toContain(
      "Chapter 1 state snapshot contains entity 林砚 updated in chapter 2.",
    );
  });
});

describe("ReviewSchema", () => {
  it("accepts the three review gates", () => {
    for (const gate of ["pass", "revise", "block"] as const) {
      expect(ReviewSchema.parse({ gate, summary: "ok", issues: [] }).gate).toBe(gate);
    }
  });

  it("rejects an unknown review gate", () => {
    expect(() =>
      ReviewSchema.parse({ gate: "maybe", summary: "ok", issues: [] }),
    ).toThrow();
  });

  it("accepts the review issue type enum and rejects unknown types", () => {
    for (const type of [
      "logic",
      "character",
      "setting",
      "pacing",
      "ai_flavor",
      "hook",
      "other",
    ] as const) {
      expect(
        ReviewSchema.parse({
          gate: "revise",
          summary: "ok",
          issues: [
            {
              severity: "low",
              type,
              quote: "原文",
              problem: "问题",
              fix: "修改",
            },
          ],
        }).issues[0]!.type,
      ).toBe(type);
    }

    expect(() =>
      ReviewSchema.parse({
        gate: "revise",
        summary: "ok",
        issues: [
          {
            severity: "low",
            type: "style",
            quote: "原文",
            problem: "问题",
            fix: "修改",
          },
        ],
      }),
    ).toThrow();
  });
});

describe("StoryStateSchema", () => {
  it("accepts a state with entities, relationships, foreshadows, and events", () => {
    const state = StoryStateSchema.parse({
      entities: [
        {
          entityName: "林砚",
          state: { location: "青石镇" },
          updatedAtChapter: 1,
        },
      ],
      relationships: [
        { source: "林砚", target: "苏晚", kind: "同伴", description: "暂时结盟" },
      ],
      foreshadows: [{ title: "地脉印裂纹", status: "open", note: "第 1 章" }],
      events: [{ summary: "林砚得到半枚地脉印", chapterNumber: 1 }],
    });

    expect(state.entities[0]!.entityName).toBe("林砚");
    expect(state.entities[0]!.updatedAtChapter).toBe(1);
    expect(state.events).toHaveLength(1);
  });

  it.each([0, -1, 1.5])(
    "rejects entity update chapter %s",
    (updatedAtChapter) => {
      expect(() =>
        StoryStateSchema.parse({
          entities: [
            {
              entityName: "林砚",
              state: { location: "旧城" },
              updatedAtChapter,
            },
          ],
          relationships: [],
          foreshadows: [],
          events: [],
        }),
      ).toThrow();
    },
  );

  it("rejects foreshadow statuses outside the shared enum", () => {
    expect(() =>
      StoryStateSchema.parse({
        entities: [],
        relationships: [],
        foreshadows: [{ title: "旧伏笔", status: "planted" }],
        events: [],
      }),
    ).toThrow();
  });
});

describe("ChapterSchema", () => {
  it("accepts an optional state snapshot", () => {
    const chapter = ChapterSchema.parse({
      number: 1,
      title: "第 1 章",
      outline: makeChapter(1),
      text: "正文",
      wordCount: 2,
      status: "reviewed",
      stateSnapshot: {
        entities: [
          {
            entityName: "林砚",
            state: { location: "青石镇" },
            updatedAtChapter: 1,
          },
        ],
        relationships: [],
        foreshadows: [],
        events: [],
      },
    });

    expect(chapter.stateSnapshot?.entities[0]?.entityName).toBe("林砚");
  });
});

describe("countWords", () => {
  it("counts non-whitespace characters", () => {
    expect(countWords("你好 世界\n！")).toBe(5);
    expect(countWords("a😀 b")).toBe(3);
  });
});
