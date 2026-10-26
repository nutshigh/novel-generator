import type { AiGateway, GenerateRequest } from "../ai/gateway.js";
import type { ProjectStore } from "../domain/store.js";

export const PROMPT_LOG_ARTIFACT = "prompt-log.jsonl";

export interface PromptLogToolCall {
  id?: string;
  name: string;
  arguments: unknown;
}

export interface PromptLogReply {
  text: string;
  thinking?: string;
  toolCalls: PromptLogToolCall[];
  model?: string;
  stopReason?: string;
  usage?: unknown;
}

export interface PromptLogToolResult {
  toolCallId?: string;
  toolName: string;
  isError: boolean;
  text: string;
}

export interface PromptLogEntry {
  at: string;
  projectId: string;
  source: "director" | "model";
  kind: string;
  round: number;
  chapterNumber?: number;
  systemPrompt?: string;
  prompt: string;
  replies: PromptLogReply[];
  toolResults?: PromptLogToolResult[];
  temperature?: number;
  maxTokens?: number;
  durationMs: number;
  error?: string;
}

export interface PromptLogQuery {
  chapterNumber?: number;
  /** Returns the most recent N matching entries. */
  limit?: number;
}

export interface PromptLogResult {
  entries: PromptLogEntry[];
  total: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = asRecord(block);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

export function promptLogReply(message: unknown): PromptLogReply {
  const record = asRecord(message);
  const content = record?.content;
  let text = "";
  let thinking = "";
  const toolCalls: PromptLogToolCall[] = [];

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const value = asRecord(block);
      if (!value) continue;
      if (value.type === "text" && typeof value.text === "string") {
        text = text.length > 0 ? `${text}\n${value.text}` : value.text;
      } else if (value.type === "thinking" && typeof value.thinking === "string") {
        thinking =
          thinking.length > 0 ? `${thinking}\n${value.thinking}` : value.thinking;
      } else if (value.type === "toolCall") {
        toolCalls.push({
          ...(typeof value.id === "string" ? { id: value.id } : {}),
          name: typeof value.name === "string" ? value.name : "",
          arguments: value.arguments ?? null,
        });
      }
    }
  }

  return {
    text,
    ...(thinking.length > 0 ? { thinking } : {}),
    toolCalls,
    ...(typeof record?.model === "string" ? { model: record.model } : {}),
    ...(typeof record?.stopReason === "string"
      ? { stopReason: record.stopReason }
      : {}),
    ...(record?.usage === undefined ? {} : { usage: record.usage }),
  };
}

export function promptLogToolResults(results: unknown): PromptLogToolResult[] {
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    const record = asRecord(result);
    if (!record) return [];
    const text = textFromContent(record.content);
    return [
      {
        ...(typeof record.toolCallId === "string"
          ? { toolCallId: record.toolCallId }
          : {}),
        toolName: typeof record.toolName === "string" ? record.toolName : "",
        isError: record.isError === true,
        text: text.length > 0 ? text : JSON.stringify(record.content ?? ""),
      },
    ];
  });
}

function isPromptLogEntry(value: unknown): value is PromptLogEntry {
  const record = asRecord(value);
  if (!record) return false;
  return (
    typeof record.at === "string" &&
    typeof record.projectId === "string" &&
    (record.source === "director" || record.source === "model") &&
    typeof record.kind === "string" &&
    typeof record.round === "number" &&
    typeof record.prompt === "string" &&
    Array.isArray(record.replies) &&
    typeof record.durationMs === "number"
  );
}

/**
 * Appends JSONL entries in order. Write failures are swallowed on purpose so a
 * diagnostic log can never fail chapter generation.
 */
export class PromptLogWriter {
  readonly projectId: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: ProjectStore,
    projectId: string,
  ) {
    this.projectId = projectId;
  }

  append(entry: PromptLogEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const write = () =>
      this.store.appendArtifact(this.projectId, PROMPT_LOG_ARTIFACT, line);

    const result = this.tail
      .then(write, write)
      .then(
        () => undefined,
        () => undefined,
      );
    this.tail = result;
    return result;
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}

/** Logs every structured gateway call (bible, outline, review, state, ...). */
export function withPromptLogging(
  ai: AiGateway,
  logger: PromptLogWriter,
): AiGateway {
  let runRound = 0;
  const chapterRounds = new Map<number, number>();

  return {
    async generateText(req: GenerateRequest): Promise<string> {
      let round: number;
      if (req.chapterNumber === undefined) {
        runRound += 1;
        round = runRound;
      } else {
        round = (chapterRounds.get(req.chapterNumber) ?? 0) + 1;
        chapterRounds.set(req.chapterNumber, round);
      }

      const startedAt = Date.now();
      const base = {
        at: new Date().toISOString(),
        projectId: logger.projectId,
        source: "model" as const,
        kind: req.kind,
        round,
        systemPrompt: req.system,
        prompt: req.user,
        ...(req.chapterNumber === undefined
          ? {}
          : { chapterNumber: req.chapterNumber }),
        ...(req.temperature === undefined
          ? {}
          : { temperature: req.temperature }),
        ...(req.maxTokens === undefined ? {} : { maxTokens: req.maxTokens }),
      };

      try {
        const text = await ai.generateText(req);
        await logger.append({
          ...base,
          replies: [{ text, toolCalls: [] }],
          durationMs: Date.now() - startedAt,
        });
        return text;
      } catch (error) {
        await logger.append({
          ...base,
          replies: [],
          durationMs: Date.now() - startedAt,
          error: errorMessage(error),
        });
        throw error;
      }
    },
  };
}

export async function readPromptLog(
  store: ProjectStore,
  projectId: string,
  query: PromptLogQuery = {},
): Promise<PromptLogResult> {
  const raw = await store.readArtifact(projectId, PROMPT_LOG_ARTIFACT);
  if (raw === undefined) return { entries: [], total: 0 };

  const entries: PromptLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isPromptLogEntry(parsed)) entries.push(parsed);
    } catch {
      // A truncated or manually edited line should not hide the rest.
    }
  }

  const matching =
    query.chapterNumber === undefined
      ? entries
      : entries.filter(
          (entry) => entry.chapterNumber === query.chapterNumber,
        );
  const limited =
    query.limit === undefined ? matching : matching.slice(-query.limit);

  return { entries: limited, total: matching.length };
}
