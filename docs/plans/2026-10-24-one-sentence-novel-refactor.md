# 一句话生成一部长篇小说 · 系统重构规划

> **给后续实现者：** 这是一份系统级重构规划，不是逐行代码计划。实现时按第 12 节的阶段拆分任务；每个阶段都必须有可运行的验收物。所有 AI 能力统一走 Pi Agent SDK，不允许在新的主链路里直接调用 LangChain 或各模型厂商 SDK。

**目标：** 用户只输入一句话（可选填少量高级参数），系统自动完成故事圣经、分卷/阶段/章节大纲、逐章正文、审核修订、连续性状态维护，并导出完整小说。

> **Revision 2（2026-10-24）：** 技术栈已切换为 **TypeScript + Node**，不再使用 Python Story Engine。Story Engine、Agent Runtime、API、CLI 全部在同一个 Node/TypeScript 项目内；AI 能力全部走 Pi Agent SDK。本文中涉及 Python/FastAPI 的章节为历史设计，具体实现以 `docs/plans/2026-10-24-ts-node-implementation.md` 为准。

**架构：** TypeScript/Node 单体服务：Story Engine（领域模型、存储、上下文、字数预算、校验、导出）+ Agent Runtime（Pi SDK、模型调用、会话/压缩、进度事件）+ 极简 HTTP/SSE 服务与 CLI。前端只保留“输入 → 进度 → 成书”。

**技术栈：** TypeScript / Node >= 22.19、Pi Agent SDK（`@earendil-works/pi-coding-agent@1.4.0`）、Zod、Vitest、Node 内置 HTTP/SSE、本地 JSON 存储（后续可换 SQLite）。

---

## 0. 结论与默认假设

这份规划的核心判断：

1. **“卡片”不应出现在新系统里。** 故事数据用关系型文档模型表达：项目、故事圣经、大纲节点、章节、实体、状态、伏笔、审核。UI 不暴露类型/schema/触发器。
2. **真正值得保留的是四件事：** 雪花式逐层展开、章节上下文装配、字数受控续写、连续性状态维护。外加审核门禁和拆书/逆向分析作为可选能力。
3. **一句话生成不是“一个超大 prompt”。** 它必须是一个可恢复的流水线：Director 只做规划和调度，正文由独立的 ChapterWriter 按章生成，审核与状态提取也是独立步骤。Director 的上下文里永远不放大段正文。
4. **Pi Agent SDK 是唯一 AI 底座。** 新系统的所有模型调用、会话、工具、流式事件、压缩、重试都通过 Pi SDK。未来更换模型/提供商/agent 能力时，只改 Agent Runtime 内部，不改 Story Engine 和业务工具契约。
5. **默认全自动，审核点可选。** 默认不打断用户；高级设置里可以开启“故事圣经确认 / 大纲确认 / 每卷确认 / 每章确认”。

默认参数（可被高级设置覆盖）：

| 参数 | 默认值 |
|---|---|
| 语言 | 简体中文 |
| 目标字数 | 200,000 字 |
| 单章字数 | 2,500 字 |
| 分卷数 | 6 卷 |
| 每卷阶段数 | 4–6 |
| 叙事视角 | 第三人称限知 |
| 时态 | 过去时 |
| 自主级别 | `auto`（全自动） |
| 质量档位 | `balanced`（规划/正文用强模型，提取/摘要用便宜模型） |
| 成本上限 | 项目开始时估算并写入 `budget_cap`，默认不设硬上限但必须显示预估 |
| 导出格式 | Markdown + TXT，可选 EPUB/DOCX |

---

## 1. 目标与非目标

### 1.1 目标

- 输入一句话即可启动，不强制用户做任何结构化操作。
- 自动生成并校验：故事圣经、分卷/阶段/章节大纲、逐章正文。
- 每章满足：字数目标、 cast 白名单、下一章边界、风格约束、连续性状态。
- 全流程可暂停、恢复、中止、续跑；进程重启后可继续。
- 支持“重写某一章 / 换一种走向 / 只改某一卷”的分支操作。
- 最终输出完整小说 + 故事圣经 + 大纲 + 运行报告（成本、模型、问题清单）。
- 所有 AI 调用经过 Pi Agent SDK；模型/提供商可替换。
- 核心确定性模块（字数预算、上下文编译、校验、状态合并）可以脱离 LLM 单测。

### 1.2 非目标

- 不做卡片树、卡片类型、Schema Studio、触发器、通用工作流编辑器。
- 不做多人协作、权限、计费系统（除非后续明确要做服务端）。
- 不做“通用低代码平台”。流水线是固定的、可配置的，不是让用户搭流程。
- 不把 Neo4j 作为必需依赖。默认用 SQLite/JSON 存关系；Neo4j 只作为可选适配器。
- 不追求“第一版就 100% 自动出版级质量”。第一版目标是“一句话 -> 结构完整、可读、可继续打磨的长篇草稿”。

---

## 2. 用户视角的产品流程

### 2.1 主流程

1. 打开应用，看到一个输入框：`用一句话描述你想写的小说`。
2. 可选展开“高级设置”：类型、目标字数、单章字数、视角、风格、禁忌、自主级别、模型档位、成本上限。
3. 点击“开始生成”。
4. 进度页显示：当前阶段、当前卷/章、已写字数、预计剩余、实时正文流、审核结论、成本。
5. 可随时：暂停、继续、中止、给一句反馈（steer）。
6. 完成后进入成书页：章节列表、故事圣经、大纲、问题清单、导出。
7. 可选操作：重写某章、调整某卷大纲、开启人审确认点。全部是可选，不是必经步骤。

### 2.2 自主级别

| 级别 | 行为 |
|---|---|
| `auto` | 一句话后不打断，直到成书；失败时按策略继续或暂停并报告 |
| `checkpoint` | 在故事圣经、总大纲、每卷结束、每章结束中选择暂停点 |
| `interactive` | 运行中可随时 steer/followUp；适合边写边调 |

默认 `auto`。高级设置里提供“先让我确认故事圣经和大纲”开关。

---

## 3. 目标架构

```
┌──────────────────────────────────────────────┐
│ Electron / Web UI                            │
│ 输入 · 进度 · 成书 · 可选编辑 · 导出          │
└───────────────┬──────────────────────────────┘
                │ HTTP + SSE
┌───────────────▼──────────────────────────────┐
│ API Gateway（Node，也可由 Electron main 承担）│
│ 项目 CRUD 代理 · Run 控制 · SSE 转发 · 鉴权   │
└───────┬───────────────────────────┬──────────┘
        │                           │
┌───────▼─────────────────┐  ┌──────▼──────────────────────────┐
│ Story Engine（Python）   │  │ Agent Runtime（Node + Pi SDK）  │
│ 故事圣经/大纲/章节/实体   │  │ Director Agent                  │
│ 上下文编译/校验/状态/导出 │  │ ChapterWriter / Reviewer /      │
│ 确定性、可单测            │  │ Extractor / OutlineCritic       │
└───────┬─────────────────┘  │ 会话 · 压缩 · 工具 · 流式事件    │
        │                    └──────┬──────────────────────────┘
        │                           │
┌───────▼─────────────────┐  ┌──────▼──────────────────────────┐
│ SQLite / PostgreSQL      │  │ Pi ModelRuntime + Providers     │
│ 项目数据、版本、状态、用量 │  │ OpenAI/Anthropic/Google/兼容端点│
└─────────────────────────┘  └─────────────────────────────────┘
```

### 3.1 为什么拆成 Python + Node

- Python 侧已有可直接复用的提示词、字数预算、审核、状态提取、关系抽取逻辑；重写不划算。
- Pi Agent SDK 是 Node/TypeScript 生态；把它放进独立的 Agent Runtime，升级/替换 AI 底座时不影响故事数据层。
- 确定性逻辑（上下文编译、校验、字数）留在 Python，可脱离 LLM 测试；Agent Runtime 只负责“规划 + 调用模型 + 调度工具”。
- 本地桌面版可以把 Agent Runtime 作为独立 Node 进程；服务端版可以把同一进程拆成独立服务。
- 逻辑上 API Gateway 与 Agent Runtime 分开；实现上可以是同一个 Node 进程。公共入口优先由 Node 承担，Story Engine 作为内部服务。

### 3.2 服务边界

- **Story Engine 不调用任何 LLM。** 它只负责数据、上下文、校验、状态合并、导出。
- **Agent Runtime 不直接写数据库。** 所有故事数据变更都通过 Story Engine 的工具 API。
- **UI 不直接调用模型。** 只消费 Run 事件和项目数据。
- **Pi SDK 只在 Agent Runtime 内出现。** 其他模块不得 import Pi 包。

---

## 4. 保留并重构的核心设计

以下设计来自 NovelBuilder 中经过验证的部分，但全部去掉卡片/树/触发器的表达方式。

### 4.1 雪花式逐层展开

保留“从一句话逐层放大”的方法：

```
一句话
→ 一段话梗概
→ 主题/类型/读者/视角/基调
→ 角色 / 世界观 / 金手指 / 核心冲突
→ 核心蓝图（三幕或分卷转折、结局）
→ 分卷
→ 阶段
→ 章节大纲
→ 正文
```

规则：

- 每一层只能基于上一层和已确认的设定展开，不允许跳级。
- 每一层产出都必须通过结构校验；不通过则自动修复/重试，而不是继续往下写。
- 每层都保存版本，支持“只重写这一层，不影响下面已确认的内容”或“级联更新”。
- 默认自动展开；`checkpoint` 模式下可逐层确认。

### 4.2 故事圣经（Story Bible）

故事圣经是唯一的事实来源。建议字段：

```json
{
  "logline": "一句话",
  "synopsis": "一段话/一页纸梗概",
  "genre": ["玄幻", "升级流"],
  "audience": "男频/女频/通用",
  "themes": ["复仇", "成长"],
  "tone": "热血、克制、少抒情",
  "pov": "third_limited",
  "tense": "past",
  "target_words": 200000,
  "chapter_words": 2500,
  "ending": "主角推翻旧秩序，但付出代价",
  "assumptions": ["默认东方玄幻", "默认单女主"],
  "world": {
    "rules": [],
    "power_system": {"levels": [], "costs": [], "limits": []},
    "factions": [],
    "history": [],
    "society": [],
    "taboos": []
  },
  "characters": [
    {
      "id": "char_001",
      "name": "",
      "role": "protagonist|antagonist|ally|mentor|love_interest",
      "goal": "",
      "motivation": "",
      "wound": "",
      "arc": "",
      "voice": "",
      "secrets": [],
      "relationships": []
    }
  ],
  "items": [],
  "concepts": [],
  "style_guide": {
    "pov": "third_limited",
    "tense": "past",
    "sentence_rhythm": "",
    "dialogue_ratio": "30%-40%",
    "description_density": "medium",
    "banned_phrases": [],
    "ai_flavor_blacklist": [],
    "web_novel_principles": ["章末留钩", "冲突前置", "爽点兑现", "少解释多行动"]
  },
  "foreshadow_ledger": [
    {"id": "fs_001", "setup_chapter": 3, "payoff_chapter": 40, "title": "", "status": "planned"}
  ]
}
```

校验：

- 主角必须有目标、动机、缺陷、弧光。
- 力量体系必须有代价和限制，不能无上限。
- 结局必须明确；分卷转折必须服务结局。
- 每个伏笔必须有 setup 和 payoff 章节。
- 风格指南必须可执行（禁止项要具体）。

### 4.3 分层大纲

统一用 `OutlineNode` 表达三层，不再用不同卡片类型：

```json
{
  "level": "volume|stage|chapter",
  "number": 1,
  "parent_id": null,
  "title": "",
  "summary": "",
  "target_words": 30000,
  "pov": "char_001",
  "time": "",
  "place": "",
  "cast": ["char_001", "char_002"],
  "goal": "",
  "conflict": "",
  "turn": "",
  "reveal": "",
  "hook": "",
  "constraints": [],
  "foreshadow_setup": [],
  "foreshadow_payoff": []
}
```

章节大纲必须能回答：

- 这一章谁想要什么？
- 谁/什么阻碍？
- 发生了什么不可逆的变化？
- 读者获得什么新信息/爽点？
- 章末钩子是什么？
- 与下一章的边界在哪里？

校验：

- 章节号连续覆盖全书。
- `cast` 中的实体都存在。
- 每章至少有一个 `goal`、一个 `conflict`、一个 `turn`。
- 分卷/阶段字数之和等于目标字数。
- 伏笔 setup/payoff 都有安排，且 payoff 不早于 setup。
- POV/时态在全书中一致（除非显式配置多 POV）。
- 下一章大纲存在时，本章结尾不能提前完成下一章的核心事件。

### 4.4 上下文编译器（替代 @DSL）

NovelBuilder 的 `@type`/`@parent`/`[previous]`/`[filter:]` 思路很好，但绑定在卡片树上。新系统改为**声明式 ContextSpec + 确定性编译器**：

```json
{
  "chapter_id": "ch_012",
  "include": [
    {"source": "style_guide", "priority": 100},
    {"source": "bible_summary", "priority": 90},
    {"source": "volume_summary", "priority": 80},
    {"source": "stage_summary", "priority": 80},
    {"source": "chapter_outline", "chapter": "current", "priority": 100},
    {"source": "chapter_outline", "chapter": "next", "fields": ["summary", "hook"], "priority": 70},
    {"source": "chapter_text", "chapter": "previous", "mode": "tail", "max_chars": 3000, "priority": 60},
    {"source": "entity", "from": "chapter.cast", "fields": ["name", "role", "goal", "voice", "state"], "priority": 90},
    {"source": "relationship", "from": "chapter.cast", "priority": 60},
    {"source": "entity_state", "from": "chapter.cast", "priority": 90},
    {"source": "foreshadow", "status": "open", "due_before": "current", "priority": 70},
    {"source": "recent_events", "limit": 10, "priority": 50},
    {"source": "continuity_constraints", "priority": 80}
  ],
  "budget": {
    "max_tokens": 30000,
    "reserve_output_tokens": 6000,
    "truncate": "priority_then_tail"
  },
  "format": "markdown"
}
```

`ContextCompiler` 负责：

- 解析引用、去重、按优先级排序。
- 超过预算时从低优先级开始截断；正文类内容优先保留“结尾”。
- 生成可缓存的 `ContextPack`，带 hash；状态变化时失效。
- 输出中标注每段来源，便于调试和审核。
- 绝不把整本书塞进上下文；只注入本章 cast 和必要摘要。

### 4.5 字数受控的章节续写

保留 NovelBuilder 的预算思路，做成独立模块：

- 两种模式：
  - `prompt_only`：只在提示词里给目标字数，成本低、自然。
  - `budgeted`：按剩余字数拆成多轮，每轮有建议字数、`max_tokens`、硬上限。
- 规则：
  - **大纲边界优先于字数**：本章大纲写完后，不得到下一章凑字数。
  - 达到目标 ±10% 即视为达标；不足则继续，超出则按句号/段落边界裁剪。
  - 最后一轮强制收束，不能再开新冲突。
  - 每轮生成后校验：是否完成本章 `turn`、是否留下 `hook`、是否越界。
- 输出：`DraftResult {text, rounds, word_count, boundary_ok, hook_ok}`。
- 该模块是纯函数/纯服务，不依赖数据库，必须可单测。

### 4.6 审核门禁

保留 NovelBuilder 的“质量门禁 + 结构化审稿单”：

- 结论只有三种：`pass` / `revise` / `block`。
- 审核维度：
  - 行文逻辑、因果链、人物动机、信息承接
  - 人设/设定/时间线/降智风险
  - 节奏：空转、拖沓、断层、承接弱
  - AI 味：套话、重复结构、空泛情绪、模板化描写
  - 网文原则：卖点、主线、冲突、爽点、章末钩、主角驱动力、场景具体度
- 输出结构化 JSON + 可读 Markdown：
  ```json
  {
    "gate": "pass|revise|block",
    "summary": "",
    "issues": [
      {"severity": "high|medium|low", "type": "logic|character|setting|pacing|ai_flavor|hook", "quote": "", "problem": "", "fix": ""}
    ],
    "suggestions": [],
    "continuity_notes": [],
    "open_questions": []
  }
  ```
- 处理策略：
  - `pass`：进入状态提取。
  - `revise`：带着 issues 做定向重写，最多 2 轮；保留评分最高的版本。
  - `block`：记录问题；默认继续下一章并在最终报告标红；`checkpoint` 模式暂停等用户决定。
- 审核结果必须持久化，不能被后续重写覆盖；章节版本和审核版本一一对应。

### 4.7 连续性状态机

这是长篇一致性的核心。每章完成后，从正文中提取“状态增量”，而不是重写整份设定。

状态类型：

| 类型 | 示例 |
|---|---|
| 角色状态 | 位置、伤势、实力、资源、身份、目标、心态 |
| 关系状态 | 称呼、信任、敌对、债务、秘密共享 |
| 物品状态 | 持有者、位置、损坏、能力变化 |
| 场景状态 | 毁坏、控制方、开放/封闭 |
| 概念/规则 | 是否被揭示、掌握程度、代价变化 |
| 时间线 | 当前时间、关键事件顺序 |
| 伏笔 | 新埋、推进、回收、放弃 |
| 承诺/契约 | 谁答应谁什么、期限 |

```json
{
  "chapter_id": "ch_012",
  "deltas": [
    {
      "entity_id": "char_001",
      "path": "/state/location",
      "op": "set",
      "value": "北境·黑石城",
      "evidence": "他连夜赶到了黑石城"
    },
    {
      "entity_id": "char_002",
      "path": "/relationships/char_001/trust",
      "op": "increment",
      "value": 1,
      "evidence": "她第一次没有拔剑"
    }
  ],
  "events": [
    {"summary": "主角夺得黑石令", "entities": ["char_001"], "importance": "high"}
  ],
  "foreshadow_updates": [
    {"id": "fs_001", "status": "progressed", "note": "黑石令与旧王朝有关"}
  ]
}
```

校验与合并：

- Schema 校验；未知实体/非法路径直接拒绝。
- 与现有状态做冲突检测（例如同一物品被两个人持有）。
- 数值变化设上限/下限，避免“信任 +100”。
- 冲突时保留旧状态并把 delta 标为 `needs_review`，不静默覆盖。
- 每章保存一个 `state_snapshot`，支持回滚到任意章节。
- 下一章 ContextCompiler 自动注入 cast 的最新状态和相关关系。

### 4.8 伏笔与关系账本

- 伏笔：`setup_chapter`、`payoff_chapter`、`status`、`note`、`importance`。
- 关系：`source`、`target`、`kind`、`stance`、`description`、`since_chapter`、`until_chapter`。
- 每章生成前检查：到期未回收的伏笔、应该推进的关系、不能提前揭晓的秘密。
- 全书完成后生成“未回收伏笔/未完成弧光”报告。
- 关系图默认存 SQLite/JSON；需要可视化时再做只读图视图，不引入 Neo4j 作为硬依赖。

### 4.9 结构化生成与指令流

- 故事圣经、大纲、状态增量、审核结果全部使用 JSON Schema 约束。
- 生成流程：`schema → LLM → parse → validate → repair/retry`。
- 生成调用在 Agent Runtime 内执行；Story Engine 只提供 schema、校验、合并和存储，不直接调用 LLM。
- NovelBuilder 的“指令流”（自然语言 + `set/append/done`）保留为**可选交互模式**：
  - 用户在 UI 里逐字段调整故事圣经/大纲时，可以边生成边看字段变化。
  - 全自动流水线默认用普通 JSON 输出，简单可靠。
- 所有 schema 版本化；prompt 版本化；每次生成记录 `prompt_hash`、`schema_hash`、模型、温度。

### 4.10 拆书/逆向分析（可选能力）

不是“一句话生成”的必经步骤，但值得保留为独立工具：

- 输入：已有小说（整本或分章文件）。
- 输出：章节摘要、阶段划分、骨架结构、人物脉络、技法库、可迁移方法。
- 用途：
  - 给用户做“风格/结构参考”，生成 `style_reference`。
  - 把参考作品的结构转成新故事的骨架（注意版权，不复制原文）。
- 如果输入是单个 txt，先做**分章器**：按 `第X章/第X节/Chapter X` 正则切分，生成章节文件与元数据。NovelBuilder 目前要求预先分章，这是一个明显缺口，新系统应补上。
- 该能力独立于主流水线，失败不影响成书。

### 4.11 提示词与知识库版本化

- 所有 prompt 存为版本化文件，带 `id`、`version`、`stage`、`model_hint`、`input_schema`、`output_schema`。
- 支持 `@KB{name=...}` 注入写作知识（爽点、起名、节奏、禁忌）。
- 运行时记录实际使用的 prompt 版本；支持 A/B 对比和回滚。
- 不把 prompt 藏在代码字符串里；统一放 `prompts/` 目录，可被非开发者编辑。

### 4.12 固定流水线 + Agent 调度

不要通用工作流编辑器。流水线是固定的状态机：

```
INTAKE
  → BIBLE
  → BIBLE_REVIEW
  → OUTLINE
  → OUTLINE_REVIEW
  → CHAPTER_LOOP:
       CONTEXT → DRAFT → REVIEW → (REVISE) → STATE_EXTRACT → COMMIT
  → BOOK_REVIEW
  → EXPORT
  → DONE
```

Agent 只负责：

- 决定下一步调用哪个工具。
- 根据审核/校验结果决定重试、重写、跳过、暂停。
- 维护少量运行记忆（进度、问题、假设）。
- 不直接写正文、不直接改数据库。

确定性服务负责：

- 上下文编译、字数预算、schema 校验、状态合并、导出。
- 这些逻辑必须能在没有 LLM 的情况下测试。

---

## 5. 一句话生成流水线

### 5.1 Intake

输入：`premise`（一句话）+ 可选高级参数。

处理：

- 解析类型、基调、主角、核心冲突、目标读者；缺失的用默认值补全。
- 推断目标字数/分卷数/单章字数；写入 `assumptions`。
- 安全/合规检查；不通过直接拒绝并给出原因。
- 生成 `project_id` 和 `run_id`；写入初始状态。
- 默认不向用户提问；`interactive` 模式下可以问最多 3 个高价值问题。

### 5.2 Bible

- 按 4.1 的层级生成故事圣经。
- 并行生成角色/世界观/风格指南，但最后必须做一次一致性合并。
- 运行确定性校验 + 一次 `BibleCritic` LLM 审核。
- 不通过则修复；最多 2 轮。
- 保存 `bible_version`。

### 5.3 Outline

- 先生成核心蓝图（结局、分卷转折、主要高潮）。
- 再生成分卷大纲；每卷生成阶段；每阶段生成章节大纲。
- 每层生成后立即校验；章节层校验通过后才进入正文。
- 运行 `OutlineCritic`：节奏、重复、cast 合理性、伏笔安排、章末钩子。
- 保存 `outline_version`；支持只重写某一卷/阶段。

### 5.4 Chapter Loop

对每一章按顺序执行：

1. **Context**：ContextCompiler 生成 `ContextPack`，记录 token 估算。
2. **Draft**：ChapterWriter 按字数预算生成正文；流式写入 UI；保存草稿版本。
3. **Deterministic checks**：字数、cast 白名单、POV、时态、禁用词、重复段落、下一章边界。
4. **Review**：Reviewer 输出 gate + issues。
5. **Revise**：`revise` 时定向重写；最多 2 轮；每轮重新审核。
6. **State extract**：Extractor 输出状态增量；校验/合并；冲突标记。
7. **Commit**：保存章节最终版本、审核、状态快照、用量；更新进度。
8. **Checkpoint**：按配置暂停/继续。

失败策略：

- 单次生成失败：重试（指数退避），最多 3 次。
- 审核 `block`：记录问题；`auto` 模式默认继续，`checkpoint` 模式暂停。
- 连续 2 章 `block` 或同一章 3 次失败：暂停整个 Run，输出诊断报告。
- 成本/时间/token 超限：暂停，保留现场，等待用户决定。

### 5.5 Book Review

- 汇总所有章节和状态。
- 检查：未回收伏笔、角色弧光完成度、时间线、开放剧情线、重复场景、名称/称呼漂移、风格漂移。
- 生成全书问题清单；可选择性修复（默认只报告，不自动重写已通过审核的章节）。
- 生成标题候选、简介、标签（可选）。

### 5.6 Export

- 按章节顺序拼接；加入书名、简介、作者备注、目录。
- 导出 Markdown/TXT；可选 EPUB/DOCX。
- 同时导出 `story-bible.json`、`outline.json`、`run-report.json`、`reviews.json`，保证可复现。
- 记录最终 token/成本、模型、prompt 版本、未解决问题。

---

## 6. Agent 设计

### 6.1 角色分工

| 角色 | 形态 | 职责 |
|---|---|---|
| **Director** | Pi `AgentSession`（有状态） | 规划、调度工具、处理审核结果、决定重试/继续/暂停 |
| **ChapterWriter** | 确定性服务 + Pi 模型调用 | 按 ContextPack 和字数预算写正文 |
| **Reviewer** | 确定性校验 + Pi 模型调用 | 输出 gate/issues |
| **Extractor** | Pi 模型调用 | 从正文提取状态增量、事件、伏笔更新 |
| **OutlineCritic** | 独立 Pi 调用（可复用 session） | 审大纲节奏/结构/伏笔 |
| **StylePolisher** | 可选 Pi 调用 | 去 AI 味、统一文风（默认关闭） |
| **Deconstructor** | 可选独立流程 | 拆书/风格参考 |

关键约束：

- **Director 不写正文。** 它只能调用 `chapter.draft`，拿回 `{chapter_id, word_count, gate, issues}` 这类摘要。
- **Director 不读整章正文。** 需要抽查时用 `chapter.excerpt(chapter_id, max_chars)`。
- **ChapterWriter 不决定剧情。** 剧情由大纲决定；它只负责把大纲写成正文。
- **Reviewer 不改正文。** 只输出问题；重写由 ChapterWriter 执行。
- **Extractor 不发挥。** 只提取正文中已有的事实，不推断未发生的事。

### 6.2 Director 的循环

```
observe(run state)
  → choose next tool
  → execute tool
  → update progress/issue memory
  → if gate/validation fails → choose repair/retry/stop
  → if chapter done → next chapter
  → if all done → book review → export
```

必须有的停止条件：

- 所有章节 `committed`。
- 达到 `max_chapters` / `max_tokens` / `max_cost` / `max_wall_time`。
- 连续失败超过阈值。
- 用户 abort。
- 审核 `block` 且策略要求暂停。

Director 的系统提示要明确：

- 你是 showrunner，不是写手。
- 不许直接输出正文；必须调用工具。
- 不许跳过 schema/审核。
- 不许发明 cast 之外的重要角色；需要新角色时先调用 `cast.add` 并走校验。
- 不许提前写下一章剧情。
- 遇到不确定时，优先选择“保守、可继续、记录问题”，而不是停下来问用户。
- 每次工具调用后更新 `run_memory`：已完成章节、未解决问题、当前卷/章、预算消耗。

### 6.3 工具目录

工具分两类：**Director 可见的粗粒度工具** 和 **Story Engine 内部服务**。Director 只看到粗粒度工具，避免它陷入细节。

| 工具 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `project.get` | `project_id` | 项目摘要 | 含 premise、参数、assumptions |
| `bible.generate` | `project_id` | `bible_version`、摘要 | 内部完成雪花展开 |
| `bible.get` | `project_id` | 故事圣经 JSON | 可裁剪 |
| `bible.update` | patch | `bible_version` | 用户/Agent 修改 |
| `bible.validate` | `bible_version` | issues | 确定性 + 可选 LLM |
| `outline.generate` | `project_id`、`bible_version` | `outline_version` | 分卷/阶段/章节 |
| `outline.get` | `project_id`、level/filter | 大纲摘要 | 默认只返回摘要 |
| `outline.update` | patch | `outline_version` | 局部重写 |
| `outline.validate` | `outline_version` | issues | 连续性/字数/cast |
| `chapter.context` | `chapter_id` | `context_pack_id`、token 估算 | 不返回全文 |
| `chapter.draft` | `chapter_id`、`instructions?`、`target_words?` | `chapter_id`、word_count、boundary_ok | 内部调用 ChapterWriter |
| `chapter.review` | `chapter_id` | gate、issues 摘要 | 内部调用 Reviewer |
| `chapter.revise` | `chapter_id`、issues | 新版本号、word_count | 定向重写 |
| `chapter.extract_state` | `chapter_id` | deltas 摘要、冲突 | 内部调用 Extractor |
| `chapter.commit` | `chapter_id`、version | 状态快照、下一章 | 幂等 |
| `chapter.excerpt` | `chapter_id`、`max_chars` | 摘录 | 仅抽查 |
| `continuity.check` | `project_id`、范围 | issues | 确定性 + LLM |
| `foreshadow.list` | `project_id`、status | 列表 | 到期/未回收 |
| `foreshadow.update` | id、status、note | 更新结果 | |
| `cast.add` | 实体草案 | 实体 ID | 需校验；防止临时角色泛滥 |
| `manuscript.assemble` | `project_id` | 成书 ID | |
| `manuscript.export` | 格式 | 文件路径/流 | |
| `run.report` | `run_id` | 统计/问题/成本 | |
| `run.checkpoint` | `run_id`、原因 | 暂停确认 | |

工具设计原则：

- 幂等：同一 `chapter_id` + 版本重复 commit 不产生重复数据。
- 粗粒度：一次工具调用完成一个有意义的故事动作，不做“写 10 个字”这种碎片操作。
- 返回摘要：默认不把大段正文返回给 Director。
- 错误可读：抛出的错误包含“为什么失败、下一步建议”，便于 Agent 决策。
- 所有写操作带 `run_id` 和 `idempotency_key`。

---

## 7. Pi Agent SDK 接入

### 7.1 选型

使用 **`@earendil-works/pi-coding-agent`** 的 SDK 层，而不是只用底层 `pi-agent-core`：

- 需要 `createAgentSession`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`、`SettingsManager`、`defineTool`、事件流、压缩、重试、会话树。
- 禁用它的内置编码工具（`read`/`bash`/`edit`/`write`），只保留我们的故事工具。
- 使用 `systemPromptOverride` 替换成 Director 提示，去掉编码 agent 的默认指令。
- 如果后续只需要更薄的控制，可再下沉到 `@earendil-works/pi-agent-core` 的 `Agent`/`AgentHarness`；接口层不变。

npm 当前稳定版为 `1.4.0`；本地 `F:\project\pi\pi` 是 `0.82.1` 的参考实现，不作为运行依赖。新代码固定 `@earendil-works/pi-coding-agent@1.4.0` 与 `@earendil-works/pi-ai@1.4.0`（不要用 `^` 浮动），并以安装包内的 `docs/sdk.md` 为准。Node 要求 `>=22.19.0`；本机 Node 24.19.0 满足。

### 7.2 创建会话

```ts
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create({
  authPath: join(agentDir, "auth.json"),
  modelsPath: join(agentDir, "models.json"),
});
if (process.env.NOVELBUILDER_API_KEY) {
  await modelRuntime.setRuntimeApiKey(provider, process.env.NOVELBUILDER_API_KEY);
}

const model = modelRuntime.getModel(provider, modelId);
if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);

const loader = new DefaultResourceLoader({
  cwd: projectDir,
  agentDir,
  systemPromptOverride: () => DIRECTOR_SYSTEM_PROMPT,
  skillsOverride: (current) => ({
    skills: [...current.skills, ...novelSkills],
    diagnostics: current.diagnostics,
  }),
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: projectDir,
  agentDir,
  model,
  modelRuntime,
  resourceLoader: loader,
  noTools: "builtin",
  customTools: storyTools,
  sessionManager: SessionManager.create(projectDir),
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3 },
  }),
});

try {
  session.subscribe((event) => {
    publishRunEvent(normalizePiEvent(event));
  });

  await session.prompt(buildIntakePrompt(project));
} finally {
  session.dispose();
}
```

要点：

- `noTools: "builtin"` 禁用编码工具；`customTools` 注册故事工具。
- 故事写操作的顺序由 Story Engine 的 per-project 锁、事务和幂等键保证；不要依赖 Agent 的并行/串行模式。
- `SessionManager.create(projectDir)` 持久化会话；`SessionManager.open(path)` 恢复。
- `settingsManager` 控制压缩和重试；压缩策略按第 7.5 节配置。
- `ModelRuntime` 统一管理 provider、key、模型目录；业务代码不直接读 API key。
- `session.dispose()` 必须调用，否则会残留订阅和扩展上下文。

### 7.3 事件映射

Pi 事件 -> 统一 Run 事件：

| Pi 事件 | Run 事件 | UI 用途 |
|---|---|---|
| `agent_start` | `run.phase` | 开始 |
| `turn_start` | `run.turn` | 当前轮次 |
| `message_update` (`text_delta`) | `agent.delta` | 流式文本/思考 |
| `tool_execution_start` | `tool.start` | 当前动作 |
| `tool_execution_update` | `tool.progress` | 工具进度 |
| `tool_execution_end` | `tool.end` | 结果摘要 |
| `turn_end` | `run.turn_end` | 统计 |
| `agent_end` | `run.agent_end` | 本轮结束 |
| 自定义工具事件 | `chapter.*` / `state.*` / `review.*` | 业务进度 |

自定义事件示例：

- `chapter.draft_started`
- `chapter.draft_delta`
- `chapter.drafted` (`word_count`)
- `chapter.reviewed` (`gate`)
- `chapter.revised` (`version`)
- `state.updated` (`delta_count`)
- `run.paused` / `run.completed` / `run.failed`

SSE 要求：

- 每个事件有 `id`、`run_id`、`seq`、`timestamp`。
- 支持 `Last-Event-ID` 断线重连。
- 事件持久化到 `run_events`，不只存在内存。

### 7.4 控制与恢复

| 需求 | Pi SDK |
|---|---|
| 用户中止 | `session.abort()` |
| 运行中插话 | `session.steer(text)` |
| 一轮结束后追加要求 | `session.followUp(text)` |
| 暂停/恢复 | 应用层状态机 + 持久化；恢复时 `SessionManager.open` + `session.prompt/continue` |
| 分支/重写 | `session.navigateTree(entryId)` 或新建章节版本后重跑 |
| 上下文压缩 | `session.compact()` + 自动压缩配置 |
| 模型切换 | `session.setModel(model)` |
| 思考级别 | `session.setThinkingLevel(level)` |

恢复原则：

- 会话（Pi JSONL）+ Run 状态（Story Engine）双持久化。
- 工具必须幂等；恢复时从最后一个 `committed` 章节继续。
- 中断发生在 `chapter.draft` 中间时，丢弃未 commit 的草稿，或保留为 `draft` 版本供参考；不要当作已完成。
- 恢复前校验 `bible_version` / `outline_version` / `state_snapshot` 一致性。

### 7.5 上下文与压缩

- Director 的上下文只放：项目摘要、当前进度、未解决问题、当前卷/章摘要、最近工具结果摘要。
- 不把正文放进 Director 上下文；正文只存在 Story Engine。
- 开启 Pi 自动压缩，阈值按模型上下文窗口配置（例如 70% 触发）。
- 每卷结束做一次显式 `compact`，把已完成卷压缩成 5–10 条要点。
- ChapterWriter 的上下文由 ContextCompiler 单独构建，不复用 Director 会话。
- 所有模型调用带 `sessionId`，便于 provider 侧缓存（如果支持）。

### 7.6 模型与 Provider

- 统一通过 `ModelRuntime` / `pi-ai` 的模型目录。
- 支持：
  - OpenAI 兼容端点（DeepSeek、Qwen、Moonshot、自建网关等）。
  - Anthropic。
  - Google。
- 模型档位：
  - `planning`：故事圣经/大纲/难题修复。
  - `prose`：正文。
  - `review`：审核。
  - `extract`：状态/摘要/关系抽取。
- 每个档位可在高级设置里覆盖；默认使用同一强模型，`extract` 用便宜模型。
- API key 存 OS keychain（Electron `keytar` 或系统凭据管理器）；环境变量仅用于开发。
- 不在前端暴露 key；不写日志。

### 7.7 未来替换 AI 底座的约束

为了让 Pi SDK 的变更不影响业务：

- 定义 `AiGateway` 接口（在 Agent Runtime 内）：
  ```ts
  interface AiGateway {
    stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
    complete(request: ModelRequest): Promise<ModelResponse>;
    getCapabilities(modelId: string): ModelCapabilities;
  }
  ```
- 当前实现：`PiAiGateway`，内部用 `ModelRuntime.streamSimple` / `session`。
- 业务工具只依赖 `AiGateway`，不直接 import Pi。
- `AgentRuntime` 接口：`startRun`、`controlRun`、`subscribe`、`resumeRun`、`forkRun`。
- Pi 升级时：只改 `PiAiGateway` / `PiAgentRuntime`，跑契约测试和回归评测。
- 版本锁定 + 升级脚本 + CHANGELOG 检查。

### 7.8 安全

- 禁用 `bash`、`read`、`write`、`edit` 等编码工具；Agent 不能碰文件系统。
- 自定义工具只接受 `project_id` / `run_id` / `chapter_id`，服务端校验归属。
- 不允许 Agent 传入任意文件路径；导出路径由服务端生成。
- Prompt 注入防护：用户 premise 只作为数据，不拼接系统指令；工具返回内容标注来源。
- 内容安全：生成前/后做敏感内容检查（可选）。
- 成本保护：每次模型调用前检查预算；超限暂停。
- 日志脱敏：不记录 API key、完整 prompt（可记录 hash/长度）。

---

## 8. 数据模型（无卡片）

本地默认 SQLite；服务端可换 PostgreSQL。所有表带 `created_at`/`updated_at`；所有故事数据带 `project_id`。

### 8.1 核心表

| 表 | 关键字段 | 说明 |
|---|---|---|
| `projects` | `id`, `title`, `premise`, `language`, `genre`, `target_words`, `chapter_words`, `pov`, `tense`, `status`, `assumptions` | 项目 |
| `runs` | `id`, `project_id`, `status`, `phase`, `autonomy`, `model_profile`, `budget_cap`, `started_at`, `finished_at`, `error` | 一次生成运行 |
| `run_events` | `id`, `run_id`, `seq`, `type`, `payload`, `created_at` | SSE/审计 |
| `story_bibles` | `id`, `project_id`, `version`, `content`, `status`, `created_at` | 故事圣经版本 |
| `outline_nodes` | `id`, `project_id`, `parent_id`, `level`, `number`, `title`, `content`, `status`, `version` | 卷/阶段/章大纲 |
| `chapters` | `id`, `project_id`, `outline_node_id`, `number`, `title`, `status`, `current_version`, `word_count` | 章节 |
| `chapter_versions` | `id`, `chapter_id`, `version`, `text`, `word_count`, `model`, `prompt_hash`, `created_at` | 正文版本 |
| `reviews` | `id`, `chapter_id`, `chapter_version`, `gate`, `report`, `model`, `prompt_version`, `created_at` | 审核 |
| `entities` | `id`, `project_id`, `type`, `name`, `aliases`, `content`, `first_chapter`, `status` | 角色/物品/场景/组织/概念 |
| `entity_states` | `id`, `entity_id`, `chapter_id`, `state`, `source`, `created_at` | 状态快照/增量结果 |
| `relationships` | `id`, `project_id`, `source_id`, `target_id`, `kind`, `stance`, `description`, `since_chapter`, `until_chapter` | 关系 |
| `foreshadows` | `id`, `project_id`, `setup_chapter`, `payoff_chapter`, `title`, `status`, `note`, `importance` | 伏笔 |
| `events` | `id`, `project_id`, `chapter_id`, `type`, `summary`, `entities`, `importance` | 故事事件 |
| `artifacts` | `id`, `project_id`, `run_id`, `type`, `path`, `mime`, `metadata` | 导出/报告 |
| `usage_records` | `id`, `run_id`, `phase`, `model`, `input_tokens`, `output_tokens`, `cost`, `created_at` | 成本 |

### 8.2 版本与一致性

- `story_bibles.version` 递增；大纲/章节引用生成时的 `bible_version`。
- `chapter_versions` 只追加，不覆盖；`chapters.current_version` 指向最佳版本。
- `entity_states` 以 `chapter_id` 形成时间线；支持回滚。
- `outline_nodes.status`: `planned|generating|ready|drafted|reviewed|committed|needs_attention`。
- `runs.status`: `queued|running|paused|completed|failed|aborted`。
- 所有写工具带 `idempotency_key`，避免恢复时重复写。

### 8.3 不做的表

- 不建 `cards`、`card_types`、`workflow_definitions`、`workflow_runs`、`node_execution_states`。
- 不建通用 schema 表；schema 是代码里的版本化 JSON Schema。
- 不建通用图数据库；关系用关系表；需要图查询时做只读投影。

---

## 9. API 与事件

### 9.1 公共 API

```
POST   /v1/projects                     创建项目（premise + 可选参数）
GET    /v1/projects/:id                 项目摘要
GET    /v1/projects/:id/bible           故事圣经（可裁剪）
GET    /v1/projects/:id/outline         大纲树/列表
GET    /v1/projects/:id/chapters        章节列表
GET    /v1/projects/:id/chapters/:n     章节正文（可按版本）
GET    /v1/projects/:id/reviews         审核列表
GET    /v1/projects/:id/issues          问题清单（连续性/伏笔/未完成）
POST   /v1/projects/:id/runs            启动运行
GET    /v1/runs/:id                     运行状态
GET    /v1/runs/:id/events              SSE
POST   /v1/runs/:id/control             pause/resume/abort/feedback
POST   /v1/projects/:id/export          导出
GET    /v1/projects/:id/report          运行报告
```

服务归属：

- `/v1/runs/*` 与 SSE 由 Agent Runtime（或 Node API Gateway）提供。
- `/v1/projects/*` 的数据接口由 Story Engine 提供，由网关代理。
- 桌面版可以直连 Python/Node 两个本地端口；服务端版建议只暴露 Node 网关。

### 9.2 Run 控制

```json
POST /v1/runs/:id/control
{
  "action": "pause|resume|abort|feedback|rewrite_chapter|regenerate_volume",
  "chapter_id": "optional",
  "message": "optional user feedback"
}
```

- `pause`：在安全点暂停（当前工具完成后）。
- `resume`：从最后 checkpoint 恢复。
- `abort`：立即中止当前模型调用；保留已 commit 内容。
- `feedback`：映射到 Pi `steer`/`followUp`。
- `rewrite_chapter`：创建新章节版本，从该章重跑；后续章节标记为 `stale`，由用户选择是否级联重写。

### 9.3 SSE 事件

```json
{
  "id": "evt_000123",
  "run_id": "run_abc",
  "seq": 123,
  "type": "chapter.drafted",
  "timestamp": "2026-10-24T12:00:00Z",
  "payload": {
    "chapter_id": "ch_012",
    "word_count": 2480,
    "boundary_ok": true
  }
}
```

事件类型：

- `run.started` / `run.phase` / `run.progress` / `run.paused` / `run.resumed` / `run.completed` / `run.failed`
- `agent.delta` / `agent.thinking`
- `tool.start` / `tool.progress` / `tool.end`
- `chapter.draft_started` / `chapter.draft_delta` / `chapter.drafted`
- `chapter.reviewed` / `chapter.revised` / `chapter.committed`
- `state.updated` / `continuity.issue`
- `bible.ready` / `outline.ready` / `book.assembled` / `export.ready`

---

## 10. UI

### 10.1 主界面

只保留三个主页面：

1. **新建**：一句话输入 + 高级设置（折叠）。
2. **运行**：阶段时间线、当前卷/章、字数、成本、实时流、暂停/中止、反馈框。
3. **成书**：章节列表、故事圣经、大纲、问题清单、导出。

### 10.2 高级设置（默认折叠）

- 类型/子类型
- 目标字数/单章字数/分卷数
- 视角/时态
- 风格关键词/禁忌
- 自主级别（auto/checkpoint/interactive）
- 模型档位（planning/prose/review/extract）
- 成本上限
- 是否启用“故事圣经确认/大纲确认/每卷确认/每章确认”
- 是否启用“拆书参考”

### 10.3 运行页信息

- 阶段进度：Intake → Bible → Outline → Chapters → Book Review → Export。
- 章节进度：`已 commit / 总数`，当前章字数。
- 质量：最近审核 gate、未解决问题数、未回收伏笔数。
- 成本：输入/输出 token、预估费用、剩余预算。
- 操作：暂停、继续、中止、反馈、重写当前章、查看问题。
- 断线重连：根据 `Last-Event-ID` 恢复。

### 10.4 成书页

- 章节阅读/编辑（Markdown 编辑器）。
- 故事圣经/大纲只读（可进入高级编辑）。
- 问题清单：连续性、审核 block、未回收伏笔、字数异常。
- 导出：Markdown/TXT/EPUB/DOCX + JSON 包。
- 重跑：从某章/某卷开始，保留旧版本。

### 10.5 明确不做的 UI

- 不显示卡片树、类型、schema、触发器、工作流画布。
- 不要求用户手动“入图关系”或“提取动态信息”；这些在后台自动完成。
- 不要求用户逐字段确认；默认全自动。

---

## 11. 质量、成本与可观测性

### 11.1 确定性校验（每次生成后）

- 字数：目标 ±10%；硬上限 1.5×。
- cast：正文中出现的具名角色必须在 `chapter.cast` 或已登记的“临时角色”里；否则标记。
- 边界：不能完成下一章的核心事件；不能提前揭晓下一章 reveal。
- 名称/称呼：与实体表一致；别称必须在 aliases 里。
- 重复：段落/句子重复率阈值。
- 风格：禁用词/禁用句式/AI 味词表。
- 时间线：顺序、持续时间、地点移动合理性。
- 伏笔：到期未回收提醒。
- 状态：同一物品不能多人持有；死亡角色不能无解释出场；伤势不能无解释恢复。

### 11.2 LLM 审核

- 结构化 gate/issues；不做“泛泛夸奖”。
- 审核与生成使用不同 prompt；审核模型可以更强。
- 审核结果只读；重写后重新审核，保留历史。
- 可配置审核严格度：`loose` / `normal` / `strict`。

### 11.3 成本控制

- 每次模型调用前估算输入 token；超过单章/单卷预算则先压缩上下文。
- 记录真实 usage；与估算对比，校准。
- 模型路由：
  - 规划/正文/审核：强模型。
  - 摘要/状态/关系：便宜模型。
  - 失败重试：可降级到便宜模型做修复，但最终审核用强模型。
- 开启 provider prompt caching（如支持）；稳定 system prompt 前缀。
- 上下文只注入必要内容；不把整本书放进 prompt。
- 成本上限：`budget_cap`；达到 80% 警告，100% 暂停。

### 11.4 可观测性

- 结构化日志：`run_id`、`project_id`、`phase`、`chapter_id`、`tool`、`model`、`tokens`、`duration`。
- Trace：一次 Run 一棵树；每个阶段/工具/模型调用是 span。
- 运行报告：阶段耗时、token/成本、审核统计、问题数、模型分布。
- 事件持久化；支持回放。
- 敏感信息脱敏。

---

## 12. 实施阶段

### Phase 0：Pi SDK 验证与骨架（必须先做）

> 详细可执行任务见：`docs/plans/2026-10-24-phase-0-pi-sdk-skeleton.md`

**目标：** 证明 Pi SDK 能在本机跑通，并确定最终接口。

任务：

- [ ] 在 `agent-runtime/` 初始化 TypeScript 项目，Node >= 22.19，锁定 `@earendil-works/pi-coding-agent@1.4.0` 与 `@earendil-works/pi-ai@1.4.0`。
- [ ] 用 `ModelRuntime` 配置至少一个 provider（OpenAI 兼容端点优先，便于接 DeepSeek/Qwen）。
- [ ] 用 `createAgentSession` 创建会话：`noTools: "builtin"` + 一个自定义 `echo` 工具 + `SessionManager.inMemory()`。
- [ ] 订阅事件，打印 `message_update`、`tool_execution_start/end`、`agent_end`。
- [ ] 验证 `steer`、`followUp`、`abort`、`compact`。
- [ ] 验证 `SessionManager.create` 落盘 + `SessionManager.open` 恢复。
- [ ] 写一份 `PI_SDK_NOTES.md`：实际 API、坑、provider 配置、版本约束。
- [ ] 验收：一个 Node 脚本能用一句话调用模型、调用自定义工具、流式输出、恢复会话。

**验收物：** `agent-runtime` 可运行 demo + 笔记。未通过不得进入 Phase 1。

### Phase 1：Story Engine 最小闭环

**目标：** 一句话 -> 故事圣经 -> 大纲（不写正文）。

任务：

- [ ] 建 SQLite schema（projects/runs/story_bibles/outline_nodes/entities/foreshadows/usage）。
- [ ] 实现 `POST /v1/projects` 和 `POST /v1/runs`（run 先只跑 Bible + Outline）。
- [ ] 把 NovelBuilder 的提示词导入为版本化 prompt 文件：一句话、故事大纲、世界观、核心蓝图、分卷/阶段/章节大纲、写作指南。
- [ ] 实现 StoryBible/Outline 的 JSON Schema 与确定性校验。
- [ ] 实现 ContextCompiler 的最小版（仅大纲阶段使用；章节阶段留接口）。
- [ ] 实现 SSE 事件与持久化。
- [ ] 前端最小页面：输入一句话 -> 进度 -> 展示故事圣经/大纲。
- [ ] 验收：输入 5 个不同的一句话，均能生成结构完整、校验通过的故事圣经和 1 卷/3 阶段/10 章大纲。

### Phase 2：章节正文闭环

**目标：** 按大纲写出前 10 章，字数/边界/风格受控。

任务：

- [ ] 移植字数预算模块（`prompt_only` + `budgeted`），用 Python 实现并单测。
- [ ] 实现 ContextCompiler 完整版：风格、bible 摘要、卷/阶段摘要、上一章、当前/下一章大纲、cast 实体与状态、伏笔、最近事件。
- [ ] 实现 ChapterWriter：ContextPack -> 多轮生成 -> 边界/字数校验 -> 保存版本。
- [ ] 实现确定性章节校验（cast、字数、重复、禁用词、POV/时态）。
- [ ] 实现章节循环与 `chapter.commit` 幂等。
- [ ] 前端运行页：实时正文流、进度、暂停/中止。
- [ ] 验收：前 10 章全部生成，字数 ±10%，cast 无越界，下一章边界无违规。

### Phase 3：审核与连续性

**目标：** 自动审核、修订、状态提取，保证 30 章以上一致性。

任务：

- [ ] 导入审核提示词，实现 Reviewer（JSON gate/issues + Markdown）。
- [ ] 实现 revise 循环（最多 2 轮）和版本保留。
- [ ] 导入关系/角色/物品/场景/组织/概念状态提取提示词，实现 Extractor。
- [ ] 实现状态增量 schema、冲突检测、快照、回滚。
- [ ] 实现伏笔账本与到期检查。
- [ ] 实现 `continuity.check`。
- [ ] 验收：30 章运行，审核 gate 统计合理；状态冲突可检测；未回收伏笔有报告；恢复后能从断点继续。

### Phase 4：成书、导出与体验

**目标：** 完整一本书，可导出、可恢复、可分支。

任务：

- [ ] 实现 Book Review（未回收伏笔、弧光、时间线、重复、名称漂移）。
- [ ] 实现 manuscript.assemble + Markdown/TXT 导出；EPUB/DOCX 可选。
- [ ] 实现运行报告（成本、模型、问题、prompt 版本）。
- [ ] 实现 pause/resume/abort/feedback 的完整语义。
- [ ] 实现“重写某章/某卷”分支与 stale 标记。
- [ ] 成书页/问题清单/导出 UI。
- [ ] 验收：一句话 -> 目标字数成书；中途 kill 进程后能恢复；导出文件完整；报告可读。

### Phase 5：可选增强

- [ ] 拆书/分章器：单 txt -> 章节文件 -> 摘要/阶段/技法分析。
- [ ] 风格参考：拆书结果 -> `style_reference` -> 写作时注入。
- [ ] 多 POV / 多主角线。
- [ ] 封面/简介/标签生成。
- [ ] 本地模型（llama.cpp/Ollama）适配（通过 Pi provider）。
- [ ] 服务端部署与多项目管理。

---

## 13. 测试与评估

### 13.1 单元测试（无 LLM）

- 字数预算：不同目标/当前字数/模式 -> 轮次计划、硬上限、收束。
- ContextCompiler：引用解析、优先级、截断、缓存失效。
- Schema 校验：故事圣经/大纲/状态增量/审核。
- 状态合并：冲突、回滚、数值边界。
- 章节校验：cast、重复、禁用词、边界。
- 导出：章节顺序、标题、字数统计。

### 13.2 契约测试

- Story Engine API：请求/响应 schema。
- 工具契约：每个 tool 的输入/输出/错误。
- Pi 事件映射：给定 Pi 事件序列 -> Run 事件序列。
- 模型网关：`AiGateway` 的流式/非流式/中止/错误。

### 13.3 集成测试（假模型）

- 用固定的 `streamFn`/faux provider 返回脚本化内容，跑完整流水线。
- 断言：章节数、字数、状态、审核 gate、导出内容。
- 覆盖：正常、审核 revise、block、状态冲突、模型超时、恢复。

### 13.4 端到端评估（真实模型）

- 20 个不同题材的一句话，生成 10 章样例。
- 评分维度：premise 忠实度、结构、人物一致性、世界一致性、节奏、章末钩、文风、AI 味、可读性。
- 人工抽检 + LLM judge；记录模型/prompt 版本。
- 回归集：边界违规、cast 幻觉、时间线错误、伏笔丢失、重复段落。
- 成本/时延基准：每千字 token/费用、每章耗时。

### 13.5 验收阈值（第一版）

- 10 章样例：100% 章节存在；字数 ±10%；0 个 cast 越界；0 个下一章边界违规。
- 30 章样例：连续性冲突 <= 2 个/30 章，且全部在报告中可见。
- 恢复：kill 进程后可从最后 committed 章节继续，不重复写。
- 成本：在预算上限内完成；报告可解释每章成本。
- 所有 AI 调用经过 Pi SDK；新链路无 LangChain import。

---

## 14. 与 NovelBuilder 的迁移映射

### 14.1 直接复用

| NovelBuilder 资产 | 新系统用法 |
|---|---|
| `backend/app/bootstrap/prompts/一句话梗概.txt` | Bible 第一步 |
| `故事大纲/世界观设定/核心蓝图/分卷大纲/阶段大纲/章节大纲/写作指南` | 雪花展开 + 大纲 |
| `章节审核/通用审核/阶段审核` | Reviewer |
| `角色动态信息提取/物品状态提取/场景状态提取/组织状态提取/概念掌握提取/关系提取` | Extractor |
| `拆书_章节大纲摘要/阶段划分/全案拆解_*` | 可选拆书器 |
| `continuation_budget_runtime.py` | 字数预算（移植到 Python 服务或 TS） |
| `context_service.py` + 章节上下文模板 | ContextCompiler 的规则来源 |
| `review_service.py` 的 quality gate 解析 | Reviewer 输出契约 |
| `memory_extractors/` 的 schema/merge 逻辑 | 状态增量 |
| `foreshadow_service.py` | 伏笔账本（替换掉正则启发式） |
| `kg_provider.py` / `relation_graph_service.py` | 关系表/可选图适配器 |

### 14.2 替换/删除

| 旧设计 | 新设计 |
|---|---|
| Card / CardType / Schema Studio | 关系型故事文档 + JSON Schema |
| 卡片树 / 手动排序 | 大纲节点树（自动生成，UI 不强调树） |
| 触发器 / 工作流 DSL / 工作流编辑器 | 固定流水线 + Agent 工具 |
| LangChain / 各厂商 SDK | Pi Agent SDK / Pi ModelRuntime |
| Neo4j 默认 | SQLite/JSON 关系表；Neo4j 可选 |
| 手动“入图关系/提取动态信息” | 后台自动 Extractor |
| 卡片导出 | 成书导出（Markdown/TXT/EPUB/DOCX） |
| 灵感工作台 | 可选，后续独立做 |
| 提示词工坊 | 高级设置里的只读/可编辑 prompt，不是主流程 |

### 14.3 迁移策略

- 不直接改造旧 UI；新系统作为 `novelbuilder-next` 并列运行，旧系统保留到新系统通过验收。
- 旧项目数据可选迁移：导出 JSON/Markdown -> 映射到 `story_bibles` / `outline_nodes` / `chapters` / `entities`。第一版可以只支持新项目。
- 旧提示词先复制为版本化文件，再逐步优化；不要直接引用旧数据库里的 prompt。
- 旧关系/状态数据如果存在，写一次性导入脚本；否则从新项目开始。

---

## 15. 风险与决策

| 风险 | 影响 | 缓解 |
|---|---|---|
| 一句话信息不足，生成方向不符合预期 | 用户不满意 | 默认假设写入报告；`checkpoint` 模式可确认；高级设置可约束；支持重写大纲 |
| 长篇上下文爆炸 | 成本高/质量下降 | Director 不读正文；ContextCompiler 只注入必要内容；Pi 压缩；分卷摘要 |
| LLM 状态提取错误 | 连续性崩坏 | Schema 校验 + 冲突检测 + 人工可查；保留状态历史；关键冲突暂停 |
| 审核过于严格导致无限重写 | 成本/时间失控 | 最大 2 轮；保留最佳版本；block 默认继续并报告 |
| 模型输出越界/提前写下一章 | 结构崩坏 | 下一章大纲注入 + 确定性边界检查 + 重写 |
| Pi SDK API 变动 | 集成破裂 | 锁定版本；`AiGateway`/`AgentRuntime` 适配层；契约测试；升级演练 |
| Node + Python 双运行时 | 部署复杂 | 本地 Electron 打包两个进程；服务端 Docker Compose；内部 API 版本化 |
| 成本不可控 | 用户流失 | 预算上限、成本预估、模型路由、缓存、暂停 |
| 版权/抄袭 | 法律风险 | 拆书只提取结构/技法，不复制原文；风格参考不直接模仿在世作者；内容检查 |
| 全自动质量不稳定 | 口碑 | 第一版定位“长篇草稿”；提供审稿/重写工具；质量档位可选 |

### 15.1 已决策

- 新系统不使用卡片/工作流编辑器。
- 使用 Python Story Engine + Node Agent Runtime；AI 只在 Node 侧。
- 所有 AI 走 Pi Agent SDK；锁定版本。
- 默认 `auto`，可选 checkpoint。
- 默认 SQLite；Neo4j 可选。
- 先做“一句话 -> 10 章”闭环，再扩到 200k 字。

### 15.2 待实现时确认

- 第一版是否直接做 200k 字，还是先 10 章 demo？建议先 10 章，再逐步放大。
- 是否保留“拆书”作为第一版功能？建议 Phase 5。
- 是否支持多 POV？建议 Phase 5。
- 是否要做 Web 版？建议先 Electron 本地版，API 保持服务端兼容。
- 模型 provider 首选哪家？建议先接一个 OpenAI 兼容端点，便于切换 DeepSeek/Qwen。

---

## 16. 验收标准

第一版必须同时满足：

- [ ] 用户只输入一句话 + 默认参数，点击开始，不需要其他操作。
- [ ] 系统自动生成故事圣经、分卷/阶段/章节大纲，并通过校验。
- [ ] 按大纲逐章生成正文，章节数完整，字数目标 ±10%。
- [ ] 每章通过 cast 白名单、下一章边界、风格禁用词检查。
- [ ] 审核输出 gate/issues；`revise` 可自动重写；`block` 在报告中可见。
- [ ] 每章完成后更新状态、关系、伏笔；下一章注入最新状态。
- [ ] 支持暂停/恢复/中止；进程重启后可从最后 committed 章节继续。
- [ ] 支持重写某一章/某一卷，且不破坏其他章节。
- [ ] 导出 Markdown/TXT；故事圣经/大纲/报告可一并导出。
- [ ] 所有 AI 调用经过 Pi Agent SDK；新链路没有 LangChain/厂商 SDK 直接调用。
- [ ] 核心确定性模块有单测；假模型端到端测试通过。
- [ ] 运行报告包含：章节统计、字数、审核统计、问题、token/成本、模型/prompt 版本。

---

## 17. 附录 A：Pi SDK 关键 API 速查

| 需求 | API |
|---|---|
| 创建会话 | `createAgentSession(options)` |
| 自定义工具 | `defineTool({ name, label, description, parameters: Type.Object(...), execute })` |
| 禁用内置工具 | `noTools: "builtin"` |
| 自定义工具注册 | `customTools: [tool]` |
| 持久化会话 | `SessionManager.create(cwd)` / `SessionManager.open(path)` |
| 内存会话 | `SessionManager.inMemory()` |
| 模型运行时 | `ModelRuntime.create({ authPath, modelsPath })` |
| 设置 API key | `await modelRuntime.setRuntimeApiKey(provider, key)` |
| 获取模型 | `modelRuntime.getModel(provider, modelId)` |
| 系统提示覆盖 | `DefaultResourceLoader({ systemPromptOverride })` |
| Skills | `DefaultResourceLoader({ skillsOverride })` |
| Prompt 模板 | `DefaultResourceLoader({ promptsOverride })` |
| 压缩/重试 | `SettingsManager.inMemory({ compaction, retry })` |
| 订阅事件 | `session.subscribe(listener)` |
| 运行中插话 | `session.steer(text)` |
| 结束后追加 | `session.followUp(text)` |
| 中止 | `session.abort()` |
| 压缩 | `session.compact()` |
| 切换模型 | `session.setModel(model)` |
| 会话分支 | `session.navigateTree(entryId)` / `SessionManager.branch` |
| 子进程集成 | `runRpcMode(runtime)` / `pi --mode rpc` |

参考 npm 稳定版 `1.4.0`，Node `>=22.19.0`。本地 `F:\project\pi\pi`（0.82.1）只用于对照实现；实现时以安装包内 `docs/sdk.md` 和 TypeScript 声明为准。

---

## 18. 附录 B：一句话输入模板

```text
你是一位负责长篇商业小说的 showrunner。用户只给一句话，你需要自动补全合理默认值，并调用工具完成整本书。不要向用户提问，除非处于 interactive 模式。

用户的一句话：
{{premise}}

默认约束：
- 语言：简体中文
- 目标字数：{{target_words}}
- 单章字数：{{chapter_words}}
- 视角/时态：{{pov}} / {{tense}}
- 自主级别：{{autonomy}}
- 成本上限：{{budget_cap}}

工作规则：
1. 先调用 bible.generate；校验通过后再 outline.generate。
2. 大纲通过校验后，逐章调用 chapter.context → chapter.draft → chapter.review → chapter.extract_state → chapter.commit。
3. 你不写正文；正文由 chapter.draft 完成。
4. 不发明 cast 之外的重要角色；需要时先 cast.add。
5. 不提前写下一章剧情；遵守大纲边界。
6. 审核 revise 时调用 chapter.revise，最多 2 轮；block 记录问题并按策略继续。
7. 每章完成后更新 run_memory；不要重复已完成章节。
8. 所有章节完成后调用 manuscript.assemble 和 manuscript.export，并输出 run.report。
9. 如果预算/时间/失败次数超限，调用 run.checkpoint 暂停并报告。
10. 你的输出是工具调用和简短状态说明，不是小说正文。
```

---

## 19. 附录 C：最小目录结构

```
novelbuilder-next/
  apps/
    desktop/                 # Electron + Vue，极简 UI
  services/
    story-engine/            # Python FastAPI，确定性故事服务
      app/
        api/
        domain/
        context/
        validation/
        state/
        export/
        prompts/             # 版本化提示词
        schemas/             # JSON Schema
      tests/
    agent-runtime/           # Node + Pi SDK
      src/
        runtime/             # createAgentSession / events / control
        tools/               # story_* 工具
        ai/                  # AiGateway / PiAiGateway
        director/            # Director prompt + run memory
        writers/             # ChapterWriter / Reviewer / Extractor
      tests/
  packages/
    contracts/               # OpenAPI / JSON Schema / TS types
  data/                      # 本地 SQLite / 项目文件（运行时）
```

---

**完成标志：** 用户输入一句话，系统自动产出可读的完整长篇草稿、故事圣经、大纲、审核/连续性报告，并可一键导出；整个过程除可选的暂停/反馈外，不需要任何结构化操作。
