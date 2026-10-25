import { describe, expect, it } from "vitest";
import { createProject } from "../src/story/project.js";

const premise = "一个少年在旧城意外觉醒，被迫卷入宗门与王朝的暗战。";

describe("createProject", () => {
  it("applies the demo-safe defaults", () => {
    const project = createProject({ premise });

    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(project.premise).toBe(premise);
    expect(project.language).toBe("简体中文");
    expect(project.chapterWords).toBe(800);
    expect(project.maxChapters).toBe(6);
    expect(project.targetWords).toBe(4800);
    expect(project.status).toBe("draft");
    expect(Number.isNaN(Date.parse(project.createdAt))).toBe(false);
  });

  it("honors custom language, chapter count, and chapter words", () => {
    const project = createProject({
      premise,
      language: "English",
      chapterWords: 500,
      maxChapters: 4,
    });

    expect(project.language).toBe("English");
    expect(project.chapterWords).toBe(500);
    expect(project.maxChapters).toBe(4);
    expect(project.targetWords).toBe(2000);
  });

  it("trims language and falls back to the default when blank", () => {
    expect(createProject({ premise, language: "  English  " }).language).toBe(
      "English",
    );
    expect(createProject({ premise, language: "   " }).language).toBe("简体中文");
  });

  it("uses an explicit targetWords value when supplied", () => {
    const project = createProject({
      premise,
      chapterWords: 500,
      maxChapters: 4,
      targetWords: 1234,
    });

    expect(project.targetWords).toBe(1234);
  });

  it("computes targetWords for the minimum supported budget", () => {
    const project = createProject({
      premise,
      chapterWords: 200,
      maxChapters: 1,
    });

    expect(project.targetWords).toBe(200);
  });

  it("creates unique ids", () => {
    expect(createProject({ premise }).id).not.toBe(createProject({ premise }).id);
  });

  it.each(["", "   "])("rejects an empty premise (%j)", (value) => {
    expect(() => createProject({ premise: value })).toThrow(/premise/i);
  });

  it.each([
    { chapterWords: 100 },
    { maxChapters: 0 },
    { maxChapters: 41 },
    { targetWords: 100 },
  ])("rejects invalid values: %j", (overrides) => {
    expect(() => createProject({ premise, ...overrides })).toThrow();
  });
});
