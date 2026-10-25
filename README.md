# NovelBuilder Next

一句话生成一部长篇小说的 TypeScript + Node 重构版。所有 AI 调用统一走 Pi Agent SDK；不再使用 Python 服务，也不再使用卡片/工作流编辑器。

## 当前状态

- Phase 0（Pi SDK 验证）已完成，真实模型 smoke 因没有 API Key 暂未执行。
- Phase 1A/1B（领域模型、存储、AI 网关、故事圣经、大纲）已完成。
- Phase 2A/2B（上下文、字数控制、章节写作、审核、状态、编排、导出、CLI）已完成。
- Phase 3（Web UI + SSE）已完成。
- Phase 4A（简化 Web UI、页面内模型配置、OpenAI 兼容 / Anthropic 协议）已完成。
- Phase 5（书架、目录展开、章节阅读、分批续写、扩展新章节）已完成。
- Phase 6（Neo4j 知识图谱：人物关系时间线、事件关联、情节线/伏笔图、写作上下文检索、Cytoscape 图谱 Tab）已完成。
- `npm test`：30 个测试文件，331 个测试全部通过。
- `npm run typecheck`：通过。
- 未消耗真实模型 token；所有测试使用 Fake/Blocking gateway。

## 快速开始

### Web UI

服务默认监听：

```text
http://127.0.0.1:8787
```

检查 8787 是否已有服务在监听：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen
```

重新启动：

```powershell
cd F:\project\novel-generator\agent-runtime
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ }
npm run serve
```

页面里默认选中“演示模式”，不需要 API Key；输入一句话后点击“开始生成”，只会生成故事圣经和章节大纲。之后到书架里决定本次写多少章、从第几章开始写。

#### 实时进度与运行记录

生成任务现在会持续推送细粒度进度，不再只有“开始/结束”两条事件：

- 阶段事件：排队、故事圣经、章节大纲、写作、审校、修订、状态提取、图谱同步、整理手稿、完成/失败。
- 每个事件带服务器时间戳；完成的步骤带耗时（如“故事圣经已生成，用时 82.4 秒”）。
- 运行概览显示“最后更新 x 秒前”；长时间没有新事件时会提示模型仍在处理，已用时继续计时。
- 页面刷新会自动查找仍在运行的任务并重新连接，回放已有事件后继续实时接收。
- 书架里每本书新增“运行记录”按钮，可随时回看最近一次任务的完整事件、耗时和失败原因。
- 运行记录持久化到 `.agent/runs/<runId>.json`；服务重启时，上次仍为 `running` 的任务会被标记为失败，并给出中断原因。
- 可通过 `GET /api/runs?status=running` 查看运行中的任务，`GET /api/runs/<runId>` 查看完整事件记录；`GET /api/runs/<runId>/events` 仍是 SSE 流。

#### 先从大纲开始，再到书架分批写作

“开始生成”不再自动写完整本书，工作流拆成两步：

1. **创作页**：输入故事前提，点击“开始生成” → 生成故事圣经与分卷/阶段/章节大纲。完成后显示大纲预览和“去书架开始写作”。
2. **书架**：找到刚生成的书，展开目录，选择“继续写作”或某一章的“从此章续写”，在弹窗里填写**本次写作章数**。

写作批次的行为：

- 默认从第一个没有正文的章节开始；也可以在目录里指定起始章。
- 本次只写用户填写的章数，写完后项目回到书架，状态显示“写作中 x/y”，可以下次继续。
- 如果所选范围里已有正文，确认框会提示哪些章节会被覆盖。
- 当前大纲全部写完后，项目状态变为“已完成”；点“续写新章节”可以追加 1–20 章新大纲，并选择本次先写其中的几章。
- 中断后已写章节会保留；单本累计章节数不设上限。

#### Neo4j 知识图谱

连续性和人物/情节关系现在写入 Neo4j，不再只依赖平面 `StoryState`：

- 节点：书、章节、人物、阵营、地点、物品、概念、事件、情节线/伏笔。
- 关系边：人物关系（带起止章节和证据章节）、人物出场、事件参与、事件发生章节、地点关联、伏笔设置/回收/推进、章节顺序、阵营归属。
- 关系变化不会覆盖旧值：旧边会标记结束章节，新边从当前章节开始，因此可以查询人物关系时间线。
- 每章写作前，从图数据库查询本章 cast 相关的 1 跳关系、相关旧事件、未回收线索，注入写作上下文。
- 每章写完后增量写入图谱；从书架续写或重写时，会先按当前章节文件重建该书图谱，并过滤掉当前章及未来章节的事实，避免“未来剧情泄漏”。
- 书架里每本书增加“图谱”入口，点击后切到顶部“图谱” Tab，用 Cytoscape.js 渲染可缩放、可拖拽的节点—关系画布。
- 图谱页支持：
  - 左侧切换书籍、按节点类型筛选、搜索节点、切换布局
  - 章节范围滑块，只看第 1–N 章的事实
  - “显示历史关系”（已结束关系用虚线）
  - “显示章节节点”
  - 点击节点查看属性和关联边；点击关系边查看说明、起止章节和证据章节
- Cytoscape.js 作为本地依赖从 `/vendor/cytoscape.min.js` 提供，不依赖 CDN。

配置在 `agent-runtime/.env`：

```text
NOVELBUILDER_NEO4J_URI=bolt://127.0.0.1:7687
NOVELBUILDER_NEO4J_USER=neo4j
NOVELBUILDER_NEO4J_PASSWORD=<你的密码>
# NOVELBUILDER_NEO4J_DISABLED=1
```

当前实现使用已有的 `neo4j` Docker 容器，但所有节点使用 `NovelNode` 标签、关系使用 `NOVEL_REL` 类型，并带 `bookId` 隔离；不会和同一数据库里的其他项目数据混在一起。Neo4j 不可用时，生成会继续使用原有平面状态，并在事件流提示图谱同步失败。

#### 页面内模型设置

切换到“真实模型”后，可以直接在页面填写本次运行的模型配置：

- **API 协议**：OpenAI 兼容（`openai-completions`）或 Anthropic（`anthropic-messages`）
- **模型名称**
- **Base URL**
- **API Key**（可选）

API Key 留空只适用于不需要鉴权的端点；需要鉴权的服务必须填写。填写页面模型配置时，留空的 API Key 不会从 `.env` 借用；只有模型字段全部留空时，才会整体使用 `.env` 默认配置。

API Key 只随本次请求发送，仅用于当前运行；不会写入浏览器存储、项目文件或运行日志。协议、模型名称和 Base URL 会保存在浏览器 `localStorage` 中，方便下次填写。

三项配置（协议、模型名称、Base URL）要么全部填写，要么全部留空：

- 全部留空：使用服务器 `.env` 中的默认模型配置。
- 只填写一部分：页面会提示错误，不会提交请求。

示例：

```text
OpenAI 兼容
协议:      OpenAI 兼容
模型名称:  deepseek-chat
Base URL:  https://api.deepseek.com/v1
API Key:   <你的 key；该端点无需鉴权时可留空>

Anthropic
协议:      Anthropic
模型名称:  claude-sonnet-4-5
Base URL:  https://api.anthropic.com
API Key:   <你的 key；该端点无需鉴权时可留空>
```

停止占用 8787 的服务：

```powershell
Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ }
```

### CLI（演示模式）

```powershell
cd F:\project\novel-generator\agent-runtime
npm run generate -- "一个少年在旧城废墟中意外唤醒沉睡的龙脉，被迫卷入王朝最后的权力游戏" --fake --chapters 6 --words 800 --out F:\project\novel-generator\demo
```

演示输出已生成在：

```text
F:\project\novel-generator\demo\27e23f11-51a3-4d67-9544-2a29cf95a28f\
```

包含：

- `book.md` / `book.txt`：成书
- `bible.json`：故事圣经
- `outline.json`：分卷/阶段/章节大纲
- `chapter-001.json` ... `chapter-006.json`：章节版本
- `chapters.json`：全部章节
- `state.json`：最终连续性状态
- `project.json`：项目元数据

### 真实 Pi 模式

1. 准备模型配置：

```powershell
cd F:\project\novel-generator\agent-runtime
Copy-Item agent\models.example.json .agent\models.json
Copy-Item .env.example .env
```

2. 编辑 `.env`：

```text
NOVELBUILDER_PROVIDER=novelbuilder
NOVELBUILDER_MODEL=deepseek-chat
NOVELBUILDER_API_KEY=<你的 key>
```

3. 运行（CLI 去掉 `--fake`；网页切换到“真实模型”）：

```powershell
npm run generate -- "一句话" --chapters 6 --words 800
```

网页里切换“真实模型”后，可以填写页面内的协议、模型名称、Base URL 和 API Key；也可以把这些字段全部留空，直接使用上面的 `.env` 默认配置。

说明：`.agent/models.json` 和网页内配置都支持 OpenAI 兼容端点（DeepSeek、Qwen、Moonshot、Ollama 等），网页内还支持 Anthropic 协议。真实模型 smoke 未执行，因为当前没有 API Key；接入后建议先用 1 章/300 字验证。

## 架构

```text
agent-runtime/
  src/
    domain/       Zod 模型、ProjectStore（Memory/JSON）
    ai/           AiGateway、PiAiGateway、FakeAiGateway、JSON 提取
    prompts/      系统提示词、用户提示词、契约
    story/        圣经、大纲、上下文、字数预算、章节、审核、状态、编排、导出
                  书架聚合（library）、续写（continuation）、大纲扩展（outlineExtension）
    graph/        Neo4j 知识图谱：建模、增量索引、子图检索、摘要
    ui.ts         单页 Web UI（创作 + 书架 + 图谱）
    server.ts     node:http + SSE
    generate.ts   一句话 CLI
    cli.ts        Phase 0 Pi SDK smoke CLI
```

关键设计：

- **Snowflake 式逐层展开**：一句话 → 故事圣经 → 大纲 → 章节。
- **上下文编译器**：每章只注入 cast、当前/下一章大纲、上一章尾部、风格指南、状态/伏笔；不把整本书塞进 prompt。
- **知识图谱**：Neo4j 保存人物关系时间线、事件参与、地点、物品、伏笔/情节线；写作前按 cast 取子图，写完增量更新，重写时先重建并排除当前/未来章节事实。
- **字数控制**：`CHAPTER_TARGET_WORDS` 与 `ROUND_WORDS` 分离；不足自动续写，超出按句边界裁剪；仍不足标记 `needs_attention`。
- **审核门禁**：`pass/revise/block`；revise 最多一轮，保留评分更高的版本。
- **连续性状态**：每章提取状态增量，合并实体/关系/伏笔；非法增量过滤并警告，不拖垮整本书。
- **可恢复/可中止**：Pipeline 保存 `running/completed/failed`，AbortSignal 贯穿所有 AI 调用。
- **AI 底座唯一入口**：所有模型调用经 `AiGateway`；真实实现为 `PiAiGateway`（Pi `ModelRuntime.completeSimple`），未来换底层只改这一层。

## 数据与磁盘

- 项目根目录：`F:\project\novel-generator`
- 依赖：`agent-runtime\node_modules`
- npm cache：`F:\project\novel-generator\.cache\npm`
- 临时目录：`F:\project\novel-generator\.cache\tmp`
- Pi auth/models/sessions：`agent-runtime\.agent`
- 知识图谱：本机 Neo4j（`bolt://127.0.0.1:7687`，节点标签 `NovelNode`，关系类型 `NOVEL_REL`，按 `bookId` 隔离）
- 页面内模型配置的临时 `models.json`：`agent-runtime\.agent\runtime-models`，初始化后立即清理
- 运行记录：`agent-runtime\.agent\runs\<runId>.json`（不含 API Key）
- 演示成书：`F:\project\novel-generator\demo`

依赖、缓存、临时文件、运行数据都在 F 盘；项目级 `.npmrc` 已把 npm cache 固定到 F。

## 测试

```powershell
cd F:\project\novel-generator\agent-runtime
npm test
npm run typecheck
npm run smoke -- --dry-run
```

当前：

```text
Test Files  32 passed (32)
Tests       362 passed (362)
```

## 已知限制

- 演示模式（FakeAiGateway）是可读的占位文本，不是真实模型输出；真实质量需要接 API Key 后验证。
- 新建时单次大纲上限 200 章；书架里可以分次“续写新章节”，单本累计章节数不设上限。
- 单次模型输出上限为 384k tokens；实际可用长度仍受所接模型和服务端配置限制。
- 知识图谱由章节状态快照推导；如果只重写中间一章并保留后续章节，后续章节的图谱事实仍来自旧快照，需要连续重写或后续做状态级联重算才能完全一致。
- Neo4j 不可用时自动退化为平面状态，不影响写作，但“图谱”面板会显示不可用原因。
- 存储目前是本地 JSON；后续可换 SQLite，不影响 `ProjectStore` 接口。
- 尚未实现并发项目队列、多 POV、拆书 UI。
- `Phase 0` 的真实模型 smoke 与 `SessionManager.open` 恢复仍待有 Key 时补验。

## 规划文档

- `docs/plans/2026-10-24-one-sentence-novel-refactor.md`
- `docs/plans/2026-10-24-ts-node-implementation.md`
- `docs/plans/2026-10-24-phase-0-pi-sdk-skeleton.md`
