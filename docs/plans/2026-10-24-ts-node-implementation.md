# TS + Node 实施规格（Revision 2）

> 本文件覆盖主规划中 Python Story Engine 的部分。新系统全部使用 TypeScript + Node 24；AI 能力全部走 Pi Agent SDK；不再引入 Python 服务。

## 0. 目标

一句话 -> 故事圣经 -> 大纲 -> 逐章正文 -> 审核/状态更新 -> 导出，默认全自动。用户只需输入一句话，可选高级参数。

## 1. 技术栈

- Node >= 22.19，TypeScript 5.9，ESM/NodeNext
- Pi SDK：`@earendil-works/pi-coding-agent@1.4.0`、`@earendil-works/pi-ai@1.4.0`
- 校验：Zod 3.25.76
- 测试：Vitest 4.1.9
- 存储：本地 JSON 文件（原子写）；后续可换 SQLite，不影响接口
- HTTP/SSE：Node 内置 `node:http`，不引入 Web 框架
- UI：单页 HTML + 原生 JS，由 Node 服务直接提供

## 2. 目录

```
agent-runtime/
  src/
    domain/
      schemas.ts        # Zod schemas + 类型
      store.ts          # ProjectStore: JSON / InMemory
    ai/
      gateway.ts        # AiGateway 接口 + GenerateRequest
      piGateway.ts      # Pi ModelRuntime.completeSimple 实现
      fakeGateway.ts    # 无 key 的确定性实现（demo/测试）
      json.ts           # 从模型输出提取/校验 JSON
    prompts/
      loader.ts
      *.md              # 从 NovelBuilder 迁移/改写的提示词
    story/
      bible.ts
      outline.ts
      context.ts
      wordBudget.ts
      chapter.ts
      review.ts
      state.ts
      pipeline.ts
      export.ts
    server.ts
    cli.ts
  test/
```

## 3. 领域模型（Zod）

- `Project`: id, premise, language, targetWords, chapterWords, maxChapters, status, createdAt
- `StoryBible`: logline, synopsis, genre, audience, themes, tone, pov, tense, ending, world, characters, items, concepts, styleGuide, foreshadowLedger, assumptions
- `Outline`: volumes[] { number, title, summary, stages[] { number, title, summary, chapters[] { number, title, summary, pov, cast, goal, conflict, turn, reveal, hook, targetWords } } }
- `Chapter`: number, title, outline, text, wordCount, status, review, stateSnapshot
- `Review`: gate `pass|revise|block`, summary, issues[] {severity,type,quote,problem,fix}
- `EntityState`: entityName, state, updatedAtChapter
- `StoryState`: entities[], relationships[], foreshadows[], events[]
- `RunProgress`: phase, message, chapterNumber?, wordCount?, gate?, error?

Validation rules:

- Outline chapter numbers contiguous.
- Every chapter has goal/conflict/turn.
- Cast names must exist in bible characters (case-sensitive exact; for MVP).
- Chapter targetWords > 0.
- Review gate is one of the three values.

## 4. AiGateway

```ts
export type GenerateKind = "bible" | "outline" | "chapter" | "review" | "state" | "revise";

export interface GenerateRequest {
  kind: GenerateKind;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiGateway {
  generateText(req: GenerateRequest): Promise<string>;
}
```

- `PiAiGateway`: `ModelRuntime.create({ authPath, modelsPath, refreshOnCreate: false })`; `getModel`; `completeSimple(model, { systemPrompt, messages:[{role:"user",content,timestamp}] }, { temperature, maxTokens, signal })`; join text blocks.
- `FakeAiGateway`: deterministic; switch on `kind`; returns valid JSON/text for tests/demo. `chapter` returns Chinese prose of approximately `targetWords` length (request maxTokens can be used as a hint; or embed `targetWords` in user prompt and parse). To keep it deterministic, `FakeAiGateway` extracts a `TARGET_WORDS=<n>` marker from the user prompt.
- All model calls must go through `AiGateway`; no direct provider calls.

## 5. Pipeline

1. `generateBible(project, ai, prompts)`: one structured call; parse/validate; retry once with validation error appended.
2. `generateOutline(project, bible, ai, prompts)`: one structured call for `maxChapters` (default 12); validate; retry once.
3. For each chapter:
   - `buildContext`: bible summary + previous chapter tail (max 2000 chars) + current outline + next outline summary + cast state + style guide + target words.
   - `writeChapter`: `TARGET_WORDS=n`; call `chapter`; if too short and word budget mode `budgeted`, continue up to 2 rounds; trim to ~1.3x at sentence boundary.
   - `reviewChapter`: call `review`; parse; if `revise`, one revision then re-review; keep best.
   - `extractState`: call `state`; parse; merge; ignore invalid deltas with warning.
   - Save chapter; emit progress.
4. `assembleBook`: join chapters; add title/synopsis; write `book.md` and `book.txt`.
5. `runPipeline` returns project + artifacts and emits `RunProgress`.

Default demo-safe params: `maxChapters=6`, `chapterWords=800`, `targetWords=4800`, `wordControl="prompt_only"` for fake/real MVP. The plan can later scale to 200k.

## 6. CLI

- `npm run generate -- "一句话"` -> real Pi gateway, writes `output/<projectId>/`.
- `npm run generate -- "一句话" --fake --chapters 6 --words 800` -> fake demo, no API key.
- `npm run serve` -> http://127.0.0.1:8787.
- `npm run smoke -- --dry-run` remains Phase 0 Pi check.

## 7. HTTP API

- `GET /` -> UI
- `POST /api/projects` body `{premise, fake?, maxChapters?, chapterWords?}` -> `{projectId, runId}`
- `GET /api/runs/:runId/events` -> SSE
- `GET /api/projects/:projectId` -> project JSON
- `GET /api/projects/:projectId/manuscript` -> `text/markdown`
- `GET /api/health` -> `{ok:true}`

## 8. 测试

- Schemas: valid/invalid outline, review gate, cast.
- Store: JSON round-trip, atomic write, in-memory.
- Prompt loader: variable substitution.
- JSON extraction: fences, leading prose, invalid JSON.
- Word budget/trim.
- Context: includes cast/next outline/previous tail, excludes non-cast.
- Pipeline with FakeAiGateway: bible -> outline -> chapters -> review -> state -> export; assert chapter count, words, file content.
- CLI fake run: spawn `src/cli.ts --fake` with temp dir; assert output files.
- Server: `node:http` integration with fake pipeline; health + generate + SSE maybe.
- Pi gateway: dry-run session creation already covered; no paid calls in tests.

## 9. 非目标

- 不做卡片、schema studio、工作流编辑器、Neo4j。
- 不在第一版做复杂多 POV/拆书 UI。
- 不在测试中使用真实模型或消耗 token。

## 10. 完成标准

- `npm test` 全绿。
- `npm run typecheck` 全绿。
- `npm run generate -- "一句话" --fake` 生成故事圣经、大纲、6 章正文、审核/状态和 `book.md`/`book.txt`。
- `npm run serve` 打开后可用一句话启动 fake/real 生成并看到 SSE 进度。
- 所有 AI 调用经过 `AiGateway`；真实实现是 `PiAiGateway`。
- 所有运行时数据在 `F:\project\novel-generator` 下；npm cache/tmp 在 F 盘。
