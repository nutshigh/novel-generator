import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
);
const cache = new Map<string, string>();

function stripFrontmatter(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) return text.trim();

  const end = text.indexOf("\n---", 3);
  if (end === -1) return text.trim();

  return text.slice(end + 4).trim();
}

/** Reads a skill body from `skills/<name>/SKILL.md`, without its frontmatter. */
export function loadSkill(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const raw = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
  const body = stripFrontmatter(raw);
  cache.set(name, body);
  return body;
}
