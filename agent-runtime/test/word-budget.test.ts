import { describe, expect, it } from "vitest";
import {
  planContinuation,
  shouldContinue,
  trimToWordLimit,
} from "../src/story/wordBudget.js";
import { countWords } from "../src/domain/schemas.js";

describe("shouldContinue", () => {
  it("continues below ninety percent of the target", () => {
    expect(shouldContinue(100, 89)).toBe(true);
  });

  it("stops at exactly ninety percent of the target", () => {
    expect(shouldContinue(100, 90)).toBe(false);
  });

  it("stops above the target", () => {
    expect(shouldContinue(100, 130)).toBe(false);
  });
});

describe("planContinuation", () => {
  it("splits the remaining words across the remaining rounds", () => {
    expect(planContinuation(1000, 400, 0, 2)).toEqual({
      suggestedWords: 300,
      isFinalRound: false,
      remaining: 600,
    });
  });

  it("asks for the full remainder on the final round", () => {
    expect(planContinuation(1000, 400, 1, 2)).toEqual({
      suggestedWords: 600,
      isFinalRound: true,
      remaining: 600,
    });
  });

  it("returns zero when the target is already met", () => {
    expect(planContinuation(1000, 1000, 0, 2)).toEqual({
      suggestedWords: 0,
      isFinalRound: true,
      remaining: 0,
    });
  });

  it("returns zero when the target is exceeded", () => {
    expect(planContinuation(1000, 1200, 0, 2)).toEqual({
      suggestedWords: 0,
      isFinalRound: true,
      remaining: 0,
    });
  });

  it("treats the first round as final when maxRounds is one", () => {
    expect(planContinuation(800, 500, 0, 1)).toEqual({
      suggestedWords: 300,
      isFinalRound: true,
      remaining: 300,
    });
  });
});

describe("trimToWordLimit", () => {
  it("returns text unchanged when it is under the limit", () => {
    expect(trimToWordLimit("你好。", 10)).toBe("你好。");
  });

  it("returns text unchanged when it is exactly at the limit", () => {
    expect(trimToWordLimit("你好。", 3)).toBe("你好。");
  });

  it("trims at a Chinese sentence boundary instead of mid-sentence", () => {
    expect(trimToWordLimit("第一句。第二句。第三句。", 6)).toBe("第一句。");
  });

  it("trims at exclamation, question, ellipsis, and newline boundaries", () => {
    expect(trimToWordLimit("甲！乙？丙…丁。", 3)).toBe("甲！");
    expect(trimToWordLimit("第一段\n第二段", 4)).toBe("第一段");
  });

  it("accepts ASCII periods and closing quotes as boundaries", () => {
    expect(trimToWordLimit(`${"甲".repeat(60)}.${"乙".repeat(100)}`, 100)).toBe(
      `${"甲".repeat(60)}.`,
    );
    expect(
      trimToWordLimit(`${"甲".repeat(60)}."${"乙".repeat(100)}`, 100),
    ).toBe(`${"甲".repeat(60)}."`);
  });

  it("absorbs closing quotes after the chosen sentence boundary", () => {
    const text = `他说：“走吧。”${"后".repeat(200)}`;

    expect(trimToWordLimit(text, 7)).toBe("他说：“走吧。”");
  });

  it("caps closer absorption at four characters", () => {
    const text = `他说：“走吧。”${"”".repeat(5)}${"后".repeat(200)}`;

    expect(trimToWordLimit(text, 7)).toBe(`他说：“走吧。”${"”".repeat(3)}`);
  });

  it("hard slices when there is no sentence boundary within the limit", () => {
    expect(trimToWordLimit("一二三四五", 3)).toBe("一二三");
  });

  it("does not collapse to an early boundary far below the limit", () => {
    const trimmed = trimToWordLimit(`短。${"甲".repeat(5000)}`, 100);

    expect(trimmed).not.toBe("短。");
    expect(trimmed.startsWith("短。")).toBe(true);
    expect(countWords(trimmed)).toBe(100);
  });

  it("strips leading whitespace before slicing", () => {
    const trimmed = trimToWordLimit(`\n\n${"甲".repeat(200)}`, 100);

    expect(trimmed.startsWith("甲")).toBe(true);
    expect(trimmed).not.toBe("");
    expect(countWords(trimmed)).toBe(100);
  });

  it("keeps the result within the requested non-whitespace count", () => {
    const text = "第一句。第二句。第三句。第四句。";
    const trimmed = trimToWordLimit(text, 9);

    expect(trimmed.endsWith("。")).toBe(true);
    expect(countWords(trimmed)).toBeLessThanOrEqual(9);
  });

  it("returns an empty string for a non-positive limit", () => {
    expect(trimToWordLimit("第一句。", 0)).toBe("");
  });
});
