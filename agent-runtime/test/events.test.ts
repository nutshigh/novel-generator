import { describe, expect, it } from "vitest";
import { normalizePiEvent, type PiEventLike } from "../src/events.js";

describe("normalizePiEvent", () => {
  it("maps agent lifecycle events", () => {
    expect(normalizePiEvent({ type: "agent_start" })).toEqual({ type: "agent.start" });
    expect(normalizePiEvent({ type: "turn_end" })).toEqual({ type: "turn.end" });
    expect(normalizePiEvent({ type: "agent_end" })).toEqual({ type: "agent.end" });
  });

  it("maps text deltas", () => {
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "你好" },
      }),
    ).toEqual({ type: "agent.delta", text: "你好" });
  });

  it("ignores non-text message updates", () => {
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "thinking_delta", delta: "..." },
      }),
    ).toBeNull();
  });

  it("returns null when assistantMessageEvent is undefined or null", () => {
    expect(normalizePiEvent({ type: "message_update" })).toBeNull();
    expect(normalizePiEvent({ type: "message_update", assistantMessageEvent: null })).toBeNull();
  });

  it("returns null when assistantMessageEvent is not an object", () => {
    expect(
      normalizePiEvent({ type: "message_update", assistantMessageEvent: "text_delta" }),
    ).toBeNull();
  });

  it("returns null when assistantMessageEvent has no type", () => {
    expect(
      normalizePiEvent({ type: "message_update", assistantMessageEvent: {} }),
    ).toBeNull();
  });

  it("returns null for text_delta with missing or non-string delta", () => {
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta" },
      }),
    ).toBeNull();
    expect(
      normalizePiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: 42 },
      }),
    ).toBeNull();
  });

  it("maps tool lifecycle events", () => {
    expect(
      normalizePiEvent({ type: "tool_execution_start", toolCallId: "c1", toolName: "echo" }),
    ).toEqual({ type: "tool.start", toolCallId: "c1", toolName: "echo" });

    expect(
      normalizePiEvent({ type: "tool_execution_update", toolCallId: "c1", toolName: "echo" }),
    ).toEqual({ type: "tool.update", toolCallId: "c1", toolName: "echo" });

    expect(
      normalizePiEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "echo", isError: false }),
    ).toEqual({ type: "tool.end", toolCallId: "c1", toolName: "echo", isError: false });
  });

  it("normalizes the tool error flag strictly", () => {
    expect(
      normalizePiEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "echo", isError: true }),
    ).toEqual({ type: "tool.end", toolCallId: "c1", toolName: "echo", isError: true });
    expect(
      normalizePiEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "echo" }),
    ).toEqual({ type: "tool.end", toolCallId: "c1", toolName: "echo", isError: false });
    expect(
      normalizePiEvent({ type: "tool_execution_end", toolCallId: "c1", toolName: "echo", isError: "false" }),
    ).toEqual({ type: "tool.end", toolCallId: "c1", toolName: "echo", isError: false });
  });

  it("returns null for unknown events", () => {
    expect(normalizePiEvent({ type: "something_else" })).toBeNull();
  });

  it("returns null for null or undefined input", () => {
    expect(normalizePiEvent(null as unknown as PiEventLike)).toBeNull();
    expect(normalizePiEvent(undefined as unknown as PiEventLike)).toBeNull();
  });
});
