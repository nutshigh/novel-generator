import { describe, expect, it } from "vitest";
import {
  countWords,
  type Chapter,
  type OutlineChapter,
} from "../src/domain/schemas.js";
import { MemoryProjectStore } from "../src/domain/store.js";
import {
  assembleManuscript,
  saveBookArtifacts,
} from "../src/story/export.js";
import { makeBible, makeChapter, makeOutline, makeProject } from "./story-fixtures.js";

function makeRecord(
  outline: OutlineChapter,
  text: string,
  status: Chapter["status"] = "committed",
): Chapter {
  return {
    number: outline.number,
    title: outline.title,
    outline,
    text,
    wordCount: countWords(text),
    status,
  };
}

describe("assembleManuscript", () => {
  it("renders the title, logline, synopsis, and chapters in number order", () => {
    const project = makeProject({ maxChapters: 3, chapterWords: 300 });
    const bible = makeBible(3);
    const outline = makeOutline(3, 300);
    const chapters = [
      makeRecord(makeChapter(3, 300), "第三章的正文。"),
      makeRecord(makeChapter(1, 300), "第一章的正文。"),
      makeRecord(makeChapter(2, 300), "第二章的正文。"),
    ];

    const manuscript = assembleManuscript(project, bible, outline, chapters);

    expect(manuscript.markdown.startsWith("# 第一卷 旧城火")).toBe(true);
    expect(manuscript.markdown).toContain(bible.logline);
    expect(manuscript.markdown).toContain(bible.synopsis);
    expect(manuscript.markdown).toContain("## 第1章 旧城线索");
    expect(manuscript.markdown).toContain("## 第2章 旧城线索");
    expect(manuscript.markdown).toContain("## 第3章 旧城线索");
    expect(manuscript.markdown.indexOf("第一章的正文。")).toBeLessThan(
      manuscript.markdown.indexOf("第二章的正文。"),
    );
    expect(manuscript.markdown.indexOf("第二章的正文。")).toBeLessThan(
      manuscript.markdown.indexOf("第三章的正文。"),
    );
    expect(manuscript.markdown).not.toContain("第1章 第1章");
  });

  it("strips Chinese numeral and English chapter prefixes from headings", () => {
    const project = makeProject({ maxChapters: 2, chapterWords: 300 });
    const bible = makeBible(2);
    const outline = makeOutline(2, 300);
    const chapters = [
      makeRecord(
        { ...makeChapter(1, 300), title: "第一章 旧城线索" },
        "第一章正文。",
      ),
      makeRecord(
        { ...makeChapter(2, 300), title: "Chapter 2: 暗巷" },
        "第二章正文。",
      ),
    ];

    const manuscript = assembleManuscript(project, bible, outline, chapters);

    expect(manuscript.markdown).toContain("## 第1章 旧城线索");
    expect(manuscript.markdown).toContain("## 第2章 暗巷");
    expect(manuscript.markdown).not.toContain("第一章 第一章");
    expect(manuscript.markdown).not.toContain("Chapter 2");
  });

  it("renders a plain-text version without Markdown heading markers", () => {
    const project = makeProject({ maxChapters: 1, chapterWords: 300 });
    const bible = makeBible(1);
    const outline = makeOutline(1, 300);
    const chapters = [makeRecord(makeChapter(1, 300), "只有一章的正文。")];

    const manuscript = assembleManuscript(project, bible, outline, chapters);

    expect(manuscript.text).not.toMatch(/^#/m);
    expect(manuscript.text).not.toContain("##");
    expect(manuscript.text).toContain("第一卷 旧城火");
    expect(manuscript.text).toContain(bible.logline);
    expect(manuscript.text).toContain("第1章 旧城线索");
    expect(manuscript.text).toContain("只有一章的正文。");
  });
});

describe("saveBookArtifacts", () => {
  it("saves book.md and book.txt with the assembled contents", async () => {
    const store = new MemoryProjectStore();
    const project = await store.createProject({
      premise: "一个少年在旧城意外觉醒。",
      targetWords: 300,
      chapterWords: 300,
      maxChapters: 1,
    });
    const bible = makeBible(1);
    const outline = makeOutline(1, 300);
    const chapters = [makeRecord(makeChapter(1, 300), "正文。")];
    const manuscript = assembleManuscript(project, bible, outline, chapters);

    const paths = await saveBookArtifacts(store, project.id, manuscript);

    expect(store.getArtifact(project.id, "book.md")).toBe(manuscript.markdown);
    expect(store.getArtifact(project.id, "book.txt")).toBe(manuscript.text);
    expect(paths.markdownPath).toContain("book.md");
    expect(paths.textPath).toContain("book.txt");
  });
});
