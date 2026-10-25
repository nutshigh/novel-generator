# NovelBuilder UI 改版与全局模型设置

- 日期：2026-10-24
- 状态：待评审
- 范围：`agent-runtime` 的 Web UI、设置存储与 API、品牌改名
- 参考稿：`.superpowers/brainstorm/design/content/design-c.html`、`design-c-settings.html`

## 1. 背景与目标

当前页面把「运行模式」和「模型配置」直接铺在首屏，信息层级混乱：演示模式与真实模型并列，模型字段占据主版面，设置只在提交时保存，视觉也停留在基础表单样式。

本次改造要解决四件事：

1. 去掉页面上的「运行模式」，Web 端只走真实模型。
2. 模型配置移入右上角「全局设置」抽屉，不再占用创作版面。
3. 配置填写后自动保存到本机，之后打开页面和每次生成都复用。
4. 按已确认的「现代编辑室」方向重做页面，品牌改为 **NovelBuilder**。

成功标准：

- 首屏只保留创作相关内容：故事前提、章节/字数、生成按钮、进度与事件。
- 首次打开且没有任何可用配置时，页面引导用户完成模型设置；配置完成后不再打扰。
- 修改任一模型字段后无需点保存，关闭抽屉、刷新页面、重启服务后配置仍在。
- 接口响应、服务端日志、导出文件中不会出现 API Key 明文；抽屉关闭后输入框立即清空。
- 现有生成流水线、SSE 进度、导出能力不变。

## 2. 非目标

- 不做项目库、提示词库等多页面导航；顶栏不放无实际功能的链接。
- 不做模型连通性测试按钮。
- 不做多用户、账号、权限体系。
- 不改故事生成流水线、提示词、字数控制、审校逻辑。
- Web 端移除演示模式，但服务端与 CLI 的 `fake` 能力保留，仅供测试和 `--fake` 调试。
- 不加密磁盘上的 API Key；依赖本地文件权限与「不回传浏览器」控制风险。

## 3. 关键决策

| 决策 | 结论 |
| --- | --- |
| 视觉方向 | 方案 C「现代编辑室」：浅灰底、白卡片、森林绿、克制的圆角与阴影 |
| 品牌 | 全量改名 NovelForge → NovelBuilder |
| 设置位置 | 右侧全局设置抽屉，齿轮或模型状态胶囊打开 |
| 设置存储 | 服务端 JSON 文件 `agent-runtime/.agent/settings.json` |
| API Key | 保存到同一文件，接口只返回 `hasApiKey`，不回显明文 |
| 保存时机 | 输入防抖 700ms 自动保存；关闭抽屉、协议切换时立即落盘 |
| 运行模式 | Web 端删除；提交时不再发送 `fake` 开关 |
| 配置解析顺序 | 请求体 `modelConfig`（兼容）→ 已保存设置 → `.env` 默认配置 |
| 演示模式 | 仅从 UI 移除；`FakeAiGateway`、`--fake`、`NOVELBUILDER_FAKE` 保留 |

## 4. 信息架构与页面设计

### 4.1 整体布局

- 最大内容宽度 1220px，左右 30px 安全边距。
- 顶栏 sticky，高 66px，底部 1px 分隔线，背景 `rgba(245,245,241,.86)` + 14px 模糊。
- 顶栏左侧：30px 方形 Logo（深墨底、白色 `N`）+ 文字 **NovelBuilder**。
- 顶栏右侧：模型状态胶囊 + 齿轮按钮。
- 主体：标题区 + 两栏网格（主栏自适应，右栏 372px，间距 22px）。
- 980px 以下切单栏，隐藏顶栏导航，抽屉占满宽度。

参考稿里的「项目库 / 提示词」导航、今日字数徽标和三张产物小卡只用于展示气质；本次不复刻这些无后端支撑的元素，避免死链接和伪造数据。

视觉变量：

```css
--bg:#f5f5f1; --surface:#fff; --surface-2:#fafaf7;
--ink:#15171a; --ink-2:#3c4147; --muted:#767b83;
--line:#e5e5df; --line-2:#d5d6cf;
--accent:#1f5b4e; --accent-dark:#17453b; --accent-soft:#e8f0ed;
--warm:#d9603f; --warm-soft:#fbeae4;
```

字体：正文用系统无衬线；标题中的关键词用宋体（`Songti SC` / `Noto Serif SC`）；数字、标签、Base URL 用等宽字体。无外部字体与图片请求。

### 4.2 标题区

- 小标签：`NEW STORY`，前面 18px 森林绿短线。
- 主标题：`从一个念头，长出一部小说。`，其中「长出一部小说」用宋体 + 森林绿。
- 说明文字：一句话概括故事圣经、大纲、逐章写作、连续性维护。
- 不放「今日字数」等伪造统计。

### 4.3 创作卡

结构从上到下：

1. 卡头：步骤编号 `01` + 「故事前提」+ 右侧「必填」标记。
2. 大文本域：宋体 18.5px，浅色底，聚焦时白底 + 森林绿描边 + 4px 柔光。
3. 字符计数：右下角显示「N 字」。不设硬上限，200 字仅为推荐长度。
4. 三张参数卡：章节数、每章字数、全书预计。
   - 章节数：数字输入，1–40。
   - 每章字数：数字输入，200–20,000，步进 100。
   - 全书预计：只读，等于章节数 × 每章字数，千分位显示。
5. 卡底栏：
   - 左侧保存提示：绿色勾 + `{模型名} · 配置已自动保存`；仅使用 `.env` 时显示 `{envModel} · 来自服务器 .env`；未配置时显示琥珀色点 + `尚未配置模型`，点击打开设置。
   - 右侧主按钮 `开始生成`；运行中按钮禁用并显示 `生成中…`，旁边出现 `停止生成` 次要按钮。

参数卡同步逻辑：任一输入变化时立即重算「全书预计」；非法或越界值在失焦时回落到默认值（章节 6、每章 800）。

### 4.4 右栏

**运行概览卡**

- 卡头：`运行概览` + 状态胶囊（待命 / 生成中 / 已完成 / 失败）。
- 进度环：直径 58px，conic-gradient 按「已完成章节 / 总章节」显示，中心 `N/M`。
- 主状态行：`第 N 章正在写作` 或 `等待开始`，副文案为实时字数。
- 纵向阶段列表，共 7 项：故事圣经、章节大纲、逐章写作、审校、状态同步、导出、完成。已完成项实心勾，当前项空心点 + 光圈，失败项暖红。
- 两格数据：实时字数、已用时（前端从提交成功开始计时，每秒刷新；结束后停止）。

**事件流卡**

- 卡头：`事件流` + 条数。
- 列表保留现有 SSE 事件的阶段标签、消息、时间（前端接收时刻 HH:mm:ss）。
- 最多展示 200 条，容器最大高度约 220px，可滚动，自动滚到底部。
- 空状态：`等待开始。填写故事前提后点击“开始生成”。`

**错误提示**

- 表单错误显示在创作卡底部；运行错误显示在运行概览卡底部。
- 暖红底、深红字，保留 `role="alert"`。

### 4.5 结果区

生成完成后，在两栏下方出现整宽结果卡：

- 眉标 `手稿已完成` + 故事标题（取 `book.md` 一级标题，缺失时用 premise）。
- 两个数据：章节数、总字数。
- 两个链接：`打开 book.md`、`查看项目档案`，均新标签打开。
- 手稿预览：等宽/正文混排的只读区域，最多 2400 字，超出加省略号。
- 结果卡出现时平滑滚动到可视区域；`prefers-reduced-motion` 下直接跳转。

### 4.6 全局设置抽屉

- 触发：右上角齿轮按钮、模型状态胶囊、未配置时的卡底提示。
- 形态：右侧滑入抽屉，宽 456px；遮罩 `rgba(18,22,20,.34)` + 2px 模糊；`role="dialog"`、`aria-modal="true"`。
- 头部：眉标 `GLOBAL SETTINGS`、标题「全局设置」、说明「模型配置只在这里维护，填写后自动保存，之后每次创作都会复用。」、关闭按钮。
- 当前状态条：
  - 已保存完整配置：绿点 + 模型名 + `OpenAI 兼容 · {host}` + 「已连接」标签。
  - 仅有 `.env` 配置：绿点 + env 模型名 + `来自服务器 .env`。
  - 保存了部分字段且 `.env` 可用：琥珀点 + `配置不完整` + `当前仍使用 .env（{envModel}）`。
  - 保存了部分字段且 `.env` 不可用：琥珀点 + `配置不完整` + 「需要配置」标签。
  - 未配置：琥珀点 + `尚未配置模型` + 「需要配置」标签。
- 字段：
  1. **API 协议**：分段单选（OpenAI 兼容 / Anthropic）。用真实 radio input 保证键盘可用。
  2. **模型名称**：等宽输入，placeholder `例如：deepseek-chat`。
  3. **Base URL**：等宽输入，placeholder `https://api.example.com/v1`，提示必须带 http(s)。
  4. **API Key**：
     - 已有 Key：输入框为空，placeholder 为 `••••••••（已保存）`，下方绿字「已保存在本机，页面不会回显明文」，右侧「清除」文字按钮。
     - 无 Key：placeholder `sk-…`，可输入。
     - 输入新值即替换；清空输入框不会删除已保存的 Key（需点「清除」）。
- 底部说明：配置写入 `agent-runtime/.agent/settings.json`，不上传、不写入作品文件。
- 抽屉底栏：
  - 左侧保存状态：`保存中…` / `已保存 14:32` / `保存失败，重试`，带 `aria-live="polite"`；配置不完整时显示琥珀色 `配置不完整`。
  - 右侧：`清除配置`（两步确认：点击后变成「确认清除？取消」）与 `完成`。
- 关闭方式：关闭按钮、`完成`、点击遮罩、`Esc`。
- 打开时锁定页面滚动；焦点移入抽屉；Tab 在抽屉内循环；关闭后焦点回到触发元素。

### 4.7 首次使用与错误流

- 启动时 `GET /api/settings`：
  - `usable === true`：正常显示。
  - `usable === false`：模型胶囊显示「未配置模型」，本次页面加载自动打开设置抽屉一次（用户关闭后不再强制弹出）。
- 点击「开始生成」但配置不可用：
  - 不提交运行；
  - 打开设置抽屉，聚焦第一个缺失字段；
  - 创作卡底部提示「请先完成模型设置，或配置服务器 .env」。
- 提交返回 `400` 且 `code === "model_not_configured"`：按上一条处理。
- 设置读取失败：胶囊显示「设置不可用」，抽屉内显示重试按钮；不阻塞页面浏览。
- 保存失败：保留当前输入，底栏显示失败并提供重试；下次输入或关闭抽屉时再次尝试。

## 5. 设置数据模型与存储

### 5.1 文件

路径：`resolve(NOVELBUILDER_AGENT_DIR || ".agent", "settings.json")`

默认：`agent-runtime/.agent/settings.json`（`.agent/` 已在 `.gitignore` 中）。

文件格式：

```json
{
  "protocol": "openai",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "apiKey": "sk-...",
  "updatedAt": "2026-10-24T06:32:11.000Z"
}
```

允许部分字段为空字符串或 `protocol: null`，用于保存「填到一半」的草稿；是否可用由 `complete` 判断。

### 5.2 模块

新增 `src/settings.ts`：

```ts
export type ModelProtocol = "openai" | "anthropic";

export interface StoredSettings {
  protocol: ModelProtocol | null;
  model: string;
  baseUrl: string;
  apiKey?: string;
  updatedAt: string;
}

export interface SettingsPatch {
  protocol?: ModelProtocol | null | "";
  model?: string;
  baseUrl?: string;
  apiKey?: string;      // 非空才替换
  clearApiKey?: boolean;
}

export interface SettingsStore {
  read(): Promise<StoredSettings | undefined>;
  patch(patch: SettingsPatch): Promise<StoredSettings>;
  clear(): Promise<void>;
}
```

`JsonSettingsStore` 实现要求：

- 目录不存在时递归创建。
- 读取时文件不存在 → `undefined`；JSON 损坏 → 记一条不含敏感信息的警告并视为未配置，不抛到请求层。
- 写入先写 `settings.json.tmp`，再 `rename` 覆盖，避免半写文件。
- 创建文件时使用 `mode: 0o600`（Windows 上为尽力而为）。
- 进程内用 promise 链串行化 `patch` / `clear`，避免并发写互相覆盖。
- 任何日志、异常消息不得包含 `apiKey`。

服务端接入：

- `StartServerOptions` 新增 `settingsPath?: string`，默认 `resolve(agentDir, "settings.json")`；测试用临时目录隔离。
- `ServerContext` 持有 `SettingsStore`，每次请求实时读取，不做长时间缓存。
- 页面修改设置不影响正在进行的运行；当前运行在提交时已经取得模型配置。

### 5.3 可用性判断

`complete` 为真需同时满足：

- `protocol` 是 `openai` 或 `anthropic`；
- `model` 去空格后非空；
- `baseUrl` 去空格后是合法 `http(s)` URL。

`usable` 为 `complete || envConfigured`。`envConfigured` 由 `NOVELBUILDER_PROVIDER` 与 `NOVELBUILDER_MODEL` 同时非空判断。

## 6. HTTP API

所有响应 `cache-control: no-store`。PUT 要求 `content-type: application/json`；PUT 与 DELETE 都执行现有同源校验。

### 6.1 `GET /api/settings`

返回脱敏后的设置：

```json
{
  "protocol": "openai",
  "model": "deepseek-chat",
  "baseUrl": "https://api.deepseek.com/v1",
  "hasApiKey": true,
  "complete": true,
  "usable": true,
  "updatedAt": "2026-10-24T06:32:11.000Z",
  "envConfigured": true,
  "envModel": "deepseek-chat"
}
```

- 文件不存在时返回空值：`protocol: null`、`model: ""`、`baseUrl: ""`、`hasApiKey: false`、`complete: false`、`updatedAt: null`。
- 永不返回 `apiKey` 明文。
- `envModel` 只暴露模型名，不暴露 Key。

### 6.2 `PUT /api/settings`

请求体为 `SettingsPatch`。语义：

- 字段缺省：保留原值。
- `protocol: null` 或 `""`：清空协议。
- `model` / `baseUrl`：字符串，去除首尾空格后保存；允许空字符串。
- `apiKey`：非空字符串才替换；空字符串视为不修改。
- `clearApiKey: true`：删除已有 Key；与 `apiKey` 同时出现时以 `clearApiKey` 为准。
- 长度限制：`model ≤ 200`、`baseUrl ≤ 2000`、`apiKey ≤ 10_000`，超限返回 400。
- 非字符串类型返回 400。

响应与 GET 相同（脱敏）。

### 6.3 `DELETE /api/settings`

清空整个设置文件（含 Key），返回 200 与和 GET 相同的结构：持久化字段为空；如果 `.env` 仍可用，`usable` 与 `envConfigured` 仍为 `true`。

### 6.4 `POST /api/projects`

- `fake` 参数保留；Web UI 不发送。
- 非 fake 时模型解析顺序：
  1. 请求体 `modelConfig`（兼容旧调用）；
  2. 已保存的完整设置（含 Key）；
  3. `.env` 默认配置。
- 三者都没有时返回：

```json
{ "error": "未配置模型。请先在全局设置中填写模型配置。", "code": "model_not_configured" }
```

状态码 400，不返回 500，不泄露环境变量内容。

- 设置文件在每次请求时读取，修改后无需重启。
- 已保存设置不完整但 `.env` 可用时，继续使用 `.env`。
- 已保存设置视为一个整体：若它缺少 Key，不会从 `.env` 借用 Key，避免把不同端点的凭据拼在一起。

## 7. 前端实现

### 7.1 结构

仍由 `src/ui.ts` 导出单个 HTML 字符串，样式与脚本内联，不引入外部资源。现有约束继续成立：

- 不出现 `<link>`；
- 不出现 `<script src=...>`；
- 不出现 `url(http...)`；
- 无第三方前端依赖。

脚本用 IIFE + `var`/`function` 风格，和现有实现保持一致，避免引入构建步骤。

### 7.2 状态

```js
settings = { protocol:null, model:"", baseUrl:"", hasApiKey:false,
             complete:false, usable:false, updatedAt:null,
             envConfigured:false, envModel:"" };
settingsLoaded = false;
settingsOpen = false;
saveTimer = null;
saveRevision = 0;
savedRevision = 0;
runStartedAt = 0;
elapsedTimer = null;
```

### 7.3 自动保存

- `input` / `change` 事件触发 `queueSave()`。
- 700ms 防抖；协议切换、`change` 事件、关闭抽屉时立即 flush。
- 只提交发生变化的字段。API Key 输入框为空时不提交 `apiKey`。
- 保存请求串行执行；每次请求带递增 revision，只有最新 revision 成功才把状态改为「已保存」。
- 成功后用响应更新本地状态、模型胶囊和卡底提示，并用 `HH:mm` 显示保存时间。
- 失败时显示「保存失败，重试」，保留输入；再次输入或关闭抽屉时重试。
- 页面不再使用 `localStorage` 保存模型配置，删除 `novelforge.modelSettings` 相关代码。

### 7.4 设置抽屉

- 打开时先渲染当前内存状态，再 `GET /api/settings` 刷新。
- 顶部状态条、字段值、Key 状态、底栏保存状态由 `renderSettings()` 统一刷新。
- `hasApiKey` 时不填充输入框；用户输入新值后才替换。
- 「清除」Key 走 `PUT { clearApiKey: true }`；「清除配置」走 `DELETE`，需二次确认。
- 关闭时若有待保存修改，先 flush，再关闭（不阻塞界面，保存失败会在下次打开时提示）。

### 7.5 提交与进度

- 提交体：`{ premise, maxChapters, chapterWords }`。
- 不发送 `fake`、`modelConfig`。
- 成功后沿用现有 SSE 订阅、事件去重、阶段推进、章节字数累计、停止请求。
- 阶段顺序保持 `setup → outline → chapter → review → state → export → done`。
- 运行开始时启动计时器，`done` / `error` 时停止。
- 现有结果加载逻辑保留，改为新结果卡样式。

### 7.6 模型胶囊

| 状态 | 文案 | 圆点 |
| --- | --- | --- |
| 读取中 | `读取设置…` | 灰 |
| 已保存且完整 | `{model}` | 绿 |
| 仅 `.env` | `{envModel} · env` | 绿 |
| 未配置 | `未配置模型` | 琥珀 |

点击胶囊打开设置抽屉。

## 8. 品牌与配置改名

全量改名，覆盖所有活跃代码、配置、测试与用户可见文档：

| 旧 | 新 |
| --- | --- |
| `NovelForge`（界面/日志/文档） | `NovelBuilder` |
| `@novelforge/agent-runtime` | `@novelbuilder/agent-runtime` |
| `NOVELFORGE_*` 环境变量 | `NOVELBUILDER_*` |
| provider `novelforge` | `novelbuilder` |
| `$NOVELFORGE_API_KEY` | `$NOVELBUILDER_API_KEY` |
| 页面内 provider `novelforge-ui` | `novelbuilder-ui` |
| `NOVELFORGE_FAKE` | `NOVELBUILDER_FAKE` |

涉及文件：

- `package.json`、`package-lock.json`
- `.env`、`.env.example`
- `agent/models.example.json`、`.agent/models.json`
- `src/config.ts`、`src/server.ts`、`src/generate.ts`、`src/ui.ts`、`src/ai/piGateway.ts`
- `test/config.test.ts`、`test/cli.test.ts`、`test/server.test.ts`、其他临时目录前缀
- `README.md`
- `PHASE0_ACCEPTANCE.md`、`PI_SDK_NOTES.md` 中仍描述当前配置的部分
- `docs/plans/*.md` 中的项目名、包名、env 名称同步替换；**保留**指向旧外部项目真实路径 `F:\project\NovelForge\NovelForge` 的引用，不改写历史路径。

不修改：`.cache/`、`output/`、`demo/`、历史运行日志、`.superpowers/` 下的临时预览文件。

### 8.1 文件改动清单

新增：

- `src/settings.ts`
- `test/settings.test.ts`
- 本设计文档

修改：

- `src/server.ts`：设置路由、配置解析顺序、`settingsPath`、日志前缀
- `src/ui.ts`：整页重写、设置抽屉、自动保存、模型胶囊
- `src/config.ts`：env 名称、`envConfigured` 辅助判断
- `src/generate.ts`：env 名称
- `src/ai/piGateway.ts`：页面 provider 名
- `package.json`、`package-lock.json`
- `.env`、`.env.example`
- `agent/models.example.json`、`.agent/models.json`
- `test/config.test.ts`、`test/cli.test.ts`、`test/server.test.ts`
- `README.md`、`PHASE0_ACCEPTANCE.md`、`PI_SDK_NOTES.md`
- `docs/plans/*.md` 中的活跃名称

迁移动作：

- 直接更新本地 `.env` 与 `.agent/models.json`；
- 重启服务；
- 旧 `NOVELFORGE_*` 变量不再读取；
- 浏览器旧的 `novelforge.modelSettings` 不再使用，可忽略。

## 9. 错误处理与安全

- 设置文件解析失败：记录警告，按未配置处理；GET 仍返回 200 空设置。
- 设置写入失败：GET/PUT 返回 500，前端显示可重试状态。
- API Key 处理：
  - 只进不出：GET/PUT/DELETE 响应均不含 `apiKey`；
  - 不写日志、不拼进错误消息、不进入作品文件；
  - 文件权限 0600（尽力而为）。
- 请求体校验：类型、长度、协议枚举、URL 合法性在生成时再次校验。
- 跨站保护：现有 Origin 校验继续用于 PUT/DELETE/POST。
- 关闭抽屉不自动删除配置；只有显式「清除配置」才删除。
- 清除配置不影响 `.env`。

## 10. 无障碍与响应式

- 所有输入有可见 label；图标按钮有 `aria-label`。
- 协议切换使用 `radiogroup` + `radio`，方向键可切换。
- 抽屉焦点陷阱、Esc 关闭、焦点回归。
- 保存状态、运行状态用 `aria-live="polite"`。
- 颜色对比满足正文 4.5:1；状态不能只靠颜色区分，配文字。
- 760px 以下：参数卡单列，结果区数据两列，顶栏只留品牌、胶囊、齿轮。
- `prefers-reduced-motion` 下关闭滑入、进度过渡与平滑滚动。

## 11. 测试计划

### 11.1 新增 `test/settings.test.ts`

- 文件不存在时 `read()` 返回 `undefined`。
- `patch` 写入后可读回，包含 Key；`updatedAt` 递增。
- 部分字段 patch 不会清掉其他字段。
- 空 `apiKey` 不覆盖旧 Key；`clearApiKey` 删除 Key。
- `clear()` 后文件不存在，后续 `read()` 返回 `undefined`。
- 损坏 JSON 按未配置处理且不抛错。
- 并发 patch 串行化，最终字段不丢失。
- 序列化结果不含意外字段。

### 11.2 `test/server.test.ts` 增补

- 首页包含 `NovelBuilder`、设置抽屉、模型胶囊；不再包含「演示模式」「运行模式」「mode-demo」「mode-real」。
- `GET /api/settings` 空设置结构正确。
- `PUT /api/settings` 保存后返回 `hasApiKey:true`，响应 JSON 字符串中不含 Key 明文。
- 省略 `apiKey` 的 PUT 保留旧 Key；`clearApiKey` 清除。
- 非法协议、超长字段、非 JSON 返回 400/415。
- 保存设置后，不带 `modelConfig` 的 `POST /api/projects` 通过 `gatewayFactory` 捕获到设置中的模型配置与 Key。
- 无设置且无 env 时，真实模型提交返回 400 且 `code === "model_not_configured"`。
- `DELETE /api/settings` 清空后 GET 返回空设置。
- 现有 fake 运行、SSE、中止、结果读取测试保持通过。

### 11.3 既有测试更新

- `config.test.ts`、`cli.test.ts` 的环境变量名与 provider 名改为 NovelBuilder。
- 其他测试中的临时目录前缀改为 `novelbuilder-*`。
- 页面断言改为新 DOM。

### 11.4 手工验收

1. 清空设置文件，启动服务：首屏自动打开设置抽屉。
2. 填写协议、模型、Base URL、Key，观察「保存中 → 已保存」。
3. 关闭抽屉并刷新：字段仍在，Key 显示已保存，胶囊显示模型名。
4. 重启服务后再次打开：配置仍生效。
5. 不填 Key 提交生成：运行开始，若端点要求鉴权则显示模型错误（预期）。
6. 点击停止：运行中止，界面恢复可提交。
7. 移动端 390px 宽：单栏、抽屉全宽、无横向滚动。
8. 键盘：Tab 可在抽屉内循环，Esc 关闭，协议可用方向键切换。

### 11.5 验证命令

```powershell
cd F:\project\novel-generator\agent-runtime
npm run typecheck
npm test
npm run serve
```

## 12. 实施顺序

1. 品牌与 env 全量改名，跑通 typecheck 与现有测试。
2. 新增 `settings.ts` 与单元测试。
3. 接入 HTTP 设置接口与生成配置解析，补服务端测试。
4. 重写 `ui.ts` 页面结构与样式。
5. 实现设置抽屉、自动保存、模型胶囊与首次引导。
6. 更新 README 与验收文档。
7. 手工验收 + 全量测试。

## 13. 验收清单

- [ ] Web 端无演示/真实切换，提交始终走真实模型。
- [ ] 模型配置只出现在全局设置抽屉。
- [ ] 配置修改后自动保存，刷新和重启后复用。
- [ ] API Key 不回传页面、不出现在日志与作品中。
- [ ] 页面符合方案 C 的布局、色彩与排版。
- [ ] 首次无配置时自动引导设置。
- [ ] 现有生成、SSE、停止、结果预览全部可用。
- [ ] `npm run typecheck` 与 `npm test` 通过。
- [ ] README 与配置示例全部使用 NovelBuilder / `NOVELBUILDER_*`。
