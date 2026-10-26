import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ForeshadowStore } from "../domain/foreshadowStore.js";
import type { ProjectStore } from "../domain/store.js";
import {
  countWords,
  type Chapter,
  type Outline,
  type OutlineChapter,
  type Project,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import type {
  BookGraph,
  NovelEdge,
  NovelGraphStore,
  NovelNode,
} from "../graph/types.js";
import {
  chapterBriefFor,
  chapterHeading,
  type ChapterBriefBlock,
  type ChapterSummaryBlock,
} from "../story/context.js";
import { loadChapter } from "../story/library.js";
import { flattenChapters } from "../story/outline.js";
import { trimToWordLimit } from "../story/wordBudget.js";

export interface ChapterToolContext {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  store: ProjectStore;
  foreshadows: ForeshadowStore;
  graph?: NovelGraphStore;
  /** Finalized chapters before the current chapter. */
  chapters: Chapter[];
  state: StoryState;
  targetChapter: OutlineChapter;
  startChapterNumber: number;
  endChapterNumber: number;
  maxToolCalls: number;
  toolCallCount: number;
  commitCount?: number;
  draft?: { text: string };
  emit?: (event: {
    phase: string;
    message: string;
    chapterNumber?: number;
    wordCount?: number;
  }) => void;
}

export interface ChapterToolset {
  tools: ToolDefinition[];
  getDraft(): string | undefined;
}

const MAX_DIGEST_RANGE = 30;
const MAX_RECALL_RANGE = 30;

function jsonResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : { value },
  };
}

function guard(ctx: ChapterToolContext, toolName: string): void {
  ctx.toolCallCount += 1;
  if (toolName === "chapter_commit") {
    ctx.commitCount = (ctx.commitCount ?? 0) + 1;
    if (ctx.commitCount > 5) {
      throw new Error(
        "chapter_commit 调用次数过多，请停止重复提交，直接结束本章。",
      );
    }
    return;
  }
  if (ctx.toolCallCount > ctx.maxToolCalls) {
    throw new Error(
      `工具调用次数超过上限 ${ctx.maxToolCalls}（最后调用：${toolName}）。请停止检索，直接写正文并调用 chapter_commit。`,
    );
  }
}

function formatDigestChapter(chapter: Chapter): string {
  const outline = chapter.outline;
  if (!chapter.digest) {
    return [
      `【${chapterHeading(chapter)}｜档案缺失，回退大纲】`,
      `- 大纲摘要：${outline.summary}`,
      `- goal：${outline.goal}`,
      `- turn：${outline.turn}`,
      `- reveal：${outline.reveal}`,
      `- hook：${outline.hook}`,
    ].join("\n");
  }

  const digest = chapter.digest;
  const settings = digest.coreSettings
    .map((entry) => `- [${entry.type}] ${entry.name}：${entry.detail}`)
    .join("\n");
  const characters = digest.characters
    .map(
      (entry) =>
        `- ${entry.name}｜${entry.roleInChapter}｜目标：${entry.goal}｜变化：${entry.change}`,
    )
    .join("\n");
  const plot = digest.plotNodes
    .map((entry, index) => `- ${index + 1}. ${entry.summary}｜影响：${entry.impact}`)
    .join("\n");
  const relationships = digest.relationshipProgress
    .map(
      (entry) =>
        `- ${entry.source} → ${entry.target}：${entry.change}（${entry.reason}）`,
    )
    .join("\n");
  const foreshadows = digest.foreshadows
    .map((entry) => `- ${entry.title}｜${entry.action}｜${entry.note}`)
    .join("\n");

  return [
    `【${chapterHeading(chapter)}】`,
    `核心设定：\n${settings || "- （无）"}`,
    `人物：\n${characters || "- （无）"}`,
    `情节发展：\n${plot || "- （无）"}`,
    `关系进展：\n${relationships || "- （无）"}`,
    `伏笔：\n${foreshadows || "- （无）"}`,
    `章末钩子：${outline.hook}`,
  ].join("\n");
}

function briefSourceLabel(block: ChapterBriefBlock): string {
  if (block.source === "digest") return "｜据章节档案整理";
  if (block.source === "outline") return "｜大纲回退";
  return "";
}

function formatBriefBlock(block: ChapterBriefBlock): string {
  return [
    `【${chapterHeading({
      number: block.chapterNumber,
      title: block.title,
    })}｜本章摘要${briefSourceLabel(block)}】`,
    block.text,
  ].join("\n");
}

function formatRollingBlock(block: ChapterSummaryBlock): string {
  return [
    `【第${block.fromChapter}-${block.toChapter}章｜滚动摘要】`,
    block.text,
  ].join("\n");
}

function findChapter(
  chapters: readonly Chapter[],
  chapterNumber: number,
): Chapter | undefined {
  return chapters.find((chapter) => chapter.number === chapterNumber);
}

function graphNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nodeChapterRange(node: NovelNode): {
  from?: number;
  to?: number;
} {
  const setup = graphNumber(node.data?.setupChapter);
  const payoff = graphNumber(node.data?.payoffChapter);
  const advanced = graphNumber(node.data?.lastAdvancedChapter);

  if (node.kind === "thread") {
    const from = setup ?? advanced;
    const to = payoff ?? advanced ?? from;
    return {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
  }

  if (node.chapter !== undefined) {
    return { from: node.chapter, to: node.chapter };
  }

  return {};
}

function nodeMatchesChapter(
  node: NovelNode,
  fromChapter: number,
  toChapter: number,
): boolean {
  const range = nodeChapterRange(node);
  if (range.from === undefined) return true;
  return range.from <= toChapter && (range.to ?? range.from) >= fromChapter;
}

function edgeMatchesChapter(edge: NovelEdge, cutoffChapter: number): boolean {
  if (edge.fromChapter !== undefined && edge.fromChapter > cutoffChapter) {
    return false;
  }
  if (edge.evidenceChapter !== undefined && edge.evidenceChapter > cutoffChapter) {
    return false;
  }
  return true;
}

function sanitizeGraphData(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(
    ([key]) => key !== "pairKey" && key !== "signature" && !key.startsWith("_"),
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function formatGraphNode(node: NovelNode): Record<string, unknown> {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    ...(node.chapter === undefined ? {} : { chapter: node.chapter }),
    ...(node.status === undefined ? {} : { status: node.status }),
    ...(sanitizeGraphData(node.data) === undefined
      ? {}
      : { data: sanitizeGraphData(node.data) }),
  };
}

const GRAPH_KIND_ORDER: Record<NovelNode["kind"], number> = {
  character: 0,
  thread: 1,
  event: 2,
  faction: 3,
  location: 4,
  item: 5,
  concept: 6,
  entity: 7,
  chapter: 8,
  book: 9,
};

function sortGraphNodes(nodes: NovelNode[]): NovelNode[] {
  return [...nodes].sort((left, right) => {
    const kindDifference =
      GRAPH_KIND_ORDER[left.kind] - GRAPH_KIND_ORDER[right.kind];
    if (kindDifference !== 0) return kindDifference;
    const chapterDifference =
      (left.chapter ?? 0) - (right.chapter ?? 0);
    if (chapterDifference !== 0) return chapterDifference;
    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function createChapterTools(ctx: ChapterToolContext): ChapterToolset {
  const runStatusTool = defineTool({
    name: "run_status",
    label: "写作进度",
    description:
      "查看本次写作范围、已完成的前序章节、当前章节和下一章。需要确认进度或章节大纲时调用。",
    parameters: Type.Object({
      chapterNumber: Type.Optional(
        Type.Integer({ description: "要查看的章节号；省略时返回当前章节。" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "run_status");
      const outlineChapter =
        params.chapterNumber === undefined
          ? ctx.targetChapter
          : flattenChapters(ctx.outline).find(
              (chapter) => chapter.number === params.chapterNumber,
            );

      if (!outlineChapter) {
        throw new Error(`第 ${String(params.chapterNumber)} 章不在大纲中。`);
      }
      if (
        params.chapterNumber !== undefined &&
        params.chapterNumber > ctx.targetChapter.number
      ) {
        throw new Error(
          `不能提前查看未来章节；当前只能查看第 ${ctx.targetChapter.number} 章及之前。`,
        );
      }

      return jsonResult({
        range: {
          fromChapter: ctx.startChapterNumber,
          toChapter: ctx.endChapterNumber,
        },
        completedChapters: ctx.chapters
          .filter(
            (chapter) =>
              chapter.number >= ctx.startChapterNumber &&
              chapter.number <= ctx.endChapterNumber &&
              chapter.number < ctx.targetChapter.number,
          )
          .map((chapter) => ({
            number: chapter.number,
            title: chapter.title,
            wordCount: chapter.wordCount,
            status: chapter.status,
          })),
        targetChapter: {
          number: outlineChapter.number,
          title: outlineChapter.title,
          targetWords: outlineChapter.targetWords,
          cast: outlineChapter.cast,
          goal: outlineChapter.goal,
          conflict: outlineChapter.conflict,
          turn: outlineChapter.turn,
          reveal: outlineChapter.reveal,
          hook: outlineChapter.hook,
        },
        committedDraftWords:
          ctx.draft === undefined ? 0 : countWords(ctx.draft.text),
      });
    },
  });

  const storyDigestTool = defineTool({
    name: "story_digest",
    label: "章节档案",
    description:
      "检索当前章之前某个章节区间的核心设定、出场人物、情节发展节点、人物关系进展、伏笔动作和章末钩子。用于回忆更早章节发生过什么，或核对伏笔来源与钩子细节。",
    parameters: Type.Object({
      fromChapter: Type.Integer({ description: "起始章节号，包含。" }),
      toChapter: Type.Integer({ description: "结束章节号，包含。" }),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "story_digest");
      if (params.fromChapter < 1 || params.toChapter < params.fromChapter) {
        throw new Error("章节区间无效：需要 1 <= fromChapter <= toChapter。");
      }
      if (params.toChapter - params.fromChapter + 1 > MAX_DIGEST_RANGE) {
        throw new Error(
          `一次最多检索 ${MAX_DIGEST_RANGE} 章，请缩小区间。`,
        );
      }
      const lastAvailableChapter = ctx.targetChapter.number - 1;
      if (lastAvailableChapter < 1) {
        throw new Error("当前是第 1 章，没有可检索的既往章节。");
      }
      if (params.toChapter > lastAvailableChapter) {
        throw new Error(
          `不能检索当前章及未来章节；当前最多检索到第 ${lastAvailableChapter} 章。`,
        );
      }

      const found = ctx.chapters
        .filter(
          (chapter) =>
            chapter.number >= params.fromChapter &&
            chapter.number <= params.toChapter,
        )
        .sort((left, right) => left.number - right.number);

      if (found.length === 0) {
        return jsonResult({
          range: { fromChapter: params.fromChapter, toChapter: params.toChapter },
          chapters: [],
          message: "该区间尚无已写章节。",
        });
      }

      return {
        content: [
          {
            type: "text",
            text: found.map(formatDigestChapter).join("\n\n"),
          },
        ],
        details: {
          fromChapter: params.fromChapter,
          toChapter: params.toChapter,
          chapterCount: found.length,
        },
      };
    },
  });

  const storyRecallTool = defineTool({
    name: "story_recall",
    label: "分层回忆",
    description:
      "按层级回忆当前章之前的章节。level=rolling 返回 5 章一块的滚动摘要，用于定位时间段和主线；level=chapter 返回逐章 2-3 句摘要，用于确认事件、因果与章末钩子。需要精确原文时再调用 chapter_read。",
    parameters: Type.Object({
      level: Type.Union([
        Type.Literal("rolling"),
        Type.Literal("chapter"),
      ], { description: "rolling=滚动摘要；chapter=逐章摘要。" }),
      fromChapter: Type.Integer({ description: "起始章节号，包含。" }),
      toChapter: Type.Integer({ description: "结束章节号，包含；不能超过当前章之前。" }),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "story_recall");
      const cutoffChapter = ctx.targetChapter.number - 1;
      if (params.fromChapter < 1 || params.toChapter < params.fromChapter) {
        throw new Error("章节区间无效：需要 1 <= fromChapter <= toChapter。");
      }
      if (params.toChapter > cutoffChapter) {
        throw new Error(
          `不能检索当前章或未来章节；当前最多检索到第 ${cutoffChapter} 章。`,
        );
      }
      if (params.toChapter - params.fromChapter + 1 > MAX_RECALL_RANGE) {
        throw new Error(`一次最多检索 ${MAX_RECALL_RANGE} 章，请缩小区间。`);
      }

      if (params.level === "rolling") {
        const seen = new Set<string>();
        const blocks: ChapterSummaryBlock[] = ctx.chapters
          .filter(
            (chapter) =>
              chapter.number <= cutoffChapter &&
              chapter.summary !== undefined &&
              chapter.summary.toChapter >= params.fromChapter &&
              chapter.summary.fromChapter <= params.toChapter,
          )
          .sort((left, right) => left.number - right.number)
          .flatMap((chapter) => {
            const summary = chapter.summary;
            if (!summary) return [];
            const key = `${summary.fromChapter}-${summary.toChapter}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ ...summary, source: "chapter" as const }];
          });

        if (blocks.length === 0) {
          return jsonResult({
            level: params.level,
            fromChapter: params.fromChapter,
            toChapter: params.toChapter,
            blocks: [],
            message: "该区间没有可用的滚动摘要。请改用 level=chapter 或 chapter_read。",
          });
        }

        return {
          content: [
            {
              type: "text",
              text: blocks.map(formatRollingBlock).join("\n\n"),
            },
          ],
          details: {
            level: params.level,
            fromChapter: params.fromChapter,
            toChapter: params.toChapter,
            blockCount: blocks.length,
          },
        };
      }

      const briefs = ctx.chapters
        .filter(
          (chapter) =>
            chapter.number >= params.fromChapter &&
            chapter.number <= params.toChapter &&
            chapter.number <= cutoffChapter &&
            chapter.text.trim().length > 0,
        )
        .sort((left, right) => left.number - right.number)
        .flatMap((chapter) => {
          const block = chapterBriefFor(chapter);
          return block === undefined ? [] : [block];
        });

      if (briefs.length === 0) {
        return jsonResult({
          level: params.level,
          fromChapter: params.fromChapter,
          toChapter: params.toChapter,
          blocks: [],
          message: "该区间没有已写章节的逐章摘要。请直接用 chapter_read 读取原文。",
        });
      }

      return {
        content: [
          {
            type: "text",
            text: briefs.map(formatBriefBlock).join("\n\n"),
          },
        ],
        details: {
          level: params.level,
          fromChapter: params.fromChapter,
          toChapter: params.toChapter,
          chapterCount: briefs.length,
        },
      };
    },
  });

  const chapterReadTool = defineTool({
    name: "chapter_read",
    label: "读取章节",
    description:
      "读取当前章之前某一章的正文。默认返回全文；可用 maxChars 限制返回长度。用于核对细节或承接上一章。",
    parameters: Type.Object({
      chapterNumber: Type.Integer({ description: "章节号。" }),
      maxChars: Type.Optional(
        Type.Integer({ description: "最多返回多少个字符；省略返回全文。" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "chapter_read");
      if (params.chapterNumber >= ctx.targetChapter.number) {
        const lastAvailableChapter = ctx.targetChapter.number - 1;
        throw new Error(
          lastAvailableChapter < 1
            ? "当前是第 1 章，没有可读取的既往章节。"
            : `不能读取当前章或未来章节；只能读取第 1 至 ${lastAvailableChapter} 章。`,
        );
      }
      const chapter =
        findChapter(ctx.chapters, params.chapterNumber) ??
        (await loadChapter(ctx.store, ctx.project.id, params.chapterNumber));

      if (!chapter || chapter.text.trim().length === 0) {
        throw new Error(`第 ${params.chapterNumber} 章不存在或尚未写入。`);
      }

      const limit = params.maxChars ?? 0;
      const characters = Array.from(chapter.text);
      const text =
        limit > 0 && characters.length > limit
          ? `${characters.slice(0, limit).join("")}\n\n（已截断，原文共 ${characters.length} 字符）`
          : chapter.text;

      return {
        content: [
          {
            type: "text",
            text: `【${chapterHeading(chapter)}】\n${text}`,
          },
        ],
        details: {
          chapterNumber: chapter.number,
          wordCount: chapter.wordCount,
          truncated: limit > 0 && characters.length > limit,
        },
      };
    },
  });

  const storyGraphTool = defineTool({
    name: "story_graph",
    label: "知识图谱",
    description:
      "检索知识图谱中的人物关系时间线、事件、地点、物品、概念、阵营和伏笔连线。可按节点名搜索，或按章节范围查看；不会返回当前章之后的未来事实。",
    parameters: Type.Object({
      nodeName: Type.Optional(
        Type.String({ description: "按人物/地点/物品/概念/伏笔名检索，支持部分匹配。" }),
      ),
      nodeKind: Type.Optional(
        Type.Union([
          Type.Literal("character"),
          Type.Literal("thread"),
          Type.Literal("event"),
          Type.Literal("faction"),
          Type.Literal("location"),
          Type.Literal("item"),
          Type.Literal("concept"),
          Type.Literal("entity"),
          Type.Literal("chapter"),
          Type.Literal("book"),
        ]),
      ),
      chapterFrom: Type.Optional(
        Type.Integer({ description: "章节范围起点，包含。" }),
      ),
      chapterTo: Type.Optional(
        Type.Integer({ description: "章节范围终点，包含；不能超过当前章。" }),
      ),
      includeEdges: Type.Optional(
        Type.Boolean({ description: "是否返回节点之间的关系边，默认 true。" }),
      ),
      limit: Type.Optional(
        Type.Integer({ description: "最多返回多少个节点，默认 40，最大 100。" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "story_graph");
      if (!ctx.graph) {
        return jsonResult({
          available: false,
          reason: "知识图谱未启用。",
          nodes: [],
          edges: [],
        });
      }

      const cutoffChapter = ctx.targetChapter.number;
      const chapterTo = Math.min(
        params.chapterTo ?? cutoffChapter,
        cutoffChapter,
      );
      const chapterFrom = Math.max(1, params.chapterFrom ?? 1);
      if (chapterTo < chapterFrom) {
        throw new Error("章节范围无效：chapterFrom 不能大于 chapterTo。");
      }
      const limit = Math.max(1, Math.min(100, params.limit ?? 40));
      const includeEdges = params.includeEdges !== false;
      const query = params.nodeName?.trim().toLowerCase();

      let graph: BookGraph | undefined;
      try {
        graph = await ctx.graph.getGraph(ctx.project.id);
      } catch (error) {
        return jsonResult({
          available: false,
          reason: error instanceof Error ? error.message : String(error),
          nodes: [],
          edges: [],
        });
      }

      if (!graph || graph.nodes.length === 0) {
        return jsonResult({
          available: false,
          reason: "知识图谱尚无可检索的数据。",
          nodes: [],
          edges: [],
        });
      }

      const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
      const baseNodes = graph.nodes.filter((node) => {
        if (node.kind === "book" && params.nodeKind !== "book") return false;
        if (node.kind === "chapter" && params.nodeKind !== "chapter") {
          return false;
        }
        if (params.nodeKind !== undefined && node.kind !== params.nodeKind) {
          return false;
        }
        if (nodeMatchesChapter(node, chapterFrom, chapterTo) === false) {
          return false;
        }
        if (
          node.kind === "thread" &&
          (nodeChapterRange(node).from ?? 0) > chapterTo
        ) {
          return false;
        }
        return true;
      });

      const seedIds = new Set(
        query === undefined
          ? []
          : baseNodes
              .filter((node) => node.name.toLowerCase().includes(query))
              .map((node) => node.id),
      );
      if (query !== undefined && seedIds.size === 0) {
        return jsonResult({
          available: true,
          query,
          chapterFrom,
          chapterTo,
          nodeCount: 0,
          edgeCount: 0,
          nodes: [],
          edges: [],
        });
      }

      const selectedIds = new Set(seedIds);
      if (query !== undefined) {
        for (const edge of graph.edges) {
          if (!seedIds.has(edge.fromId) && !seedIds.has(edge.toId)) continue;
          if (!edgeMatchesChapter(edge, cutoffChapter)) continue;
          const source = nodeById.get(edge.fromId);
          const target = nodeById.get(edge.toId);
          if (source && nodeMatchesChapter(source, chapterFrom, chapterTo)) {
            selectedIds.add(edge.fromId);
          }
          if (target && nodeMatchesChapter(target, chapterFrom, chapterTo)) {
            selectedIds.add(edge.toId);
          }
        }
      } else {
        for (const node of baseNodes) {
          if (nodeMatchesChapter(node, chapterFrom, chapterTo)) {
            selectedIds.add(node.id);
          }
        }
      }

      if (selectedIds.size === 0) {
        for (const node of baseNodes) {
          if (nodeMatchesChapter(node, chapterFrom, chapterTo)) {
            selectedIds.add(node.id);
          }
        }
      }

      const selected = sortGraphNodes(
        Array.from(selectedIds, (id) => nodeById.get(id)).filter(
          (node): node is NovelNode => node !== undefined,
        ),
      ).slice(0, limit);
      const finalIds = new Set(selected.map((node) => node.id));
      const edges = includeEdges
        ? graph.edges
            .filter(
              (edge) =>
                finalIds.has(edge.fromId) &&
                finalIds.has(edge.toId) &&
                edgeMatchesChapter(edge, cutoffChapter),
            )
            .slice(0, 100)
            .map((edge) => ({
              id: edge.id,
              kind: edge.kind,
              from: nodeById.get(edge.fromId)?.name ?? edge.fromId,
              to: nodeById.get(edge.toId)?.name ?? edge.toId,
              fromId: edge.fromId,
              toId: edge.toId,
              ...(edge.description === undefined
                ? {}
                : { description: edge.description }),
              ...(edge.fromChapter === undefined
                ? {}
                : { fromChapter: edge.fromChapter }),
              ...(edge.toChapter === undefined
                ? {}
                : { toChapter: edge.toChapter }),
              ...(edge.evidenceChapter === undefined
                ? {}
                : { evidenceChapter: edge.evidenceChapter }),
              ...(edge.status === undefined ? {} : { status: edge.status }),
              ...(sanitizeGraphData(edge.data) === undefined
                ? {}
                : { data: sanitizeGraphData(edge.data) }),
            }))
        : [];

      return jsonResult({
        available: true,
        ...(query === undefined ? {} : { query }),
        chapterFrom,
        chapterTo,
        nodeCount: selected.length,
        edgeCount: edges.length,
        nodes: selected.map(formatGraphNode),
        edges,
      });
    },
  });

  const foreshadowUpdateTool = defineTool({
    name: "foreshadow_update",
    label: "更新伏笔",
    description:
      "埋设、推进、回收或放弃一个伏笔。正常正文中的伏笔变化会被自动提取；只有需要主动调整伏笔账本时才调用。",
    parameters: Type.Object({
      chapterNumber: Type.Integer({ description: "当前章节号。" }),
      title: Type.String({ description: "伏笔标题，必须稳定。" }),
      action: Type.Union([
        Type.Literal("setup"),
        Type.Literal("progress"),
        Type.Literal("payoff"),
        Type.Literal("abandon"),
      ]),
      note: Type.Optional(Type.String({ description: "本次变更说明。" })),
      setupChapter: Type.Optional(
        Type.Integer({ description: "设置章节；新建伏笔时使用。" }),
      ),
      payoffChapter: Type.Optional(
        Type.Integer({ description: "计划回收章节。" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "foreshadow_update");
      if (params.chapterNumber !== ctx.targetChapter.number) {
        throw new Error(
          `伏笔只能记录在当前章（第 ${ctx.targetChapter.number} 章），收到第 ${params.chapterNumber} 章。`,
        );
      }
      const record = ctx.foreshadows.upsert(ctx.project.id, {
        title: params.title,
        chapterNumber: params.chapterNumber,
        action: params.action,
        ...(params.note === undefined ? {} : { note: params.note }),
        ...(params.setupChapter === undefined
          ? {}
          : { setupChapter: params.setupChapter }),
        ...(params.payoffChapter === undefined
          ? {}
          : { payoffChapter: params.payoffChapter }),
      });
      ctx.state.foreshadows = ctx.foreshadows.toStoryState(
        ctx.project.id,
        ctx.targetChapter.number,
      );

      return jsonResult({
        title: record.title,
        status: record.status,
        setupChapter: record.setupChapter,
        plannedPayoffChapter: record.plannedPayoffChapter,
        resolvedChapter: record.resolvedChapter,
        note: record.note,
      });
    },
  });

  const chapterCommitTool = defineTool({
    name: "chapter_commit",
    label: "提交章节",
    description:
      "提交本章正文。第一次提交会覆盖草稿；字数不足时返回 needs_attention，可用 append=true 继续补写。正文只放在 text 参数里，不要放在普通回复里。",
    parameters: Type.Object({
      chapterNumber: Type.Integer({ description: "本章章节号。" }),
      text: Type.String({ description: "本章完整正文，纯文本。" }),
      append: Type.Optional(
        Type.Boolean({ description: "是否追加到已有草稿后面。" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      guard(ctx, "chapter_commit");
      if (params.chapterNumber !== ctx.targetChapter.number) {
        throw new Error(
          `本章只能提交第 ${ctx.targetChapter.number} 章，收到第 ${params.chapterNumber} 章。`,
        );
      }
      if (params.text.trim().length === 0) {
        throw new Error("chapter_commit.text 不能为空。");
      }

      const existing = ctx.draft?.text ?? "";
      const rawText =
        params.append === true && existing.length > 0
          ? `${existing.trimEnd()}\n\n${params.text.trimStart()}`
          : params.text;
      const targetWords = ctx.targetChapter.targetWords;
      const text = trimToWordLimit(rawText, Math.ceil(targetWords * 1.3));
      const wordCount = countWords(text);
      const status =
        wordCount < targetWords * 0.9 ? "needs_attention" : "drafted";
      ctx.draft = { text };

      const missingWords = Math.max(0, targetWords - wordCount);
      return jsonResult({
        chapterNumber: ctx.targetChapter.number,
        wordCount,
        targetWords,
        status,
        missingWords,
        message:
          status === "needs_attention"
            ? `字数不足，还差约 ${missingWords} 字。继续补写后用 append=true 再次提交。`
            : "正文已提交。",
      });
    },
  });

  return {
    tools: [
      runStatusTool,
      storyDigestTool,
      storyRecallTool,
      chapterReadTool,
      storyGraphTool,
      foreshadowUpdateTool,
      chapterCommitTool,
    ],
    getDraft: () => ctx.draft?.text,
  };
}
