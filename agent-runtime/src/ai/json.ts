import type { ZodType } from "zod";

function closes(open: string, close: string): boolean {
  return (open === "{" && close === "}") || (open === "[" && close === "]");
}

function balancedCandidate(source: string, start: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }

    if (character === "}" || character === "]") {
      const open = stack.pop();
      if (!open || !closes(open, character)) return undefined;
      if (stack.length === 0) return source.slice(start, index + 1);
    }
  }

  return undefined;
}

export function extractJson(text: string): unknown {
  const fenced = Array.from(
    text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
    (match) => match[1] ?? "",
  )
    .join("\n")
    .trim();
  const source = fenced || text;

  let sawStart = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "{" && source[index] !== "[") continue;

    sawStart = true;
    const candidate = balancedCandidate(source, index);
    if (!candidate) continue;

    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  if (sawStart) {
    throw new Error("Invalid JSON in model response.");
  }
  throw new Error("No JSON object or array found in model response.");
}

export function parseWithSchema<T>(schema: ZodType<T>, text: string): T {
  return schema.parse(extractJson(text));
}
