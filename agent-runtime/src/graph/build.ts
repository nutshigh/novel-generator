import { createHash } from "node:crypto";
import type {
  Chapter,
  Outline,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";
import { flattenOutlineChapters } from "../story/library.js";
import type {
  BookGraph,
  BuildBookGraphInput,
  BuildChapterGraphInput,
  NovelEdge,
  NovelNode,
} from "./types.js";

const LOCATION_FIELD = /^(location|地点|位置|所在|当前位置)$/iu;

export function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

export function characterNodeId(name: string): string {
  return `character:${name}`;
}

export function chapterNodeId(number: number): string {
  return `chapter:${number}`;
}

export function threadNodeId(title: string): string {
  return `thread:${title}`;
}

export function eventNodeId(chapterNumber: number, summary: string): string {
  return `event:${chapterNumber}:${shortHash(summary)}`;
}

export function entityNodeId(name: string): string {
  return `entity:${name}`;
}

function uniqueNodes(nodes: NovelNode[]): NovelNode[] {
  const byId = new Map<string, NovelNode>();
  for (const node of nodes) {
    const existing = byId.get(node.id);
    if (!existing) {
      byId.set(node.id, { ...node });
      continue;
    }
    byId.set(node.id, {
      ...existing,
      ...node,
      data: { ...existing.data, ...node.data },
    });
  }
  return Array.from(byId.values());
}

function uniqueEdges(edges: NovelEdge[]): NovelEdge[] {
  const byId = new Map<string, NovelEdge>();
  for (const edge of edges) byId.set(edge.id, edge);
  return Array.from(byId.values());
}

function chapterTitle(project: BuildBookGraphInput["project"], outline: Outline): string {
  return outline.volumes[0]?.title.trim() || project.premise.trim() || project.id;
}

function locationFromState(
  state: StoryState | undefined,
): string | undefined {
  if (!state) return undefined;
  for (const entity of state.entities) {
    for (const [key, value] of Object.entries(entity.state)) {
      if (LOCATION_FIELD.test(key) && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function inferEntityKind(
  name: string,
  bible: StoryBible,
): NovelNode["kind"] {
  if (bible.characters.some((character) => character.name === name)) {
    return "character";
  }
  if (bible.items.includes(name)) return "item";
  if (bible.concepts.includes(name)) return "concept";
  if (bible.world.factions.includes(name)) return "faction";
  return "entity";
}

function relationSignature(kind: string, description: string): string {
  return `${kind}\u0000${description}`;
}

function buildRelationEdges(
  chapter: Chapter,
  bookId: string,
): NovelEdge[] {
  const edges: NovelEdge[] = [];
  const state = chapter.stateSnapshot;
  if (!state) return edges;

  for (const relation of state.relationships) {
    const signature = relationSignature(
      relation.kind,
      relation.description,
    );
    const pairKey = `${relation.source}\u0000${relation.target}`;
    edges.push({
      id: `relation:${relation.source}\u0000${relation.target}\u0000${chapter.number}\u0000${shortHash(
        signature,
      )}`,
      kind: "relation",
      fromId: characterNodeId(relation.source),
      toId: characterNodeId(relation.target),
      description: relation.description,
      fromChapter: chapter.number,
      evidenceChapter: chapter.number,
      status: "active",
      data: {
        bookId,
        pairKey,
        signature,
        relationshipKind: relation.kind,
      },
    });
  }

  return edges;
}

/**
 * Builds the nodes and edges contributed by one written chapter. Relation
 * edges are emitted as new active edges; temporal closing is handled by the
 * full book builder and by the incremental Neo4j indexer.
 */
export function buildChapterGraph(input: BuildChapterGraphInput): {
  nodes: NovelNode[];
  edges: NovelEdge[];
} {
  const { bookId, bible, chapter } = input;
  const state = chapter.stateSnapshot;
  const nodes: NovelNode[] = [];
  const edges: NovelEdge[] = [];
  const chapterId = chapterNodeId(chapter.number);
  const chapterStatus = chapter.status;

  nodes.push({
    id: chapterId,
    kind: "chapter",
    name: chapter.title,
    chapter: chapter.number,
    status: chapterStatus,
    data: {
      summary: chapter.outline.summary,
      pov: chapter.outline.pov,
      cast: chapter.outline.cast,
      targetWords: chapter.outline.targetWords,
      wordCount: chapter.wordCount,
      reviewGate: chapter.review?.gate,
    },
  });

  for (const name of chapter.outline.cast) {
    const character = bible.characters.find((entry) => entry.name === name);
    if (!character) continue;
    nodes.push({
      id: characterNodeId(name),
      kind: "character",
      name,
      data: {
        role: character.role,
        goal: character.goal,
        motivation: character.motivation,
        wound: character.wound,
        arc: character.arc,
        voice: character.voice,
        secrets: character.secrets,
        relationships: character.relationships,
      },
    });
    edges.push({
      id: `appears_in:${chapter.number}:${name}`,
      kind: "appears_in",
      fromId: characterNodeId(name),
      toId: chapterId,
      fromChapter: chapter.number,
      evidenceChapter: chapter.number,
      data: { bookId },
    });
  }

  if (state) {
    for (const entity of state.entities) {
      const kind = inferEntityKind(entity.entityName, bible);
      const id =
        kind === "character"
          ? characterNodeId(entity.entityName)
          : kind === "item" || kind === "concept" || kind === "faction"
            ? `${kind}:${entity.entityName}`
            : entityNodeId(entity.entityName);
      nodes.push({
        id,
        kind,
        name: entity.entityName,
        status: "current",
        data: {
          state: entity.state,
          updatedAtChapter: entity.updatedAtChapter,
        },
      });
    }

    const location = locationFromState(state);
    if (location) {
      const locationId = `location:${location}`;
      nodes.push({
        id: locationId,
        kind: "location",
        name: location,
        data: { firstSeenChapter: chapter.number },
      });
      for (const entity of state.entities) {
        const entityLocation = Object.entries(entity.state).find(
          ([key, value]) => LOCATION_FIELD.test(key) && value.trim(),
        )?.[1];
        if (entityLocation?.trim() !== location) continue;
        const kind = inferEntityKind(entity.entityName, bible);
        const fromId =
          kind === "character"
            ? characterNodeId(entity.entityName)
            : kind === "item" || kind === "concept" || kind === "faction"
              ? `${kind}:${entity.entityName}`
              : entityNodeId(entity.entityName);
        edges.push({
          id: `located_at:${entity.entityName}:${location}:${chapter.number}`,
          kind: "located_at",
          fromId,
          toId: locationId,
          evidenceChapter: chapter.number,
          data: { bookId },
        });
      }
    }

    for (const event of state.events) {
      if (event.chapterNumber !== chapter.number) continue;
      const id = eventNodeId(chapter.number, event.summary);
      nodes.push({
        id,
        kind: "event",
        name: event.summary,
        chapter: chapter.number,
        status: "happened",
        data: {
          summary: event.summary,
          participants: chapter.outline.cast,
          location,
        },
      });
      edges.push({
        id: `event_in_chapter:${id}`,
        kind: "event_in_chapter",
        fromId: id,
        toId: chapterId,
        evidenceChapter: chapter.number,
        data: { bookId },
      });
      for (const name of chapter.outline.cast) {
        edges.push({
          id: `event_involves:${id}:${name}`,
          kind: "event_involves",
          fromId: id,
          toId: characterNodeId(name),
          evidenceChapter: chapter.number,
          data: { bookId },
        });
      }
      if (location) {
        edges.push({
          id: `event_location:${id}:${location}`,
          kind: "event_location",
          fromId: id,
          toId: `location:${location}`,
          evidenceChapter: chapter.number,
          data: { bookId },
        });
      }
    }

    for (const foreshadow of state.foreshadows) {
      const id = threadNodeId(foreshadow.title);
      const ledger = bible.foreshadowLedger.find(
        (entry) => entry.title === foreshadow.title,
      );
      nodes.push({
        id,
        kind: "thread",
        name: foreshadow.title,
        status: foreshadow.status,
        data: {
          note: foreshadow.note,
          lastAdvancedChapter: chapter.number,
          ...(ledger
            ? {
                setupChapter: ledger.setupChapter,
                payoffChapter: ledger.payoffChapter,
              }
            : {}),
        },
      });
      edges.push({
        id: `thread_advanced_in:${foreshadow.title}:${chapter.number}:${foreshadow.status}`,
        kind: "thread_advanced_in",
        fromId: id,
        toId: chapterId,
        evidenceChapter: chapter.number,
        description: foreshadow.note,
        status: foreshadow.status,
        data: { bookId },
      });
    }
  }

  edges.push(...buildRelationEdges(chapter, bookId));

  return { nodes, edges };
}

export function buildBookGraph(input: BuildBookGraphInput): BookGraph {
  const { project, bible, outline, chapters } = input;
  const bookId = project.id;
  const nodes: NovelNode[] = [];
  const edges: NovelEdge[] = [];
  const bookNodeId = `book:${bookId}`;
  const orderedChapters = [...chapters].sort(
    (left, right) => left.number - right.number,
  );
  const writtenNumbers = new Set(orderedChapters.map((chapter) => chapter.number));

  nodes.push({
    id: bookNodeId,
    kind: "book",
    name: chapterTitle(project, outline),
    status: project.status,
    data: {
      premise: project.premise,
      language: project.language,
      plannedChapters: flattenOutlineChapters(outline).length,
      writtenChapters: writtenNumbers.size,
      wordCount: orderedChapters.reduce(
        (sum, chapter) => sum + chapter.wordCount,
        0,
      ),
    },
  });

  for (const character of bible.characters) {
    nodes.push({
      id: characterNodeId(character.name),
      kind: "character",
      name: character.name,
      data: {
        role: character.role,
        goal: character.goal,
        motivation: character.motivation,
        wound: character.wound,
        arc: character.arc,
        voice: character.voice,
        secrets: character.secrets,
        relationships: character.relationships,
      },
    });
  }

  for (const faction of bible.world.factions) {
    nodes.push({
      id: `faction:${faction}`,
      kind: "faction",
      name: faction,
      data: {},
    });
  }

  for (const item of bible.items) {
    nodes.push({ id: `item:${item}`, kind: "item", name: item, data: {} });
  }

  for (const concept of bible.concepts) {
    nodes.push({
      id: `concept:${concept}`,
      kind: "concept",
      name: concept,
      data: {},
    });
  }

  for (const character of bible.characters) {
    for (const description of character.relationships) {
      for (const faction of bible.world.factions) {
        if (!description.includes(faction)) continue;
        edges.push({
          id: `member_of:${character.name}:${faction}`,
          kind: "member_of",
          fromId: characterNodeId(character.name),
          toId: `faction:${faction}`,
          description,
          evidenceChapter: 0,
          data: { bookId },
        });
      }
    }
  }

  for (const entry of bible.foreshadowLedger) {
    const id = threadNodeId(entry.title);
    nodes.push({
      id,
      kind: "thread",
      name: entry.title,
      status: entry.status,
      data: {
        setupChapter: entry.setupChapter,
        payoffChapter: entry.payoffChapter,
        note: entry.status,
      },
    });
    edges.push({
      id: `thread_setup_in:${entry.title}`,
      kind: "thread_setup_in",
      fromId: id,
      toId: chapterNodeId(entry.setupChapter),
      fromChapter: entry.setupChapter,
      evidenceChapter: entry.setupChapter,
      data: { bookId },
    });
    edges.push({
      id: `thread_payoff_in:${entry.title}`,
      kind: "thread_payoff_in",
      fromId: id,
      toId: chapterNodeId(entry.payoffChapter),
      fromChapter: entry.payoffChapter,
      evidenceChapter: entry.payoffChapter,
      data: { bookId },
    });
  }

  const outlineChapters = flattenOutlineChapters(outline);
  for (const outlineChapter of outlineChapters) {
    const written = orderedChapters.find(
      (chapter) => chapter.number === outlineChapter.number,
    );
    nodes.push({
      id: chapterNodeId(outlineChapter.number),
      kind: "chapter",
      name: written?.title || outlineChapter.title,
      chapter: outlineChapter.number,
      status: written?.status || "missing",
      data: {
        summary: outlineChapter.summary,
        pov: outlineChapter.pov,
        cast: outlineChapter.cast,
        targetWords: outlineChapter.targetWords,
        wordCount: written?.wordCount ?? 0,
        reviewGate: written?.review?.gate,
      },
    });
    for (const name of outlineChapter.cast) {
      if (!bible.characters.some((character) => character.name === name)) continue;
      edges.push({
        id: `appears_in:${outlineChapter.number}:${name}`,
        kind: "appears_in",
        fromId: characterNodeId(name),
        toId: chapterNodeId(outlineChapter.number),
        fromChapter: outlineChapter.number,
        evidenceChapter: written ? outlineChapter.number : undefined,
        data: { bookId, planned: !written },
      });
    }
    const next = outlineChapters.find(
      (chapter) => chapter.number === outlineChapter.number + 1,
    );
    if (next) {
      edges.push({
        id: `chapter_follows:${outlineChapter.number}`,
        kind: "chapter_follows",
        fromId: chapterNodeId(outlineChapter.number),
        toId: chapterNodeId(next.number),
        data: { bookId },
      });
    }
  }

  const relationEdgesByPair = new Map<string, NovelEdge>();
  const closedRelations: NovelEdge[] = [];
  const allChapterNodes: NovelNode[] = [];
  const allChapterEdges: NovelEdge[] = [];

  for (const chapter of orderedChapters) {
    const delta = buildChapterGraph({
      bookId,
      bible,
      chapter,
    });
    allChapterNodes.push(...delta.nodes);
    allChapterEdges.push(...delta.edges);
  }

  for (const edge of allChapterEdges) {
    if (edge.kind !== "relation") continue;
    const pairKey = String(edge.data?.pairKey ?? "");
    const signature = String(edge.data?.signature ?? "");
    const current = relationEdgesByPair.get(pairKey);
    if (!current) {
      relationEdgesByPair.set(pairKey, { ...edge });
      continue;
    }
    const currentSignature = String(current.data?.signature ?? "");
    if (currentSignature === signature) {
      current.evidenceChapter = edge.evidenceChapter;
      current.data = {
        ...current.data,
        lastSeenChapter: edge.evidenceChapter,
      };
      continue;
    }
    current.toChapter = (edge.fromChapter ?? 1) - 1;
    current.status = "ended";
    closedRelations.push({ ...current });
    relationEdgesByPair.set(pairKey, { ...edge });
  }

  const relations = [
    ...closedRelations,
    ...Array.from(relationEdgesByPair.values()),
  ];
  const nonRelationEdges = allChapterEdges.filter(
    (edge) => edge.kind !== "relation",
  );

  return {
    bookId,
    nodes: uniqueNodes([...nodes, ...allChapterNodes]),
    edges: uniqueEdges([...edges, ...nonRelationEdges, ...relations]),
  };
}
