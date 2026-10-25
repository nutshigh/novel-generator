import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const tempRoot = resolve(process.cwd(), "..", ".cache", "tmp");

export function createTempDir(prefix: string): string {
  mkdirSync(tempRoot, { recursive: true });
  return mkdtempSync(join(tempRoot, prefix));
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
