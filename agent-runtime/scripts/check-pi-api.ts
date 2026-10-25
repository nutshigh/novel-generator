import * as pi from "@earendil-works/pi-coding-agent";

const required = [
  "createAgentSession",
  "defineTool",
  "DefaultResourceLoader",
  "ModelRuntime",
  "SessionManager",
  "SettingsManager",
] as const;

for (const name of required) {
  if (!(name in pi)) {
    throw new Error(`Missing Pi SDK export: ${name}`);
  }
}

console.log(`Pi SDK exports OK: ${required.join(", ")}`);
