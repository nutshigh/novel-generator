import type { Chapter, StoryBible } from "../domain/schemas.js";
import { buildChapterGraph } from "./build.js";
import { formatGraphContext, summaryFromBookGraph } from "./format.js";
import type {
  BookGraph,
  ChapterContextInput,
  GraphSummary,
  NovelEdge,
  NovelGraphStore,
  NovelNode,
} from "./types.js";
import { EMPTY_GRAPH_SUMMARY } from "./types.js";

export class MemoryNovelGraph implements NovelGraphStore {
  readonly name = "memory";
  private readonly books = new Map<string, BookGraph>();

  async rebuildBook(graph: BookGraph): Promise<void> {
    this.books.set(graph.bookId, {
      bookId: graph.bookId,
      nodes: graph.nodes.map((node) => ({ ...node })),
      edges: graph.edges.map((edge) => ({ ...edge })),
    });
  }

  async indexChapter(
    bookId: string,
    bible: StoryBible,
    chapter: Chapter,
  ): Promise<void> {
    const graph = this.books.get(bookId) ?? {
      bookId,
      nodes: [],
      edges: [],
    };
    const delta = buildChapterGraph({ bookId, bible, chapter });

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of delta.nodes) {
      const existing = nodeById.get(node.id);
      nodeById.set(node.id, {
        ...existing,
        ...node,
        data: { ...existing?.data, ...node.data },
      });
    }

    const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
    for (const edge of delta.edges) {
      if (edge.kind !== "relation") {
        edgeById.set(edge.id, edge);
        continue;
      }
      const pairKey = String(edge.data?.pairKey ?? "");
      const signature = String(edge.data?.signature ?? "");
      const previous = Array.from(edgeById.values()).find(
        (candidate) =>
          candidate.kind === "relation" &&
          candidate.toChapter === undefined &&
          String(candidate.data?.pairKey ?? "") === pairKey,
      );
      if (!previous) {
        edgeById.set(edge.id, edge);
        continue;
      }
      if (String(previous.data?.signature ?? "") === signature) {
        edgeById.set(previous.id, {
          ...previous,
          evidenceChapter: edge.evidenceChapter,
          data: {
            ...previous.data,
            lastSeenChapter: edge.evidenceChapter,
          },
        });
        continue;
      }
      edgeById.set(previous.id, {
        ...previous,
        toChapter: (edge.fromChapter ?? 1) - 1,
        status: "ended",
      });
      edgeById.set(edge.id, edge);
    }

    this.books.set(bookId, {
      bookId,
      nodes: Array.from(nodeById.values()),
      edges: Array.from(edgeById.values()),
    });
  }

  async buildChapterContext(input: ChapterContextInput): Promise<string> {
    const graph = this.books.get(input.bookId);
    if (!graph) return "";

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const cast = new Set(input.cast);
    const relationEdges = graph.edges
      .filter((edge) => edge.kind === "relation")
      .sort(
        (left, right) =>
          (right.evidenceChapter ?? 0) - (left.evidenceChapter ?? 0),
      );
    const relations = relationEdges
      .filter((edge) => (edge.fromChapter ?? 0) < input.chapterNumber)
      .filter((edge) => {
        const source = nodeById.get(edge.fromId)?.name;
        const target = nodeById.get(edge.toId)?.name;
        return Boolean(
          (source && cast.has(source)) || (target && cast.has(target)),
        );
      })
      .slice(0, 30)
      .map((edge) => ({
        source: nodeById.get(edge.fromId)?.name ?? edge.fromId,
        target: nodeById.get(edge.toId)?.name ?? edge.toId,
        kind: String(edge.data?.relationshipKind ?? "关系"),
        description: edge.description ?? "",
        ...(edge.fromChapter === undefined
          ? {}
          : { fromChapter: edge.fromChapter }),
        ...(edge.toChapter === undefined ? {} : { toChapter: edge.toChapter }),
        ...(edge.evidenceChapter === undefined
          ? {}
          : { evidenceChapter: edge.evidenceChapter }),
      }));

    const involvedEventIds = new Set(
      graph.edges
        .filter((edge) => edge.kind === "event_involves")
        .filter((edge) => {
          const name = nodeById.get(edge.toId)?.name;
          return name !== undefined && cast.has(name);
        })
        .map((edge) => edge.fromId),
    );
    const events = graph.nodes
      .filter(
        (node) =>
          node.kind === "event" &&
          node.chapter !== undefined &&
          node.chapter < input.chapterNumber &&
          involvedEventIds.has(node.id),
      )
      .sort((left, right) => (right.chapter ?? 0) - (left.chapter ?? 0))
      .slice(0, 10)
      .map((node) => ({ summary: node.name, chapter: node.chapter! }));

    const threads = graph.nodes
      .filter(
        (node) =>
          node.kind === "thread" &&
          node.status !== "resolved" &&
          node.status !== "abandoned" &&
          (typeof node.data?.lastAdvancedChapter !== "number" ||
            node.data.lastAdvancedChapter < input.chapterNumber),
      )
      .map((node) => {
        const setupChapter =
          typeof node.data?.setupChapter === "number"
            ? node.data.setupChapter
            : undefined;
        const payoffChapter =
          typeof node.data?.payoffChapter === "number"
            ? node.data.payoffChapter
            : undefined;
        return {
          title: node.name,
          status: node.status ?? "planned",
          ...(setupChapter === undefined ? {} : { setupChapter }),
          ...(payoffChapter === undefined ? {} : { payoffChapter }),
          ...(node.data?.note === undefined
            ? {}
            : { note: String(node.data.note) }),
        };
      })
      .sort(
        (left, right) =>
          (left.payoffChapter ?? Number.MAX_SAFE_INTEGER) -
          (right.payoffChapter ?? Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 15);

    return formatGraphContext({ relations, events, threads, entities: [] });
  }

  async getSummary(bookId: string): Promise<GraphSummary> {
    const graph = this.books.get(bookId);
    if (!graph) {
      return { ...EMPTY_GRAPH_SUMMARY, reason: "book not indexed" };
    }
    return summaryFromBookGraph(graph);
  }

  async getGraph(bookId: string): Promise<BookGraph | undefined> {
    const graph = this.books.get(bookId);
    if (!graph) return undefined;
    return {
      bookId: graph.bookId,
      nodes: graph.nodes.map((node) => ({ ...node })),
      edges: graph.edges.map((edge) => ({ ...edge })),
    };
  }

  async close(): Promise<void> {
    this.books.clear();
  }
}

export function mergeGraphNodes(nodes: NovelNode[]): NovelNode[] {
  const byId = new Map<string, NovelNode>();
  for (const node of nodes) {
    const existing = byId.get(node.id);
    byId.set(node.id, {
      ...existing,
      ...node,
      data: { ...existing?.data, ...node.data },
    });
  }
  return Array.from(byId.values());
}

export function mergeGraphEdges(edges: NovelEdge[]): NovelEdge[] {
  const byId = new Map<string, NovelEdge>();
  for (const edge of edges) byId.set(edge.id, edge);
  return Array.from(byId.values());
}
