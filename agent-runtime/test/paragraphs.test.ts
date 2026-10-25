import { describe, expect, it } from "vitest";
import {
  firstParagraphs,
  joinParagraphs,
  lastParagraphs,
  replaceFirstParagraphs,
  replaceLastParagraphs,
  splitParagraphs,
} from "../src/story/paragraphs.js";

const text = "第一段。\n\n第二段。\n\n第三段。";

describe("paragraph helpers", () => {
  it("splits and joins paragraphs", () => {
    expect(splitParagraphs(text)).toEqual(["第一段。", "第二段。", "第三段。"]);
    expect(joinParagraphs(["甲", "乙"])).toBe("甲\n\n乙");
  });

  it("takes paragraphs from the head and tail", () => {
    expect(firstParagraphs(text, 2)).toBe("第一段。\n\n第二段。");
    expect(lastParagraphs(text, 2)).toBe("第二段。\n\n第三段。");
    expect(firstParagraphs(text, 0)).toBe("");
  });

  it("appends or replaces tail paragraphs", () => {
    expect(replaceLastParagraphs(text, "新结尾。", 0)).toBe(
      "第一段。\n\n第二段。\n\n第三段。\n\n新结尾。",
    );
    expect(replaceLastParagraphs(text, "新结尾。", 1)).toBe(
      "第一段。\n\n第二段。\n\n新结尾。",
    );
    expect(replaceLastParagraphs(text, "新结尾。", 2)).toBe(
      "第一段。\n\n新结尾。",
    );
  });

  it("prepends or replaces head paragraphs", () => {
    expect(replaceFirstParagraphs(text, "新开头。", 0)).toBe(
      "新开头。\n\n第一段。\n\n第二段。\n\n第三段。",
    );
    expect(replaceFirstParagraphs(text, "新开头。", 1)).toBe(
      "新开头。\n\n第二段。\n\n第三段。",
    );
    expect(replaceFirstParagraphs(text, "新开头。", 2)).toBe(
      "新开头。\n\n第三段。",
    );
  });

  it("rejects replacing more paragraphs than exist", () => {
    expect(() => replaceLastParagraphs(text, "新。", 5)).toThrow(/tail/i);
    expect(() => replaceFirstParagraphs(text, "新。", 5)).toThrow(/opening/i);
  });
});
