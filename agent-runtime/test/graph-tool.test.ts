import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { openForeshadowStore, type ForeshadowStore } from "../src/domain/foreshadowStore.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { MemoryNovelGraph } from "../src/graph/memory.js";
import type { BookGraph } from "../src/graph/types.js";
import { createChapterTools, type ChapterToolContext } from "../src/tools/story.js";
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
  const result = await run("graph-test", params, undefined, undefined, undefined);
  return {
    text: result.content.map((item) => item.text).join("\n"),
    details: result.details,
  };
}

function makeGraph(): BookGraph {
  return {
    bookId: "project-1",
    nodes: [
      { id: "book-1", kind: "book", name: "旧城火" },
      { id: "char-1", kind: "character", name: "林砚" },
      { id: "char-2", kind: "character", name: "苏晚" },
      {
        id: "event-1",
        kind: "event",
        name: "林砚在旧城发现脚印",
        chapter: 2,
      },
      {
        id: "event-2",
        kind: "event",
        name: "未来才发生的钟楼交易",
        chapter: 5,
      },
      {
        id: "thread-1",
        kind: "thread",
        name: "地脉印的裂纹",
        status: "progressed",
        data: { setupChapter: 1, payoffChapter: 6 },
      },
    ],
    edges: [
      {
        id: "relation-1",
        kind: "relation",
        fromId: "char-1",
        toId: "char-2",
        description: "暂时结盟，彼此仍有隐瞒",
        fromChapter: 1,
        evidenceChapter: 2,
        data: { relationshipKind: "同伴", pairKey: "char-1|char-2" },
      },
      {
        id: "event-1-involves",
        kind: "event_involves",
        fromId: "event-1",
        toId: "char-1",
        evidenceChapter: 2,
      },
      {
        id: "event-2-involves",
        kind: "event_involves",
        fromId: "event-2",
        toId: "char-1",
        evidenceChapter: 5,
      },
      {
        id: "thread-1-advanced",
        kind: "thread_advanced_in",
        fromId: "thread-1",
        toId: "char-1",
        evidenceChapter: 2,
      },
    ],
  };
}

async function makeContext(
  graph?: MemoryNovelGraph,
): Promise<{ tools: ToolDefinition[]; foreshadows: ForeshadowStore }> {
  const store = new MemoryProjectStore();
  const project = makeProject();
  await store.saveProject(project);
  const foreshadows = openForeshadowStore(store, project.id);
  stores.push(foreshadows);
  const target = makeChapter(3, 300);
  const context: ChapterToolContext = {
    project,
    bible: makeBible(6),
    outline: makeOutline(6, 300),
    store,
    foreshadows,
    ...(graph === undefined ? {} : { graph }),
    chapters: [],
    state: { entities: [], relationships: [], foreshadows: [], events: [] },
    targetChapter: target,
    startChapterNumber: 1,
    endChapterNumber: 3,
    maxToolCalls: 20,
    toolCallCount: 0,
  };
  return { tools: createChapterTools(context).tools, foreshadows };
}

describe("story_graph tool", () => {
  it("returns one-hop relationships and hides future chapters", async () => {
    const graph = new MemoryNovelGraph();
    await graph.rebuildBook(makeGraph());
    const { tools } = await makeContext(graph);

    const result = await execute(
      tools.find((tool) => tool.name === "story_graph"),
      { nodeName: "林砚" },
    );

    const nodes = result.details.nodes as Array<{ name: string; kind: string }>;
    const edges = result.details.edges as Array<{ kind: string }>;
    expect(nodes.map((node) => node.name)).toContain("林砚");
    expect(nodes.map((node) => node.name)).toContain("苏晚");
    expect(nodes.map((node) => node.name)).toContain("林砚在旧城发现脚印");
    expect(nodes.map((node) => node.name)).not.toContain(
      "未来才发生的钟楼交易",
    );
    expect(edges.some((edge) => edge.kind === "relation")).toBe(true);
    expect(result.text).toContain("地脉印的裂纹");
  });

  it("filters events by chapter range", async () => {
    const graph = new MemoryNovelGraph();
    await graph.rebuildBook(makeGraph());
    const { tools } = await makeContext(graph);

    const result = await execute(
      tools.find((tool) => tool.name === "story_graph"),
      { nodeKind: "event", chapterFrom: 1, chapterTo: 3 },
    );

    const nodes = result.details.nodes as Array<{ name: string }>;
    expect(nodes.map((node) => node.name)).toEqual(["林砚在旧城发现脚印"]);
  });

  it("returns an unavailable result when the graph is disabled or empty", async () => {
    const { tools } = await makeContext();
    const disabled = await execute(
      tools.find((tool) => tool.name === "story_graph"),
      {},
    );
    expect(disabled.details.available).toBe(false);

    const emptyGraph = new MemoryNovelGraph();
    const withEmpty = await makeContext(emptyGraph);
    const empty = await execute(
      withEmpty.tools.find((tool) => tool.name === "story_graph"),
      {},
    );
    expect(empty.details.available).toBe(false);
  });
});
