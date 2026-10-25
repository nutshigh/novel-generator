import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { createTempDir, removeTempDir } from "./temp.js";
import { MemoryNovelGraph } from "../src/graph/memory.js";
import { startServer, type StartedServer } from "../src/server.js";

interface GraphResponse {
  available: boolean;
  reason?: string;
  graph?: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{
    id: string;
    kind: string;
    name: string;
    chapter?: number;
    status?: string;
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    kind: string;
    description?: string;
    status?: string;
    fromChapter?: number;
    toChapter?: number;
    evidenceChapter?: number;
    data: Record<string, unknown>;
  }>;
}

describe("knowledge graph API", () => {
  let root: string;
  let started: StartedServer;
  let baseUrl: string;
  const graph = new MemoryNovelGraph();

  beforeAll(async () => {
    root = createTempDir("novelbuilder-graph-");
    started = await startServer({
      port: 0,
      host: "127.0.0.1",
      outputDir: join(root, "output"),
      fakeDefault: true,
      settingsPath: join(root, "settings.json"),
      graph,
    });
    baseUrl = `http://127.0.0.1:${started.port}`;
  }, 30_000);

  afterAll(async () => {
    await started.close();
    removeTempDir(root);
  }, 30_000);

  it("builds the graph after outline generation and updates it after writing", async () => {
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
    const created = (await createdResponse.json()) as {
      projectId: string;
      runId: string;
    };

    const scene = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(created.runId)}/events`,
    );
    expect(scene.status).toBe(200);
    expect(await scene.text()).toContain('"phase":"done"');

    const outlineGraph = (await (
      await fetch(`${baseUrl}/api/projects/${created.projectId}/graph`)
    ).json()) as GraphResponse;
    expect(outlineGraph.available).toBe(true);
    expect(outlineGraph.graph).toBe("memory");
    expect(outlineGraph.nodeCount).toBeGreaterThan(0);
    expect(outlineGraph.edgeCount).toBeGreaterThan(0);
    expect(
      outlineGraph.nodes.some(
        (node) => node.kind === "thread" && node.name === "地脉印的裂纹",
      ),
    ).toBe(true);
    expect(
      outlineGraph.edges.some((edge) => edge.kind === "thread_setup_in"),
    ).toBe(true);
    expect(outlineGraph.nodes.filter((node) => node.kind === "event")).toHaveLength(0);

    const continueResponse = await fetch(
      `${baseUrl}/api/projects/${created.projectId}/continue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chapterCount: 1 }),
      },
    );
    expect(continueResponse.status).toBe(202);
    const continued = (await continueResponse.json()) as { runId: string };

    const sse = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(continued.runId)}/events`,
    );
    expect(sse.status).toBe(200);
    const body = await sse.text();
    expect(body).toContain('"phase":"done"');

    const chapterGraph = (await (
      await fetch(`${baseUrl}/api/projects/${created.projectId}/graph`)
    ).json()) as GraphResponse;
    expect(chapterGraph.available).toBe(true);
    expect(
      chapterGraph.nodes.filter((node) => node.kind === "event").length,
    ).toBeGreaterThan(0);
    const relation = chapterGraph.edges.find((edge) => edge.kind === "relation");
    expect(relation).toBeDefined();
    expect(relation).toMatchObject({
      source: "character:林砚",
      target: "character:苏晚",
      status: "active",
    });
    expect(relation!.data.relationshipKind).toBe("同伴");
    expect(chapterGraph.nodeCount).toBeGreaterThan(outlineGraph.nodeCount);
  }, 25_000);

  it("returns 404 for a missing project graph", async () => {
    const response = await fetch(`${baseUrl}/api/projects/missing/graph`);
    expect(response.status).toBe(404);
  });
});
