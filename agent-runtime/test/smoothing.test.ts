import { describe, expect, it } from "vitest";
import type { AiGateway, GenerateRequest } from "../src/ai/gateway.js";
import {
  countWords,
  type BoundaryAudit,
  type Chapter,
} from "../src/domain/schemas.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import { smoothChapterBoundaries } from "../src/story/smoothing.js";
import {
  makeBible,
  makeChapter,
  makeOutline,
  makeProject,
} from "./story-fixtures.js";

class ScriptedSeamGateway implements AiGateway {
  readonly requests: GenerateRequest[] = [];
  private readonly audits: string[];
  private readonly repairs: string[];
  private readonly states: string[];

  constructor(input: {
    audits?: string[];
    repairs?: string[];
    states?: string[];
  } = {}) {
    this.audits = [...(input.audits ?? [])];
    this.repairs = [...(input.repairs ?? [])];
    this.states = [...(input.states ?? [])];
  }

  async generateText(req: GenerateRequest): Promise<string> {
    this.requests.push(req);

    if (req.kind === "boundary_audit") {
      const response = this.audits.shift();
      if (response === undefined) throw new Error("No audit response left.");
      return response;
    }
    if (req.kind === "seam_repair") {
      const response = this.repairs.shift();
      if (response === undefined) throw new Error("No repair response left.");
      return response;
    }
    if (req.kind === "state") {
      const response = this.states.shift();
      if (response === undefined) throw new Error("No state response left.");
      return response;
    }

    throw new Error(`Unexpected request kind: ${req.kind}`);
  }
}

function auditJson(overrides: Partial<BoundaryAudit> = {}): string {
  return JSON.stringify({
    relation: "cut",
    previousEndComplete: true,
    previousEndHookEffective: true,
    nextStartAnchored: true,
    factChecks: [],
    danglingThreads: [],
    contradictions: [],
    action: "none",
    reason: "场景切换有锚点。",
    repairBrief: "",
    ...overrides,
  });
}

function repairJson(
  overrides: {
    previousTail?: string;
    previousParagraphs?: number;
    nextHead?: string;
    nextParagraphs?: number;
    notes?: string;
  } = {},
): string {
  return JSON.stringify({
    previousTail: "",
    previousParagraphs: 0,
    nextHead: "",
    nextParagraphs: 0,
    notes: "",
    ...overrides,
  });
}

function makeChapterRecord(
  number: number,
  text: string,
  state?: Chapter["stateSnapshot"],
): Chapter {
  const outline = makeChapter(number, 120);
  return {
    number,
    title: outline.title,
    outline,
    text,
    wordCount: countWords(text),
    status: "drafted",
    ...(state === undefined ? {} : { stateSnapshot: state }),
  };
}

function makeInput(
  chapters: Chapter[],
  gateway: AiGateway,
  overrides: Partial<Parameters<typeof smoothChapterBoundaries>[0]> = {},
): Parameters<typeof smoothChapterBoundaries>[0] {
  const store = new MemoryProjectStore();
  return {
    project: makeProject(),
    bible: makeBible(6),
    outline: makeOutline(6, 120),
    chapters,
    boundaries: [{ fromChapter: 1, toChapter: 2 }],
    ai: gateway,
    store,
    mode: "auto",
    refreshState: false,
    auditPasses: 1,
    ...overrides,
  };
}

describe("smoothChapterBoundaries", () => {
  it("leaves a cut with an anchor untouched", async () => {
    const first = makeChapterRecord(1, "他推开门。\n\n屋里没人。");
    const second = makeChapterRecord(
      2,
      "第二天早上，约翰站在总部电梯里。\n\n电梯门开了。",
    );
    const gateway = new ScriptedSeamGateway({
      audits: [auditJson({ relation: "cut", action: "none" })],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.chapters[1]!.text).toBe(second.text);
    expect(result.report.entries[0]!.status).toBe("ok");
    expect(result.changedChapters).toEqual([]);
  });

  it("does not rewrite a complete but quiet ending", async () => {
    const first = makeChapterRecord(1, "他关掉手机。\n\n屋里安静下来。");
    const second = makeChapterRecord(
      2,
      "第二天早上，约翰站在总部电梯里。\n\n电梯门开了。",
    );
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "cut",
          previousEndComplete: true,
          previousEndHookEffective: false,
          nextStartAnchored: true,
          action: "close_previous",
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.report.entries[0]!.status).toBe("ok");
  });

  it("anchors the next chapter when a hard obligation is ignored", async () => {
    const first = makeChapterRecord(
      1,
      "“明天十点，品牌交接会议。”\n\n他挂了电话。",
    );
    const second = makeChapterRecord(2, "他推开门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "cut",
          action: "none",
          factChecks: [
            {
              fact: "明天十点的品牌交接会议",
              status: "ignored",
              evidence: "未提及",
            },
          ],
        }),
        auditJson({ relation: "cut", action: "none" }),
      ],
      repairs: [
        repairJson({
          nextHead: "离十点的品牌交接会议还有两个小时。",
          nextParagraphs: 0,
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(result.chapters[1]!.text.startsWith("离十点")).toBe(true);
    expect(result.changedChapters).toEqual([2]);
    expect(result.report.entries[0]!.status).toBe("repaired");
  });

  it("flags a contradicted hard fact even when the relation is a cut", async () => {
    const first = makeChapterRecord(1, "他签了不服从调度确认单。");
    const second = makeChapterRecord(2, "他昨天签了出勤确认单。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "cut",
          action: "none",
          factChecks: [
            {
              fact: "约翰签的是不服从调度确认单",
              status: "contradicted",
              evidence: "下一章写成出勤确认单",
            },
          ],
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.chapters[1]!.text).toBe(second.text);
    expect(result.report.entries[0]!.status).toBe("flagged");
  });

  it("merges two audit passes and keeps the stricter finding", async () => {
    const first = makeChapterRecord(1, "“明天十点开会。”\n\n他挂了电话。");
    const second = makeChapterRecord(2, "他推开门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({ relation: "cut", action: "none" }),
        auditJson({
          relation: "cut",
          action: "none",
          factChecks: [
            {
              fact: "明天十点的会议",
              status: "ignored",
              evidence: "未提及",
            },
          ],
        }),
        auditJson({ relation: "cut", action: "none" }),
        auditJson({ relation: "cut", action: "none" }),
      ],
      repairs: [
        repairJson({
          nextHead: "离十点的会议还有两个小时。",
          nextParagraphs: 0,
        }),
      ],
    });

    const result = await smoothChapterBoundaries({
      ...makeInput([first, second], gateway),
      auditPasses: 2,
    });

    expect(gateway.requests.filter((r) => r.kind === "boundary_audit")).toHaveLength(4);
    expect(result.chapters[1]!.text.startsWith("离十点")).toBe(true);
    expect(result.report.entries[0]!.status).toBe("repaired");
  });

  it("keeps a partial seam repair and marks remaining contradictions", async () => {
    const first = makeChapterRecord(1, "“明天十点开会。”\n\n他挂了电话。");
    const second = makeChapterRecord(2, "他推开门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "cut",
          action: "none",
          factChecks: [
            {
              fact: "明天十点的会议",
              status: "ignored",
              evidence: "未提及",
            },
          ],
        }),
        auditJson({
          relation: "cut",
          action: "flag",
          contradictions: ["下一章把会议文件写成了另一份文件。"],
        }),
      ],
      repairs: [
        repairJson({
          nextHead: "离十点的会议还有两个小时。",
          nextParagraphs: 0,
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(result.chapters[1]!.text.startsWith("离十点")).toBe(true);
    expect(result.report.entries[0]!.status).toBe("flagged");
    expect(result.changedChapters).toEqual([2]);
  });

  it("replaces a mid-action ending and re-audits the seam", async () => {
    const first = makeChapterRecord(
      1,
      "电话响了两声。\n\n“遗属会，您好。”\n\n“我是约翰·凯尔。”他说。\n\n那头静了一拍。\n\n“我是米洛·陈。你说。”",
    );
    const second = makeChapterRecord(
      2,
      "第二天早上，约翰站在总部电梯里。\n\n电梯门开了。",
    );
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "broken",
          previousEndComplete: false,
          action: "close_previous",
          repairBrief: "补米洛的回应和约翰的决定。",
        }),
        auditJson({ relation: "continue", action: "none" }),
      ],
      repairs: [
        repairJson({
          previousTail:
            "电话那头沉默了一拍。约翰把来意说完，米洛只回了一句“明天给你答复”。",
          previousParagraphs: 1,
        }),
      ],
    });

    const input = makeInput([first, second], gateway);
    const result = await smoothChapterBoundaries(input);

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
      "seam_repair",
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).not.toContain("我是米洛·陈。你说。");
    expect(result.chapters[0]!.text).toContain("明天给你答复");
    expect(result.chapters[0]!.wordCount).toBe(
      countWords(result.chapters[0]!.text),
    );
    expect(result.report.entries[0]!.status).toBe("repaired");
    expect(result.changedChapters).toEqual([1]);

    const secondRun = new ScriptedSeamGateway();
    const cached = await smoothChapterBoundaries({
      ...input,
      chapters: result.chapters,
      ai: secondRun,
      force: false,
    });
    expect(secondRun.requests).toHaveLength(0);
    expect(cached.report.entries[0]!.status).toBe("repaired");
  });

  it("prepends an anchor to the next chapter", async () => {
    const first = makeChapterRecord(1, "他关掉灯。\n\n门锁咔哒一声。");
    const second = makeChapterRecord(2, "他推开门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "cut",
          nextStartAnchored: false,
          action: "anchor_next",
          repairBrief: "补时间、地点和视角锚点。",
        }),
        auditJson({ relation: "cut", action: "none" }),
      ],
      repairs: [
        repairJson({
          nextHead:
            "三十七层的电梯门打开时，约翰先听见咖啡机在磨豆。",
          nextParagraphs: 0,
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(result.chapters[1]!.text.startsWith("三十七层")).toBe(true);
    expect(result.chapters[1]!.text).toContain("他推开门。");
    expect(result.changedChapters).toEqual([2]);
    expect(result.report.entries[0]!.status).toBe("repaired");
  });

  it("flags contradictions without editing text", async () => {
    const first = makeChapterRecord(1, "约翰在旧城。\n\n他关掉灯。");
    const second = makeChapterRecord(2, "约翰在总部。\n\n电梯门开了。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "broken",
          action: "flag",
          contradictions: ["人物从旧城瞬移到总部，缺少过渡。"],
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.chapters[1]!.text).toBe(second.text);
    expect(result.report.entries[0]!.status).toBe("flagged");
  });

  it("rejects an overlong or incomplete repair", async () => {
    const first = makeChapterRecord(1, "电话接通了。\n\n“你说。”");
    const second = makeChapterRecord(2, "第二天早上，约翰出门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "broken",
          previousEndComplete: false,
          action: "close_previous",
          repairBrief: "补完电话。",
        }),
      ],
      repairs: [
        repairJson({
          previousTail: "没有句号",
          previousParagraphs: 1,
        }),
      ],
    });

    const result = await smoothChapterBoundaries(
      makeInput([first, second], gateway),
    );

    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.report.entries[0]!.status).toBe("failed");
    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
      "seam_repair",
    ]);
  });

  it("does not edit in report mode", async () => {
    const first = makeChapterRecord(1, "电话接通了。\n\n“你说。”");
    const second = makeChapterRecord(2, "第二天早上，约翰出门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "broken",
          previousEndComplete: false,
          action: "close_previous",
          repairBrief: "补完电话。",
        }),
      ],
    });

    const result = await smoothChapterBoundaries({
      ...makeInput([first, second], gateway),
      mode: "report",
    });

    expect(gateway.requests.map((request) => request.kind)).toEqual([
      "boundary_audit",
    ]);
    expect(result.chapters[0]!.text).toBe(first.text);
    expect(result.report.entries[0]!.status).toBe("reported");
  });

  it("refreshes the state snapshot of a repaired chapter", async () => {
    const first = makeChapterRecord(1, "电话接通了。\n\n“你说。”");
    const second = makeChapterRecord(2, "第二天早上，约翰出门。");
    const gateway = new ScriptedSeamGateway({
      audits: [
        auditJson({
          relation: "broken",
          previousEndComplete: false,
          action: "close_previous",
          repairBrief: "补完电话。",
        }),
        auditJson({ relation: "continue", action: "none" }),
      ],
      repairs: [
        repairJson({
          previousTail: "电话那头沉默了一拍。约翰把来意说完，米洛说明天答复。",
          previousParagraphs: 1,
        }),
      ],
      states: [
        JSON.stringify({
          entities: [],
          relationships: [],
          foreshadows: [],
          events: [{ summary: "约翰打完电话。", chapterNumber: 1 }],
        }),
      ],
    });

    const result = await smoothChapterBoundaries({
      ...makeInput([first, second], gateway),
      refreshState: true,
    });

    expect(gateway.requests.some((request) => request.kind === "state")).toBe(
      true,
    );
    expect(result.chapters[0]!.stateSnapshot?.events[0]?.summary).toBe(
      "约翰打完电话。",
    );
  });
});
