import { z } from "zod";
import { describe, expect, it } from "vitest";
import { extractJson, parseWithSchema } from "../src/ai/json.js";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"title":"旧城火"}')).toEqual({ title: "旧城火" });
  });

  it("parses JSON inside a markdown fence", () => {
    expect(extractJson('```json\n{"title":"旧城火"}\n```')).toEqual({
      title: "旧城火",
    });
  });

  it("parses JSON surrounded by prose", () => {
    expect(
      extractJson('Here is the result:\n{"title":"旧城火","chapters":[1,2]}\nDone.'),
    ).toEqual({ title: "旧城火", chapters: [1, 2] });
  });

  it("parses a JSON array", () => {
    expect(extractJson("prefix [1, 2, 3] suffix")).toEqual([1, 2, 3]);
  });

  it("ignores bracketed prose before the JSON", () => {
    expect(extractJson('Note [see below]: {"a":1} done')).toEqual({ a: 1 });
  });

  it("ignores bracketed prose after the JSON", () => {
    expect(extractJson('{"a":1} done [ok]')).toEqual({ a: 1 });
  });

  it("handles nested values and braces inside strings", () => {
    const payload = {
      text: "brace } and ] inside",
      items: [{ n: 1 }, { n: 2 }],
      nested: { ok: true, list: [1, [2, 3]] },
    };

    expect(extractJson(`prefix ${JSON.stringify(payload)} suffix`)).toEqual(payload);
  });

  it("throws a clear error when no JSON is present", () => {
    expect(() => extractJson("no json here")).toThrow(/JSON/i);
  });

  it("throws a clear error for malformed JSON", () => {
    expect(() => extractJson('{"title":}')).toThrow(/Invalid JSON/i);
  });
});

describe("parseWithSchema", () => {
  const schema = z.object({ name: z.string() });

  it("extracts and validates a schema", () => {
    expect(parseWithSchema(schema, '```json\n{"name":"林砚"}\n```')).toEqual({
      name: "林砚",
    });
  });

  it("surfaces schema validation errors", () => {
    expect(() => parseWithSchema(schema, '{"name":42}')).toThrow();
  });
});
