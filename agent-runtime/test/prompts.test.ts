import { describe, expect, it } from "vitest";
import {
  BIBLE_SYSTEM_PROMPT,
  CHAPTER_SYSTEM_PROMPT,
  OUTLINE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  REVISE_SYSTEM_PROMPT,
  STATE_SYSTEM_PROMPT,
  buildBibleRetryPrompt,
  buildBibleUserPrompt,
  buildChapterUserPrompt,
  buildEndingAuditUserPrompt,
  buildOutlineRetryPrompt,
  buildOutlineUserPrompt,
  buildReviewUserPrompt,
  buildReviseUserPrompt,
  buildStateUserPrompt,
  renderTemplate,
} from "../src/prompts/defaults.js";
import {
  countWords,
  type Chapter,
  type Review,
  type ReviewIssue,
  type StoryState,
} from "../src/domain/schemas.js";
import { makeBible, makeChapter, makeProject } from "./story-fixtures.js";

describe("prompt constants", () => {
  it("exports six non-empty prompt strings", () => {
    const prompts = [
      BIBLE_SYSTEM_PROMPT,
      OUTLINE_SYSTEM_PROMPT,
      CHAPTER_SYSTEM_PROMPT,
      REVIEW_SYSTEM_PROMPT,
      STATE_SYSTEM_PROMPT,
      REVISE_SYSTEM_PROMPT,
    ];

    for (const prompt of prompts) {
      expect(typeof prompt).toBe("string");
      expect(prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("embeds the novel writing skill in the chapter and revise prompts", () => {
    expect(CHAPTER_SYSTEM_PROMPT).toContain("中文小说单章写作 Skill");
    expect(CHAPTER_SYSTEM_PROMPT).toContain("本章必须是一个完整的小故事");
    expect(CHAPTER_SYSTEM_PROMPT).toContain("开头：落地");
    expect(REVISE_SYSTEM_PROMPT).toContain("中文小说单章写作 Skill");
    expect(REVIEW_SYSTEM_PROMPT).toContain("章节完整性");
  });

  it("uses chapter target and round markers in the chapter system prompt", () => {
    expect(CHAPTER_SYSTEM_PROMPT).toContain("CHAPTER_TARGET_WORDS");
    expect(CHAPTER_SYSTEM_PROMPT).toContain("ROUND_WORDS");
    expect(CHAPTER_SYSTEM_PROMPT).not.toMatch(/(?<!CHAPTER_)TARGET_WORDS/);
  });

  it("requires the hook to be the final beat and the last scene to close", () => {
    expect(CHAPTER_SYSTEM_PROMPT).toContain("hook 必须是全章最后一个节拍");
    expect(CHAPTER_SYSTEM_PROMPT).toContain("动作—反应");
    expect(REVIEW_SYSTEM_PROMPT).toContain("动作—反应");
    expect(REVISE_SYSTEM_PROMPT).toContain("不得删减或压缩结尾");
    expect(OUTLINE_SYSTEM_PROMPT).toContain("最后一拍");
  });

  it("defers language to the project setting instead of hard-coding Chinese", () => {
    const prompts = [
      BIBLE_SYSTEM_PROMPT,
      OUTLINE_SYSTEM_PROMPT,
      CHAPTER_SYSTEM_PROMPT,
      REVIEW_SYSTEM_PROMPT,
      STATE_SYSTEM_PROMPT,
      REVISE_SYSTEM_PROMPT,
    ];

    for (const prompt of prompts) {
      expect(prompt).not.toContain("使用简体中文");
      expect(prompt).toContain("项目指定语言（默认简体中文）");
    }
  });
});

describe("renderTemplate", () => {
  it("replaces every occurrence of a variable", () => {
    expect(renderTemplate("{{name}} meets {{name}}.", { name: "林砚" })).toBe(
      "林砚 meets 林砚.",
    );
  });

  it("replaces numeric values and allows spaces inside braces", () => {
    expect(renderTemplate("Write {{ count }} words for {{name}}.", {
      count: 800,
      name: "林砚",
    })).toBe("Write 800 words for 林砚.");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplate("{{known}} and {{missing}}", { known: "yes" })).toBe(
      "yes and {{missing}}",
    );
  });

  it("does not substitute inherited keys", () => {
    expect(renderTemplate("{{constructor}} {{__proto__}}", {})).toBe(
      "{{constructor}} {{__proto__}}",
    );
  });

  it("returns text unchanged when there are no placeholders", () => {
    expect(renderTemplate("plain text", { ignored: "value" })).toBe("plain text");
  });
});

describe("story prompt builders", () => {
  it("builds a bible prompt with project parameters and the full field contract", () => {
    const project = makeProject({
      premise: "少年在旧城觉醒",
      targetWords: 7200,
      chapterWords: 900,
      maxChapters: 8,
    });

    const prompt = buildBibleUserPrompt(project);

    expect(prompt).toContain("PREMISE=少年在旧城觉醒");
    expect(prompt).toContain("TARGET_WORDS=7200");
    expect(prompt).toContain("CHAPTER_WORDS=900");
    expect(prompt).toContain("MAX_CHAPTERS=8");

    for (const field of [
      "logline",
      "synopsis",
      "genre",
      "audience",
      "themes",
      "tone",
      "pov",
      "tense",
      "ending",
      "world",
      "rules",
      "powerSystem",
      "levels",
      "costs",
      "limits",
      "factions",
      "society",
      "taboos",
      "characters",
      "name",
      "role",
      "goal",
      "motivation",
      "wound",
      "arc",
      "voice",
      "secrets",
      "relationships",
      "items",
      "concepts",
      "styleGuide",
      "sentenceRhythm",
      "dialogueRatio",
      "descriptionDensity",
      "bannedPhrases",
      "aiFlavorBlacklist",
      "webNovelPrinciples",
      "foreshadowLedger",
      "setupChapter",
      "payoffChapter",
      "status",
      "assumptions",
    ]) {
      expect(prompt).toContain(field);
    }

    expect(prompt).not.toContain("{{");
  });

  it("uses the shared foreshadow status enum in the bible field contract", () => {
    const prompt = buildBibleUserPrompt(makeProject());

    for (const status of [
      "planned",
      "open",
      "progressed",
      "resolved",
      "abandoned",
    ]) {
      expect(prompt).toContain(status);
    }
    expect(prompt).not.toContain("status: string");
  });

  it("builds an outline prompt with a bible summary, limits, and outline shape", () => {
    const project = makeProject({ maxChapters: 6, chapterWords: 800 });
    const bible = makeBible(6);

    const prompt = buildOutlineUserPrompt(project, bible);

    expect(prompt).toContain(bible.logline);
    expect(prompt).toContain(bible.synopsis);
    expect(prompt).toContain(bible.ending);
    for (const genre of bible.genre) {
      expect(prompt).toContain(genre);
    }
    for (const theme of bible.themes) {
      expect(prompt).toContain(theme);
    }
    for (const rule of bible.world.rules) {
      expect(prompt).toContain(rule);
    }
    for (const level of bible.world.powerSystem.levels) {
      expect(prompt).toContain(level);
    }
    for (const cost of bible.world.powerSystem.costs) {
      expect(prompt).toContain(cost);
    }
    for (const limit of bible.world.powerSystem.limits) {
      expect(prompt).toContain(limit);
    }
    for (const faction of bible.world.factions) {
      expect(prompt).toContain(faction);
    }
    for (const character of bible.characters) {
      expect(prompt).toContain(character.name);
      expect(prompt).toContain(character.role);
      expect(prompt).toContain(character.goal);
    }
    for (const item of bible.items) {
      expect(prompt).toContain(item);
    }
    for (const concept of bible.concepts) {
      expect(prompt).toContain(concept);
    }
    for (const assumption of bible.assumptions) {
      expect(prompt).toContain(assumption);
    }
    for (const entry of bible.foreshadowLedger) {
      expect(prompt).toContain(entry.title);
      expect(prompt).toContain(`setupChapter=${entry.setupChapter}`);
      expect(prompt).toContain(`payoffChapter=${entry.payoffChapter}`);
    }
    expect(prompt).toContain(bible.characters[0]!.relationships[0]!);
    expect(prompt).toContain(bible.styleGuide.sentenceRhythm);
    expect(prompt).toContain("MAX_CHAPTERS=6");
    expect(prompt).toContain("CHAPTER_WORDS=800");

    for (const field of [
      "volumes",
      "stages",
      "chapters",
      "number",
      "title",
      "summary",
      "pov",
      "cast",
      "goal",
      "conflict",
      "turn",
      "reveal",
      "hook",
      "targetWords",
    ]) {
      expect(prompt).toContain(field);
    }

    expect(prompt).toContain("从 1 开始连续");
    expect(prompt).toContain("不得提前泄露");
    expect(prompt).toContain("不得违反");
    expect(prompt).not.toContain("{{");
  });

  it("builds a bible retry prompt containing the base prompt and error", () => {
    const retry = buildBibleRetryPrompt("基础提示词", "ending 不能为空");

    expect(retry).toContain("基础提示词");
    expect(retry).toContain("ending 不能为空");
    expect(retry).toContain("只输出");
    expect(retry).toContain("JSON");
  });

  it("builds an outline retry prompt containing every issue", () => {
    const issues = [
      "Outline has 2 chapters; expected 3.",
      "Chapter 1 references cast member not in bible: 陌生人.",
    ];

    const retry = buildOutlineRetryPrompt("基础提示词", issues);

    expect(retry).toContain("基础提示词");
    for (const issue of issues) {
      expect(retry).toContain(issue);
    }
    expect(retry).toContain("只输出");
    expect(retry).toContain("JSON");
  });
});

function makeChapterRecord(): Chapter {
  const outline = makeChapter(1, 120);
  const text = "林砚停在旧城的石阶上，听见墙后有人压低呼吸。苏晚没有回头。";
  return {
    number: outline.number,
    title: outline.title,
    outline,
    text,
    wordCount: countWords(text),
    status: "drafted",
  };
}

function makeState(): StoryState {
  return {
    entities: [
      {
        entityName: "林砚",
        state: { location: "旧城石阶", condition: "左臂擦伤" },
        updatedAtChapter: 1,
      },
    ],
    relationships: [
      { source: "林砚", target: "苏晚", kind: "同伴", description: "暂时结盟" },
    ],
    foreshadows: [{ title: "地脉印的裂纹", status: "open" }],
    events: [{ summary: "林砚与苏晚在旧城石阶发现脚印。", chapterNumber: 1 }],
  };
}

describe("chapter-side prompt builders", () => {
  it("includes context markers, cast, state, foreshadows, and writing rules", () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outlineChapter = makeChapter(1, 120);
    const nextOutlineChapter = makeChapter(2, 120);
    const cast = bible.characters.filter((character) =>
      outlineChapter.cast.includes(character.name),
    );
    const previousChapterText = `${"前".repeat(2100)}上一章结尾`;

    const prompt = buildChapterUserPrompt({
      project,
      bible,
      outlineChapter,
      nextOutlineChapter,
      previousChapterText,
      cast,
      state: makeState(),
      foreshadow: bible.foreshadowLedger,
      targetWords: 120,
    });

    expect(prompt).toContain("CHAPTER_TARGET_WORDS=120");
    expect(prompt).toContain("ROUND_WORDS=120");
    expect(prompt).toContain("CHAPTER_NUMBER=1");
    expect(prompt).toContain(bible.logline);
    expect(prompt).toContain(bible.synopsis);
    expect(prompt).toContain(bible.world.rules[0]!);
    expect(prompt).toContain(bible.world.powerSystem.limits[0]!);
    expect(prompt).toContain(bible.styleGuide.sentenceRhythm);
    for (const field of [
      outlineChapter.goal,
      outlineChapter.conflict,
      outlineChapter.turn,
      outlineChapter.reveal,
      outlineChapter.hook,
    ]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("下一章");
    expect(prompt).toContain(nextOutlineChapter.summary);
    expect(prompt).not.toContain(nextOutlineChapter.reveal);
    expect(prompt).toContain("上一章结尾");
    expect(prompt).toContain("旧城石阶");
    expect(prompt).toContain("地脉印的裂纹");
    expect(prompt).toContain("林砚");
    expect(prompt).toContain("苏晚");
    expect(prompt).not.toContain("角色：顾沉");
    expect(prompt).toContain("只能使用");
    expect(prompt).toContain("不要重复章节标题");
    expect(prompt).toContain("不得写入下一章");
    expect(prompt).toContain("只输出正文纯文本");
    expect(prompt).not.toContain("{{");
  });

  it("builds a review prompt with the chapter text and Review JSON contract", () => {
    const chapter = makeChapterRecord();

    const prompt = buildReviewUserPrompt(chapter, chapter.outline);

    expect(prompt).toContain("CHAPTER_NUMBER=1");
    expect(prompt).toContain(chapter.text);
    expect(prompt).toContain(chapter.outline.goal);
    for (const field of [
      "gate",
      "pass",
      "revise",
      "block",
      "summary",
      "issues",
      "severity",
      "type",
      "quote",
      "problem",
      "fix",
    ]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("只输出");
  });

  it("scopes a revision review to the previous issues", () => {
    const chapter = makeChapterRecord();
    const previousReview: Review = {
      gate: "revise",
      summary: "章末目标还没有落地。",
      issues: [
        {
          severity: "high",
          type: "hook",
          quote: "他合上名单。",
          problem: "没有写出约翰是否出席。",
          fix: "补一个明确决定。",
        },
      ],
    };

    const prompt = buildReviewUserPrompt(
      chapter,
      chapter.outline,
      previousReview,
    );

    expect(prompt).toContain("修订稿的复审");
    expect(prompt).toContain(previousReview.summary);
    expect(prompt).toContain(previousReview.issues[0]!.quote);
    expect(prompt).toContain(previousReview.issues[0]!.problem);
    expect(prompt).toContain("已解决");
    expect(prompt).toContain("上一轮遗漏");
  });

  it("builds an ending audit prompt with the tail, goal, and hook", () => {
    const chapter = makeChapterRecord();

    const prompt = buildEndingAuditUserPrompt(chapter);

    expect(prompt).toContain("CHAPTER_NUMBER=1");
    expect(prompt).toContain(chapter.text);
    expect(prompt).toContain(chapter.outline.goal);
    expect(prompt).toContain(chapter.outline.hook);
    expect(prompt).toContain("EndingAudit");
    expect(prompt).toContain("complete");
    expect(prompt).toContain("missing");
  });

  it("builds a revise prompt containing every issue and the word target", () => {
    const chapter = makeChapterRecord();
    const issues: ReviewIssue[] = [
      {
        severity: "high",
        type: "logic",
        quote: "苏晚没有回头。",
        problem: "苏晚此时不该出现在这里。",
        fix: "把苏晚改成顾沉，并保留对峙张力。",
      },
    ];

    const prompt = buildReviseUserPrompt(chapter, issues);

    expect(prompt).toContain("TARGET_WORDS=120");
    expect(prompt).toContain(chapter.text);
    expect(prompt).toContain(issues[0]!.quote);
    expect(prompt).toContain(issues[0]!.problem);
    expect(prompt).toContain(issues[0]!.fix);
    expect(prompt).toContain("只修复");
    expect(prompt).toContain("保留");
  });

  it("builds a state prompt with current state, cast, and StoryState JSON contract", () => {
    const chapter = makeChapterRecord();
    const bible = makeBible(6);
    const cast = bible.characters.slice(0, 2);

    const prompt = buildStateUserPrompt(
      chapter,
      makeState(),
      cast,
      bible.foreshadowLedger,
      bible.items,
      bible.concepts,
    );

    expect(prompt).toContain("CHAPTER_NUMBER=1");
    expect(prompt).toContain(chapter.text);
    expect(prompt).toContain("旧城石阶");
    expect(prompt).toContain("林砚");
    expect(prompt).toContain("苏晚");
    expect(prompt).toContain(bible.foreshadowLedger[0]!.title);
    expect(prompt).toContain("canonical title");
    expect(prompt).toContain(bible.items[0]!);
    expect(prompt).toContain(bible.concepts[0]!);
    expect(prompt).toContain("canonical 物品名");
    expect(prompt).toContain("canonical 概念名");
    expect(prompt).toContain("updatedAtChapter 必须小于或等于");
    for (const field of [
      "entities",
      "entityName",
      "updatedAtChapter",
      "relationships",
      "source",
      "target",
      "kind",
      "foreshadows",
      "title",
      "status",
      "events",
      "summary",
      "chapterNumber",
    ]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("只根据");
    expect(prompt).toContain("已经发生");
  });
});
