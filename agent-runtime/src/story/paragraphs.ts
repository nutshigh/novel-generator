/** Paragraph-level text helpers used by seam smoothing. */

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function joinParagraphs(paragraphs: readonly string[]): string {
  return paragraphs.join("\n\n");
}

export function lastParagraphs(text: string, count: number): string {
  const paragraphs = splitParagraphs(text);
  if (count <= 0) return "";
  return joinParagraphs(paragraphs.slice(-count));
}

export function firstParagraphs(text: string, count: number): string {
  const paragraphs = splitParagraphs(text);
  if (count <= 0) return "";
  return joinParagraphs(paragraphs.slice(0, count));
}

/**
 * Replace the last `count` paragraphs. `count = 0` appends the replacement as
 * one or more new paragraphs.
 */
export function replaceLastParagraphs(
  text: string,
  replacement: string,
  count: number,
): string {
  const paragraphs = splitParagraphs(text);
  const added = splitParagraphs(replacement);
  if (added.length === 0) return text;
  if (count === 0) return joinParagraphs([...paragraphs, ...added]);
  if (count > paragraphs.length) {
    throw new Error(
      `Cannot replace ${count} tail paragraphs; chapter has ${paragraphs.length}.`,
    );
  }
  return joinParagraphs([
    ...paragraphs.slice(0, paragraphs.length - count),
    ...added,
  ]);
}

/**
 * Replace the first `count` paragraphs. `count = 0` prepends the replacement
 * as one or more new paragraphs.
 */
export function replaceFirstParagraphs(
  text: string,
  replacement: string,
  count: number,
): string {
  const paragraphs = splitParagraphs(text);
  const added = splitParagraphs(replacement);
  if (added.length === 0) return text;
  if (count === 0) return joinParagraphs([...added, ...paragraphs]);
  if (count > paragraphs.length) {
    throw new Error(
      `Cannot replace ${count} opening paragraphs; chapter has ${paragraphs.length}.`,
    );
  }
  return joinParagraphs([...added, ...paragraphs.slice(count)]);
}
