import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import type { Chapter, Outline } from "../src/domain/schemas.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { continueNovel } from "../src/story/continuation.js";
import {
  listBooks,
  loadBookToc,
  loadChapter,
  loadStoredChapters,
  flattenOutlineChapters,
} from "../src/story/library.js";
import { runNovelPipeline } from "../src/story/pipeline.js";
import { createProject } from "../src/story/project.js";

function markerNumber(user: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|\\n)\\s*${name}=(\\d+)`, "i").exec(user);
  if (!match) return undefined;
  const value = Number.parseInt(match[1]!, 10);
  return Number.isFinite(value) ? value : undefined;
}

class FailChapterGateway extends FakeAiGateway {
  private failed = false;

  constructor(private readonly failOnChapter: number) {
    super();
  }

  override async generateText(req: GenerateRequest): Promise<string> {
    if (
      req.kind === "chapter" &&
      !this.failed &&
      markerNumber(req.user, "CHAPTER_NUMBER") === this.failOnChapter
    ) {
      this.failed = true;
      throw new Error("simulated chapter failure");
    }
    return super.generateText(req);
  }
}

class RecordingGateway extends FakeAiGateway {
  readonly requests: GenerateRequest[] = [];

  override async generateText(req: GenerateRequest): Promise<string> {
    this.requests.push(req);
    return super.generateText(req);
  }
}

async function createFailedBook(
  store: MemoryProjectStore,
  maxChapters: number,
  failOnChapter: number,
) {
  const project = await store.createProject(
    createProject({
      premise: "一个少年在旧城意外觉醒。",
      chapterWords: 300,
      maxChapters,
    }),
  );
  await expect(
    runNovelPipeline({
      project,
      ai: new FailChapterGateway(failOnChapter),
      store,
    }),
  ).rejects.toThrow(/chapter/i);
  return project;
}

describe("book library", () => {
  it("lists books and exposes an expandable toc with chapter status", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 2,
      }),
    );
    await runNovelPipeline({ project, ai: new FakeAiGateway(), store });

    const books = await listBooks(store);
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id: project.id,
      title: "第一卷 旧城火",
      plannedChapters: 2,
      writtenChapters: 2,
      firstUnwrittenChapter: null,
      outlineReady: true,
      canExtend: true,
      chapterWords: 300,
    });
    expect(books[0]!.wordCount).toBeGreaterThan(0);

    const toc = await loadBookToc(store, project.id);
    expect(toc).toBeDefined();
    expect(toc!.volumes).toHaveLength(1);
    expect(toc!.volumes[0]!.stages).toHaveLength(2);
    const chapters = toc!.volumes.flatMap((volume) =>
      volume.stages.flatMap((stage) => stage.chapters),
    );
    expect(chapters.map((chapter) => chapter.number)).toEqual([1, 2]);
    expect(chapters.every((chapter) => chapter.status === "written")).toBe(true);
    expect(chapters.every((chapter) => chapter.hasText)).toBe(true);

    const chapter = await loadChapter(store, project.id, 1);
    expect(chapter?.number).toBe(1);
    expect(chapter?.text.length).toBeGreaterThan(0);
  });

  it("loads partial books from per-chapter artifacts", async () => {
    const store = new MemoryProjectStore();
    const project = await createFailedBook(store, 3, 3);

    const books = await listBooks(store);
    expect(books[0]).toMatchObject({
      writtenChapters: 2,
      plannedChapters: 3,
      firstUnwrittenChapter: 3,
    });

    const toc = await loadBookToc(store, project.id);
    const chapters = toc!.volumes.flatMap((volume) =>
      volume.stages.flatMap((stage) => stage.chapters),
    );
    expect(chapters.map((chapter) => chapter.status)).toEqual([
      "written",
      "written",
      "missing",
    ]);
  });
});

describe("continueNovel", () => {
  it("resumes from the first unwritten chapter and keeps earlier chapters", async () => {
    const store = new MemoryProjectStore();
    const project = await createFailedBook(store, 3, 3);
    const chapterTwo = JSON.parse(
      (await store.readArtifact(project.id, "chapter-002.json"))!,
    ) as Chapter;
    const recorder = new RecordingGateway();

    const result = await continueNovel({
      projectId: project.id,
      ai: recorder,
      store,
    });

    expect(result.fromChapter).toBe(3);
    expect(result.toChapter).toBe(3);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3]);
    expect(result.chapters[1]).toEqual(chapterTwo);
    expect(result.project.status).toBe("completed");

    const chapterRequest = recorder.requests.find(
      (request) =>
        request.kind === "chapter" &&
        markerNumber(request.user, "CHAPTER_NUMBER") === 3,
    );
    expect(chapterRequest).toBeDefined();
    expect(chapterRequest!.user).toContain("上一章全文");
    expect(chapterRequest!.user).toContain(
      Array.from(chapterTwo.text).slice(0, 20).join(""),
    );
    expect(chapterRequest!.user).toContain(
      Array.from(chapterTwo.text).slice(-20).join(""),
    );

    const completed = await store.getProject(project.id);
    expect(completed?.status).toBe("completed");
  });

  it("rewrites from an explicitly selected chapter and preserves earlier ones", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 3,
      }),
    );
    await runNovelPipeline({ project, ai: new FakeAiGateway(), store });

    const originalOne = (await loadChapter(store, project.id, 1))!;
    const originalTwo = JSON.parse(
      (await store.readArtifact(project.id, "chapter-002.json"))!,
    ) as Chapter;
    const marked: Chapter = {
      ...originalTwo,
      text: `${originalTwo.text}\n\n这一行应当被覆盖。`,
    };
    await store.saveArtifact(
      project.id,
      "chapter-002.json",
      JSON.stringify(marked, null, 2),
    );

    const result = await continueNovel({
      projectId: project.id,
      fromChapter: 2,
      ai: new FakeAiGateway(),
      store,
    });

    expect(result.fromChapter).toBe(2);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual(originalOne);
    expect(result.chapters[1]!.text).not.toContain("这一行应当被覆盖。");
    expect(result.chapters.every((chapter) => chapter.status === "committed")).toBe(true);
  });

  it("extends the outline and keeps writing after the last planned chapter", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 2,
      }),
    );
    await runNovelPipeline({ project, ai: new FakeAiGateway(), store });

    const result = await continueNovel({
      projectId: project.id,
      additionalChapters: 2,
      ai: new FakeAiGateway(),
      store,
    });

    expect(result.extended).toBe(true);
    expect(result.fromChapter).toBe(3);
    expect(result.toChapter).toBe(4);
    expect(result.outline.volumes).toHaveLength(2);
    expect(flattenOutlineChapters(result.outline)).toHaveLength(4);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3, 4]);
    expect(result.project.maxChapters).toBe(4);
    expect(result.project.status).toBe("completed");

    const savedProject = await store.getProject(project.id);
    expect(savedProject?.maxChapters).toBe(4);
    const savedOutline = JSON.parse(
      (await store.readArtifact(project.id, "outline.json"))!,
    ) as { volumes: unknown[] };
    expect(savedOutline.volumes).toHaveLength(2);
  });

  it("writes only the requested number of chapters and keeps later chapters", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 3,
      }),
    );
    await runNovelPipeline({ project, ai: new FakeAiGateway(), store });
    const originalThree = (await loadChapter(store, project.id, 3))!;
    const originalOne = (await loadChapter(store, project.id, 1))!;

    const result = await continueNovel({
      projectId: project.id,
      fromChapter: 2,
      chapterCount: 1,
      ai: new FakeAiGateway(),
      store,
    });

    expect(result.fromChapter).toBe(2);
    expect(result.toChapter).toBe(2);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual(originalOne);
    expect(result.chapters[2]).toEqual(originalThree);
    expect(result.project.status).toBe("completed");
  });

  it("leaves the project as draft when only part of the outline is written", async () => {
    const store = new MemoryProjectStore();
    const project = await createFailedBook(store, 5, 3);

    const result = await continueNovel({
      projectId: project.id,
      chapterCount: 1,
      ai: new FakeAiGateway(),
      store,
    });

    expect(result.fromChapter).toBe(3);
    expect(result.toChapter).toBe(3);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3]);
    expect(result.project.status).toBe("draft");

    const toc = await loadBookToc(store, project.id);
    expect(toc!.writtenChapters).toBe(3);
    expect(toc!.firstUnwrittenChapter).toBe(4);
  });

  it("refuses to extend while planned chapters are still missing", async () => {
    const store = new MemoryProjectStore();
    const project = await createFailedBook(store, 3, 2);

    await expect(
      continueNovel({
        projectId: project.id,
        additionalChapters: 1,
        ai: new FakeAiGateway(),
        store,
      }),
    ).rejects.toMatchObject({
      code: "outline_incomplete",
    });
  });

  it("refuses to continue a fully written outline without an extension request", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    await runNovelPipeline({ project, ai: new FakeAiGateway(), store });

    await expect(
      continueNovel({
        projectId: project.id,
        ai: new FakeAiGateway(),
        store,
      }),
    ).rejects.toMatchObject({ code: "outline_exhausted" });
  });

  it("can load a partial book through the library loader", async () => {
    const store = new MemoryProjectStore();
    const project = await createFailedBook(store, 3, 3);
    const outline = JSON.parse(
      (await store.readArtifact(project.id, "outline.json"))!,
    ) as Outline;
    const outlineChapters = flattenOutlineChapters(outline);
    const stored = await loadStoredChapters(store, project.id, outlineChapters);
    expect(stored.chapters).toHaveLength(2);
    expect(stored.invalid).toHaveLength(0);
  });
});
