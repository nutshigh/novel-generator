import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const echoTool = defineTool({
  name: "echo",
  label: "Echo",
  description: "Return the provided text unchanged.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: params.text }],
    details: { length: params.text.length },
  }),
});
