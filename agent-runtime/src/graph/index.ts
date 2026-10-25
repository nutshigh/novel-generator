import { loadNeo4jConfig } from "./config.js";
import { DisabledNovelGraph } from "./disabled.js";
import { Neo4jNovelGraph } from "./neo4j.js";
import type { NovelGraphStore } from "./types.js";

export function createNovelGraph(
  env: NodeJS.ProcessEnv = process.env,
): NovelGraphStore {
  const config = loadNeo4jConfig(env);
  if (!config.enabled) {
    return new DisabledNovelGraph(config.reason ?? "Neo4j is disabled");
  }
  return new Neo4jNovelGraph(config);
}

export { Neo4jNovelGraph } from "./neo4j.js";
export { MemoryNovelGraph } from "./memory.js";
export { DisabledNovelGraph } from "./disabled.js";
export { buildBookGraph, buildChapterGraph } from "./build.js";
export type * from "./types.js";
