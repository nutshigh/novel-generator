import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import {
  JsonProjectStore,
  MemoryProjectStore,
  type CreateProjectInput,
} from "../src/domain/store.js";
import { OutlineSchema, StoryBibleSchema } from "../src/domain/schemas.js";
import {
  MAX_SUPPORTED_CHAPTERS,
  OutlineGenerationError,
  flattenChapters,
} from "../src/story/outline.js";
import {
  StorySetupError,
  generateStorySetup,
  loadStorySetup,
} from "../src/story/setup.js";
import { createTempDir, removeTempDir } from "./temp.js";

const input: CreateProjectInput = {
  premise: "一个少年在旧城意外觉醒。",
  targetWords: 4800,
  chapterWords: 800,
  maxChapters: 6,
};

class RecordingGateway implements AiGateway {
  readonly requests: GenerateRequest[] = [];
  private readonly inner = new FakeAiGateway();

  async generateText(req: GenerateRequest): Promise<string> {
    this.requests.push(req);
    return this.inner.generateText(req);
  }
}

describe("generateStorySetup", () => {
  it("generates and saves bible and outline artifacts", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);

    const setup = await generateStorySetup(project, new FakeAiGateway(), store);

    const bibleRaw = store.getArtifact(project.id, "bible.json");
    const outlineRaw = store.getArtifact(project.id, "outline.json");

    expect(bibleRaw).toBeDefined();
    expect(outlineRaw).toBeDefined();
    expect(StoryBibleSchema.parse(JSON.parse(bibleRaw!))).toEqual(setup.bible);
    expect(OutlineSchema.parse(JSON.parse(outlineRaw!))).toEqual(setup.outline);
    expect(flattenChapters(setup.outline)).toHaveLength(project.maxChapters);
  });

  it("round-trips setup through loadStorySetup", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    const setup = await generateStorySetup(project, new FakeAiGateway(), store);

    expect(await loadStorySetup(store, project.id)).toEqual(setup);
  });

  it.each([800, 200])(
    "supports a one-chapter setup with chapterWords=%i",
    async (chapterWords) => {
      const store = new MemoryProjectStore();
      const project = await store.createProject(input);
      const ai = new RecordingGateway();

      const setup = await generateStorySetup(project, ai, store, {
        maxChapters: 1,
        chapterWords,
      });
      const chapters = flattenChapters(setup.outline);

      expect(chapters).toHaveLength(1);
      expect(chapters[0]!.targetWords).toBe(chapterWords);
      expect(
        setup.bible.foreshadowLedger.every(
          (entry) => entry.setupChapter <= 1 && entry.payoffChapter <= 1,
        ),
      ).toBe(true);
      expect(project.maxChapters).toBe(6);
      expect(project.chapterWords).toBe(800);

      const stored = await store.getProject(project.id);
      expect(stored).toEqual(setup.project);
      expect(stored?.maxChapters).toBe(1);
      expect(stored?.chapterWords).toBe(chapterWords);
      expect(stored?.targetWords).toBe(chapterWords);

      expect(ai.requests.map((request) => request.kind)).toEqual([
        "bible",
        "outline",
      ]);
      for (const request of ai.requests) {
        expect(request.user).toContain("MAX_CHAPTERS=1");
        expect(request.user).toContain(`CHAPTER_WORDS=${chapterWords}`);
        expect(request.user).toContain(`TARGET_WORDS=${chapterWords}`);
      }

      expect(await loadStorySetup(store, project.id)).toEqual(setup);
    },
  );

  it("rejects chapter counts above the MVP cap before any model call", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    const ai = new RecordingGateway();

    await expect(
      generateStorySetup(project, ai, store, {
        maxChapters: MAX_SUPPORTED_CHAPTERS + 1,
      }),
    ).rejects.toBeInstanceOf(OutlineGenerationError);
    expect(ai.requests).toHaveLength(0);
    expect((await store.getProject(project.id))?.maxChapters).toBe(6);
  });

  it("rejects an invalid effective project before any model call", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    const ai = new RecordingGateway();

    const promise = generateStorySetup(project, ai, store, { chapterWords: 100 });

    await expect(promise).rejects.toBeInstanceOf(StorySetupError);
    await expect(promise).rejects.toThrow(/chapterWords/);
    expect(ai.requests).toHaveLength(0);
    expect((await store.getProject(project.id))?.chapterWords).toBe(800);
  });

  it("round-trips setup through a JsonProjectStore", async () => {
    const root = createTempDir("novelbuilder-setup-");
    const store = new JsonProjectStore(root);

    try {
      const project = await store.createProject(input);
      const setup = await generateStorySetup(project, new FakeAiGateway(), store);

      expect(await loadStorySetup(store, project.id)).toEqual(setup);
    } finally {
      removeTempDir(root);
    }
  });

  it("throws a clear error when artifacts are missing", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);

    await expect(loadStorySetup(store, project.id)).rejects.toBeInstanceOf(
      StorySetupError,
    );
    await expect(loadStorySetup(store, project.id)).rejects.toThrow(/bible\.json/);
  });

  it("throws a clear error when an artifact is corrupt", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    await store.saveArtifact(project.id, "bible.json", "{broken");

    await expect(loadStorySetup(store, project.id)).rejects.toThrow(
      /Invalid artifact bible\.json/,
    );
  });

  it("rejects a semantically invalid bible artifact", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    const setup = await generateStorySetup(project, new FakeAiGateway(), store);
    const bible = structuredClone(setup.bible);
    bible.ending = "   ";
    await store.saveArtifact(project.id, "bible.json", JSON.stringify(bible));

    await expect(loadStorySetup(store, project.id)).rejects.toThrow(
      /Invalid bible\.json/,
    );
  });

  it("rejects a semantically invalid outline artifact", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);
    const setup = await generateStorySetup(project, new FakeAiGateway(), store);
    const outline = structuredClone(setup.outline);
    flattenChapters(outline)[0]!.reveal = "";
    await store.saveArtifact(project.id, "outline.json", JSON.stringify(outline));

    await expect(loadStorySetup(store, project.id)).rejects.toThrow(
      /Invalid outline\.json/,
    );
  });
});
