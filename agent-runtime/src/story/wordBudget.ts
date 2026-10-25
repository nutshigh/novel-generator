import { countWords } from "../domain/schemas.js";

const SENTENCE_BOUNDARIES = new Set([
  "。",
  "！",
  "？",
  "!",
  "?",
  "…",
  ".",
  "\n",
  "”",
  "’",
  '"',
  "'",
]);
const MIN_BOUNDARY_RATIO = 0.6;
const TRAILING_CLOSERS = new Set([
  "”",
  "’",
  '"',
  "'",
  "）",
  ")",
  "】",
  "]",
  "」",
  "』",
  "》",
  "〉",
]);

export interface ContinuationPlan {
  suggestedWords: number;
  isFinalRound: boolean;
  remaining: number;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function shouldContinue(targetWords: number, currentWords: number): boolean {
  const target = nonNegativeInteger(targetWords);
  return nonNegativeInteger(currentWords) < target * 0.9;
}

export function planContinuation(
  targetWords: number,
  currentWords: number,
  roundIndex: number,
  maxRounds = 2,
): ContinuationPlan {
  const target = nonNegativeInteger(targetWords);
  const current = nonNegativeInteger(currentWords);
  const remaining = Math.max(0, target - current);
  const totalRounds = Math.max(1, nonNegativeInteger(maxRounds));
  const index = nonNegativeInteger(roundIndex);

  if (remaining === 0) {
    return { suggestedWords: 0, isFinalRound: true, remaining };
  }

  const isFinalRound = index >= totalRounds - 1;
  const roundsLeft = Math.max(1, totalRounds - index);
  const suggestedWords = isFinalRound
    ? remaining
    : Math.ceil(remaining / roundsLeft);

  return { suggestedWords, isFinalRound, remaining };
}

function hardSliceAtWordLimit(characters: string[], limit: number): string {
  let words = 0;
  let end = 0;

  for (let index = 0; index < characters.length; index += 1) {
    if (!/\s/u.test(characters[index]!)) {
      words += 1;
    }

    if (words === limit) {
      end = index + 1;
    }

    if (words > limit) break;
  }

  return characters.slice(0, end).join("").trimEnd();
}

export function trimToWordLimit(text: string, maxWords: number): string {
  const limit = nonNegativeInteger(maxWords);
  if (limit === 0) return "";

  const leadingTrimmed = text.trimStart();
  if (countWords(leadingTrimmed) <= limit) {
    return leadingTrimmed;
  }

  const characters = Array.from(leadingTrimmed);
  let words = 0;
  let lastSentenceBoundary = -1;
  let boundaryWords = 0;

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (!/\s/u.test(character)) {
      words += 1;
    }

    if (SENTENCE_BOUNDARIES.has(character) && words <= limit) {
      lastSentenceBoundary = index;
      boundaryWords = words;
    }

    if (words > limit) break;
  }

  if (
    lastSentenceBoundary >= 0 &&
    boundaryWords >= limit * MIN_BOUNDARY_RATIO
  ) {
    let end = lastSentenceBoundary + 1;
    let absorbedClosers = 0;
    while (
      end < characters.length &&
      absorbedClosers < 4 &&
      TRAILING_CLOSERS.has(characters[end]!)
    ) {
      end += 1;
      absorbedClosers += 1;
    }

    return characters.slice(0, end).join("").trimEnd();
  }

  return hardSliceAtWordLimit(characters, limit);
}
