import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonProjectStore,
  MemoryProjectStore,
  type CreateProjectInput,
  type ProjectStore,
} from "../src/domain/store.js";
import { createTempDir, removeTempDir } from "./temp.js";

const input: CreateProjectInput = {
  premise: "一个少年在旧城觉醒。",
  targetWords: 4800,
  chapterWords: 800,
  maxChapters: 6,
};

async function seedProjects(store: ProjectStore): Promise<string[]> {
  await store.createProject({
    ...input,
    id: "z-newer",
    createdAt: "2026-02-01T00:00:00.000Z",
  });
  await store.createProject({
    ...input,
    id: "b-older",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await store.createProject({
    ...input,
    id: "a-older",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  return (await store.listProjects()).map((project) => project.id);
}

describe("MemoryProjectStore", () => {
  it("creates, reads, saves, and lists projects", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);

    expect(project.status).toBe("draft");
    expect(project.language).toBe("简体中文");
    expect(await store.getProject(project.id)).toEqual(project);
    expect(await store.listProjects()).toEqual([project]);

    await store.saveProject({ ...project, premise: "修改后的前提" });
    expect((await store.getProject(project.id))?.premise).toBe("修改后的前提");
  });

  it("stores artifacts in memory", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(input);

    const path = await store.saveArtifact(project.id, "bible.json", '{"ok":true}');

    expect(path).toBe(`memory://${project.id}/bible.json`);
    expect(store.getArtifact(project.id, "bible.json")).toBe('{"ok":true}');
  });

  it("returns undefined for an unknown project", async () => {
    const store = new MemoryProjectStore();
    expect(await store.getProject("missing")).toBeUndefined();
  });
});

describe("JsonProjectStore", () => {
  it("round-trips a project through disk and lists it", async () => {
    const root = createTempDir("novelbuilder-store-");
    const store = new JsonProjectStore(root);

    try {
      const project = await store.createProject(input);

      expect(await store.getProject(project.id)).toEqual(project);
      expect(await store.listProjects()).toEqual([project]);

      const raw = await readFile(join(root, project.id, "project.json"), "utf8");
      expect(JSON.parse(raw)).toEqual(project);
    } finally {
      removeTempDir(root);
    }
  });

  it("saves atomically-ish without leaving temp files", async () => {
    const root = createTempDir("novelbuilder-store-");
    const store = new JsonProjectStore(root);

    try {
      const project = await store.createProject(input);
      await store.saveProject({ ...project, premise: "第二次保存" });

      const projectDir = join(root, project.id);
      const raw = await readFile(join(projectDir, "project.json"), "utf8");
      expect(JSON.parse(raw).premise).toBe("第二次保存");
      expect(await readdir(projectDir)).toEqual(["project.json"]);
    } finally {
      removeTempDir(root);
    }
  });

  it("writes and returns the artifact path", async () => {
    const root = createTempDir("novelbuilder-store-");
    const store = new JsonProjectStore(root);

    try {
      const project = await store.createProject(input);
      const path = await store.saveArtifact(
        project.id,
        "bible.json",
        '{"title":"旧城火"}',
      );

      expect(path).toBe(join(root, project.id, "bible.json"));
      expect(await readFile(path, "utf8")).toBe('{"title":"旧城火"}');
    } finally {
      removeTempDir(root);
    }
  });

  it("returns an empty list when the root does not exist", async () => {
    const root = createTempDir("novelbuilder-store-");
    const store = new JsonProjectStore(join(root, "missing"));

    try {
      expect(await store.listProjects()).toEqual([]);
    } finally {
      removeTempDir(root);
    }
  });
});

describe("store parity", () => {
  it("sorts projects by createdAt then id in both stores", async () => {
    const root = createTempDir("novelbuilder-store-");
    const memory = new MemoryProjectStore();
    const json = new JsonProjectStore(root);

    try {
      const memoryOrder = await seedProjects(memory);
      const jsonOrder = await seedProjects(json);

      expect(memoryOrder).toEqual(["a-older", "b-older", "z-newer"]);
      expect(memoryOrder).toEqual(jsonOrder);
    } finally {
      removeTempDir(root);
    }
  });

  it("rejects invalid artifact names in both stores", async () => {
    const root = createTempDir("novelbuilder-store-");
    const stores: ProjectStore[] = [new MemoryProjectStore(), new JsonProjectStore(root)];

    try {
      for (const store of stores) {
        const project = await store.createProject({ ...input, id: "p-1" });

        await expect(
          store.saveArtifact(project.id, "../escape.txt", "x"),
        ).rejects.toThrow(/escapes project directory/);
        await expect(store.saveArtifact(project.id, "  ", "x")).rejects.toThrow(
          /must not be empty/,
        );
        await expect(store.saveArtifact("..", "safe.txt", "x")).rejects.toThrow(
          /Invalid project id/,
        );
      }
    } finally {
      removeTempDir(root);
    }
  });
});
