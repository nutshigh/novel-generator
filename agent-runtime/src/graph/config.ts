export interface Neo4jConfig {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  reason?: string;
}

export function loadNeo4jConfig(
  env: NodeJS.ProcessEnv = process.env,
): Neo4jConfig {
  const uri = env.NOVELBUILDER_NEO4J_URI?.trim() || "bolt://127.0.0.1:7687";
  const user = env.NOVELBUILDER_NEO4J_USER?.trim() || "neo4j";
  const password = env.NOVELBUILDER_NEO4J_PASSWORD?.trim() || "";
  const disabled = env.NOVELBUILDER_NEO4J_DISABLED?.trim() === "1";

  if (disabled) {
    return {
      enabled: false,
      uri,
      user,
      password,
      reason: "NOVELBUILDER_NEO4J_DISABLED=1",
    };
  }

  if (!password) {
    return {
      enabled: false,
      uri,
      user,
      password,
      reason: "NOVELBUILDER_NEO4J_PASSWORD is not set",
    };
  }

  return { enabled: true, uri, user, password };
}
