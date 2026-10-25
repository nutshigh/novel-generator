import { loadConfig } from "./config.js";
import { normalizePiEvent, type PiEventLike } from "./events.js";
import { createNovelAgentSession } from "./runtime.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const premise =
  args.filter((arg) => arg !== "--dry-run").join(" ").trim() ||
  "写一个少年剑修在旧王朝崩塌后重建秩序的故事";

const config = loadConfig();
const agent = await createNovelAgentSession(config);

try {
  agent.session.subscribe((event) => {
    const normalized = normalizePiEvent(event as PiEventLike);
    if (!normalized) return;
    if (normalized.type === "agent.delta") {
      process.stdout.write(normalized.text);
    }
    if (normalized.type === "tool.start") {
      process.stderr.write(`\n[tool] ${normalized.toolName}\n`);
    }
  });

  if (dryRun) {
    console.log("dry-run ok");
    console.log(`model: ${config.provider}/${config.modelId}`);
    console.log(`tools: ${agent.session.getActiveToolNames().join(", ")}`);
  } else {
    await agent.session.prompt(premise);
    process.stdout.write("\n");
  }
} finally {
  agent.dispose();
}
