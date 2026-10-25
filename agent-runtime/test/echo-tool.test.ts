import { describe, expect, it } from "vitest";
import { echoTool } from "../src/tools/echo.js";

describe("echoTool", () => {
  it("returns the input text", async () => {
    const result = await echoTool.execute(
      "call-1",
      { text: "hello" },
      undefined,
      undefined,
      {} as never,
    );

    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toEqual({ length: 5 });
  });
});
