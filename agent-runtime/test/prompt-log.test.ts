import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway } from "../src/ai/gateway.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import {
  PROMPT_LOG_ARTIFACT,
  PromptLogWriter,
  promptLogReply,
  promptLogToolResults,
  readPromptLog,
  withPromptLogging,
  type PromptLogEntry,
} from "../src/story/promptLog.js";
import { makeProject } from "./story-fixtures.js";

function entry(
  projectId: string,
  overrides: Partial<PromptLogEntry> = {},
): PromptLogEntry {
  return {
    at: "2026-10-25T00:00:00.000Z",
    projectId,
    source: "director",
    kind: "chapter",
    round: 1,
    prompt: "写第一章",
    replies: [{ text: "正文", toolCalls: [] }],
    durationMs: 1000,
    ...overrides,
  };
}

describe("prompt log", () => {
  it("appends JSONL entries and filters by chapter", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const writer = new PromptLogWriter(store, project.id);

    await writer.append(entry(project.id, { chapterNumber: 1 }));
    await writer.append(
      entry(project.id, { chapterNumber: 2, round: 2, source: "model" }),
    );
    await writer.flush();

    const raw = store.getArtifact(project.id, PROMPT_LOG_ARTIFACT);
    expect(raw?.trim().split("\n")).toHaveLength(2);

    const all = await readPromptLog(store, project.id);
    expect(all.total).toBe(2);
    expect(all.entries.map((value) => value.chapterNumber)).toEqual([1, 2]);

    const filtered = await readPromptLog(store, project.id, {
      chapterNumber: 2,
    });
    expect(filtered.total).toBe(1);
    expect(filtered.entries[0]).toMatchObject({
      source: "model",
      round: 2,
      prompt: "写第一章",
    });
  });

  it("returns the most recent entries when limited", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const writer = new PromptLogWriter(store, project.id);

    for (let round = 1; round <= 5; round += 1) {
      await writer.append(entry(project.id, { chapterNumber: 1, round }));
    }

    const result = await readPromptLog(store, project.id, { limit: 2 });
    expect(result.total).toBe(5);
    expect(result.entries.map((value) => value.round)).toEqual([4, 5]);
  });

  it("logs model calls with prompt, response, chapter and error", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const writer = new PromptLogWriter(store, project.id);
    const flaky: AiGateway = {
      async generateText(req): Promise<string> {
        if (req.kind === "review") throw new Error("boom");
        return new FakeAiGateway().generateText(req);
      },
    };
    const gateway = withPromptLogging(flaky, writer);

    const response = await gateway.generateText({
      kind: "state",
      system: "STATE SYSTEM",
      user: "STATE USER",
      chapterNumber: 7,
      temperature: 0.2,
      maxTokens: 1234,
    });

    const success = await readPromptLog(store, project.id, {
      chapterNumber: 7,
    });
    expect(success.total).toBe(1);
    expect(success.entries[0]).toMatchObject({
      source: "model",
      kind: "state",
      chapterNumber: 7,
      round: 1,
      systemPrompt: "STATE SYSTEM",
      prompt: "STATE USER",
      temperature: 0.2,
      maxTokens: 1234,
    });
    expect(success.entries[0]!.replies[0]!.text).toBe(response);
    expect(success.entries[0]!.error).toBeUndefined();

    await expect(
      gateway.generateText({
        kind: "review",
        system: "S",
        user: "U",
        chapterNumber: 7,
      }),
    ).rejects.toThrow("boom");

    const afterFailure = await readPromptLog(store, project.id, {
      chapterNumber: 7,
    });
    expect(afterFailure.total).toBe(2);
    expect(afterFailure.entries[1]).toMatchObject({
      kind: "review",
      round: 2,
      error: "boom",
      replies: [],
    });
  });

  it("numbers model calls separately for each chapter", async () => {
    const store = new MemoryProjectStore();
    const project = makeProject();
    await store.saveProject(project);
    const writer = new PromptLogWriter(store, project.id);
    const gateway = withPromptLogging(new FakeAiGateway(), writer);

    await gateway.generateText({
      kind: "state",
      system: "S",
      user: "U1",
      chapterNumber: 1,
    });
    await gateway.generateText({
      kind: "state",
      system: "S",
      user: "U2",
      chapterNumber: 1,
    });
    await gateway.generateText({
      kind: "state",
      system: "S",
      user: "U3",
      chapterNumber: 2,
    });

    const chapterOne = await readPromptLog(store, project.id, {
      chapterNumber: 1,
    });
    const chapterTwo = await readPromptLog(store, project.id, {
      chapterNumber: 2,
    });
    expect(chapterOne.entries.map((value) => value.round)).toEqual([1, 2]);
    expect(chapterTwo.entries.map((value) => value.round)).toEqual([1]);
  });

  it("extracts assistant content and tool results", () => {
    const reply = promptLogReply({
      role: "assistant",
      model: "fake-model",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "先提交正文" },
        { type: "text", text: "正在提交。" },
        {
          type: "toolCall",
          id: "call-1",
          name: "chapter_commit",
          arguments: { chapterNumber: 1, text: "正文内容" },
        },
      ],
    });

    expect(reply).toMatchObject({
      text: "正在提交。",
      thinking: "先提交正文",
      model: "fake-model",
      stopReason: "toolUse",
    });
    expect(reply.toolCalls).toEqual([
      {
        id: "call-1",
        name: "chapter_commit",
        arguments: { chapterNumber: 1, text: "正文内容" },
      },
    ]);

    const results = promptLogToolResults([
      {
        toolCallId: "call-1",
        toolName: "chapter_commit",
        isError: false,
        content: [{ type: "text", text: "已提交" }],
      },
    ]);
    expect(results).toEqual([
      {
        toolCallId: "call-1",
        toolName: "chapter_commit",
        isError: false,
        text: "已提交",
      },
    ]);
  });
});
