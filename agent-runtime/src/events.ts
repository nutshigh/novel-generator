export type RunEvent =
  | { type: "agent.start" }
  | { type: "agent.delta"; text: string }
  | { type: "turn.end" }
  | { type: "agent.end" }
  | { type: "tool.start"; toolCallId: string; toolName: string }
  | { type: "tool.update"; toolCallId: string; toolName: string }
  | { type: "tool.end"; toolCallId: string; toolName: string; isError: boolean };

export interface PiEventLike {
  type: string;
  [key: string]: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizePiEvent(event: PiEventLike): RunEvent | null {
  if (!event || typeof event !== "object") return null;
  switch (event.type) {
    case "agent_start":
      return { type: "agent.start" };
    case "turn_end":
      return { type: "turn.end" };
    case "agent_end":
      return { type: "agent.end" };
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (!update || typeof update !== "object") return null;
      const { type, delta } = update as { type?: unknown; delta?: unknown };
      if (type === "text_delta" && typeof delta === "string") {
        return { type: "agent.delta", text: delta };
      }
      return null;
    }
    case "tool_execution_start":
      return {
        type: "tool.start",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
      };
    case "tool_execution_update":
      return {
        type: "tool.update",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
      };
    case "tool_execution_end":
      return {
        type: "tool.end",
        toolCallId: text(event.toolCallId),
        toolName: text(event.toolName),
        isError: event.isError === true,
      };
    default:
      return null;
  }
}
