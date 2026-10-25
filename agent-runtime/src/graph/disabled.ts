import type {
  BookGraph,
  ChapterContextInput,
  GraphSummary,
  NovelGraphStore,
} from "./types.js";
import { EMPTY_GRAPH_SUMMARY } from "./types.js";
import type { Chapter, StoryBible } from "../domain/schemas.js";

export class DisabledNovelGraph implements NovelGraphStore {
  readonly name = "disabled";

  constructor(private readonly reason: string) {}

  async rebuildBook(_graph: BookGraph): Promise<void> {
    return;
  }

  async indexChapter(
    _bookId: string,
    _bible: StoryBible,
    _chapter: Chapter,
  ): Promise<void> {
    return;
  }

  async buildChapterContext(_input: ChapterContextInput): Promise<string> {
    return "";
  }

  async getSummary(_bookId: string): Promise<GraphSummary> {
    return { ...EMPTY_GRAPH_SUMMARY, reason: this.reason };
  }

  async getGraph(_bookId: string): Promise<BookGraph | undefined> {
    return undefined;
  }

  async close(): Promise<void> {
    return;
  }
}
