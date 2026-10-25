import type {
  Chapter,
  StoryBible,
  OutlineChapter,
  Project,
  Outline,
} from "../domain/schemas.js";

export type NovelNodeKind =
  | "book"
  | "chapter"
  | "character"
  | "faction"
  | "location"
  | "item"
  | "concept"
  | "entity"
  | "event"
  | "thread";

export type NovelEdgeKind =
  | "appears_in"
  | "relation"
  | "member_of"
  | "located_at"
  | "event_in_chapter"
  | "event_involves"
  | "event_location"
  | "thread_setup_in"
  | "thread_payoff_in"
  | "thread_advanced_in"
  | "chapter_follows";

export interface NovelNode {
  id: string;
  kind: NovelNodeKind;
  name: string;
  chapter?: number;
  status?: string;
  data?: Record<string, unknown>;
}

export interface NovelEdge {
  id: string;
  kind: NovelEdgeKind;
  fromId: string;
  toId: string;
  description?: string;
  fromChapter?: number;
  toChapter?: number;
  evidenceChapter?: number;
  status?: string;
  data?: Record<string, unknown>;
}

export interface BookGraph {
  bookId: string;
  nodes: NovelNode[];
  edges: NovelEdge[];
}

export interface ChapterContextInput {
  bookId: string;
  chapterNumber: number;
  cast: string[];
}

export interface GraphRelationSummary {
  source: string;
  target: string;
  kind: string;
  description: string;
  fromChapter?: number;
  toChapter?: number;
  evidenceChapter?: number;
}

export interface GraphThreadSummary {
  title: string;
  status: string;
  setupChapter?: number;
  payoffChapter?: number;
  note?: string;
}

export interface GraphEventSummary {
  summary: string;
  chapter: number;
}

export interface GraphSummary {
  available: boolean;
  reason?: string;
  nodeCount: number;
  edgeCount: number;
  relations: GraphRelationSummary[];
  threads: GraphThreadSummary[];
  events: GraphEventSummary[];
}

export interface NovelGraphStore {
  readonly name: string;
  rebuildBook(graph: BookGraph): Promise<void>;
  indexChapter(
    bookId: string,
    bible: StoryBible,
    chapter: Chapter,
  ): Promise<void>;
  buildChapterContext(input: ChapterContextInput): Promise<string>;
  getGraph(bookId: string): Promise<BookGraph | undefined>;
  getSummary(bookId: string): Promise<GraphSummary>;
  close(): Promise<void>;
}

export interface BuildBookGraphInput {
  project: Project;
  bible: StoryBible;
  outline: Outline;
  chapters: Chapter[];
}

export interface BuildChapterGraphInput {
  bookId: string;
  bible: StoryBible;
  chapter: Chapter;
  outlineChapter?: OutlineChapter;
  existingNodeIds?: ReadonlySet<string>;
}

export const EMPTY_GRAPH_SUMMARY: GraphSummary = {
  available: false,
  nodeCount: 0,
  edgeCount: 0,
  relations: [],
  threads: [],
  events: [],
};
