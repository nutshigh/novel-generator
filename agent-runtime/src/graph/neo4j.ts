import {
  auth,
  driver,
  int,
  isInt,
  type Driver,
  type Integer,
  type Record as Neo4jRecord,
} from "neo4j-driver";
import type { Chapter, StoryBible } from "../domain/schemas.js";
import { buildChapterGraph } from "./build.js";
import { formatGraphContext } from "./format.js";
import type { Neo4jConfig } from "./config.js";
import type {
  BookGraph,
  ChapterContextInput,
  GraphEventSummary,
  GraphRelationSummary,
  GraphSummary,
  NovelEdge,
  NovelGraphStore,
  NovelNode,
} from "./types.js";

const NODE_LABEL = "NovelNode";
const EDGE_TYPE = "NOVEL_REL";
const BATCH_SIZE = 200;

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function toIntegerOrNull(value: number | undefined): Integer | null {
  return value === undefined ? null : int(Math.trunc(value));
}

function asNumber(value: unknown): number | undefined {
  if (isInt(value)) return (value as Integer).toNumber();
  if (typeof value === "number") return value;
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseData(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nodeRow(node: NovelNode): Record<string, unknown> {
  const data = node.data ?? {};
  const setupChapter =
    typeof data.setupChapter === "number" ? data.setupChapter : undefined;
  const payoffChapter =
    typeof data.payoffChapter === "number" ? data.payoffChapter : undefined;
  const lastChapter =
    typeof data.lastAdvancedChapter === "number"
      ? data.lastAdvancedChapter
      : typeof data.updatedAtChapter === "number"
        ? data.updatedAtChapter
        : undefined;
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    chapter: toIntegerOrNull(node.chapter),
    lastChapter: toIntegerOrNull(lastChapter),
    status: node.status ?? null,
    setupChapter: toIntegerOrNull(setupChapter),
    payoffChapter: toIntegerOrNull(payoffChapter),
    dataJson: JSON.stringify(data),
  };
}

function edgeRow(edge: NovelEdge): Record<string, unknown> {
  return {
    id: edge.id,
    kind: edge.kind,
    fromId: edge.fromId,
    toId: edge.toId,
    description: edge.description ?? null,
    fromChapter: toIntegerOrNull(edge.fromChapter),
    toChapter: toIntegerOrNull(edge.toChapter),
    evidenceChapter: toIntegerOrNull(edge.evidenceChapter),
    status: edge.status ?? null,
    pairKey:
      typeof edge.data?.pairKey === "string" ? edge.data.pairKey : null,
    signature:
      typeof edge.data?.signature === "string" ? edge.data.signature : null,
    dataJson: JSON.stringify(edge.data ?? {}),
  };
}

export class Neo4jNovelGraph implements NovelGraphStore {
  readonly name: string;
  private readonly driver: Driver;
  private readonly ready: Promise<void>;

  constructor(config: Neo4jConfig) {
    this.name = `neo4j:${config.uri}`;
    this.driver = driver(
      config.uri,
      auth.basic(config.user, config.password),
      {
        connectionTimeout: 5_000,
        maxConnectionPoolSize: 10,
        maxTransactionRetryTime: 10_000,
      },
    );
    this.ready = this.initialize();
    this.ready.catch(() => undefined);
  }

  private async initialize(): Promise<void> {
    await this.driver.verifyConnectivity();
    const session = this.driver.session();
    try {
      await session.run(
        `CREATE CONSTRAINT novel_node_unique IF NOT EXISTS
         FOR (n:${NODE_LABEL}) REQUIRE (n.bookId, n.id) IS UNIQUE`,
      );
      await session.run(
        `CREATE INDEX novel_rel_book IF NOT EXISTS
         FOR ()-[r:${EDGE_TYPE}]-() ON (r.bookId)`,
      );
    } finally {
      await session.close();
    }
  }

  private async session<T>(
    work: (session: ReturnType<Driver["session"]>) => Promise<T>,
  ): Promise<T> {
    await this.ready;
    const session = this.driver.session();
    try {
      return await work(session);
    } finally {
      await session.close();
    }
  }

  async rebuildBook(graph: BookGraph): Promise<void> {
    await this.session(async (session) => {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `MATCH (n:${NODE_LABEL} {bookId: $bookId}) DETACH DELETE n`,
          { bookId: graph.bookId },
        );

        for (const rows of chunk(graph.nodes.map(nodeRow), BATCH_SIZE)) {
          await tx.run(
            `UNWIND $rows AS row
             MERGE (n:${NODE_LABEL} {bookId: $bookId, id: row.id})
             SET n.kind = row.kind,
                 n.name = row.name,
                 n.chapter = row.chapter,
                 n.lastChapter = row.lastChapter,
                 n.status = row.status,
                 n.setupChapter = row.setupChapter,
                 n.payoffChapter = row.payoffChapter,
                 n.dataJson = row.dataJson,
                 n.updatedAt = datetime()`,
            { bookId: graph.bookId, rows },
          );
        }

        for (const rows of chunk(graph.edges.map(edgeRow), BATCH_SIZE)) {
          await tx.run(
            `UNWIND $rows AS row
             MATCH (a:${NODE_LABEL} {bookId: $bookId, id: row.fromId})
             MATCH (b:${NODE_LABEL} {bookId: $bookId, id: row.toId})
             MERGE (a)-[r:${EDGE_TYPE} {bookId: $bookId, id: row.id}]->(b)
             SET r.kind = row.kind,
                 r.description = row.description,
                 r.fromChapter = row.fromChapter,
                 r.toChapter = row.toChapter,
                 r.evidenceChapter = row.evidenceChapter,
                 r.status = row.status,
                 r.pairKey = row.pairKey,
                 r.signature = row.signature,
                 r.dataJson = row.dataJson`,
            { bookId: graph.bookId, rows },
          );
        }
      });
    });
  }

  async indexChapter(
    bookId: string,
    bible: StoryBible,
    chapter: Chapter,
  ): Promise<void> {
    const delta = buildChapterGraph({ bookId, bible, chapter });

    await this.session(async (session) => {
      await session.executeWrite(async (tx) => {
        for (const rows of chunk(delta.nodes.map(nodeRow), BATCH_SIZE)) {
          await tx.run(
            `UNWIND $rows AS row
             MERGE (n:${NODE_LABEL} {bookId: $bookId, id: row.id})
             SET n.kind = row.kind,
                 n.name = row.name,
                 n.chapter = row.chapter,
                 n.lastChapter = row.lastChapter,
                 n.status = row.status,
                 n.setupChapter = row.setupChapter,
                 n.payoffChapter = row.payoffChapter,
                 n.dataJson = row.dataJson,
                 n.updatedAt = datetime()`,
            { bookId, rows },
          );
        }

        const nonRelation = delta.edges.filter(
          (edge) => edge.kind !== "relation",
        );
        for (const rows of chunk(nonRelation.map(edgeRow), BATCH_SIZE)) {
          await tx.run(
            `UNWIND $rows AS row
             MATCH (a:${NODE_LABEL} {bookId: $bookId, id: row.fromId})
             MATCH (b:${NODE_LABEL} {bookId: $bookId, id: row.toId})
             MERGE (a)-[r:${EDGE_TYPE} {bookId: $bookId, id: row.id}]->(b)
             SET r.kind = row.kind,
                 r.description = row.description,
                 r.fromChapter = row.fromChapter,
                 r.toChapter = row.toChapter,
                 r.evidenceChapter = row.evidenceChapter,
                 r.status = row.status,
                 r.dataJson = row.dataJson`,
            { bookId, rows },
          );
        }

        for (const edge of delta.edges.filter(
          (candidate) => candidate.kind === "relation",
        )) {
          const row = edgeRow(edge);
          const pairKey = String(row.pairKey ?? "");
          const signature = String(row.signature ?? "");
          const previousResult = await tx.run(
            `MATCH (a:${NODE_LABEL} {bookId: $bookId, id: $fromId})
                   -[r:${EDGE_TYPE} {bookId: $bookId, kind: 'relation'}]->
                   (b:${NODE_LABEL} {bookId: $bookId, id: $toId})
             WHERE r.pairKey = $pairKey AND r.toChapter IS NULL
             RETURN r.id AS id, r.signature AS signature
             LIMIT 1`,
            {
              bookId,
              fromId: edge.fromId,
              toId: edge.toId,
              pairKey,
            },
          );
          const previous = previousResult.records[0];

          if (previous) {
            const previousId = asString(previous.get("id"));
            const previousSignature = asString(previous.get("signature"));
            if (previousSignature === signature && previousId) {
              await tx.run(
                `MATCH ()-[r:${EDGE_TYPE} {bookId: $bookId, id: $id}]->
                       ()
                 SET r.evidenceChapter = $evidenceChapter,
                     r.dataJson = $dataJson`,
                {
                  bookId,
                  id: previousId,
                  evidenceChapter: toIntegerOrNull(edge.evidenceChapter),
                  dataJson: row.dataJson,
                },
              );
              continue;
            }
            if (previousId) {
              await tx.run(
                `MATCH ()-[r:${EDGE_TYPE} {bookId: $bookId, id: $id}]->
                       ()
                 SET r.toChapter = $toChapter, r.status = 'ended'`,
                {
                  bookId,
                  id: previousId,
                  toChapter: int(Math.max(0, chapter.number - 1)),
                },
              );
            }
          }

          await tx.run(
            `MATCH (a:${NODE_LABEL} {bookId: $bookId, id: $fromId})
             MATCH (b:${NODE_LABEL} {bookId: $bookId, id: $toId})
             MERGE (a)-[r:${EDGE_TYPE} {bookId: $bookId, id: $id}]->(b)
             SET r.kind = $kind,
                 r.description = $description,
                 r.fromChapter = $fromChapter,
                 r.toChapter = $toChapter,
                 r.evidenceChapter = $evidenceChapter,
                 r.status = $status,
                 r.pairKey = $pairKey,
                 r.signature = $signature,
                 r.dataJson = $dataJson`,
            {
              bookId,
              id: edge.id,
              fromId: edge.fromId,
              toId: edge.toId,
              kind: edge.kind,
              description: edge.description ?? null,
              fromChapter: toIntegerOrNull(edge.fromChapter),
              toChapter: null,
              evidenceChapter: toIntegerOrNull(edge.evidenceChapter),
              status: edge.status ?? "active",
              pairKey,
              signature,
              dataJson: row.dataJson,
            },
          );
        }
      });
    });
  }

  async buildChapterContext(input: ChapterContextInput): Promise<string> {
    if (input.cast.length === 0) return "";

    return this.session(async (session) => {
      const relationsResult = await session.run(
        `MATCH (a:${NODE_LABEL} {bookId: $bookId})
               -[r:${EDGE_TYPE} {bookId: $bookId, kind: 'relation'}]->
               (b:${NODE_LABEL} {bookId: $bookId})
         WHERE (a.name IN $cast OR b.name IN $cast)
           AND coalesce(r.fromChapter, 0) < $chapter
         RETURN a.name AS source, b.name AS target, r.description AS description,
                r.fromChapter AS fromChapter, r.toChapter AS toChapter,
                r.evidenceChapter AS evidenceChapter, r.dataJson AS dataJson
         ORDER BY r.evidenceChapter DESC
         LIMIT 40`,
        {
          bookId: input.bookId,
          cast: input.cast,
          chapter: int(input.chapterNumber),
        },
      );

      const eventsResult = await session.run(
        `MATCH (e:${NODE_LABEL} {bookId: $bookId, kind: 'event'})
               -[:${EDGE_TYPE} {bookId: $bookId, kind: 'event_involves'}]->
               (c:${NODE_LABEL} {bookId: $bookId})
         WHERE c.name IN $cast
         MATCH (e)-[:${EDGE_TYPE} {bookId: $bookId, kind: 'event_in_chapter'}]->
               (ch:${NODE_LABEL} {bookId: $bookId})
         WHERE ch.chapter < $chapter
         RETURN DISTINCT e.name AS summary, ch.chapter AS chapter
         ORDER BY chapter DESC
         LIMIT 10`,
        {
          bookId: input.bookId,
          cast: input.cast,
          chapter: int(input.chapterNumber),
        },
      );

      const threadsResult = await session.run(
        `MATCH (t:${NODE_LABEL} {bookId: $bookId, kind: 'thread'})
         WHERE t.status IN ['planned', 'open', 'progressed']
           AND (t.lastChapter IS NULL OR t.lastChapter < $chapter)
         RETURN t.name AS title, t.status AS status,
                t.setupChapter AS setupChapter, t.payoffChapter AS payoffChapter,
                t.dataJson AS dataJson
         ORDER BY coalesce(t.payoffChapter, 9999) ASC
         LIMIT 15`,
        { bookId: input.bookId, chapter: int(input.chapterNumber) },
      );

      const relations: GraphRelationSummary[] = relationsResult.records.map(
        (record) => ({
          source: asString(record.get("source")) ?? "",
          target: asString(record.get("target")) ?? "",
          kind:
            asString(parseData(record.get("dataJson")).relationshipKind) ??
            "鍏崇郴",
          description: asString(record.get("description")) ?? "",
          ...(asNumber(record.get("fromChapter")) === undefined
            ? {}
            : { fromChapter: asNumber(record.get("fromChapter")) }),
          ...(asNumber(record.get("toChapter")) === undefined
            ? {}
            : { toChapter: asNumber(record.get("toChapter")) }),
          ...(asNumber(record.get("evidenceChapter")) === undefined
            ? {}
            : { evidenceChapter: asNumber(record.get("evidenceChapter")) }),
        }),
      );

      const events: GraphEventSummary[] = eventsResult.records
        .map((record) => ({
          summary: asString(record.get("summary")) ?? "",
          chapter: asNumber(record.get("chapter")) ?? 0,
        }))
        .filter((event) => event.chapter > 0);

      const threads = threadsResult.records.map((record) => {
        const data = parseData(record.get("dataJson"));
        const setupChapter = asNumber(record.get("setupChapter"));
        const payoffChapter = asNumber(record.get("payoffChapter"));
        return {
          title: asString(record.get("title")) ?? "",
          status: asString(record.get("status")) ?? "planned",
          ...(setupChapter === undefined ? {} : { setupChapter }),
          ...(payoffChapter === undefined ? {} : { payoffChapter }),
          ...(typeof data.note === "string" ? { note: data.note } : {}),
        };
      });

      return formatGraphContext({
        relations,
        events,
        threads,
        entities: [],
      });
    });
  }

  async getGraph(bookId: string): Promise<BookGraph | undefined> {
    return this.session(async (session) => {
      const nodesResult = await session.run(
        `MATCH (n:${NODE_LABEL} {bookId: $bookId})
         RETURN n.id AS id, n.kind AS kind, n.name AS name, n.chapter AS chapter,
                n.status AS status, n.dataJson AS dataJson
         ORDER BY n.kind, n.name`,
        { bookId },
      );
      const edgesResult = await session.run(
        `MATCH (a:${NODE_LABEL} {bookId: $bookId})
               -[r:${EDGE_TYPE} {bookId: $bookId}]->
               (b:${NODE_LABEL} {bookId: $bookId})
         RETURN r.id AS id, r.kind AS kind, a.id AS fromId, b.id AS toId,
                r.description AS description, r.fromChapter AS fromChapter,
                r.toChapter AS toChapter, r.evidenceChapter AS evidenceChapter,
                r.status AS status, r.dataJson AS dataJson
         ORDER BY r.kind, r.id`,
        { bookId },
      );

      const nodes: NovelNode[] = [];
      for (const record of nodesResult.records) {
        const id = asString(record.get("id"));
        const kind = asString(record.get("kind"));
        const name = asString(record.get("name"));
        if (!id || !kind || name === undefined) continue;
        const chapter = asNumber(record.get("chapter"));
        const status = asString(record.get("status"));
        nodes.push({
          id,
          kind: kind as NovelNode["kind"],
          name,
          ...(chapter === undefined ? {} : { chapter }),
          ...(status === undefined ? {} : { status }),
          data: parseData(record.get("dataJson")),
        });
      }

      const edges: NovelEdge[] = [];
      for (const record of edgesResult.records) {
        const id = asString(record.get("id"));
        const kind = asString(record.get("kind"));
        const fromId = asString(record.get("fromId"));
        const toId = asString(record.get("toId"));
        if (!id || !kind || !fromId || !toId) continue;
        const description = asString(record.get("description"));
        const fromChapter = asNumber(record.get("fromChapter"));
        const toChapter = asNumber(record.get("toChapter"));
        const evidenceChapter = asNumber(record.get("evidenceChapter"));
        const status = asString(record.get("status"));
        edges.push({
          id,
          kind: kind as NovelEdge["kind"],
          fromId,
          toId,
          ...(description === undefined ? {} : { description }),
          ...(fromChapter === undefined ? {} : { fromChapter }),
          ...(toChapter === undefined ? {} : { toChapter }),
          ...(evidenceChapter === undefined ? {} : { evidenceChapter }),
          ...(status === undefined ? {} : { status }),
          data: parseData(record.get("dataJson")),
        });
      }

      if (nodes.length === 0) return undefined;
      return { bookId, nodes, edges };
    });
  }

  async getSummary(bookId: string): Promise<GraphSummary> {
    return this.session(async (session) => {
      const countResult = await session.run(
        `MATCH (n:${NODE_LABEL} {bookId: $bookId})
         WITH count(n) AS nodeCount
         OPTIONAL MATCH (a:${NODE_LABEL} {bookId: $bookId})
                       -[r:${EDGE_TYPE} {bookId: $bookId}]->
                       (b:${NODE_LABEL} {bookId: $bookId})
         RETURN nodeCount, count(r) AS edgeCount`,
        { bookId },
      );
      const countRecord = countResult.records[0];
      const nodeCount = asNumber(countRecord?.get("nodeCount")) ?? 0;
      const edgeCount = asNumber(countRecord?.get("edgeCount")) ?? 0;

      const relationsResult = await session.run(
        `MATCH (a:${NODE_LABEL} {bookId: $bookId})
               -[r:${EDGE_TYPE} {bookId: $bookId, kind: 'relation'}]->
               (b:${NODE_LABEL} {bookId: $bookId})
         RETURN a.name AS source, b.name AS target, r.description AS description,
                r.fromChapter AS fromChapter, r.toChapter AS toChapter,
                r.evidenceChapter AS evidenceChapter, r.dataJson AS dataJson
         ORDER BY r.evidenceChapter DESC
         LIMIT 40`,
        { bookId },
      );

      const threadsResult = await session.run(
        `MATCH (t:${NODE_LABEL} {bookId: $bookId, kind: 'thread'})
         WHERE t.status IN ['planned', 'open', 'progressed']
         RETURN t.name AS title, t.status AS status,
                t.setupChapter AS setupChapter, t.payoffChapter AS payoffChapter,
                t.dataJson AS dataJson
         ORDER BY coalesce(t.payoffChapter, 9999) ASC
         LIMIT 30`,
        { bookId },
      );

      const eventsResult = await session.run(
        `MATCH (e:${NODE_LABEL} {bookId: $bookId, kind: 'event'})
         RETURN e.name AS summary, e.chapter AS chapter
         ORDER BY e.chapter DESC
         LIMIT 20`,
        { bookId },
      );

      return {
        available: true,
        nodeCount,
        edgeCount,
        relations: relationsResult.records.map((record) => ({
          source: asString(record.get("source")) ?? "",
          target: asString(record.get("target")) ?? "",
          kind:
            asString(parseData(record.get("dataJson")).relationshipKind) ??
            "鍏崇郴",
          description: asString(record.get("description")) ?? "",
          ...(asNumber(record.get("fromChapter")) === undefined
            ? {}
            : { fromChapter: asNumber(record.get("fromChapter")) }),
          ...(asNumber(record.get("toChapter")) === undefined
            ? {}
            : { toChapter: asNumber(record.get("toChapter")) }),
          ...(asNumber(record.get("evidenceChapter")) === undefined
            ? {}
            : { evidenceChapter: asNumber(record.get("evidenceChapter")) }),
        })),
        threads: threadsResult.records.map((record) => {
          const data = parseData(record.get("dataJson"));
          const setupChapter = asNumber(record.get("setupChapter"));
          const payoffChapter = asNumber(record.get("payoffChapter"));
          return {
            title: asString(record.get("title")) ?? "",
            status: asString(record.get("status")) ?? "planned",
            ...(setupChapter === undefined ? {} : { setupChapter }),
            ...(payoffChapter === undefined ? {} : { payoffChapter }),
            ...(typeof data.note === "string" ? { note: data.note } : {}),
          };
        }),
        events: eventsResult.records
          .map((record) => ({
            summary: asString(record.get("summary")) ?? "",
            chapter: asNumber(record.get("chapter")) ?? 0,
          }))
          .filter((event) => event.chapter > 0),
      };
    });
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export function neo4jRecordValue(
  record: Neo4jRecord,
  key: string,
): unknown {
  return record.get(key);
}

