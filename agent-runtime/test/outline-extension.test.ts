import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { GenerateRequest } from "../src/ai/gateway.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { flattenOutlineChapters } from "../src/story/library.js";
import {
  extendOutline,
  OutlineExtensionError,
} from "../src/story/outlineExtension.js";
import { runNovelPipeline } from "../src/story/pipeline.js";
import { createProject } from "../src/story/project.js";

class BadCastGateway extends FakeAiGateway {
  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind !== "outline_extension") return super.generateText(req);
    return JSON.stringify({
      volume: { title: "第二卷", summary: "新的冲突。" },
      stage: { title: "新阶段", summary: "阶段摘要。" },
      chapters: [
        {
          number: 3,
          title: "第3章 陌生人",
          summary: "一个不存在的人出现。",
          pov: "林砚",
          cast: ["不存在的角色"],
          goal: "确认来意",
          conflict: "对方不肯开口",
          turn: "对方叫出师父的名字",
          reveal: "线索指向旧城之外",
          hook: "门外传来第二声脚步",
          targetWords: 300,
        },
      ],
    });
  }
}

async function setupBook() {
  const store = new MemoryProjectStore();
  const project = await store.createProject(
    createProject({
      premise: "一个少年在旧城意外觉醒。",
      chapterWords: 300,
      maxChapters: 2,
    }),
  );
  const result = await runNovelPipeline({
    project,
    ai: new FakeAiGateway(),
    store,
  });
  return { store, result };
}

describe("extendOutline", () => {
  it("appends a new volume with continuously numbered chapters", async () => {
    const { store, result } = await setupBook();
    const extended = await extendOutline({
      project: result.project,
      bible: result.bible,
      outline: result.outline,
      chapters: result.chapters,
      additionalChapters: 2,
      state: result.chapters.at(-1)?.stateSnapshot,
      ai: new FakeAiGateway(),
    });

    expect(extended.startChapter).toBe(3);
    expect(extended.endChapter).toBe(4);
    expect(extended.project.maxChapters).toBe(4);
    expect(extended.outline.volumes).toHaveLength(2);
    expect(flattenOutlineChapters(extended.outline).map((chapter) => chapter.number)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(extended.outline.volumes[1]!.number).toBe(2);
  });

  it("rejects extensions that introduce unknown cast members", async () => {
    const { result } = await setupBook();
    await expect(
      extendOutline({
        project: result.project,
        bible: result.bible,
        outline: result.outline,
        chapters: result.chapters,
        additionalChapters: 1,
        ai: new BadCastGateway(),
      }),
    ).rejects.toBeInstanceOf(OutlineExtensionError);
  });

  it("rejects invalid extension batch sizes", async () => {
    const { result } = await setupBook();
    await expect(
      extendOutline({
        project: result.project,
        bible: result.bible,
        outline: result.outline,
        chapters: result.chapters,
        additionalChapters: 0,
        ai: new FakeAiGateway(),
      }),
    ).rejects.toMatchObject({ code: "invalid_extension_count" });
  });
});
