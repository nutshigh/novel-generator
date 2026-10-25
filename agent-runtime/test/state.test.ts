import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import {
  countWords,
  type Chapter,
  type StoryState,
} from "../src/domain/schemas.js";
import {
  applyStateToChapter,
  extractState,
  mergeState,
} from "../src/story/state.js";
import { makeBible, makeChapter, makeProject } from "./story-fixtures.js";

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

function makeChapterRecord(number = 2): Chapter {
  const outline = makeChapter(number, 120);
  const text = "林砚在旧城石阶上停下，苏晚递来一盏快要熄灭的灯。";
  return {
    number,
    title: outline.title,
    outline,
    text,
    wordCount: countWords(text),
    status: "reviewed",
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
    events: [{ summary: "林砚得到半枚地脉印。", chapterNumber: 1 }],
  };
}

describe("extractState", () => {
  it("extracts a valid state with the fake gateway", async () => {
    const chapter = makeChapterRecord(2);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: new FakeAiGateway(),
    });

    expect(state.entities[0]!.entityName).toBe("林砚");
    expect(state.events.every((event) => event.chapterNumber <= chapter.number)).toBe(
      true,
    );
  });

  it("normalizes a drifted item entity name to the canonical bible name", async () => {
    const chapter = makeChapterRecord(2);
    const extracted: StoryState = {
      entities: [
        {
          entityName: "地脉印",
          state: { condition: "裂纹扩大" },
          updatedAtChapter: 2,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
    });

    expect(state.entities[0]!.entityName).toBe("半枚地脉印");
    expect(state.entities[0]!.state.condition).toBe("裂纹扩大");
  });

  it("never renames a character to an item that contains its name", async () => {
    const chapter = makeChapterRecord(2);
    const bible = makeBible(6);
    bible.items.push("林砚的剑");
    const extracted: StoryState = {
      entities: [
        {
          entityName: "林砚",
          state: { condition: "左臂擦伤" },
          updatedAtChapter: 2,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible,
      ai: gateway,
    });

    expect(state.entities[0]!.entityName).toBe("林砚");
  });

  it("uses the longest canonical containment match", async () => {
    const chapter = makeChapterRecord(2);
    const bible = makeBible(6);
    bible.items.push("地脉印");
    const extracted: StoryState = {
      entities: [
        {
          entityName: "地脉",
          state: { condition: "共鸣增强" },
          updatedAtChapter: 2,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible,
      ai: gateway,
    });

    expect(state.entities[0]!.entityName).toBe("半枚地脉印");
  });

  it("deduplicates entities after canonicalization and merges their state", async () => {
    const chapter = makeChapterRecord(2);
    const extracted: StoryState = {
      entities: [
        {
          entityName: "地脉印",
          state: { condition: "裂纹扩大" },
          updatedAtChapter: 2,
        },
        {
          entityName: "半枚地脉印",
          state: { holder: "林砚" },
          updatedAtChapter: 2,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
    });

    expect(state.entities).toHaveLength(1);
    expect(state.entities[0]!.entityName).toBe("半枚地脉印");
    expect(state.entities[0]!.state).toEqual({
      condition: "裂纹扩大",
      holder: "林砚",
    });
  });

  it("filters a future entity update, warns, and does not retry", async () => {
    const chapter = makeChapterRecord(2);
    const extracted: StoryState = {
      entities: [
        {
          entityName: "林砚",
          state: { location: "钟楼下" },
          updatedAtChapter: 3,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);
    const warnings: string[] = [];

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
      onWarning: (message) => warnings.push(message),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(state.entities).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/future chapter 3/i);
    expect(warnings[0]).toContain("林砚");
  });

  it("filters unknown foreshadows and keeps canonical ones", async () => {
    const chapter = makeChapterRecord(2);
    const extracted: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [
        { title: "错误标题", status: "open" },
        { title: "地脉印的裂纹", status: "progressed" },
      ],
      events: [],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);
    const warnings: string[] = [];

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
      onWarning: (message) => warnings.push(message),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(state.foreshadows).toEqual([
      { title: "地脉印的裂纹", status: "progressed" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("错误标题");
  });

  it("filters one future event, keeps one valid event, and warns", async () => {
    const chapter = makeChapterRecord(2);
    const extracted: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [
        { summary: "未来事件。", chapterNumber: 3 },
        { summary: "本章发生的事件。", chapterNumber: 2 },
      ],
    };
    const gateway = new ScriptedGateway([JSON.stringify(extracted)]);
    const warnings: string[] = [];

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
      onWarning: (message) => warnings.push(message),
    });

    expect(gateway.requests).toHaveLength(1);
    expect(state.events).toEqual([
      { summary: "本章发生的事件。", chapterNumber: 2 },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("未来事件。");
    expect(warnings[0]).toContain("3");
  });

  it("retries once when a state response fails schema validation", async () => {
    const chapter = makeChapterRecord(2);
    const valid: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [{ summary: "本章事件。", chapterNumber: 2 }],
    };
    const gateway = new ScriptedGateway(["not json", JSON.stringify(valid)]);

    const state = await extractState({
      project: makeProject(),
      chapter,
      currentState: makeState(),
      bible: makeBible(6),
      ai: gateway,
    });

    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]!.kind).toBe("state");
    expect(gateway.requests[1]!.user).toContain("上一次输出");
    expect(state.events).toEqual(valid.events);
  });

  it("throws after both state extraction attempts fail schema validation", async () => {
    const chapter = makeChapterRecord(2);
    const gateway = new ScriptedGateway(["not json", "still not json"]);

    await expect(
      extractState({
        project: makeProject(),
        chapter,
        currentState: makeState(),
        bible: makeBible(6),
        ai: gateway,
      }),
    ).rejects.toThrow(/failed after 2 attempts/i);
    expect(gateway.requests).toHaveLength(2);
  });
});

describe("mergeState", () => {
  it("overwrites matching entries while preserving deterministic order", () => {
    const current = makeState();
    const next: StoryState = {
      entities: [
        {
          entityName: "林砚",
          state: { location: "钟楼下" },
          updatedAtChapter: 2,
        },
        {
          entityName: "苏晚",
          state: { location: "钟楼下" },
          updatedAtChapter: 2,
        },
      ],
      relationships: [
        {
          source: "林砚",
          target: "苏晚",
          kind: "同伴",
          description: "开始互相信任",
        },
        {
          source: "林砚",
          target: "顾沉",
          kind: "对手",
          description: "暂时停战",
        },
      ],
      foreshadows: [
        { title: "地脉印的裂纹", status: "progressed", note: "又深了一寸" },
        { title: "旧城大火的目击者", status: "open" },
      ],
      events: [
        { summary: "林砚得到半枚地脉印。", chapterNumber: 1 },
        { summary: "两人抵达钟楼。", chapterNumber: 2 },
      ],
    };

    const merged = mergeState(current, next);

    expect(merged.entities.map((entity) => entity.entityName)).toEqual([
      "林砚",
      "苏晚",
    ]);
    expect(merged.entities[0]!.state.location).toBe("钟楼下");
    expect(merged.entities[0]!.state.condition).toBe("左臂擦伤");
    expect(merged.relationships.map((relationship) => relationship.description)).toEqual([
      "开始互相信任",
      "暂时停战",
    ]);
    expect(merged.foreshadows.map((entry) => entry.status)).toEqual([
      "progressed",
      "open",
    ]);
    expect(merged.events.map((event) => event.summary)).toEqual([
      "林砚得到半枚地脉印。",
      "两人抵达钟楼。",
    ]);
  });

  it("replaces a relationship when its kind changes for the same pair", () => {
    const current = makeState();
    const next: StoryState = {
      entities: [],
      relationships: [
        {
          source: "林砚",
          target: "苏晚",
          kind: "对手",
          description: "因误会暂时对立",
        },
      ],
      foreshadows: [],
      events: [],
    };

    const merged = mergeState(current, next);

    expect(merged.relationships).toEqual([
      {
        source: "林砚",
        target: "苏晚",
        kind: "对手",
        description: "因误会暂时对立",
      },
    ]);
  });

  it("deduplicates identical events without dropping distinct ones", () => {
    const current: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [
        { summary: "第一件事。", chapterNumber: 1 },
        { summary: "第二件事。", chapterNumber: 2 },
      ],
    };
    const next: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [
        { summary: "第二件事。", chapterNumber: 2 },
        { summary: "第三件事。", chapterNumber: 3 },
      ],
    };

    const merged = mergeState(current, next);

    expect(merged.events.map((event) => event.summary)).toEqual([
      "第一件事。",
      "第二件事。",
      "第三件事。",
    ]);
  });
});

describe("applyStateToChapter", () => {
  it("sets a validated state snapshot without mutating the original chapter", () => {
    const chapter = makeChapterRecord(2);
    const state: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [{ summary: "本章事件。", chapterNumber: 2 }],
    };

    const updated = applyStateToChapter(chapter, state);

    expect(updated.stateSnapshot).toEqual(state);
    expect(chapter.stateSnapshot).toBeUndefined();
    expect(updated.number).toBe(chapter.number);
    expect(updated.text).toBe(chapter.text);
  });

  it("rejects a snapshot with an event from a later chapter", () => {
    const chapter = makeChapterRecord(2);
    const state: StoryState = {
      entities: [],
      relationships: [],
      foreshadows: [],
      events: [{ summary: "未来事件。", chapterNumber: 3 }],
    };

    expect(() => applyStateToChapter(chapter, state)).toThrow(/chapter 3/i);
    expect(chapter.stateSnapshot).toBeUndefined();
  });

  it("rejects a snapshot with an entity updated in a later chapter", () => {
    const chapter = makeChapterRecord(2);
    const state: StoryState = {
      entities: [
        {
          entityName: "林砚",
          state: { location: "钟楼" },
          updatedAtChapter: 3,
        },
      ],
      relationships: [],
      foreshadows: [],
      events: [],
    };

    expect(() => applyStateToChapter(chapter, state)).toThrow(/updated in chapter 3/i);
    expect(chapter.stateSnapshot).toBeUndefined();
  });
});
