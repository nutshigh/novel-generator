import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import {
  countWords,
  validateChapter,
  type Chapter,
  type OutlineChapter,
  type Review,
  type StoryState,
} from "../src/domain/schemas.js";
import {
  auditChapterEnding,
  finishChapter,
  reviewChapter,
  reviseChapter,
  writeChapter,
} from "../src/story/chapter.js";
import { makeBible, makeChapter, makeOutline, makeProject } from "./story-fixtures.js";

class ScriptedGateway implements AiGateway {
  readonly requests: GenerateRequest[] = [];
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  async generateText(req: GenerateRequest): Promise<string> {
    this.requests.push(req);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("ScriptedGateway has no response left.");
    }
    return response;
  }
}

function makeState(): StoryState {
  return {
    entities: [
      {
        entityName: "林砚",
        state: { location: "旧城石阶" },
        updatedAtChapter: 1,
      },
    ],
    relationships: [],
    foreshadows: [],
    events: [],
  };
}

function makeChapterRecord(
  outline: OutlineChapter = makeChapter(1, 120),
  text = "林砚停在旧城的石阶上，听见墙后有人压低呼吸。",
): Chapter {
  return {
    number: outline.number,
    title: outline.title,
    outline,
    text,
    wordCount: countWords(text),
    status: "drafted",
  };
}

function reviewJson(gate: Review["gate"]): string {
  return JSON.stringify({
    gate,
    summary: "测试审核结论。",
    issues:
      gate === "revise"
        ? [
            {
              severity: "high",
              type: "logic",
              quote: "苏晚没有回头。",
              problem: "苏晚此时不该出现在这里。",
              fix: "改写为顾沉出现，并保留对峙张力。",
            },
          ]
        : [],
  });
}

describe("writeChapter", () => {
  it("writes a drafted chapter near the target length with the fake gateway", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 120);
    const chapter = makeChapter(1, 120);

    const result = await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: new FakeAiGateway(),
      state: makeState(),
    });

    expect(result.number).toBe(1);
    expect(result.title).toBe(chapter.title);
    expect(result.outline).toEqual(chapter);
    expect(result.status).toBe("drafted");
    expect(result.wordCount).toBe(countWords(result.text));
    expect(result.wordCount).toBeGreaterThanOrEqual(100);
    expect(result.wordCount).toBeLessThanOrEqual(Math.ceil(120 * 1.3));
    expect(validateChapter(result)).toEqual([]);
  });

  it("continues when the draft is short and combines both responses", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 100);
    const chapter = makeChapter(1, 100);
    const second = "续".repeat(120);
    const gateway = new ScriptedGateway(["短。", second]);

    const result = await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
    });

    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests.every((request) => request.kind === "chapter")).toBe(
      true,
    );
    expect(gateway.requests[1]!.user).toContain("继续写，不要重复已有内容");
    expect(gateway.requests[1]!.user).toContain("短。");
    expect(gateway.requests[0]!.user).toContain("CHAPTER_TARGET_WORDS=100");
    expect(gateway.requests[0]!.user).toContain("ROUND_WORDS=100");
    expect(gateway.requests[0]!.user).toContain("必须立即在本章大纲边界内收束");
    expect(gateway.requests[0]!.user).toContain("留下大纲要求的 hook");
    expect(gateway.requests[1]!.user).toContain("CHAPTER_TARGET_WORDS=100");
    expect(gateway.requests[1]!.user).toContain("ROUND_WORDS=49");
    expect(gateway.requests[1]!.user).toContain(
      "继续推进，不要提前收束，除非本轮结束时已达到 CHAPTER_TARGET_WORDS",
    );
    expect(gateway.requests[1]!.user).not.toContain(
      "必须立即在本章大纲边界内收束",
    );
    expect(result.text).toContain("短。");
    expect(result.text).toContain(second);
    expect(result.wordCount).toBe(countWords(result.text));
    expect(result.status).toBe("drafted");
  });

  it("stops after two continuation rounds and flags persistent short output", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 100);
    const chapter = makeChapter(1, 100);
    const gateway = new ScriptedGateway(["短。", "还是短。", "仍然短。"]);

    const result = await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
    });

    expect(gateway.requests).toHaveLength(3);
    expect(gateway.requests[2]!.user).toContain("这是最后一轮续写");
    expect(result.wordCount).toBeLessThan(90);
    expect(result.status).toBe("needs_attention");
  });

  it("joins continuation text without adding a blank line after an existing newline", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 100);
    const chapter = makeChapter(1, 100);
    const second = "续".repeat(100);
    const gateway = new ScriptedGateway(["短。\n", second]);

    const result = await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
    });

    expect(result.text).toContain(`短。\n${second}`);
    expect(result.text).not.toContain(`短。\n\n${second}`);
  });

  it("requests the 384k output budget for chapter generation", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 2500);
    const chapter = makeChapter(1, 2500);
    const gateway = new ScriptedGateway(["短。", "短。", "短。"]);

    await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
    });

    expect(gateway.requests[0]!.maxTokens).toBe(384000);
  });

  it("trims overlong text at a sentence boundary", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 10);
    const chapter = makeChapter(1, 10);
    const gateway = new ScriptedGateway([
      "第一句。第二句。第三句。第四句。第五句。",
    ]);

    const result = await writeChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(result.text.endsWith("。")).toBe(true);
    expect(result.wordCount).toBeLessThanOrEqual(13);
    expect(result.wordCount).toBe(12);
  });
});

describe("auditChapterEnding", () => {
  it("parses an incomplete ending audit and sends the chapter to the auditor", async () => {
    const gateway = new ScriptedGateway([
      JSON.stringify({
        complete: false,
        reason: "电话刚接通就停了。",
        missing: "补米洛的回应和约翰的决定。",
      }),
    ]);
    const chapter = makeChapterRecord();

    const audit = await auditChapterEnding({ chapter, ai: gateway });

    expect(audit.complete).toBe(false);
    expect(audit.reason).toBe("电话刚接通就停了。");
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]!.kind).toBe("ending_audit");
    expect(gateway.requests[0]!.user).toContain(chapter.text);
    expect(gateway.requests[0]!.user).toContain(chapter.outline.hook);
  });
});

describe("finishChapter", () => {
  it("appends a closing beat without rewriting the existing text", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const outline = makeOutline(6, 100);
    const chapter = makeChapterRecord(makeChapter(1, 100), "前文。");
    const closing = "对方回答。".repeat(20);
    const gateway = new ScriptedGateway([closing]);

    const result = await finishChapter({
      project,
      bible,
      outline,
      chapter,
      ai: gateway,
      state: makeState(),
      reason: "电话刚接通就停了。",
      missing: "补米洛的回应和约翰的决定。",
    });

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]!.kind).toBe("chapter");
    expect(gateway.requests[0]!.user).toContain("本章结尾审计未通过");
    expect(gateway.requests[0]!.user).toContain("电话刚接通就停了。");
    expect(gateway.requests[0]!.user).toContain("补米洛的回应和约翰的决定。");
    expect(result.text).toContain("前文。");
    expect(result.text).toContain(closing);
    expect(result.wordCount).toBe(countWords(result.text));
  });
});

describe("reviewChapter", () => {
  it("parses a passing review from the fake gateway", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord();

    const review = await reviewChapter({
      project,
      bible,
      chapter,
      ai: new FakeAiGateway(),
    });

    expect(review.gate).toBe("pass");
    expect(review.issues).toEqual([]);
  });

  it("parses a revise review with issues", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord();
    const gateway = new ScriptedGateway([reviewJson("revise")]);

    const review = await reviewChapter({
      project,
      bible,
      chapter,
      ai: gateway,
    });

    expect(review.gate).toBe("revise");
    expect(review.issues).toHaveLength(1);
    expect(review.issues[0]!.problem).toContain("苏晚");
    expect(gateway.requests[0]!.kind).toBe("review");
    expect(gateway.requests[0]!.maxTokens).toBe(384000);
    expect(gateway.requests[0]!.user).toContain(chapter.text);
  });

  it("includes the previous review when re-reviewing a revision", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord();
    const previousReview: Review = {
      gate: "revise",
      summary: "结尾目标没有落地。",
      issues: [
        {
          severity: "high",
          type: "hook",
          quote: "他合上名单。",
          problem: "没有写出约翰的决定。",
          fix: "补一个明确决定。",
        },
      ],
    };
    const gateway = new ScriptedGateway([reviewJson("pass")]);

    await reviewChapter({
      project,
      bible,
      chapter,
      previousReview,
      ai: gateway,
    });

    expect(gateway.requests[0]!.kind).toBe("review");
    expect(gateway.requests[0]!.user).toContain("修订稿的复审");
    expect(gateway.requests[0]!.user).toContain(previousReview.summary);
    expect(gateway.requests[0]!.user).toContain(
      previousReview.issues[0]!.problem,
    );
  });

  it("retries once when the review response cannot be parsed", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord();
    const gateway = new ScriptedGateway(["not json", reviewJson("pass")]);

    const review = await reviewChapter({
      project,
      bible,
      chapter,
      ai: gateway,
    });

    expect(review.gate).toBe("pass");
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.kind).toBe("review");
    expect(gateway.requests[1]!.user).toContain("上一次输出");
  });

  it("throws after both review attempts fail", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord();
    const gateway = new ScriptedGateway(["not json", "still not json"]);

    await expect(
      reviewChapter({
        project,
        bible,
        chapter,
        ai: gateway,
      }),
    ).rejects.toThrow(/failed after 2 attempts/i);
    expect(gateway.requests).toHaveLength(2);
  });
});

describe("reviseChapter", () => {
  it("returns a revised draft and includes every issue in the prompt", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord(makeChapter(1, 120));
    const review: Review = {
      gate: "revise",
      summary: "需要修正人物位置。",
      issues: [
        {
          severity: "high",
          type: "logic",
          quote: "苏晚没有回头。",
          problem: "苏晚此时不该出现在这里。",
          fix: "改写为顾沉出现，并保留对峙张力。",
        },
      ],
    };
    const revisedText = "顾沉站在门槛外，没有回头。".repeat(12);
    const gateway = new ScriptedGateway([revisedText]);

    const result = await reviseChapter({
      project,
      bible,
      chapter,
      review,
      ai: gateway,
    });

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]!.kind).toBe("revise");
    expect(gateway.requests[0]!.user).toContain("苏晚没有回头。");
    expect(gateway.requests[0]!.user).toContain("苏晚此时不该出现在这里。");
    expect(gateway.requests[0]!.user).toContain("改写为顾沉出现");
    expect(gateway.requests[0]!.user).toContain("TARGET_WORDS=120");
    expect(result.text).toContain("顾沉站在门槛外");
    expect(result.wordCount).toBe(countWords(result.text));
    expect(result.status).toBe("drafted");
    expect(result.number).toBe(chapter.number);
    expect(result.title).toBe(chapter.title);
    expect(result.outline).toEqual(chapter.outline);
    expect(result.review).toBeUndefined();
  });

  it("trims an overlong revision at a sentence boundary", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord(makeChapter(1, 10));
    const review: Review = {
      gate: "revise",
      summary: "需要压缩。",
      issues: [
        {
          severity: "medium",
          type: "pacing",
          quote: "第一句。",
          problem: "重复啰嗦。",
          fix: "压缩为三句以内。",
        },
      ],
    };
    const gateway = new ScriptedGateway([
      "第一句。第二句。第三句。第四句。第五句。",
    ]);

    const result = await reviseChapter({
      project,
      bible,
      chapter,
      review,
      ai: gateway,
    });

    expect(result.wordCount).toBeLessThanOrEqual(13);
    expect(result.wordCount).toBe(12);
    expect(result.text.endsWith("。")).toBe(true);
  });

  it("marks a still-short revision as needs_attention", async () => {
    const project = makeProject();
    const bible = makeBible(6);
    const chapter = makeChapterRecord(makeChapter(1, 100));
    const review: Review = {
      gate: "revise",
      summary: "需要补足内容。",
      issues: [
        {
          severity: "medium",
          type: "pacing",
          quote: "短。",
          problem: "篇幅不足。",
          fix: "补足场景与动作。",
        },
      ],
    };
    const gateway = new ScriptedGateway(["短。"]);

    const result = await reviseChapter({
      project,
      bible,
      chapter,
      review,
      ai: gateway,
    });

    expect(result.wordCount).toBeLessThan(90);
    expect(result.status).toBe("needs_attention");
  });

  it("rejects revision when the review gate is not revise", async () => {
    const gateway = new ScriptedGateway([]);
    const chapter = makeChapterRecord();
    const review: Review = {
      gate: "pass",
      summary: "无需修改。",
      issues: [],
    };

    await expect(
      reviseChapter({
        project: makeProject(),
        bible: makeBible(6),
        chapter,
        review,
        ai: gateway,
      }),
    ).rejects.toThrow(/revise/i);
    expect(gateway.requests).toHaveLength(0);
  });
});
