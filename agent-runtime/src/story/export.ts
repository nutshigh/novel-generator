import type {
  Chapter,
  Outline,
  Project,
  StoryBible,
} from "../domain/schemas.js";
import type { ProjectStore } from "../domain/store.js";

const CHAPTER_PREFIX =
  /^(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*章|Chapter\s+\d+)\s*[\s:：.\-—–]*/iu;

export interface Manuscript {
  markdown: string;
  text: string;
}

export interface BookArtifactPaths {
  markdownPath: string;
  textPath: string;
}

function chapterTitle(title: string): string {
  return title.replace(CHAPTER_PREFIX, "").trim();
}

function bookTitle(project: Project, outline: Outline): string {
  const volumeTitle = outline.volumes[0]?.title.trim();
  return volumeTitle || project.premise;
}

function finish(parts: string[]): string {
  return `${parts.filter((part) => part.length > 0).join("\n\n").trimEnd()}\n`;
}

export function assembleManuscript(
  project: Project,
  bible: StoryBible,
  outline: Outline,
  chapters: Chapter[],
): Manuscript {
  const title = bookTitle(project, outline);
  const ordered = [...chapters].sort(
    (left, right) => left.number - right.number,
  );
  const markdown: string[] = [`# ${title}`];
  const text: string[] = [title];

  if (bible.logline.trim().length > 0) {
    markdown.push(`> ${bible.logline.trim()}`);
    text.push(bible.logline.trim());
  }

  if (bible.synopsis.trim().length > 0) {
    markdown.push(bible.synopsis.trim());
    text.push(bible.synopsis.trim());
  }

  for (const chapter of ordered) {
    const titleText = chapterTitle(chapter.title);
    const heading = `第${chapter.number}章${titleText ? ` ${titleText}` : ""}`;
    markdown.push(`## ${heading}`, chapter.text.trim());
    text.push(heading, chapter.text.trim());
  }

  return { markdown: finish(markdown), text: finish(text) };
}

export async function saveBookArtifacts(
  store: ProjectStore,
  projectId: string,
  manuscript: Manuscript,
): Promise<BookArtifactPaths> {
  const markdownPath = await store.saveArtifact(
    projectId,
    "book.md",
    manuscript.markdown,
  );
  const textPath = await store.saveArtifact(
    projectId,
    "book.txt",
    manuscript.text,
  );
  return { markdownPath, textPath };
}
