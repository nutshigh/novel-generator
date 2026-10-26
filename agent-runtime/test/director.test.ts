import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { GenerateRequest } from "../src/ai/gateway.js";
import {
  openForeshadowStore,
  type ForeshadowStore,
} from "../src/domain/foreshadowStore.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { initialStoryState } from "../src/story/chapterRunner.js";
import {
  runDirectorRange,
  type DirectorSessionFactory,
} from "../src/story/director.js";
import type { PiEventLike } from "../src/events.js";
import { readPromptLog } from "../src/story/promptLog.js";
import { makeBible, makeChapter, makeOutline, makeProject } from "./story-fixtures.js";

const stores: ForeshadowStore[] = [];

afterEach(() => {
  while (stores.length > 0) stores.pop()!.close();
});

class CountingGateway extends FakeAiGateway {
  reviewCalls = 0;
  stateCalls = 0;
  memoryCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "review") this.reviewCalls += 1;
    if (req.kind === "state") this.stateCalls += 1;
    if (req.kind === "chapter_memory") this.memoryCalls += 1;
    return super.generateText(req);
  }
}

async function executeTool(
  tool: ToolDefinition | undefined,
  params: unknown,
): Promise<void> {
  if (!tool) throw new Error("tool not found");
  const run = tool.execute as unknown as (
    id: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: undefined,
  ) => Promise<unknown>;
  await run("director-test", params, undefined, undefined, undefined);
}

function makeSessionFactory(): DirectorSessionFactory & {
  calls: number;
  systemPrompts: string[];
} {
  const factory = {
    calls: 0,
    systemPrompts: [] as string[],
    async create(input: {
      systemPrompt: string;
      tools: ToolDefinition[];
      cwd: string;
      signal: AbortSignal;
    }) {
      factory.calls += 1;
      factory.systemPrompts.push(input.systemPrompt);
      return {
        prompt: async (prompt: string) => {
          const match = /CHAPTER_NUMBER=(\d+)/.exec(prompt);
          const chapterNumber = Number(match?.[1] ?? "1");
          await executeTool(
            input.tools.find((tool) => tool.name === "chapter_commit"),
            {
              chapterNumber,
              text: `第${chapterNumber}章由导演会话写成的正文。`.repeat(25),
            },
          );
        },
        dispose: () => undefined,
      };
    },
  };
  return factory;
}

function makeLoggingSessionFactory(): DirectorSessionFactory {
  return {
    async create(input) {
      let listener: ((event: PiEventLike) => void) | undefined;
      return {
        prompt: async (prompt: string) => {
          const match = /CHAPTER_NUMBER=(\d+)/.exec(prompt);
          const chapterNumber = Number(match?.[1] ?? "1");
          const text = `第${chapterNumber}章由导演会话写成的正文。`.repeat(25);
          listener?.({
            type: "turn_end",
            message: {
              role: "assistant",
              model: "fake-model",
              stopReason: "toolUse",
              content: [
                { type: "text", text: `开始写第 ${chapterNumber} 章。` },
                {
                  type: "toolCall",
                  id: "call-1",
                  name: "chapter_commit",
                  arguments: { chapterNumber, text },
                },
              ],
            },
            toolResults: [
              {
                toolCallId: "call-1",
                toolName: "chapter_commit",
                isError: false,
                content: [{ type: "text", text: "ok" }],
              },
            ],
          });
          await executeTool(
            input.tools.find((tool) => tool.name === "chapter_commit"),
            { chapterNumber, text },
          );
        },
        subscribe: (next: (event: PiEventLike) => void) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        dispose: () => undefined,
      };
    },
  };
}

describe("runDirectorRange", () => {
  it("writes chapters, builds memory, and updates the foreshadow ledger", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject({
      maxChapters: 3,
      chapterWords: 300,
      targetWords: 900,
      reviewEnabled: false,
    });
    await store.saveProject(project);
    const bible = makeBible(3);
    const outline = makeOutline(3, 300);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    const ai = new CountingGateway();

    const result = await runDirectorRange({
      project,
      bible,
      outline,
      ai,
      store,
      chapters: [],
      state: initialStoryState(bible),
      startChapterNumber: 1,
      endChapterNumber: 3,
      foreshadows,
    });

    expect(result.chapters).toHaveLength(3);
    expect(result.chapters.every((chapter) => chapter.status === "committed")).toBe(
      true,
    );
    expect(result.chapters.every((chapter) => chapter.summary !== undefined)).toBe(
      true,
    );
    expect(result.chapters.every((chapter) => chapter.digest !== undefined)).toBe(
      true,
    );
    expect(result.chapters.every((chapter) => chapter.brief !== undefined)).toBe(
      true,
    );
    expect(result.chapters[2]!.brief).toContain("第3章");
    expect(result.chapters[2]!.summary?.fromChapter).toBe(1);
    expect(result.chapters[2]!.summary?.toChapter).toBe(3);
    expect(ai.reviewCalls).toBe(0);
    expect(ai.memoryCalls).toBe(3);
    expect(ai.stateCalls).toBe(3);
    expect(
      foreshadows
        .list(project.id)
        .some((record) => record.title === "地脉印的裂纹"),
    ).toBe(true);
    expect(store.getArtifact(project.id, "chapters.json")).toBeDefined();
    expect(store.getArtifact(project.id, "chapter-003.json")).toBeDefined();
  });

  it("creates one agent session per chapter", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject({
      maxChapters: 2,
      chapterWords: 300,
      targetWords: 600,
      reviewEnabled: false,
    });
    await store.saveProject(project);
    const bible = makeBible(2);
    const outline = makeOutline(2, 300);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    const factory = makeSessionFactory();

    const result = await runDirectorRange({
      project,
      bible,
      outline,
      ai: new FakeAiGateway(),
      store,
      chapters: [],
      state: initialStoryState(bible),
      startChapterNumber: 1,
      endChapterNumber: 2,
      foreshadows,
      sessionFactory: factory,
    });

    expect(factory.calls).toBe(2);
    expect(factory.systemPrompts[0]).toContain("story_recall");
    expect(factory.systemPrompts[0]).toContain("滚动摘要");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]!.text).toContain("第1章由导演会话写成的正文");
    expect(result.chapters[1]!.text).toContain("第2章由导演会话写成的正文");
  });

  it("keeps the legacy review gate behind reviewEnabled", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject({
      maxChapters: 1,
      chapterWords: 300,
      targetWords: 300,
      reviewEnabled: true,
    });
    await store.saveProject(project);
    const bible = makeBible(1);
    const outline = makeOutline(1, 300);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);
    const ai = new CountingGateway();

    const result = await runDirectorRange({
      project,
      bible,
      outline,
      ai,
      store,
      chapters: [],
      state: initialStoryState(bible),
      startChapterNumber: 1,
      endChapterNumber: 1,
      foreshadows,
    });

    expect(ai.reviewCalls).toBeGreaterThan(0);
    expect(result.chapters[0]!.review?.gate).toBe("pass");
  });

  it("logs each director prompt round with replies and tool calls", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject({
      maxChapters: 1,
      chapterWords: 300,
      targetWords: 300,
      reviewEnabled: false,
    });
    await store.saveProject(project);
    const bible = makeBible(1);
    const outline = makeOutline(1, 300);
    const foreshadows = openForeshadowStore(store, project.id);
    stores.push(foreshadows);

    const result = await runDirectorRange({
      project,
      bible,
      outline,
      ai: new FakeAiGateway(),
      store,
      chapters: [],
      state: initialStoryState(bible),
      startChapterNumber: 1,
      endChapterNumber: 1,
      foreshadows,
      sessionFactory: makeLoggingSessionFactory(),
    });

    expect(result.chapters).toHaveLength(1);
    const log = await readPromptLog(store, project.id, { chapterNumber: 1 });
    expect(log.total).toBe(1);
    const round = log.entries[0]!;
    expect(round.source).toBe("director");
    expect(round.round).toBe(1);
    expect(round.prompt).toContain("CHAPTER_NUMBER=1");
    expect(round.systemPrompt).toBeTruthy();
    expect(round.replies).toHaveLength(1);
    expect(round.replies[0]!.text).toContain("开始写第 1 章");
    expect(round.replies[0]!.toolCalls[0]).toMatchObject({
      name: "chapter_commit",
    });
    expect(round.toolResults?.[0]).toMatchObject({
      toolName: "chapter_commit",
      isError: false,
      text: "ok",
    });
  });
});
