import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import { StoryStateSchema } from "../src/domain/schemas.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { buildBookGraph } from "../src/graph/build.js";
import { MemoryNovelGraph } from "../src/graph/memory.js";
import { continueNovel } from "../src/story/continuation.js";
import { loadStoredChapters } from "../src/story/library.js";
import { flattenOutlineChapters } from "../src/story/library.js";
import { runNovelPipeline } from "../src/story/pipeline.js";
import { createProject } from "../src/story/project.js";
import { loadStorySetup } from "../src/story/setup.js";

function markerNumber(user: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|\\n)\\s*${name}=(\\d+)`, "i").exec(user);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : undefined;
}

class ChangingStateGateway extends FakeAiGateway {
  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind !== "state") return super.generateText(req);
    const chapterNumber = markerNumber(req.user, "CHAPTER_NUMBER") ?? 1;
    return JSON.stringify(
      StoryStateSchema.parse({
        entities: [
          {
            entityName: "林砚",
            state: { location: "旧城石阶", condition: `第${chapterNumber}章的状态` },
            updatedAtChapter: chapterNumber,
          },
        ],
        relationships: [
          {
            source: "林砚",
            target: "苏晚",
            kind: "同伴",
            description: `第${chapterNumber}章的信任程度`,
          },
        ],
        foreshadows: [
          {
            title: "地脉印的裂纹",
            status: chapterNumber >= 2 ? "progressed" : "open",
            note: `第${chapterNumber}章进展`,
          },
        ],
        events: [
          {
            summary: `第${chapterNumber}章的关键事件`,
            chapterNumber,
          },
        ],
      }),
    );
  }
}

class RecordingGateway extends FakeAiGateway {
  readonly requests: GenerateRequest[] = [];

  override async generateText(req: GenerateRequest): Promise<string> {
    this.requests.push(req);
    return super.generateText(req);
  }
}

async function buildTwoChapterGraph() {
  const store = new MemoryProjectStore();
  const project = await store.createProject(
    createProject({
      premise: "一个少年在旧城意外觉醒。",
      chapterWords: 300,
      maxChapters: 2,
    }),
  );
  await runNovelPipeline({
    project,
    ai: new ChangingStateGateway(),
    store,
  });
  const setup = await loadStorySetup(store, project.id);
  const stored = await loadStoredChapters(
    store,
    project.id,
    flattenOutlineChapters(setup.outline),
  );
  const graph = buildBookGraph({
    project: setup.project,
    bible: setup.bible,
    outline: setup.outline,
    chapters: stored.chapters,
  });
  return { store, project, setup, stored, graph };
}

describe("novel knowledge graph", () => {
  it("builds character, chapter, event and thread nodes with temporal relation history", async () => {
    const { project, graph } = await buildTwoChapterGraph();

    expect(graph.bookId).toBe(project.id);
    expect(graph.nodes.some((node) => node.kind === "book")).toBe(true);
    expect(
      graph.nodes.filter((node) => node.kind === "chapter"),
    ).toHaveLength(2);
    expect(
      graph.nodes.filter((node) => node.kind === "character").length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      graph.nodes.some(
        (node) => node.kind === "thread" && node.name === "地脉印的裂纹",
      ),
    ).toBe(true);
    expect(
      graph.nodes.filter((node) => node.kind === "event").length,
    ).toBeGreaterThanOrEqual(2);

    const relations = graph.edges.filter(
      (edge) =>
        edge.kind === "relation" &&
        edge.fromId === "character:林砚" &&
        edge.toId === "character:苏晚",
    );
    expect(relations).toHaveLength(2);
    const first = relations.find((edge) => edge.fromChapter === 1);
    const second = relations.find((edge) => edge.fromChapter === 2);
    expect(first?.toChapter).toBe(1);
    expect(first?.status).toBe("ended");
    expect(second?.toChapter).toBeUndefined();
    expect(second?.status).toBe("active");

    expect(
      graph.edges.some((edge) => edge.kind === "thread_setup_in"),
    ).toBe(true);
    expect(
      graph.edges.some((edge) => edge.kind === "event_involves"),
    ).toBe(true);
    expect(
      graph.edges.some((edge) => edge.kind === "chapter_follows"),
    ).toBe(true);
  });

  it("builds a bounded context containing relations, events and threads", async () => {
    const { project, graph } = await buildTwoChapterGraph();
    const memory = new MemoryNovelGraph();
    await memory.rebuildBook(graph);

    const context = await memory.buildChapterContext({
      bookId: project.id,
      chapterNumber: 3,
      cast: ["林砚"],
    });

    expect(context).toContain("知识图谱·人物关系");
    expect(context).toContain("林砚 ↔ 苏晚");
    expect(context).toContain("第1章的信任程度");
    expect(context).toContain("第2章的信任程度");
    expect(context).toContain("第1章的关键事件");
    expect(context).toContain("地脉印的裂纹");

    const summary = await memory.getSummary(project.id);
    expect(summary.available).toBe(true);
    expect(summary.nodeCount).toBeGreaterThan(0);
    expect(summary.edgeCount).toBeGreaterThan(0);
    expect(summary.relations.length).toBeGreaterThan(0);
    expect(summary.threads.length).toBeGreaterThan(0);
    expect(summary.events.length).toBeGreaterThan(0);
  });

  it("excludes facts from the current or future chapter when rewriting", async () => {
    const { project, graph } = await buildTwoChapterGraph();
    const memory = new MemoryNovelGraph();
    await memory.rebuildBook(graph);

    const rewriteContext = await memory.buildChapterContext({
      bookId: project.id,
      chapterNumber: 2,
      cast: ["林砚"],
    });

    expect(rewriteContext).toContain("第1章的信任程度");
    expect(rewriteContext).not.toContain("第2章的信任程度");
    expect(rewriteContext).not.toContain("第2章的关键事件");
  });

  it("feeds graph context into the next chapter prompt", async () => {
    const { store, project, graph } = await buildTwoChapterGraph();
    const memory = new MemoryNovelGraph();
    await memory.rebuildBook(graph);
    const recorder = new RecordingGateway();

    await continueNovel({
      projectId: project.id,
      fromChapter: 2,
      chapterCount: 1,
      ai: recorder,
      store,
      graph: memory,
    });

    const chapterRequest = recorder.requests.find(
      (request) =>
        request.kind === "chapter" &&
        markerNumber(request.user, "CHAPTER_NUMBER") === 2,
    );
    expect(chapterRequest).toBeDefined();
    expect(chapterRequest!.user).toContain("知识图谱·人物关系");
    expect(chapterRequest!.user).toContain("林砚 ↔ 苏晚");
  });
});
