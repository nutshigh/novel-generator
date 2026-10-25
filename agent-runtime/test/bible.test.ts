import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import { StoryBibleSchema } from "../src/domain/schemas.js";
import {
  BibleGenerationError,
  generateBible,
} from "../src/story/bible.js";
import { makeProject } from "./story-fixtures.js";

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

async function validBibleResponse(maxChapters: number): Promise<string> {
  return new FakeAiGateway().generateText({
    kind: "bible",
    system: "test",
    user: `PREMISE=一个少年在旧城觉醒。\nMAX_CHAPTERS=${maxChapters}`,
  });
}

describe("generateBible", () => {
  it("generates a valid bible with the fake gateway", async () => {
    const project = makeProject();

    const bible = await generateBible(project, new FakeAiGateway());

    expect(bible.characters.length).toBeGreaterThanOrEqual(1);
    expect(bible.characters.some((character) => character.role.includes("主角"))).toBe(
      true,
    );
    expect(bible.ending.trim().length).toBeGreaterThan(0);
  });

  it("retries once with the validation error appended", async () => {
    const project = makeProject();
    const valid = await validBibleResponse(project.maxChapters);
    const gateway = new ScriptedGateway(["not json", valid]);

    const bible = await generateBible(project, gateway);

    expect(bible.characters.length).toBeGreaterThanOrEqual(1);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[0]!.kind).toBe("bible");
    expect(gateway.requests[1]!.user).toContain("上一次输出");
    expect(gateway.requests[1]!.user).toContain("No JSON");
  });

  it("retries when a schema-valid bible has no protagonist", async () => {
    const project = makeProject();
    const valid = await validBibleResponse(project.maxChapters);
    const bible = StoryBibleSchema.parse(JSON.parse(valid));
    const noProtagonist = {
      ...bible,
      characters: bible.characters.map((character) => ({
        ...character,
        role: "配角",
      })),
    };
    const gateway = new ScriptedGateway([JSON.stringify(noProtagonist), valid]);

    const result = await generateBible(project, gateway);

    expect(result.characters.some((character) => character.role.includes("主角"))).toBe(
      true,
    );
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.user).toContain("protagonist");
  });

  it("throws BibleGenerationError after two invalid responses", async () => {
    const gateway = new ScriptedGateway(["not json", "{still not json"]);

    await expect(generateBible(makeProject(), gateway)).rejects.toBeInstanceOf(
      BibleGenerationError,
    );
    expect(gateway.requests).toHaveLength(2);
  });

  it("retries when the bible has an empty ending", async () => {
    const project = makeProject();
    const valid = await validBibleResponse(project.maxChapters);
    const bible = StoryBibleSchema.parse(JSON.parse(valid));
    const gateway = new ScriptedGateway([
      JSON.stringify({ ...bible, ending: "   " }),
      valid,
    ]);

    const result = await generateBible(project, gateway);

    expect(result.ending.trim().length).toBeGreaterThan(0);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.user).toContain("non-empty ending");
  });

  it("retries when a foreshadow entry is out of range or pays off early", async () => {
    const project = makeProject();
    const valid = await validBibleResponse(project.maxChapters);
    const bible = StoryBibleSchema.parse(JSON.parse(valid));
    bible.foreshadowLedger[0] = {
      ...bible.foreshadowLedger[0]!,
      setupChapter: 2,
      payoffChapter: 1,
    };
    bible.foreshadowLedger[1] = {
      ...bible.foreshadowLedger[1]!,
      payoffChapter: project.maxChapters + 1,
    };
    const gateway = new ScriptedGateway([JSON.stringify(bible), valid]);

    const result = await generateBible(project, gateway);

    expect(
      result.foreshadowLedger.every(
        (entry) =>
          entry.setupChapter >= 1 &&
          entry.payoffChapter <= project.maxChapters &&
          entry.payoffChapter >= entry.setupChapter,
      ),
    ).toBe(true);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.user).toContain("pays off before it is set up");
    expect(gateway.requests[1]!.user).toContain("outside 1..6");
  });
});
