import { describe, expect, it } from "vitest";
import { FakeAiGateway } from "../src/ai/fakeGateway.js";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import type {
  Review,
  ReviewIssue,
  RunProgress,
} from "../src/domain/schemas.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import {
  PipelineAbortError,
  PipelineError,
  runNovelPipeline,
} from "../src/story/pipeline.js";
import { createProject } from "../src/story/project.js";

class DelegatingGateway implements AiGateway {
  readonly inner = new FakeAiGateway();

  async generateText(req: GenerateRequest): Promise<string> {
    return this.inner.generateText(req);
  }
}

function reviseReview(): string {
  const review: Review = {
    gate: "revise",
    summary: "需要修正人物位置。",
    issues: [
      {
        severity: "high",
        type: "logic",
        quote: "苏晚没有回头。",
        problem: "苏晚此时不该出现在这里。",
        fix: "改写为顾沉出现，并保留对峙张力。",
      },
    ],
  };
  return JSON.stringify(review);
}

function blockReview(): string {
  const review: Review = {
    gate: "block",
    summary: "当前章节存在无法继续的设定冲突。",
    issues: [
      {
        severity: "high",
        type: "setting",
        quote: "林砚直接越阶施术。",
        problem: "违反力量体系代价设定。",
        fix: "补足反噬后果，或改写施术方式。",
      },
    ],
  };
  return JSON.stringify(review);
}

class ReviseOnceGateway extends DelegatingGateway {
  reviewCalls = 0;
  reviseCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "review") {
      this.reviewCalls += 1;
      if (this.reviewCalls === 1) return reviseReview();
    }
    if (req.kind === "revise") this.reviseCalls += 1;
    return super.generateText(req);
  }
}

class StateFailOnceGateway extends DelegatingGateway {
  stateCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "state") {
      this.stateCalls += 1;
      if (this.stateCalls === 1) throw new Error("state boom");
    }
    return super.generateText(req);
  }
}

class BlockingGateway extends DelegatingGateway {
  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "review") return blockReview();
    return super.generateText(req);
  }
}

class ChapterFailGateway extends DelegatingGateway {
  chapterCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "chapter") {
      this.chapterCalls += 1;
      if (this.chapterCalls === 2) throw new Error("chapter boom");
    }
    return super.generateText(req);
  }
}

function reviewFor(gate: Review["gate"]): Review {
  return {
    gate,
    summary: `测试审核：${gate}。`,
    issues:
      gate === "pass"
        ? []
        : [
            {
              severity: "high",
              type: "logic",
              quote: "测试引用。",
              problem: "测试问题。",
              fix: "测试修复。",
            },
          ],
  };
}

function issue(
  severity: ReviewIssue["severity"],
  suffix: string,
): ReviewIssue {
  return {
    severity,
    type: "logic",
    quote: `引用${suffix}`,
    problem: `问题${suffix}`,
    fix: `修复${suffix}`,
  };
}

function reviseReviewWith(issues: ReviewIssue[]): Review {
  return {
    gate: "revise",
    summary: "测试审核：需要修订。",
    issues,
  };
}

class FixedDraftGateway extends DelegatingGateway {
  reviewCalls = 0;
  reviseCalls = 0;

  private readonly reviews: Review[];
  private readonly draft: string;
  private readonly revisedText: string;

  constructor(reviews: Review[], draft: string, revisedText: string) {
    super();
    this.reviews = reviews;
    this.draft = draft;
    this.revisedText = revisedText;
  }

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "review") {
      const review =
        this.reviews[Math.min(this.reviewCalls, this.reviews.length - 1)]!;
      this.reviewCalls += 1;
      return JSON.stringify(review);
    }
    if (req.kind === "chapter") return this.draft;
    if (req.kind === "revise") {
      this.reviseCalls += 1;
      return this.revisedText;
    }
    return super.generateText(req);
  }
}

class ReviewSequenceGateway extends DelegatingGateway {
  reviewCalls = 0;
  reviseCalls = 0;

  private readonly reviews: Review[];
  private readonly revisedText: string;

  constructor(reviews: Review[], revisedText: string) {
    super();
    this.reviews = reviews;
    this.revisedText = revisedText;
  }

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "review") {
      const review =
        this.reviews[Math.min(this.reviewCalls, this.reviews.length - 1)]!;
      this.reviewCalls += 1;
      return JSON.stringify(review);
    }
    if (req.kind === "revise") {
      this.reviseCalls += 1;
      return this.revisedText;
    }
    return super.generateText(req);
  }
}

class IncompleteEndingGateway extends DelegatingGateway {
  audits = 0;
  finishCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "ending_audit") {
      this.audits += 1;
      return JSON.stringify({
        complete: this.audits > 1,
        reason:
          this.audits === 1 ? "电话刚接通就停了。" : "最后一场戏已经补完。",
        missing: this.audits === 1 ? "补对方回应和人物的决定。" : "",
      });
    }
    if (
      req.kind === "chapter" &&
      req.user.includes("本章结尾审计未通过")
    ) {
      this.finishCalls += 1;
    }
    return super.generateText(req);
  }
}

class SeamRepairPipelineGateway extends DelegatingGateway {
  auditCalls = 0;
  repairCalls = 0;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "boundary_audit") {
      this.auditCalls += 1;
      if (this.auditCalls <= 2) {
        return JSON.stringify({
          relation: "cut",
          previousEndComplete: true,
          previousEndHookEffective: true,
          nextStartAnchored: false,
          factChecks: [],
          danglingThreads: [],
          contradictions: [],
          action: "anchor_next",
          reason: "下一章开头缺时间和地点锚点。",
          repairBrief: "补时间、地点和视角锚点。",
        });
      }
      return JSON.stringify({
        relation: "cut",
        previousEndComplete: true,
        previousEndHookEffective: true,
        nextStartAnchored: true,
        factChecks: [],
        danglingThreads: [],
        contradictions: [],
        action: "none",
        reason: "补完后接缝正常。",
        repairBrief: "",
      });
    }

    if (req.kind === "seam_repair") {
      this.repairCalls += 1;
      return JSON.stringify({
        previousTail: "",
        previousParagraphs: 0,
        nextHead: "第二天早上，约翰站在总部电梯里。",
        nextParagraphs: 0,
        notes: "补场景锚点。",
      });
    }

    return super.generateText(req);
  }
}

class AbortDuringChapterGateway extends DelegatingGateway {
  readonly controller = new AbortController();
  chapterCalls = 0;
  sawSignal = false;

  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "chapter") {
      this.chapterCalls += 1;
      this.sawSignal = req.signal === this.controller.signal;
      this.controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }
    return super.generateText(req);
  }
}

class FilteringStateGateway extends DelegatingGateway {
  override async generateText(req: GenerateRequest): Promise<string> {
    if (req.kind === "state") {
      return JSON.stringify({
        entities: [],
        relationships: [],
        foreshadows: [],
        events: [
          { summary: "未来事件。", chapterNumber: 3 },
          { summary: "本章发生的事件。", chapterNumber: 1 },
        ],
      });
    }
    return super.generateText(req);
  }
}

describe("runNovelPipeline", () => {
  it("generates, reviews, updates state, saves artifacts, and completes the project", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 800,
        maxChapters: 3,
      }),
    );
    const progress: RunProgress[] = [];

    const result = await runNovelPipeline({
      project,
      ai: new FakeAiGateway(),
      store,
      reviewEnabled: true,
      onProgress: (event) => progress.push(event),
    });

    expect(result.project.status).toBe("completed");
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3]);
    expect(result.chapters.map((chapter) => chapter.status)).toEqual([
      "committed",
      "committed",
      "committed",
    ]);

    for (const chapter of result.chapters) {
      expect(chapter.review?.gate).toBe("pass");
      expect(chapter.stateSnapshot).toBeDefined();
      expect(chapter.wordCount).toBeGreaterThan(0);
      expect(chapter.text.length).toBeGreaterThan(0);
    }

    expect(
      progress.some(
        (event) =>
          event.phase === "chapter" &&
          event.chapterNumber === 2 &&
          event.wordCount !== undefined &&
          event.gate === "pass",
      ),
    ).toBe(true);
    for (const phase of [
      "setup",
      "bible",
      "outline",
      "write",
      "chapter",
      "review",
      "state",
      "export",
      "done",
    ]) {
      expect(progress.some((event) => event.phase === phase), phase).toBe(true);
    }

    for (const name of [
      "bible.json",
      "outline.json",
      "chapters.json",
      "state.json",
      "chapter-001.json",
      "chapter-002.json",
      "chapter-003.json",
      "book.md",
      "book.txt",
      "review-log.jsonl",
    ]) {
      expect(store.getArtifact(project.id, name), name).toBeDefined();
    }

    const reviewLog = store
      .getArtifact(project.id, "review-log.jsonl")!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(reviewLog.every((entry) => !("text" in entry))).toBe(true);
    expect(reviewLog.some((entry) => entry.type === "review")).toBe(true);

    const savedChapters = JSON.parse(
      store.getArtifact(project.id, "chapters.json")!,
    ) as unknown[];
    expect(savedChapters).toHaveLength(3);

    const savedState = JSON.parse(store.getArtifact(project.id, "state.json")!) as {
      events: unknown[];
    };
    expect(savedState.events).toHaveLength(3);

    expect(store.getArtifact(project.id, "book.md")).toContain("## 第1章");
    expect(store.getArtifact(project.id, "book.txt")).toContain("第1章");
    expect((await store.getProject(project.id))?.status).toBe("completed");
  });

  it("smooths a chapter boundary before exporting the book", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 2,
      }),
    );
    const ai = new SeamRepairPipelineGateway();

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.repairCalls).toBe(1);
    expect(result.chapters[1]!.text.startsWith("第二天早上")).toBe(true);
    expect(result.chapters[1]!.stateSnapshot).toBeDefined();

    const book = store.getArtifact(project.id, "book.md")!;
    expect(book).toContain("第二天早上，约翰站在总部电梯里。");

    const report = JSON.parse(
      store.getArtifact(project.id, "continuity-report.json")!,
    ) as { entries: Array<{ status: string }> };
    expect(report.entries[0]!.status).toBe("repaired");
  });

  it("revises once and re-reviews after a revise gate", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const ai = new ReviseOnceGateway();

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.reviseCalls).toBe(1);
    expect(ai.reviewCalls).toBe(2);
    expect(result.chapters[0]!.review?.gate).toBe("pass");
    expect(result.chapters[0]!.status).toBe("committed");

    const reviewLog = store
      .getArtifact(project.id, "review-log.jsonl")!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, any>);
    expect(
      reviewLog.some(
        (entry) =>
          entry.type === "review" &&
          entry.stage === "initial" &&
          entry.review?.issues?.[0]?.fix === "改写为顾沉出现，并保留对峙张力。",
      ),
    ).toBe(true);
    expect(
      reviewLog.some(
        (entry) => entry.type === "revision_decision" && entry.accepted === true,
      ),
    ).toBe(true);
  });

  it("keeps the original chapter when a revised block ranks lower", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const revisedMarker = "这是修订版本。";
    const ai = new ReviewSequenceGateway(
      [reviewFor("revise"), reviewFor("block")],
      revisedMarker.repeat(80),
    );

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.reviseCalls).toBe(1);
    expect(ai.reviewCalls).toBe(2);
    expect(result.chapters[0]!.text).not.toContain(revisedMarker);
    expect(result.chapters[0]!.review?.gate).toBe("revise");
    expect(result.chapters[0]!.status).toBe("needs_attention");
  });

  it("accepts a same-score revision that fixes more issues and stays near target", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const draft = "初".repeat(300);
    const revised = "改".repeat(285);
    const progress: RunProgress[] = [];
    const ai = new FixedDraftGateway(
      [
        reviseReviewWith([
          issue("high", "甲"),
          issue("medium", "乙"),
          issue("low", "丙"),
          issue("low", "丁"),
          issue("low", "戊"),
        ]),
        reviseReviewWith([
          issue("high", "己"),
          issue("medium", "庚"),
          issue("medium", "辛"),
        ]),
        reviewFor("pass"),
      ],
      draft,
      revised,
    );

    const result = await runNovelPipeline({
      project,
      ai,
      store,
      reviewEnabled: true,
      onProgress: (event) => progress.push(event),
    });

    expect(ai.reviseCalls).toBe(2);
    expect(result.chapters[0]!.text).toBe(revised);
    expect(result.chapters[0]!.review?.gate).toBe("pass");
    expect(
      progress.some((event) => event.message.includes("问题数 5 → 3")),
    ).toBe(true);
  });

  it("keeps the original when an equal-gate revision only shortens the chapter", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const shortRevision = "短。".repeat(10);
    const ai = new ReviewSequenceGateway(
      [reviewFor("revise"), reviewFor("revise")],
      shortRevision,
    );

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.reviseCalls).toBe(1);
    expect(ai.reviewCalls).toBe(2);
    expect(result.chapters[0]!.text).not.toBe(shortRevision);
    expect(result.chapters[0]!.review?.gate).toBe("revise");
    expect(result.chapters[0]!.status).toBe("needs_attention");
  });

  it("repairs an ending that stops mid-scene, then re-reviews and re-audits", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const ai = new IncompleteEndingGateway();

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.audits).toBe(2);
    expect(ai.finishCalls).toBe(1);
    expect(result.chapters[0]!.review?.gate).toBe("pass");
    expect(result.chapters[0]!.status).toBe("committed");
  });

  it("keeps the revision when its re-review passes", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const revisedMarker = "这是修订版本。";
    const ai = new ReviewSequenceGateway(
      [reviewFor("revise"), reviewFor("pass")],
      revisedMarker.repeat(80),
    );

    const result = await runNovelPipeline({ project, ai, store, reviewEnabled: true });

    expect(ai.reviseCalls).toBe(1);
    expect(ai.reviewCalls).toBe(2);
    expect(result.chapters[0]!.text).toContain(revisedMarker);
    expect(result.chapters[0]!.review?.gate).toBe("pass");
    expect(result.chapters[0]!.status).toBe("committed");
  });

  it("keeps valid state deltas when other deltas are invalid", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );
    const progress: RunProgress[] = [];

    const result = await runNovelPipeline({
      project,
      ai: new FilteringStateGateway(),
      store,
      reviewEnabled: true,
      onProgress: (event) => progress.push(event),
    });

    expect(result.chapters[0]!.stateSnapshot?.events).toEqual([
      { summary: "本章发生的事件。", chapterNumber: 1 },
    ]);
    expect(
      progress.some(
        (event) =>
          event.phase === "state" &&
          event.chapterNumber === 1 &&
          event.message.includes("未来事件。"),
      ),
    ).toBe(true);
    expect(result.project.status).toBe("completed");
  });

  it("continues when state extraction fails and keeps the previous state", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 2,
      }),
    );
    const ai = new StateFailOnceGateway();
    const progress: RunProgress[] = [];

    const result = await runNovelPipeline({
      project,
      ai,
      store,
      reviewEnabled: true,
      onProgress: (event) => progress.push(event),
    });

    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]!.stateSnapshot).toBeUndefined();
    expect(result.chapters[1]!.stateSnapshot).toBeDefined();
    expect(
      progress.some(
        (event) =>
          event.phase === "state" &&
          event.chapterNumber === 1 &&
          event.error?.includes("state boom"),
      ),
    ).toBe(true);
    expect(result.project.status).toBe("completed");
  });

  it("marks a blocked chapter as needs_attention and continues", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 1,
      }),
    );

    const result = await runNovelPipeline({
      project,
      ai: new BlockingGateway(),
      store,
      reviewEnabled: true,
    });

    expect(result.chapters[0]!.review?.gate).toBe("block");
    expect(result.chapters[0]!.status).toBe("needs_attention");
    expect(result.project.status).toBe("completed");
    expect(store.getArtifact(project.id, "book.md")).toBeDefined();
  });

  it("wraps chapter failures in PipelineError and preserves saved artifacts", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 2,
      }),
    );

    const progress: RunProgress[] = [];
    const promise = runNovelPipeline({
      project,
      ai: new ChapterFailGateway(),
      store,
      onProgress: (event) => progress.push(event),
    });

    await expect(promise).rejects.toBeInstanceOf(PipelineError);
    await expect(promise).rejects.toMatchObject({ chapterNumber: 2 });
    expect(store.getArtifact(project.id, "chapter-001.json")).toBeDefined();
    expect(store.getArtifact(project.id, "chapter-002.json")).toBeUndefined();
    expect(store.getArtifact(project.id, "book.md")).toBeUndefined();
    expect((await store.getProject(project.id))?.status).toBe("failed");
    expect(
      progress.some(
        (event) =>
          event.phase === "error" && event.error?.includes("chapter boom"),
      ),
    ).toBe(true);
  });

  it("aborts before starting the next chapter", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 3,
      }),
    );
    const controller = new AbortController();
    const promise = runNovelPipeline({
      project,
      ai: new DelegatingGateway(),
      store,
      signal: controller.signal,
      onProgress: (event) => {
        if (
          event.phase === "chapter" &&
          event.chapterNumber === 1 &&
          event.wordCount !== undefined
        ) {
          controller.abort();
        }
      },
    });

    await expect(promise).rejects.toBeInstanceOf(PipelineAbortError);
    await expect(promise).rejects.toThrow(/abort/i);
    expect(store.getArtifact(project.id, "chapter-001.json")).toBeDefined();
    expect(store.getArtifact(project.id, "chapter-002.json")).toBeUndefined();
  });

  it("stops immediately when the gateway aborts during a chapter call", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject(
      createProject({
        premise: "一个少年在旧城意外觉醒。",
        chapterWords: 300,
        maxChapters: 3,
      }),
    );
    const ai = new AbortDuringChapterGateway();

    const promise = runNovelPipeline({
      project,
      ai,
      store,
      signal: ai.controller.signal,
    });

    await expect(promise).rejects.toBeInstanceOf(PipelineAbortError);
    expect(ai.sawSignal).toBe(true);
    expect(ai.chapterCalls).toBe(1);
    expect(store.getArtifact(project.id, "chapter-001.json")).toBeUndefined();
    expect(store.getArtifact(project.id, "chapter-002.json")).toBeUndefined();
    expect((await store.getProject(project.id))?.status).toBe("failed");
  });
});
