import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import {
  OutlineSchema,
  type Outline,
  type OutlineChapter,
} from "../src/domain/schemas.js";
import {
  MAX_SUPPORTED_CHAPTERS,
  OutlineGenerationError,
  flattenChapters,
  generateOutline,
} from "../src/story/outline.js";
import { makeBible, makeProject } from "./story-fixtures.js";

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

async function validOutlineResponse(
  maxChapters: number,
  chapterWords: number,
): Promise<string> {
  return new FakeAiGateway().generateText({
    kind: "outline",
    system: "test",
    user: `MAX_CHAPTERS=${maxChapters}\nCHAPTER_WORDS=${chapterWords}`,
  });
}

function chapter(number: number): OutlineChapter {
  return {
    number,
    title: `第${number}章`,
    summary: `第${number}章摘要`,
    pov: "林砚",
    cast: ["林砚"],
    goal: "推进调查",
    conflict: "线索被人提前清理",
    turn: "发现新的目击者",
    reveal: "地脉印与旧城大火有关",
    hook: "门外传来第二个人名的暗号",
    targetWords: 800,
  };
}

describe("generateOutline", () => {
  it("generates a contiguous outline with the fake gateway", async () => {
    const project = makeProject({ maxChapters: 6, chapterWords: 800 });
    const bible = makeBible(6);

    const outline = await generateOutline(project, bible, new FakeAiGateway());
    const chapters = flattenChapters(outline);

    expect(chapters).toHaveLength(6);
    expect(chapters.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chapters.every((item) => item.targetWords === 800)).toBe(true);
  });

  it("honors maxChapters and chapterWords options for a one-chapter outline", async () => {
    const project = makeProject({ maxChapters: 6, chapterWords: 800 });
    const bible = makeBible(1);

    const outline = await generateOutline(project, bible, new FakeAiGateway(), {
      maxChapters: 1,
      chapterWords: 600,
    });
    const chapters = flattenChapters(outline);

    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.number).toBe(1);
    expect(chapters[0]!.targetWords).toBe(600);
  });

  it("retries once when the outline fails validation", async () => {
    const project = makeProject({ maxChapters: 3, chapterWords: 800 });
    const bible = makeBible(3);
    const valid = await validOutlineResponse(3, 800);
    const collapsed = OutlineSchema.parse(JSON.parse(valid));
    collapsed.volumes[0]!.stages[0]!.chapters.pop();
    const gateway = new ScriptedGateway([JSON.stringify(collapsed), valid]);

    const outline = await generateOutline(project, bible, gateway);

    expect(flattenChapters(outline)).toHaveLength(3);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.user).toContain("上一次输出");
    expect(gateway.requests[1]!.user).toContain("expected 3");
  });

  it("throws OutlineGenerationError after two invalid responses", async () => {
    const gateway = new ScriptedGateway(["not json", "{still not json"]);

    await expect(
      generateOutline(makeProject(), makeBible(6), gateway),
    ).rejects.toBeInstanceOf(OutlineGenerationError);
    expect(gateway.requests).toHaveLength(2);
  });

  it("rejects chapter counts above the MVP cap before calling the model", async () => {
    const gateway = new ScriptedGateway([]);

    await expect(
      generateOutline(makeProject(), makeBible(6), gateway, {
        maxChapters: MAX_SUPPORTED_CHAPTERS + 1,
      }),
    ).rejects.toThrow(/MAX_SUPPORTED_CHAPTERS 200/);
    expect(gateway.requests).toHaveLength(0);
  });

  it("uses consistent effective budget markers when options override budgets", async () => {
    const project = makeProject({ maxChapters: 6, chapterWords: 800 });
    const bible = makeBible(1);
    const gateway = new ScriptedGateway([await validOutlineResponse(1, 600)]);

    const outline = await generateOutline(project, bible, gateway, {
      maxChapters: 1,
      chapterWords: 600,
    });

    expect(flattenChapters(outline)).toHaveLength(1);
    expect(gateway.requests).toHaveLength(1);
    const user = gateway.requests[0]!.user;
    expect(user).toContain("MAX_CHAPTERS=1");
    expect(user).toContain("CHAPTER_WORDS=600");
    expect(user).toContain("TARGET_WORDS=600");
    expect(project.maxChapters).toBe(6);
    expect(project.chapterWords).toBe(800);
    expect(project.targetWords).toBe(4800);
  });

  it("uses the 384k output budget for outline generation", async () => {
    const project = makeProject({ maxChapters: 10, chapterWords: 800 });
    const bible = makeBible(10);
    const gateway = new ScriptedGateway([await validOutlineResponse(10, 800)]);

    await generateOutline(project, bible, gateway);

    expect(gateway.requests[0]!.maxTokens).toBe(384000);
  });
});

describe("flattenChapters", () => {
  it("returns chapters in volume and stage order", () => {
    const outline: Outline = {
      volumes: [
        {
          number: 1,
          title: "第一卷",
          summary: "第一卷摘要",
          stages: [
            {
              number: 1,
              title: "第一阶段",
              summary: "第一阶段摘要",
              chapters: [chapter(1), chapter(2)],
            },
            {
              number: 2,
              title: "第二阶段",
              summary: "第二阶段摘要",
              chapters: [chapter(3)],
            },
          ],
        },
        {
          number: 2,
          title: "第二卷",
          summary: "第二卷摘要",
          stages: [
            {
              number: 1,
              title: "第一阶段",
              summary: "第二阶段摘要",
              chapters: [chapter(4)],
            },
          ],
        },
      ],
    };

    expect(flattenChapters(outline).map((item) => item.number)).toEqual([1, 2, 3, 4]);
  });
});
