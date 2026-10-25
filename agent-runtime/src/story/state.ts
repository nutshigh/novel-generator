import type { AiGateway } from "../ai/gateway.js";
import { parseWithSchema } from "../ai/json.js";
import { MAX_OUTPUT_TOKENS } from "../ai/limits.js";
import {
  StoryStateSchema,
  validateChapter,
  type Chapter,
  type Project,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import {
  STATE_SYSTEM_PROMPT,
  buildStateUserPrompt,
} from "../prompts/defaults.js";
import { findCanonicalName, selectCast } from "./context.js";

const MAX_STATE_ATTEMPTS = 2;

export interface ExtractStateInput {
  project: Project;
  chapter: Chapter;
  currentState: StoryState;
  bible: StoryBible;
  ai: AiGateway;
  signal?: AbortSignal;
  onWarning?: (message: string) => void;
}

export class StateExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateExtractionError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalizeEntityNames(
  state: StoryState,
  bible: StoryBible,
  protectedNames: ReadonlySet<string>,
): StoryState {
  const canonicalNames = [...bible.items, ...bible.concepts];
  const entities = state.entities.map((entity) => {
    if (protectedNames.has(entity.entityName)) return entity;
    const canonicalName = findCanonicalName(entity.entityName, canonicalNames);
    return canonicalName ? { ...entity, entityName: canonicalName } : entity;
  });

  return {
    ...state,
    entities: mergeEntities([], entities),
  };
}

interface FilteredState {
  state: StoryState;
  warnings: string[];
}

function filterExtractedState(
  state: StoryState,
  chapterNumber: number,
  canonicalForeshadowTitles: ReadonlySet<string>,
): FilteredState {
  const warnings: string[] = [];

  const events = state.events.filter((event) => {
    if (event.chapterNumber <= chapterNumber) return true;
    warnings.push(
      `Dropped future event (chapter ${event.chapterNumber}): ${event.summary}`,
    );
    return false;
  });

  const entities = state.entities.filter((entity) => {
    if (entity.updatedAtChapter <= chapterNumber) return true;
    warnings.push(
      `Dropped entity ${entity.entityName} updated in future chapter ${entity.updatedAtChapter}.`,
    );
    return false;
  });

  const foreshadows = state.foreshadows.filter((foreshadow) => {
    if (canonicalForeshadowTitles.has(foreshadow.title)) return true;
    warnings.push(
      `Dropped non-canonical foreshadow "${foreshadow.title}".`,
    );
    return false;
  });

  return {
    state: { ...state, entities, foreshadows, events },
    warnings,
  };
}

function mergeEntities(
  current: StoryState["entities"],
  next: StoryState["entities"],
): StoryState["entities"] {
  const values = new Map<string, StoryState["entities"][number]>();
  const order: string[] = [];

  for (const entity of current) {
    const existing = values.get(entity.entityName);
    if (!existing) {
      order.push(entity.entityName);
      values.set(entity.entityName, { ...entity, state: { ...entity.state } });
      continue;
    }

    values.set(entity.entityName, {
      ...existing,
      ...entity,
      state: { ...existing.state, ...entity.state },
    });
  }

  for (const entity of next) {
    const existing = values.get(entity.entityName);
    if (!existing) {
      order.push(entity.entityName);
      values.set(entity.entityName, { ...entity, state: { ...entity.state } });
      continue;
    }

    values.set(entity.entityName, {
      ...existing,
      ...entity,
      state: { ...existing.state, ...entity.state },
    });
  }

  return order.map((entityName) => values.get(entityName)!);
}

function mergeByKey<T>(
  current: readonly T[],
  next: readonly T[],
  keyOf: (value: T) => string,
): T[] {
  const values = new Map<string, T>();
  const order: string[] = [];

  for (const value of current) {
    const key = keyOf(value);
    if (!values.has(key)) order.push(key);
    values.set(key, value);
  }

  for (const value of next) {
    const key = keyOf(value);
    if (!values.has(key)) order.push(key);
    values.set(key, value);
  }

  return order.map((key) => values.get(key)!);
}

export async function extractState(input: ExtractStateInput): Promise<StoryState> {
  const {
    project,
    chapter,
    currentState,
    bible,
    ai,
    signal,
    onWarning,
  } = input;
  const cast = selectCast(bible, chapter.outline);
  const protectedNames = new Set([
    ...bible.characters.map((character) => character.name),
    ...chapter.outline.cast,
  ]);
  const baseUser = buildStateUserPrompt(
    chapter,
    currentState,
    cast,
    bible.foreshadowLedger,
    bible.items,
    bible.concepts,
  );
  const canonicalForeshadowTitles = new Set(
    bible.foreshadowLedger.map((entry) => entry.title),
  );
  const canonicalForeshadowTitleList =
    bible.foreshadowLedger.map((entry) => entry.title).join("、") || "（无）";
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_STATE_ATTEMPTS; attempt += 1) {
    const user =
      attempt === 1
        ? baseUser
        : `${baseUser}

上一次输出未通过校验：
${lastError}

可用的 canonical foreshadow titles：${canonicalForeshadowTitleList}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或额外文字；必须完全符合 StoryState schema，并且只写正文中已经发生的事实。`;

    const raw = await ai.generateText({
      kind: "state",
      system: STATE_SYSTEM_PROMPT,
      user,
      temperature: 0.2,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal,
    });

    let extracted: StoryState;
    try {
      extracted = parseWithSchema(StoryStateSchema, raw);
    } catch (error) {
      lastError = errorMessage(error);
      continue;
    }

    const state = canonicalizeEntityNames(extracted, bible, protectedNames);
    const filtered = filterExtractedState(
      state,
      chapter.number,
      canonicalForeshadowTitles,
    );
    for (const warning of filtered.warnings) {
      onWarning?.(warning);
    }
    return filtered.state;
  }

  throw new StateExtractionError(
    `State extraction failed after ${MAX_STATE_ATTEMPTS} attempts: ${lastError}`,
  );
}

export function mergeState(
  current: StoryState,
  next: StoryState,
): StoryState {
  return {
    entities: mergeEntities(current.entities, next.entities),
    relationships: mergeByKey(
      current.relationships,
      next.relationships,
      (relationship) =>
        `${relationship.source}\u0000${relationship.target}`,
    ),
    foreshadows: mergeByKey(
      current.foreshadows,
      next.foreshadows,
      (entry) => entry.title,
    ),
    events: mergeByKey(
      current.events,
      next.events,
      (event) => `${event.chapterNumber}\u0000${event.summary}`,
    ),
  };
}

export function applyStateToChapter(
  chapter: Chapter,
  state: StoryState,
): Chapter {
  const updated: Chapter = { ...chapter, stateSnapshot: state };
  const issues = validateChapter(updated);
  if (issues.length > 0) {
    throw new Error(
      `Invalid state snapshot for chapter ${chapter.number}: ${issues.join("; ")}`,
    );
  }

  return updated;
}
