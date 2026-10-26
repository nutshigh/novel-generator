import { resolve, join } from "node:path";
import {
  createEnvDirectorModelHandle,
  createPiDirectorSessionFactory,
} from "./agent/directorSession.js";
import { FakeAiGateway } from "./ai/fakeGateway.js";
import type { AiGateway } from "./ai/gateway.js";
import { loadConfig } from "./config.js";
import type { RunProgress } from "./domain/schemas.js";
import { JsonProjectStore } from "./domain/store.js";
import { runNovelPipeline } from "./story/pipeline.js";
import { createProject } from "./story/project.js";

interface GenerateOptions {
  premise: string;
  fake: boolean;
  chapters?: number;
  words?: number;
  review: boolean;
  outDir: string;
}

interface OptionValue {
  value: string;
  nextIndex: number;
}

function positiveInteger(flag: string, value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function readOptionValue(
  argv: string[],
  index: number,
  arg: string,
  name: string,
): OptionValue {
  if (arg === name) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}.`);
    }
    return { value, nextIndex: index + 1 };
  }

  return { value: arg.slice(name.length + 1), nextIndex: index };
}

function parseArgs(argv: string[]): GenerateOptions {
  const premiseParts: string[] = [];
  let fake = false;
  let chapters: number | undefined;
  let words: number | undefined;
  let review = false;
  let outDir = "output";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--fake") {
      fake = true;
      continue;
    }

    if (arg === "--review") {
      review = true;
      continue;
    }

    if (arg === "--chapters" || arg.startsWith("--chapters=")) {
      const option = readOptionValue(argv, index, arg, "--chapters");
      chapters = positiveInteger("--chapters", option.value);
      index = option.nextIndex;
      continue;
    }

    if (arg === "--words" || arg.startsWith("--words=")) {
      const option = readOptionValue(argv, index, arg, "--words");
      words = positiveInteger("--words", option.value);
      index = option.nextIndex;
      continue;
    }

    if (arg === "--out" || arg.startsWith("--out=")) {
      const option = readOptionValue(argv, index, arg, "--out");
      if (option.value.trim().length === 0) {
        throw new Error("Missing value for --out.");
      }
      outDir = option.value;
      index = option.nextIndex;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    premiseParts.push(arg);
  }

  const premise = premiseParts.join(" ").trim();
  if (premise.length === 0) {
    throw new Error(
      'A premise is required. Usage: npm run generate -- "一句话" [--fake] [--review] [--chapters N] [--words N] [--out DIR]',
    );
  }

  return { premise, fake, chapters, words, review, outDir };
}

async function createGateway(fake: boolean): Promise<AiGateway> {
  if (fake || process.env.NOVELBUILDER_FAKE === "1") {
    return new FakeAiGateway();
  }

  const { createPiGateway } = await import("./ai/piGateway.js");
  return createPiGateway(loadConfig());
}

function progressLine(event: RunProgress): string {
  if (
    event.phase === "chapter" &&
    event.chapterNumber !== undefined &&
    event.wordCount !== undefined &&
    event.gate !== undefined
  ) {
    return `[chapter ${event.chapterNumber}] ${event.wordCount} words ${event.gate}`;
  }

  const suffix =
    event.chapterNumber === undefined ? "" : ` ${event.chapterNumber}`;
  const error = event.error === undefined ? "" : ` (${event.error})`;
  return `[${event.phase}${suffix}] ${event.message}${error}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const project = createProject({
    premise: options.premise,
    reviewEnabled: options.review,
    ...(options.chapters === undefined ? {} : { maxChapters: options.chapters }),
    ...(options.words === undefined ? {} : { chapterWords: options.words }),
  });
  const outRoot = resolve(options.outDir);
  const store = new JsonProjectStore(outRoot);
  const savedProject = await store.createProject(project);
  const ai = await createGateway(options.fake);
  const directorSessionFactory =
    options.fake || process.env.NOVELBUILDER_FAKE === "1"
      ? undefined
      : createPiDirectorSessionFactory(createEnvDirectorModelHandle().config);

  const result = await runNovelPipeline({
    project: savedProject,
    ai,
    store,
    ...(directorSessionFactory === undefined
      ? {}
      : { directorSessionFactory }),
    onProgress: (event) => {
      process.stderr.write(`${progressLine(event)}\n`);
    },
  });

  const projectDir = join(outRoot, result.project.id);
  process.stdout.write(`output: ${projectDir}\n`);
  process.stdout.write(`manuscript: ${join(projectDir, "book.md")}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
