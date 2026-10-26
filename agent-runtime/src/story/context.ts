import type { ForeshadowRecord } from "../domain/foreshadowStore.js";
import type {
  Chapter,
  ChapterSummary,
  Character,
  ForeshadowLedgerEntry,
  ForeshadowState,
  Outline,
  OutlineChapter,
  Project,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";

export type ForeshadowContextEntry = ForeshadowLedgerEntry | ForeshadowState;

export interface ChapterSummaryBlock extends ChapterSummary {
  source: "chapter" | "outline";
}

export interface ChapterBriefBlock {
  chapterNumber: number;
  title: string;
  text: string;
  source: "chapter" | "digest" | "outline";
}

export interface ChapterContextInput {
  project: Project;
  bible: StoryBible;
  outlineChapter: OutlineChapter;
  nextOutlineChapter?: OutlineChapter;
  previousChapterText?: string;
  /** Previous chapters whose full text is injected, normally only the latest one. */
  recentChapters?: Chapter[];
  /** Per-chapter 2-3 sentence summaries for the recent window. */
  chapterBriefs?: ChapterBriefBlock[];
  /** Five-chapter rolling summaries covering chapters older than the brief window. */
  summaries?: ChapterSummaryBlock[];
  /** SQLite ledger records visible up to the current chapter. */
  foreshadowLedger?: ForeshadowRecord[];
  cast: Character[];
  state: StoryState;
  foreshadow: ForeshadowContextEntry[];
  targetWords: number;
  roundWords?: number;
  isFinalRound?: boolean;
  remainingWords?: number;
}

const RECENT_EVENT_LIMIT = 10;
const FULL_TEXT_CHAPTER_WINDOW = 1;
const CHAPTER_BRIEF_WINDOW = 8;
const ROLLING_SUMMARY_START_GAP = 10;

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

export function recentChaptersFor(
  chapters: readonly Chapter[],
  currentChapter: number,
  limit = FULL_TEXT_CHAPTER_WINDOW,
): Chapter[] {
  return [...chapters]
    .filter((chapter) => chapter.number < currentChapter)
    .sort((left, right) => left.number - right.number)
    .slice(-limit);
}

/**
 * Builds the per-chapter brief used in the recent chapter-summary window. New
 * chapters always have `brief`; legacy chapters fall back to their digest or
 * outline so older books still get a usable middle tier.
 */
export function chapterBriefFor(chapter: Chapter): ChapterBriefBlock | undefined {
  const brief = chapter.brief?.trim();
  if (brief) {
    return {
      chapterNumber: chapter.number,
      title: chapter.title,
      text: brief,
      source: "chapter",
    };
  }

  const nodes = (chapter.digest?.plotNodes ?? [])
    .map((node) => node.summary.trim())
    .filter((summary) => summary.length > 0)
    .slice(0, 3);
  const hook = chapter.outline.hook.trim();
  if (nodes.length > 0) {
    return {
      chapterNumber: chapter.number,
      title: chapter.title,
      text: [nodes.join("；"), hook ? `章末钩子：${hook}` : ""]
        .filter((part) => part.length > 0)
        .join("；"),
      source: "digest",
    };
  }

  const outlineSummary = chapter.outline.summary.trim();
  if (outlineSummary.length === 0) return undefined;
  return {
    chapterNumber: chapter.number,
    title: chapter.title,
    text: outlineSummary,
    source: "outline",
  };
}

/**
 * Selects per-chapter briefs for chapters N-2 through N-9. The full text of
 * N-1 is already injected separately.
 */
export function selectChapterBriefBlocks(
  chapters: readonly Chapter[],
  currentChapter: number,
): ChapterBriefBlock[] {
  const fromChapter = Math.max(
    1,
    currentChapter - (FULL_TEXT_CHAPTER_WINDOW + CHAPTER_BRIEF_WINDOW),
  );
  const toChapter = currentChapter - (FULL_TEXT_CHAPTER_WINDOW + 1);

  return [...chapters]
    .filter(
      (chapter) =>
        chapter.number >= fromChapter &&
        chapter.number <= toChapter &&
        chapter.text.trim().length > 0,
    )
    .sort((left, right) => left.number - right.number)
    .flatMap((chapter) => {
      const block = chapterBriefFor(chapter);
      return block === undefined ? [] : [block];
    });
}

function outlineChapters(outline: Outline): OutlineChapter[] {
  return outline.volumes.flatMap((volume) =>
    volume.stages.flatMap((stage) => stage.chapters),
  );
}

function outlineFallbackSummary(
  outline: Outline,
  fromChapter: number,
  toChapter: number,
): string {
  return outlineChapters(outline)
    .filter(
      (chapter) =>
        chapter.number >= fromChapter && chapter.number <= toChapter,
    )
    .map((chapter) => `第${chapter.number}章：${chapter.summary}`)
    .join("；");
}

/**
 * Selects the rolling summary blocks injected before chapter N. Chapters N-2
 * through N-9 use per-chapter briefs, so rolling summaries start at N-14 and
 * cover five chapters each: [N-14, N-10], [N-19, N-15], [N-24, N-20], ...
 * The stored summary lives on the block's last chapter (N-10, N-15, ...).
 * When a legacy chapter has no stored summary, the outline summary is used.
 */
export function selectRollingSummaryBlocks(
  chapters: readonly Chapter[],
  outline: Outline | undefined,
  currentChapter: number,
): ChapterSummaryBlock[] {
  const byNumber = new Map(chapters.map((chapter) => [chapter.number, chapter]));
  const blocks: ChapterSummaryBlock[] = [];

  for (
    let anchor = currentChapter - ROLLING_SUMMARY_START_GAP;
    anchor >= 1;
    anchor -= 5
  ) {
    const fromChapter = Math.max(1, anchor - 4);
    const stored = byNumber.get(anchor)?.summary;
    if (stored) {
      blocks.push({ ...stored, source: "chapter" });
      continue;
    }

    if (!outline) continue;
    const text = outlineFallbackSummary(outline, fromChapter, anchor);
    if (text.length === 0) continue;
    blocks.push({
      fromChapter,
      toChapter: anchor,
      text,
      source: "outline",
    });
  }

  return blocks.sort((left, right) => left.fromChapter - right.fromChapter);
}

export function chapterHeading(chapter: {
  number: number;
  title: string;
}): string {
  return /^第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*章/u.test(
    chapter.title,
  )
    ? chapter.title
    : `第${chapter.number}章 ${chapter.title}`;
}

function formatRecentChapters(chapters: readonly Chapter[]): string {
  if (chapters.length === 0) return "上一章全文：（无）";

  const range =
    chapters.length === 1
      ? `第${chapters[0]!.number}章`
      : `第${chapters[0]!.number}-${chapters[chapters.length - 1]!.number}章`;

  return [
    `上一章全文（${range}，按时间顺序，仅用于承接，不要复述）：`,
    ...chapters.map(
      (chapter) => `【${chapterHeading(chapter)}】\n${chapter.text}`,
    ),
  ].join("\n\n");
}

function formatChapterBriefs(blocks: readonly ChapterBriefBlock[]): string {
  if (blocks.length === 0) return "逐章摘要：（无）";

  const first = blocks[0]!;
  const last = blocks[blocks.length - 1]!;
  return [
    `逐章摘要（第${first.chapterNumber}-${last.chapterNumber}章，每章 2–3 句，按时间顺序；先用它判断事件和因果，需要更多细节时用 story_recall 展开，再用 chapter_read 核对原文）：`,
    ...blocks.map((block) => {
      const source =
        block.source === "digest"
          ? "（据章节档案整理）"
          : block.source === "outline"
            ? "（大纲回退）"
            : "";
      return `- ${chapterHeading({
        number: block.chapterNumber,
        title: block.title,
      })}${source}：${block.text}`;
    }),
  ].join("\n");
}

function formatSummaryBlocks(blocks: readonly ChapterSummaryBlock[]): string {
  if (blocks.length === 0) return "更早章节滚动摘要：（无）";

  const range = `${blocks[0]!.fromChapter}-${blocks[blocks.length - 1]!.toChapter}`;

  return [
    `更早章节滚动摘要（第${range}章，每 5 章一块，按时间顺序；先用它定位时间段，再通过逐章摘要和原文逐层核对，不要用滚动摘要补写具体细节）：`,
    ...blocks.map(
      (block) =>
        `${block.fromChapter}-${block.toChapter}章滚动摘要：${block.text}`,
    ),
  ].join("\n");
}

function formatForeshadowLedger(
  records: readonly ForeshadowRecord[],
  currentChapter: number,
): string {
  const visible = records.filter(
    (record) =>
      record.setupChapter <= currentChapter &&
      (record.resolvedChapter === undefined ||
        record.resolvedChapter <= currentChapter),
  );
  const resolved = visible.filter((record) => record.status === "resolved");
  const unresolved = visible.filter((record) => record.status !== "resolved");

  const formatResolved = (record: ForeshadowRecord): string =>
    `- ${record.title}｜设置=第${record.setupChapter}章｜回收=第${
      record.resolvedChapter ?? "?"
    }章｜status=${record.status}${record.note ? `｜note=${record.note}` : ""}`;

  const formatUnresolved = (record: ForeshadowRecord): string =>
    `- ${record.title}｜设置=第${record.setupChapter}章｜计划回收=${
      record.plannedPayoffChapter === undefined
        ? "未定"
        : `第${record.plannedPayoffChapter}章`
    }｜status=${record.status}${record.note ? `｜note=${record.note}` : ""}`;

  return [
    "已回收伏笔：",
    resolved.length > 0 ? resolved.map(formatResolved).join("\n") : "- （无）",
    "未回收伏笔（需要伏笔原文或历史进展时，用 story_digest 查看设置章节，必要时 chapter_read 读原文）：",
    unresolved.length > 0
      ? unresolved.map(formatUnresolved).join("\n")
      : "- （无）",
  ].join("\n");
}

export function buildChapterContext(input: ChapterContextInput): string {
  const {
    project,
    bible,
    outlineChapter,
    nextOutlineChapter,
    previousChapterText,
    recentChapters,
    chapterBriefs,
    summaries,
    foreshadowLedger,
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

  if (recentChapters !== undefined && recentChapters.length > 0) {
    sections.push(formatRecentChapters(recentChapters));
  } else if (
    previousChapterText !== undefined &&
    previousChapterText.length > 0
  ) {
    sections.push(
      `上一章全文（仅用于承接，不要复述）：\n${previousChapterText}`,
    );
  }

  if (chapterBriefs !== undefined && chapterBriefs.length > 0) {
    sections.push(formatChapterBriefs(chapterBriefs));
  }
  if (summaries !== undefined && summaries.length > 0) {
    sections.push(formatSummaryBlocks(summaries));
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
      foreshadowLedger !== undefined
        ? "- 见下方伏笔账本"
        : formatStateForeshadows(state, outlineChapter.number),
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
    foreshadowLedger !== undefined
      ? formatForeshadowLedger(foreshadowLedger, outlineChapter.number)
      : [
          "开放伏笔：",
          openForeshadows.length > 0
            ? openForeshadows.map(formatForeshadow).join("\n")
            : "- （无）",
        ].join("\n"),
  );

  return sections.join("\n\n");
}
