import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { openForeshadowStore, type ForeshadowStore } from "../src/domain/foreshadowStore.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import type { Chapter } from "../src/domain/schemas.js";
import { createChapterTools } from "../src/tools/story.js";
import { makeBible, makeChapter, makeOutline, makeProject } from "./story-fixtures.js";

const stores: ForeshadowStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()!.close();
});

async function execute(
  tool: ToolDefinition | undefined,
  params: unknown,
): Promise<{ text: string; details: Record<string, unknown> }> {
  if (!tool) throw new Error("tool not found");
  const run = tool.execute as unknown as (
    id: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: undefined,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
  const result = await run("test-call", params, undefined, undefined, undefined);
  return {
    text: result.content.map((item) => item.text).join("\n"),
    details: result.details,
  };
}

function storedChapter(number: number): Chapter {
  const outline = makeChapter(number, 300);
  return {
    number,
    title: outline.title,
    outline,
    text: `第${number}章正文。林砚在旧城发现了新的线索。`,
    wordCount: 20,
    status: "committed",
    digest: {
      coreSettings: [
        {
          type: "world",
          name: "地脉",
          detail: "灵力来自地脉。",
        },
      ],
      characters: [
        {
          name: "林砚",
          roleInChapter: "主角",
          goal: "调查旧城",
          change: "获得新线索。",
        },
      ],
      plotNodes: [
        {
          summary: "林砚发现脚印。",
          impact: "线索指向钟楼。",
        },
      ],
      relationshipProgress: [
        {
          source: "林砚",
          target: "苏晚",
          change: "更信任",
          reason: "共同承担风险。",
        },
      ],
      foreshadows: [
        {
          title: "地脉印的裂纹",
          action: "progress",
          note: "裂纹扩大。",
        },
      ],
    },
  };
}

describe("Director story tools", () => {
  it("reads a chapter range digest and a full chapter", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    const target = makeChapter(3, 300);
    const chapterOne = {
      ...storedChapter(1),
      brief: "第1章，林砚在旧城石阶发现脚印。章末钩子：钟楼的门从里面被推开。",
    };
    const chapterTwo = {
      ...storedChapter(2),
      brief: "第2章，苏晚带林砚找到旧灯铺。章末钩子：灯罩内侧刻着第二个地址。",
      summary: {
        fromChapter: 1,
        toChapter: 2,
        text: "第1到2章，林砚与苏晚追查旧城脚印和旧灯铺线索。",
      },
    };
    const toolset = createChapterTools({
      project,
      bible: makeBible(6),
      outline: makeOutline(6, 300),
      store,
      foreshadows,
      chapters: [chapterOne, chapterTwo],
      state: { entities: [], relationships: [], foreshadows: [], events: [] },
      targetChapter: target,
      startChapterNumber: 1,
      endChapterNumber: 3,
      maxToolCalls: 20,
      toolCallCount: 0,
    });

    const digest = await execute(
      toolset.tools.find((tool) => tool.name === "story_digest"),
      { fromChapter: 1, toChapter: 2 },
    );
    expect(digest.text).toContain("核心设定");
    expect(digest.text).toContain("第1章");
    expect(digest.text).toContain("地脉印的裂纹");
    expect(digest.text).toContain("章末钩子");
    expect(digest.text).toContain(makeChapter(1, 300).hook);

    const recallBriefs = await execute(
      toolset.tools.find((tool) => tool.name === "story_recall"),
      { level: "chapter", fromChapter: 1, toChapter: 2 },
    );
    expect(recallBriefs.text).toContain("本章摘要");
    expect(recallBriefs.text).toContain("林砚在旧城石阶发现脚印");
    expect(recallBriefs.text).toContain("灯罩内侧刻着第二个地址");

    const recallRolling = await execute(
      toolset.tools.find((tool) => tool.name === "story_recall"),
      { level: "rolling", fromChapter: 1, toChapter: 2 },
    );
    expect(recallRolling.text).toContain("滚动摘要");
    expect(recallRolling.text).toContain("旧灯铺线索");

    await expect(
      execute(
        toolset.tools.find((tool) => tool.name === "story_recall"),
        { level: "chapter", fromChapter: 3, toChapter: 3 },
      ),
    ).rejects.toThrow(/当前章|未来/);

    const read = await execute(
      toolset.tools.find((tool) => tool.name === "chapter_read"),
      { chapterNumber: 2 },
    );
    expect(read.text).toContain("第2章正文");

    const status = await execute(
      toolset.tools.find((tool) => tool.name === "run_status"),
      {},
    );
    expect(status.details.completedChapters).toEqual([
      expect.objectContaining({ number: 1 }),
      expect.objectContaining({ number: 2 }),
    ]);
  });

  it("hides the current and future chapters from rewrite lookups", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    const toolset = createChapterTools({
      project,
      bible: makeBible(6),
      outline: makeOutline(6, 300),
      store,
      foreshadows,
      chapters: [storedChapter(1), storedChapter(2), storedChapter(3)],
      state: { entities: [], relationships: [], foreshadows: [], events: [] },
      targetChapter: makeChapter(2, 300),
      startChapterNumber: 1,
      endChapterNumber: 4,
      maxToolCalls: 20,
      toolCallCount: 0,
    });

    const status = await execute(
      toolset.tools.find((tool) => tool.name === "run_status"),
      {},
    );
    expect(status.details.completedChapters).toEqual([
      expect.objectContaining({ number: 1 }),
    ]);

    await expect(
      execute(toolset.tools.find((tool) => tool.name === "chapter_read"), {
        chapterNumber: 2,
      }),
    ).rejects.toThrow(/当前章|既往/);

    await expect(
      execute(toolset.tools.find((tool) => tool.name === "story_digest"), {
        fromChapter: 1,
        toChapter: 2,
      }),
    ).rejects.toThrow(/当前章|既往/);
  });

  it("updates foreshadows and commits a chapter draft", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    foreshadows.seed(project.id, makeBible(6).foreshadowLedger);
    const target = makeChapter(3, 300);
    const toolset = createChapterTools({
      project,
      bible: makeBible(6),
      outline: makeOutline(6, 300),
      store,
      foreshadows,
      chapters: [],
      state: { entities: [], relationships: [], foreshadows: [], events: [] },
      targetChapter: target,
      startChapterNumber: 1,
      endChapterNumber: 3,
      maxToolCalls: 20,
      toolCallCount: 0,
    });

    const updated = await execute(
      toolset.tools.find((tool) => tool.name === "foreshadow_update"),
      {
        chapterNumber: 3,
        title: "地脉印的裂纹",
        action: "payoff",
        note: "裂纹被封印。",
      },
    );
    expect(updated.details.status).toBe("resolved");
    expect(foreshadows.list(project.id)[0]?.status).toBe("resolved");

    const short = await execute(
      toolset.tools.find((tool) => tool.name === "chapter_commit"),
      { chapterNumber: 3, text: "太短。" },
    );
    expect(short.details.status).toBe("needs_attention");

    const full = await execute(
      toolset.tools.find((tool) => tool.name === "chapter_commit"),
      {
        chapterNumber: 3,
        text: "林砚走进钟楼。".repeat(80),
        append: true,
      },
    );
    expect(full.details.status).toBe("drafted");
    expect(toolset.getDraft()?.length).toBeGreaterThan(0);
  });
});
