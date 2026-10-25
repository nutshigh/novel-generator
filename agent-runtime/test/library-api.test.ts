import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "./temp.js";
import { startServer, type StartedServer } from "../src/server.js";
import type { Project } from "../src/domain/schemas.js";

interface CreateResponse {
  projectId: string;
  runId: string;
}

interface ContinueResponse {
  projectId: string;
  runId: string;
  fromChapter: number;
  toChapter: number;
  extended: boolean;
}

interface TocResponse {
  title: string;
  plannedChapters: number;
  writtenChapters: number;
  firstUnwrittenChapter: number | null;
  volumes: Array<{
    title: string;
    stages: Array<{
      chapters: Array<{
        number: number;
        status: string;
        hasText: boolean;
        wordCount: number;
      }>;
    }>;
  }>;
}

function tocChapters(toc: TocResponse) {
  return toc.volumes.flatMap((volume) =>
    volume.stages.flatMap((stage) => stage.chapters),
  );
}

describe("library and continuation API", () => {
  let root: string;
  let started: StartedServer;
  let baseUrl: string;

  beforeAll(async () => {
    root = createTempDir("novelbuilder-library-");
    started = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      fakeDefault: true,
      settingsPath: join(root, "settings.json"),
    });
    baseUrl = `http://127.0.0.1:${started.port}`;
  }, 30_000);

  afterAll(async () => {
    await started.close();
    removeTempDir(root);
  }, 30_000);

  async function getProject(projectId: string): Promise<Project> {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { project: Project };
    return payload.project;
  }

  async function waitForRun(runId: string, timeoutMs = 20_000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let buffer = "";

    try {
      const response = await fetch(
        `${baseUrl}/api/runs/${encodeURIComponent(runId)}/events`,
        { signal: controller.signal, headers: { accept: "text/event-stream" } },
      );
      expect(response.status).toBe(200);
      if (!response.body) throw new Error("SSE response has no body.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (!/"phase":"(done|error)"/.test(buffer)) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    return buffer;
  }

  it("lists saved books, exposes toc and chapter text", async () => {
    const empty = await fetch(`${baseUrl}/api/projects`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ projects: [] });

    const createdResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        premise: "一个少年在旧城意外觉醒。",
        fake: true,
        maxChapters: 2,
        chapterWords: 300,
      }),
    });
    expect(createdResponse.status).toBe(202);
    const created = (await createdResponse.json()) as CreateResponse;
    await waitForRun(created.runId);
    const outlineProject = await getProject(created.projectId);
    expect(outlineProject.status).toBe("draft");

    const outlineList = (await (
      await fetch(`${baseUrl}/api/projects`)
    ).json()) as {
      projects: Array<{
        id: string;
        title: string;
        plannedChapters: number;
        writtenChapters: number;
        firstUnwrittenChapter: number | null;
        canExtend: boolean;
      }>;
    };
    expect(outlineList.projects).toHaveLength(1);
    expect(outlineList.projects[0]).toMatchObject({
      id: created.projectId,
      title: "第一卷 旧城火",
      plannedChapters: 2,
      writtenChapters: 0,
      firstUnwrittenChapter: 1,
      canExtend: false,
    });

    const outlineToc = (await (
      await fetch(`${baseUrl}/api/projects/${created.projectId}/toc`)
    ).json()) as TocResponse;
    expect(outlineToc.plannedChapters).toBe(2);
    expect(outlineToc.writtenChapters).toBe(0);
    expect(outlineToc.firstUnwrittenChapter).toBe(1);
    expect(tocChapters(outlineToc).map((chapter) => chapter.status)).toEqual([
      "missing",
      "missing",
    ]);

    const missingChapter = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/chapters/1`,
    );
    expect(missingChapter.status).toBe(404);

    const continueResponse = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 1 }),
      },
    );
    expect(continueResponse.status).toBe(202);
    const continued = (await continueResponse.json()) as ContinueResponse;
    expect(continued).toMatchObject({ fromChapter: 1, toChapter: 1 });
    await waitForRun(continued.runId);

    const partialProject = await getProject(created.projectId);
    expect(partialProject.status).toBe("draft");

    const list = (await (
      await fetch(`${baseUrl}/api/projects`)
    ).json()) as {
      projects: Array<{
        id: string;
        plannedChapters: number;
        writtenChapters: number;
        firstUnwrittenChapter: number | null;
        canExtend: boolean;
      }>;
    };
    expect(list.projects[0]).toMatchObject({
      plannedChapters: 2,
      writtenChapters: 1,
      firstUnwrittenChapter: 2,
      canExtend: false,
    });

    const toc = (await (
      await fetch(`${baseUrl}/api/projects/${created.projectId}/toc`)
    ).json()) as TocResponse;
    expect(toc.plannedChapters).toBe(2);
    expect(toc.writtenChapters).toBe(1);
    expect(toc.firstUnwrittenChapter).toBe(2);
    expect(tocChapters(toc).map((chapter) => chapter.status)).toEqual([
      "written",
      "missing",
    ]);

    const chapterResponse = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/chapters/1`,
    );
    expect(chapterResponse.status).toBe(200);
    const chapter = (await chapterResponse.json()) as {
      number: number;
      text: string;
      wordCount: number;
    };
    expect(chapter.number).toBe(1);
    expect(chapter.text.length).toBeGreaterThan(0);
    expect(chapter.wordCount).toBeGreaterThan(0);
  });

  it("finishes a batch, extends the outline, and writes on demand over HTTP", async () => {
    const listResponse = await fetch(`${baseUrl}/api/projects`);
    const list = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };
    const projectId = list.projects[0]!.id;

    const finishResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 1 }),
      },
    );
    expect(finishResponse.status).toBe(202);
    const finished = (await finishResponse.json()) as ContinueResponse;
    expect(finished).toMatchObject({
      fromChapter: 2,
      toChapter: 2,
      extended: false,
    });
    await waitForRun(finished.runId);
    expect((await getProject(projectId)).status).toBe("completed");

    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ additionalChapters: 2, chapterCount: 1 }),
      },
    );
    expect(response.status).toBe(202);
    const payload = (await response.json()) as ContinueResponse;
    expect(payload).toMatchObject({
      projectId,
      fromChapter: 3,
      toChapter: 3,
      extended: true,
    });

    await waitForRun(payload.runId);
    const project = await getProject(projectId);
    expect(project.status).toBe("draft");
    expect(project.maxChapters).toBe(4);

    const tocResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/toc`,
    );
    const toc = (await tocResponse.json()) as TocResponse;
    expect(toc.plannedChapters).toBe(4);
    expect(toc.writtenChapters).toBe(3);
    expect(toc.volumes).toHaveLength(2);
    expect(tocChapters(toc).map((chapter) => chapter.number)).toEqual([1, 2, 3, 4]);
    expect(tocChapters(toc).map((chapter) => chapter.status)).toEqual([
      "written",
      "written",
      "written",
      "missing",
    ]);
  });

  it("rewrites from a selected chapter over HTTP", async () => {
    const listResponse = await fetch(`${baseUrl}/api/projects`);
    const list = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };
    const projectId = list.projects[0]!.id;

    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromChapter: 2, chapterCount: 1 }),
      },
    );
    expect(response.status).toBe(202);
    const payload = (await response.json()) as ContinueResponse;
    expect(payload).toMatchObject({
      fromChapter: 2,
      toChapter: 2,
      extended: false,
    });

    await waitForRun(payload.runId);
    const project = await getProject(projectId);
    expect(project.status).toBe("draft");
    const toc = (await (
      await fetch(`${baseUrl}/api/projects/${projectId}/toc`)
    ).json()) as TocResponse;
    expect(toc.writtenChapters).toBe(3);
    expect(toc.firstUnwrittenChapter).toBe(4);
  });

  it("validates continuation requests and missing resources", async () => {
    const listResponse = await fetch(`${baseUrl}/api/projects`);
    const list = (await listResponse.json()) as {
      projects: Array<{ id: string }>;
    };
    const projectId = list.projects[0]!.id;

    const finishResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 1 }),
      },
    );
    expect(finishResponse.status).toBe(202);
    const finished = (await finishResponse.json()) as ContinueResponse;
    await waitForRun(finished.runId);

    const exhausted = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({ code: "outline_exhausted" });

    const outOfRange = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromChapter: 99 }),
      },
    );
    expect(outOfRange.status).toBe(400);
    expect(await outOfRange.json()).toMatchObject({ code: "invalid_chapter" });

    const invalidBatch = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ additionalChapters: 21 }),
      },
    );
    expect(invalidBatch.status).toBe(400);

    const invalidCount = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 0 }),
      },
    );
    expect(invalidCount.status).toBe(400);

    const conflicting = await fetch(
      `${baseUrl}/api/projects/${projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromChapter: 2, additionalChapters: 1 }),
      },
    );
    expect(conflicting.status).toBe(400);

    const missingToc = await fetch(`${baseUrl}/api/projects/missing/toc`);
    expect(missingToc.status).toBe(404);
    const missingChapter = await fetch(
      `${baseUrl}/api/projects/missing/chapters/1`,
    );
    expect(missingChapter.status).toBe(404);

    const missingContinue = await fetch(
      `${baseUrl}/api/projects/missing/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(missingContinue.status).toBe(404);
  });
});
