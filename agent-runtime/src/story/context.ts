import type {
  Character,
  ForeshadowLedgerEntry,
  ForeshadowState,
  OutlineChapter,
  Project,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";

export type ForeshadowContextEntry = ForeshadowLedgerEntry | ForeshadowState;

export interface ChapterContextInput {
  project: Project;
  bible: StoryBible;
  outlineChapter: OutlineChapter;
  nextOutlineChapter?: OutlineChapter;
  previousChapterText?: string;
  cast: Character[];
  state: StoryState;
  foreshadow: ForeshadowContextEntry[];
  targetWords: number;
  roundWords?: number;
  isFinalRound?: boolean;
  remainingWords?: number;
}

const RECENT_EVENT_LIMIT = 10;

function orNone(values: readonly string[]): string {
  return values.length > 0 ? values.join("、") : "（无）";
}

export function matchesCanonicalName(
  actualName: string,
  canonicalName: string,
): boolean {
  if (actualName === canonicalName) return true;
  if (Array.from(actualName).length < 2) return false;
  return canonicalName.includes(actualName);
}

export function findCanonicalName(
  actualName: string,
  canonicalNames: readonly string[],
): string | undefined {
  if (canonicalNames.includes(actualName)) return actualName;
  if (Array.from(actualName).length < 2) return undefined;

  const matches = canonicalNames.filter(
    (name) => name !== actualName && name.includes(actualName),
  );
  if (matches.length === 0) return undefined;

  matches.sort((left, right) => {
    const lengthDifference =
      Array.from(right).length - Array.from(left).length;
    if (lengthDifference !== 0) return lengthDifference;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return matches[0];
}

function isClosedForeshadow(entry: ForeshadowContextEntry): boolean {
  return entry.status === "resolved" || entry.status === "abandoned";
}

function isVisibleForeshadow(
  entry: ForeshadowContextEntry,
  currentChapter: number,
): boolean {
  if (isClosedForeshadow(entry)) return false;

  if ("setupChapter" in entry) {
    return entry.setupChapter <= currentChapter;
  }

  return entry.status === "open" || entry.status === "progressed";
}

function formatForeshadow(entry: ForeshadowContextEntry): string {
  if ("setupChapter" in entry) {
    return `- ${entry.title}｜setup=${entry.setupChapter}｜payoff=${entry.payoffChapter}｜status=${entry.status}`;
  }

  const note = entry.note ? `｜note=${entry.note}` : "";
  return `- ${entry.title}｜status=${entry.status}${note}`;
}

function formatEntityState(
  state: StoryState,
  castNames: ReadonlySet<string>,
): string {
  const entities = state.entities.filter((entity) =>
    castNames.has(entity.entityName),
  );
  if (entities.length === 0) return "- 实体：（无）";

  return entities
    .map((entity) => {
      const values = Object.entries(entity.state)
        .map(([key, value]) => `${key}=${value}`)
        .join("；");
      return `- ${entity.entityName}｜${values || "（无状态字段）"}｜更新于第${entity.updatedAtChapter}章`;
    })
    .join("\n");
}

function formatItemConceptState(
  bible: StoryBible,
  state: StoryState,
  protectedNames: ReadonlySet<string>,
): string {
  const names = Array.from(new Set([...bible.items, ...bible.concepts]));
  if (names.length === 0) return "- 物品/概念：（无）";

  const stateByName = new Map(
    state.entities.map((entity) => [entity.entityName, entity]),
  );

  return names
    .map((name) => {
      const exact = stateByName.get(name);
      const entity =
        exact && !protectedNames.has(exact.entityName)
          ? exact
          : state.entities.find(
              (candidate) =>
                !protectedNames.has(candidate.entityName) &&
                findCanonicalName(candidate.entityName, names) === name,
            );
      if (!entity) return `- ${name}｜状态：（无）`;
      const values = Object.entries(entity.state)
        .map(([key, value]) => `${key}=${value}`)
        .join("；");
      return `- ${name}｜${values || "（无状态字段）"}｜更新于第${entity.updatedAtChapter}章`;
    })
    .join("\n");
}

function formatRelationships(
  state: StoryState,
  castNames: ReadonlySet<string>,
): string {
  const relationships = state.relationships.filter(
    (relationship) =>
      castNames.has(relationship.source) && castNames.has(relationship.target),
  );
  if (relationships.length === 0) return "- 关系：（无）";

  return relationships
    .map(
      (relationship) =>
        `- ${relationship.source} → ${relationship.target}｜${relationship.kind}｜${relationship.description}`,
    )
    .join("\n");
}

function formatStateForeshadows(
  state: StoryState,
  currentChapter: number,
): string {
  const foreshadows = state.foreshadows.filter((entry) =>
    isVisibleForeshadow(entry, currentChapter),
  );
  if (foreshadows.length === 0) return "- 伏笔状态：（无）";

  return foreshadows
    .map((entry) => {
      const note = entry.note ? `｜note=${entry.note}` : "";
      return `- ${entry.title}｜status=${entry.status}${note}`;
    })
    .join("\n");
}

function formatEvents(state: StoryState, currentChapter: number): string {
  const events = state.events
    .filter((event) => event.chapterNumber <= currentChapter)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .slice(-RECENT_EVENT_LIMIT);
  if (events.length === 0) return "- 事件：（无）";

  return events
    .map((event) => `- 第${event.chapterNumber}章：${event.summary}`)
    .join("\n");
}

function formatCharacter(character: Character): string {
  return [
    `【角色：${character.name}】`,
    `定位：${character.role}`,
    `目标：${character.goal}`,
    `动机：${character.motivation}`,
    `创伤：${character.wound}`,
    `弧线：${character.arc}`,
    `声音：${character.voice}`,
    `秘密：${orNone(character.secrets)}`,
    `关系：${orNone(character.relationships)}`,
  ].join("\n");
}

export function selectCast(
  bible: StoryBible,
  chapter: OutlineChapter,
): Character[] {
  const charactersByName = new Map(
    bible.characters.map((character) => [character.name, character]),
  );
  const selected: Character[] = [];
  const seen = new Set<string>();

  for (const name of chapter.cast) {
    if (seen.has(name)) continue;
    const character = charactersByName.get(name);
    if (!character) {
      throw new Error(
        `Cast member "${name}" for chapter ${chapter.number} not found in story bible.`,
      );
    }
    seen.add(name);
    selected.push(character);
  }

  return selected;
}

export function previousTail(text: string, maxChars = 2000): string {
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (limit === 0) return "";

  const characters = Array.from(text);
  return characters.slice(Math.max(0, characters.length - limit)).join("");
}

export function buildChapterContext(input: ChapterContextInput): string {
  const {
    project,
    bible,
    outlineChapter,
    nextOutlineChapter,
    previousChapterText,
    cast,
    state,
    foreshadow,
    targetWords,
    roundWords,
  } = input;
  const style = bible.styleGuide;
  const allowedCast = new Set(outlineChapter.cast);
  const characterNames = new Set([
    ...bible.characters.map((character) => character.name),
    ...allowedCast,
  ]);
  const selectedCast = cast.filter((character) => allowedCast.has(character.name));
  const openForeshadows = foreshadow.filter((entry) =>
    isVisibleForeshadow(entry, outlineChapter.number),
  );
  const sections: string[] = [];

  sections.push(
    [
      `PREMISE=${project.premise}`,
      `LANGUAGE=${project.language}`,
      `CHAPTER_TARGET_WORDS=${targetWords}`,
      `ROUND_WORDS=${roundWords ?? targetWords}`,
      `CHAPTER_NUMBER=${outlineChapter.number}`,
    ].join("\n"),
  );

  sections.push(
    [
      "故事圣经摘要：",
      `- logline: ${bible.logline}`,
      `- synopsis: ${bible.synopsis}`,
      `- tone: ${bible.tone}`,
      `- themes: ${orNone(bible.themes)}`,
      `- world.rules: ${orNone(bible.world.rules)}`,
      `- world.powerSystem.levels: ${orNone(bible.world.powerSystem.levels)}`,
      `- world.powerSystem.costs: ${orNone(bible.world.powerSystem.costs)}`,
      `- world.powerSystem.limits: ${orNone(bible.world.powerSystem.limits)}`,
      `- world.factions: ${orNone(bible.world.factions)}`,
      `- world.taboos: ${orNone(bible.world.taboos)}`,
    ].join("\n"),
  );

  sections.push(
    [
      "风格指南：",
      `- pov: ${style.pov}`,
      `- tense: ${style.tense}`,
      `- sentenceRhythm: ${style.sentenceRhythm}`,
      `- dialogueRatio: ${style.dialogueRatio}`,
      `- descriptionDensity: ${style.descriptionDensity}`,
      `- bannedPhrases: ${orNone(style.bannedPhrases)}`,
      `- aiFlavorBlacklist: ${orNone(style.aiFlavorBlacklist)}`,
      `- webNovelPrinciples: ${orNone(style.webNovelPrinciples)}`,
    ].join("\n"),
  );

  sections.push(
    [
      "本章大纲：",
      `- title: ${outlineChapter.title}`,
      `- summary: ${outlineChapter.summary}`,
      `- pov: ${outlineChapter.pov}`,
      `- cast: ${orNone(outlineChapter.cast)}`,
      `- goal: ${outlineChapter.goal}`,
      `- conflict: ${outlineChapter.conflict}`,
      `- turn: ${outlineChapter.turn}`,
      `- reveal: ${outlineChapter.reveal}`,
      `- hook: ${outlineChapter.hook}`,
    ].join("\n"),
  );

  sections.push(
    nextOutlineChapter
      ? `下一章边界（只给摘要，不得在本章展开下一章事件）：\n${nextOutlineChapter.summary}`
      : "下一章边界：（无，本章为最后一章，必须在本章内收束）",
  );

  if (previousChapterText !== undefined && previousChapterText.length > 0) {
    sections.push(
      `上一章结尾（仅用于承接，不要复述）：\n${previousTail(previousChapterText)}`,
    );
  }

  sections.push(
    [
      "本章 cast（正文只能出现这些有名字的人物）：",
      selectedCast.length > 0
        ? selectedCast.map(formatCharacter).join("\n\n")
        : "（无）",
    ].join("\n"),
  );

  sections.push(
    [
      "当前连续性状态：",
      "实体：",
      formatEntityState(state, allowedCast),
      "关系：",
      formatRelationships(state, allowedCast),
      "伏笔状态：",
      formatStateForeshadows(state, outlineChapter.number),
      "最近事件：",
      formatEvents(state, outlineChapter.number),
    ].join("\n"),
  );

  sections.push(
    [
      "物品/概念状态：",
      formatItemConceptState(bible, state, characterNames),
    ].join("\n"),
  );

  sections.push(
    [
      "开放伏笔：",
      openForeshadows.length > 0
        ? openForeshadows.map(formatForeshadow).join("\n")
        : "- （无）",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
