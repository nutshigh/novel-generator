import type {
  BookGraph,
  GraphEventSummary,
  GraphRelationSummary,
  GraphSummary,
  GraphThreadSummary,
} from "./types.js";

export interface GraphEntityContext {
  name: string;
  kind: string;
  state?: Record<string, string>;
}

export interface GraphContextSections {
  relations: GraphRelationSummary[];
  events: GraphEventSummary[];
  threads: GraphThreadSummary[];
  entities: GraphEntityContext[];
}

function relationLine(relation: GraphRelationSummary): string {
  const from = relation.fromChapter !== undefined
    ? `第${relation.fromChapter}章起`
    : "起始章未知";
  const to = relation.toChapter !== undefined
    ? `至第${relation.toChapter}章`
    : "至今";
  const evidence = relation.evidenceChapter !== undefined
    ? `｜最近确认第${relation.evidenceChapter}章`
    : "";
  return `- ${relation.source} ↔ ${relation.target}｜${relation.kind}｜${from}${to}${evidence}｜${
    relation.description || "（无描述）"
  }`;
}

function entityLine(entity: GraphEntityContext): string {
  const values = Object.entries(entity.state ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("；");
  return `- ${entity.name}（${entity.kind}）${values ? `｜${values}` : ""}`;
}

function threadLine(thread: GraphThreadSummary): string {
  const range =
    thread.setupChapter !== undefined && thread.payoffChapter !== undefined
      ? `｜setup=${thread.setupChapter}｜payoff=${thread.payoffChapter}`
      : "";
  const note = thread.note ? `｜${thread.note}` : "";
  return `- ${thread.title}｜${thread.status}${range}${note}`;
}

export function formatGraphContext(sections: GraphContextSections): string {
  const blocks: string[] = [];

  const relations = sections.relations.filter(
    (relation) => relation.source && relation.target,
  );
  if (relations.length > 0) {
    blocks.push(
      ["【知识图谱·人物关系与历史】", ...relations.map(relationLine)].join(
        "\n",
      ),
    );
  }

  if (sections.entities.length > 0) {
    blocks.push(
      ["【知识图谱·角色状态】", ...sections.entities.map(entityLine)].join(
        "\n",
      ),
    );
  }

  if (sections.events.length > 0) {
    blocks.push(
      [
        "【知识图谱·相关前情】",
        ...sections.events.map(
          (event) => `- 第${event.chapter}章：${event.summary}`,
        ),
      ].join("\n"),
    );
  }

  if (sections.threads.length > 0) {
    blocks.push(
      ["【知识图谱·未回收线索】", ...sections.threads.map(threadLine)].join(
        "\n",
      ),
    );
  }

  return blocks.join("\n\n");
}

export function summaryFromBookGraph(graph: BookGraph): GraphSummary {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const relations = graph.edges
    .filter((edge) => edge.kind === "relation")
    .sort(
      (left, right) =>
        (right.evidenceChapter ?? 0) - (left.evidenceChapter ?? 0),
    )
    .slice(0, 40)
    .map((edge) => {
      const source = nodeById.get(edge.fromId)?.name ?? edge.fromId;
      const target = nodeById.get(edge.toId)?.name ?? edge.toId;
      return {
        source,
        target,
        kind: String(edge.data?.relationshipKind ?? "关系"),
        description: edge.description ?? "",
        ...(edge.fromChapter === undefined
          ? {}
          : { fromChapter: edge.fromChapter }),
        ...(edge.toChapter === undefined
          ? {}
          : { toChapter: edge.toChapter }),
        ...(edge.evidenceChapter === undefined
          ? {}
          : { evidenceChapter: edge.evidenceChapter }),
      };
    });

  const threads = graph.nodes
    .filter(
      (node) =>
        node.kind === "thread" &&
        node.status !== "resolved" &&
        node.status !== "abandoned",
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
    .slice(0, 30);

  const events = graph.nodes
    .filter((node) => node.kind === "event" && node.chapter !== undefined)
    .sort((left, right) => (right.chapter ?? 0) - (left.chapter ?? 0))
    .slice(0, 20)
    .map((node) => ({ summary: node.name, chapter: node.chapter! }));

  return {
    available: true,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    relations,
    threads,
    events,
  };
}
