import {
  ProjectSchema,
  StoryBibleSchema,
  type Outline,
  type OutlineChapter,
  type Project,
  type StoryBible,
} from "../src/domain/schemas.js";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return ProjectSchema.parse({
    id: "project-1",
    premise: "一个少年在旧城意外觉醒，被迫卷入宗门与王朝的暗战。",
    language: "简体中文",
    targetWords: 4800,
    chapterWords: 800,
    maxChapters: 6,
    status: "draft",
    createdAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  });
}

export function makeBible(maxChapters = 6): StoryBible {
  const safeMax = Math.max(1, maxChapters);

  return StoryBibleSchema.parse({
    logline: "旧城少年林砚握有半枚地脉印，必须在古城沉没前揭开师父失踪的真相。",
    synopsis:
      "林砚与苏晚追查旧城大火，顾沉则在暗处推动另一场交易。线索最终指向玄烬宗的禁术与地脉深处的古兽。",
    genre: ["东方玄幻", "成长"],
    audience: "中文网络小说读者",
    themes: ["成长", "信任", "代价"],
    tone: "冷峻中带热血",
    pov: "第三人称限知",
    tense: "过去时",
    ending: "林砚以半枚地脉印为代价封住古兽，并公开旧城大火的真相。",
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
        motivation: "保护仅存的家人与旧城",
        wound: "幼年目睹旧城大火",
        arc: "从只想自保到主动承担代价",
        voice: "寡言但观察细致",
        secrets: ["体内藏有半枚地脉印"],
        relationships: ["苏晚是并肩同伴", "顾沉是必须面对的对手"],
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
        secrets: ["修炼了玄烬宗禁术"],
        relationships: ["把林砚视为必须超越的变量"],
      },
    ],
    items: ["半枚地脉印"],
    concepts: ["地脉回响"],
    styleGuide: {
      pov: "第三人称限知",
      tense: "过去时",
      sentenceRhythm: "长短句交替，关键处用短句收束",
      dialogueRatio: "约百分之三十五",
      descriptionDensity: "中等，优先动作与感官",
      bannedPhrases: ["不禁", "嘴角微扬"],
      aiFlavorBlacklist: ["仿佛", "似乎", "某种"],
      webNovelPrinciples: ["每章有钩子", "信息密度高", "冲突推动情节"],
    },
    foreshadowLedger: [
      {
        setupChapter: 1,
        payoffChapter: Math.min(2, safeMax),
        title: "地脉印的裂纹",
        status: "planned",
      },
      {
        setupChapter: 1,
        payoffChapter: Math.min(3, safeMax),
        title: "旧城大火的目击者",
        status: "planned",
      },
    ],
    assumptions: ["地脉印共有两半", "旧城位于地脉交汇处"],
  });
}

export function makeChapter(number: number, targetWords = 800): OutlineChapter {
  return {
    number,
    title: `第${number}章 旧城线索`,
    summary: `林砚在第${number}章追查一条与旧城大火有关的线索。`,
    pov: "林砚",
    cast: ["林砚", "苏晚"],
    goal: `拿到第${number}条线索`,
    conflict: "有人提前清理了现场",
    turn: "新的目击者主动现身",
    reveal: `地脉印的第${number}道裂纹与大火有关`,
    hook: "门外传来第二个人名的暗号",
    targetWords,
  };
}

export function makeOutline(maxChapters = 6, chapterWords = 800): Outline {
  const safeMax = Math.max(1, maxChapters);
  const firstStageCount = Math.ceil(safeMax / 2);
  const chapters = Array.from({ length: safeMax }, (_, index) =>
    makeChapter(index + 1, chapterWords),
  );

  const outline: Outline = {
    volumes: [
      {
        number: 1,
        title: "第一卷 旧城火",
        summary: "林砚追查师父失踪与旧城大火。",
        stages: [
          {
            number: 1,
            title: "第一阶段 觉醒",
            summary: "林砚接触地脉印并发现第一层线索。",
            chapters: chapters.slice(0, firstStageCount),
          },
        ],
      },
    ],
  };

  if (safeMax > 1) {
    outline.volumes[0]!.stages.push({
      number: 2,
      title: "第二阶段 反噬",
      summary: "线索指向玄烬宗，代价开始出现。",
      chapters: chapters.slice(firstStageCount),
    });
  }

  return outline;
}
