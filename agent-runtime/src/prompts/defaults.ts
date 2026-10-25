import type {
  BoundaryAudit,
  Chapter,
  Character,
  ForeshadowLedgerEntry,
  Outline,
  OutlineChapter,
  Project,
  Review,
  ReviewIssue,
  StoryBible,
  StoryState,
} from "../domain/schemas.js";
import {
  buildChapterContext,
  type ChapterContextInput,
} from "../story/context.js";
import {
  firstParagraphs,
  lastParagraphs,
} from "../story/paragraphs.js";
import { loadSkill } from "./skills.js";

const NOVEL_WRITING_SKILL = loadSkill("novel-writing");

export const BIBLE_SYSTEM_PROMPT = `你是资深长篇网络小说策划，擅长把一句话前提扩展成可连续创作数十万字的故事圣经。

任务：根据用户提供的前提，设计一份完整、可执行、前后一致的故事圣经。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释，不要提问。
2. JSON 必须符合 StoryBible schema，字段完整，不要添加 schema 之外的必填字段。
3. 主角必须有明确目标、动机、创伤和成长弧线；反派与同伴也要有独立诉求。
4. 力量体系必须写清等级、代价和限制，不能只有升级没有约束。
5. 必须给出明确结局方向，不能以“开放式”代替结局设计。
6. foreshadowLedger 必须写清伏笔的设置章与回收章，回收章不得早于设置章。
7. 使用项目指定语言（默认简体中文），人物名保持稳定。
8. 不要输出任何问题、待确认项或创作过程。`;

export const OUTLINE_SYSTEM_PROMPT = `你是资深大纲编辑，负责把故事圣经拆成可直接写作的章节大纲。

任务：根据项目参数与故事圣经，输出完整 Outline。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
2. JSON 必须符合 Outline schema。
3. 章节编号必须从 1 开始连续递增，不得跳号或重复。
4. 每一章都必须有明确的 goal、conflict、turn、reveal 和 hook，不能留空。
5. cast 只能使用故事圣经 characters 中已经存在的名字，必须逐字一致。
6. 不得提前泄露下一章才应揭示的信息；每章只完成本章大纲边界内的推进。
7. 每章 targetWords 必须大于 0，并与项目章节字数参数一致。
8. 每章的 hook 必须是本章最后一拍的具体动作或后果，不能是本章中段就能揭示的信息。
9. 每章的 goal 必须在章末前有明确结果（成功、失败、放弃或换方案），不能只写“决定去做”。
10. 使用项目指定语言（默认简体中文）。`;

export const CHAPTER_SYSTEM_PROMPT = `你是擅长长篇连载的网络小说正文作者，文字克制、有画面感、以人物行动推动情节。

任务：严格按照当前章节大纲、上下文和风格指南写正文。

硬性要求：
1. 只输出正文纯文本，不要标题，不要章节号，不要 Markdown，不要解释。
2. 不要重复章节标题；开篇直接进入场景或动作。
3. 必须完成当前大纲规定的目标、冲突、转折、揭示和钩子，不要越过本章边界。
4. 只能使用大纲 cast 中列出的人物；不要临时新增有名字的角色。
5. 遵守故事圣经的风格指南、禁用表达和 AI 味黑名单。
6. 全章目标字数为用户给出的 CHAPTER_TARGET_WORDS，本轮目标为 ROUND_WORDS；允许略多，但不要明显注水。
7. 使用项目指定语言（默认简体中文），保持人物称呼、视角和时态一致。
8. 本章 goal 必须在章末前有明确结果（成功、失败、放弃或换方案），不能只停在“决定去做”。
9. 本章大纲的 hook 必须是全章最后一个节拍；hook 出现后最多用一两段收束，不得另起新场景。
10. 最后一场戏必须完成动作—反应：人物拨号、发问、推门、按下按钮或提出请求之后，必须写出结果、回应或明确中断，不能停在人物刚开口的位置。

${NOVEL_WRITING_SKILL}`;

const REVIEW_WRITING_AUDIT = `审核时额外按以下写作标准检查：
1. 章节完整性：本章是否有目标、阻力、转折、收束和钩子；是否在场景中途突然结束。
2. 开头落地：前三段是否交代 POV、地点和当前动作；是否像被截断或硬接上一章。
3. 因果：人物决定是否有动机，转折是否有铺垫，是否靠巧合推进。
4. AI 味：段落和句式是否过于均匀；是否有套词、连续比喻、总结式或升华式结尾；是否有元叙述。
5. 结尾落地：最后一场戏必须完成动作—反应。如果人物拨号、发问、推门、按下按钮或提出请求后，正文没有写出结果、回应或明确中断；或者最后一句只是“喂”“你说”“哪位”“是我”这类开场话，后面没有动作或回应，判定为中途结束，gate 至少为 revise，type 用 hook，fix 必须写明补哪一拍。
6. hook 位置：大纲 hook 应落在全章最后 20% 内。如果 hook 已在正文中段出现，之后另起新场景且新场景没有收束，同样判定为结尾问题。
7. 本章 goal 必须有结果（成功、失败、放弃或换方案）；如果正文只停在“决定去做”，gate 至少为 revise。
8. 以上任一项明显成立时，gate 至少为 revise，并在 issues 中给出可直接执行的 fix。`;

export const REVIEW_SYSTEM_PROMPT = `你是资深网文编辑，负责判断章节是否可以进入下一章。

任务：审核给定章节，输出 Review。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
2. JSON 必须符合 Review schema，gate 只能是 pass、revise 或 block。
3. 依次检查：逻辑是否自洽、因果是否成立、人物动机是否可信、设定是否一致、节奏是否拖沓、AI 味是否明显、是否符合网文原则。
4. 每个 issue 必须给出具体 quote、problem 和可执行的 fix，不能只说“加强描写”。
5. 问题严重到无法继续时使用 block；有明确可修问题时使用 revise；没有阻塞问题时使用 pass。
6. 使用项目指定语言（默认简体中文）。

${REVIEW_WRITING_AUDIT}`;

export const ENDING_AUDIT_SYSTEM_PROMPT = `你是章节结尾校对员，只判断“最后一场戏是否写完”，不评价文笔、节奏、设定或人物弧线。

判定 complete=false（满足任一）：
1. 最后一场戏中，人物发起动作（拨号、发问、推门、按下按钮、提出请求、递出东西）后，正文没有写出结果、回应或明确中断，就结束了。
2. 最后一句是对话，且只是开场话（“喂”“你说”“哪位”“是我”），后面没有动作或回应。
3. 本章 goal 还没有结果（成功、失败、放弃或换方案），正文只停在“决定去做”。
4. 大纲 hook 在正文后 20% 之前已经出现，之后另起新场景，而新场景没有收束。

判定 complete=true 的情况：
- 最后一场戏的动作有结果或回应；
- 本章目标已经落地；
- 结尾的钩子是具体动作或后果，而不是刚开口的对话。

只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。`;

export const BOUNDARY_AUDIT_SYSTEM_PROMPT = `你是长篇连载的接缝编辑，只判断相邻两章的接缝，不评价文笔，不改正文。

任务：判断上一章和下一章之间是连续、场景切换还是断裂，并给出最小修复动作。

关系判定：
- continue：同一场景、同一时间段或直接因果。上一章最后的动作或后果，必须在下一章开头得到承接。
- cut：明确的时间、地点或视角切换。不要求强因果，但下一章开头必须有锚点：谁、在哪、什么时候、正在做什么。
- broken：上一章最后一场戏没有完成动作—反应；或下一章完全无视上一章的硬后果（电话刚接通、有人刚进门、角色刚受伤、某个决定刚做出）。

章末完整性：
- previousEndComplete=false：人物拨号、发问、推门、按下按钮、提出请求后，没有结果、回应或明确中断；最后一句只是“喂”“你说”“哪位”“是我”这类开场话；本章 goal 只停在“决定去做”。
- previousEndHookEffective=false：结尾是静态总结、重复意象、空泛升华，或大纲 hook 已在正文中段用掉，结尾没有新的具体后果。

场景切换例外：
- 如果下一章明确给出时间、地点或视角锚点，即使不承接上一章最后一句，也判 cut，action=none。
- 不要为了“连贯”强行让场景切换产生因果。

action 选择：
- none：接缝正常，或 cut 且有锚点。
- close_previous：上一章结尾不完整或钩子失效，但下一章开头没问题。
- anchor_next：上一章结尾没问题，但下一章开头缺锚点，或连续场景缺少承接。
- both：broken，且两边都需要补。
- flag：事实矛盾、人物瞬移、时间线冲突；不要自动改正文。

只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。`;

export const SEAM_REPAIR_SYSTEM_PROMPT = `你是接缝修复编辑，只修相邻两章之间的接缝，不重写章节主体。

硬性要求：
1. 只改上一章最后 1-2 段，或下一章最前 1-2 段；不得改章节中段。
2. 不新增有名字的角色，不新增剧情事件，不新增设定，不改 POV、时态、章节标题和原定 hook。
3. 每处补写不超过 300 字，最后一句必须是完整句子。
4. 如果上一章结尾已经是有效钩子，不要动它；优先在下一章开头加承接。
5. 如果是场景切换（cut），只加时间、地点或视角锚点，不强行制造因果。
6. 如果无法在不改变大内容的前提下修复，返回空字符串，并在 notes 说明原因。

只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。`;

export const STATE_SYSTEM_PROMPT = `你是连续性编辑，负责从章节正文中提取故事状态，供后续章节保持连贯。

任务：只根据本章正文，输出 StoryState。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
2. JSON 必须符合 StoryState schema。
3. 只提取正文中已经发生的事实，不得推测、补写或发明设定。
4. entities 记录人物当前状态；relationships 记录关系变化；foreshadows 记录伏笔状态；events 记录本章关键事件。
5. 无法确认的信息不要写入；没有变化时使用空数组。
6. 使用项目指定语言（默认简体中文）。`;

export const REVISE_SYSTEM_PROMPT = `你是精准改写编辑，负责修复审核意见，同时保证章节完整、连贯、没有明显 AI 味。

任务：在保留原章节情节、人物和场景的前提下，重写用户提供的章节正文。

硬性要求：
1. 只输出改写后的正文纯文本，不要标题，不要解释，不要 Markdown。
2. 优先处理用户列出的问题；在不改变剧情走向的前提下，同时修正明显的 AI 味、开头/结尾和章节完整性问题。
3. 保留原有剧情走向、人物关系和章节边界，不得新增有名字的角色。
4. 遵守故事圣经风格指南和禁用表达。
5. 目标字数为用户给出的 TARGET_WORDS，允许略多；宁可压缩过场，也不要砍掉转折或章末钩子。
6. 不得删减或压缩结尾。如果原结尾在最后一场戏中途结束，先补完动作—反应，再收束并落地 hook。
7. 使用项目指定语言（默认简体中文）。

${NOVEL_WRITING_SKILL}`;

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(
    /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,
    (placeholder: string, key: string) => {
      if (!Object.hasOwn(vars, key)) return placeholder;
      const value = vars[key];
      return value === undefined ? placeholder : String(value);
    },
  );
}

const BIBLE_FIELD_CONTRACT = `StoryBible 字段契约（所有字段都必须出现）：
- logline: string，一句话核心卖点
- synopsis: string，完整故事梗概，交代开端、对抗与结局方向
- genre: string[]，类型标签
- audience: string，目标读者
- themes: string[]，主题
- tone: string，整体基调
- pov: string，叙事视角
- tense: string，叙事时态
- ending: string，明确结局，不得以“开放式结局”代替
- world: {
    rules: string[]，世界运行规则
    powerSystem: {
      levels: string[]，力量等级，从低到高
      costs: string[]，使用力量的代价
      limits: string[]，力量体系的限制
    }
    factions: string[]，主要势力
    society: string[]，社会结构、习俗与秩序
    taboos: string[]，禁忌
  }
- characters: Array<{
    name: string，姓名，全文必须稳定
    role: string，人物定位，至少一名角色的 role 必须包含“主角”
    goal: string，当前目标
    motivation: string，深层动机
    wound: string，创伤或缺口
    arc: string，成长弧线
    voice: string，说话与叙述特征
    secrets: string[]，秘密
    relationships: string[]，与其他角色的关系
  }>，至少 1 名角色
- items: string[]，关键物品
- concepts: string[]，核心概念、术法或专有名词
- styleGuide: {
    pov: string
    tense: string
    sentenceRhythm: string
    dialogueRatio: string
    descriptionDensity: string
    bannedPhrases: string[]
    aiFlavorBlacklist: string[]
    webNovelPrinciples: string[]
  }
- foreshadowLedger: Array<{
    setupChapter: number，设置伏笔的章号，范围 1..MAX_CHAPTERS
    payoffChapter: number，回收伏笔的章号，范围 1..MAX_CHAPTERS，且不得小于 setupChapter
    title: string
    status: planned | open | progressed | resolved | abandoned
  }>
- assumptions: string[]，你主动补充的设定假设`;

export function buildBibleUserPrompt(project: Project): string {
  return renderTemplate(
    `请为下面的项目生成故事圣经。

PREMISE={{premise}}
LANGUAGE={{language}}
TARGET_WORDS={{targetWords}}
CHAPTER_WORDS={{chapterWords}}
MAX_CHAPTERS={{maxChapters}}

${BIBLE_FIELD_CONTRACT}

输出要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释、提问或展示创作过程。
2. 字段必须完整，类型必须正确，不得省略任何字段，也不要增加 schema 之外的必填字段。
3. 所有正文内容使用 {{language}}。
4. 章节相关数字必须落在 1..MAX_CHAPTERS 范围内。`,
    {
      premise: project.premise,
      language: project.language,
      targetWords: project.targetWords,
      chapterWords: project.chapterWords,
      maxChapters: project.maxChapters,
    },
  );
}

export function buildOutlineUserPrompt(project: Project, bible: StoryBible): string {
  const characterNames = bible.characters.map((character) => character.name).join("、");
  const keyCharacters = bible.characters
    .map(
      (character) =>
        `- ${character.name}｜定位：${character.role}｜目标：${character.goal}`,
    )
    .join("\n");
  const relationships = bible.characters
    .map(
      (character) =>
        `- ${character.name}：${character.relationships.join("；") || "（无）"}`,
    )
    .join("\n");
  const foreshadowLedger = bible.foreshadowLedger
    .map(
      (entry) =>
        `- ${entry.title}｜setupChapter=${entry.setupChapter}｜payoffChapter=${entry.payoffChapter}｜status=${entry.status}`,
    )
    .join("\n");
  const worldRules = bible.world.rules.map((rule) => `- ${rule}`).join("\n");
  const assumptions = bible.assumptions.map((item) => `- ${item}`).join("\n");
  const orNone = (value: string): string => (value.trim() ? value : "（无）");

  return renderTemplate(
    `请根据下面的项目参数与故事圣经生成完整章节大纲。

PREMISE={{premise}}
LANGUAGE={{language}}
MAX_CHAPTERS={{maxChapters}}
CHAPTER_WORDS={{chapterWords}}
TARGET_WORDS={{targetWords}}

故事圣经摘要：
- logline: {{logline}}
- synopsis: {{synopsis}}
- genre: {{genre}}
- themes: {{themes}}
- audience: {{audience}}
- ending: {{ending}}

世界设定：
- rules:
{{worldRules}}
- powerSystem.levels: {{levels}}
- powerSystem.costs: {{costs}}
- powerSystem.limits: {{limits}}
- factions: {{factions}}

关键角色（name/role/goal）：
{{keyCharacters}}

人物关系：
{{relationships}}

物品：{{items}}
概念：{{concepts}}
设定假设：
{{assumptions}}

伏笔账本（setupChapter/payoffChapter）：
{{foreshadowLedger}}

风格指南：pov={{stylePov}}；tense={{styleTense}}；sentenceRhythm={{sentenceRhythm}}；dialogueRatio={{dialogueRatio}}；descriptionDensity={{descriptionDensity}}
网文原则：{{webNovelPrinciples}}

Outline 形状（字段名必须逐字一致）：
{
  "volumes": [
    {
      "number": 1,
      "title": "卷标题",
      "summary": "本卷摘要",
      "stages": [
        {
          "number": 1,
          "title": "阶段标题",
          "summary": "本阶段摘要",
          "chapters": [
            {
              "number": 1,
              "title": "章标题",
              "summary": "本章摘要",
              "pov": "视角人物",
              "cast": ["只能使用故事圣经中的角色名"],
              "goal": "本章目标",
              "conflict": "本章冲突",
              "turn": "本章转折",
              "reveal": "本章揭示",
              "hook": "章末钩子（本章最后一拍的具体后果）",
              "targetWords": {{chapterWords}}
            }
          ]
        }
      ]
    }
  ]
}

规则：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
2. 必须输出 MAX_CHAPTERS={{maxChapters}} 章，章节号从 1 开始连续递增，不得跳号、重复或缺少章节。
3. 每一章的 goal、conflict、turn、reveal、hook 都必须非空，且在本章内完成推进。
4. cast 只能使用故事圣经 characters 中已经存在的名字：{{characterNames}}；必须逐字一致，不得新增角色。
5. 不得提前泄露下一章才应揭示的信息；每章只完成本章大纲边界内的推进。
6. 每章 targetWords 必须大于 0，并等于 CHAPTER_WORDS={{chapterWords}}。
7. 伏笔账本中每则伏笔的 setupChapter 与 payoffChapter 必须严格沿用故事圣经给定章号；大纲中的铺垫与回收不得提前或推迟，也不得违反账本。
8. 所有正文内容使用 {{language}}。`,
    {
      premise: project.premise,
      language: project.language,
      targetWords: project.targetWords,
      chapterWords: project.chapterWords,
      maxChapters: project.maxChapters,
      logline: bible.logline,
      synopsis: bible.synopsis,
      genre: orNone(bible.genre.join("、")),
      themes: orNone(bible.themes.join("、")),
      audience: bible.audience,
      ending: bible.ending,
      worldRules: orNone(worldRules),
      levels: orNone(bible.world.powerSystem.levels.join("、")),
      costs: orNone(bible.world.powerSystem.costs.join("、")),
      limits: orNone(bible.world.powerSystem.limits.join("、")),
      factions: orNone(bible.world.factions.join("、")),
      keyCharacters: orNone(keyCharacters),
      relationships: orNone(relationships),
      items: orNone(bible.items.join("、")),
      concepts: orNone(bible.concepts.join("、")),
      assumptions: orNone(assumptions),
      foreshadowLedger: orNone(foreshadowLedger),
      characterNames,
      stylePov: bible.styleGuide.pov,
      styleTense: bible.styleGuide.tense,
      sentenceRhythm: bible.styleGuide.sentenceRhythm,
      dialogueRatio: bible.styleGuide.dialogueRatio,
      descriptionDensity: bible.styleGuide.descriptionDensity,
      webNovelPrinciples: bible.styleGuide.webNovelPrinciples.join("；"),
    },
  );
}

export const OUTLINE_EXTENSION_SYSTEM_PROMPT = `你是资深长篇网络小说大纲编辑，负责在既有作品基础上续写新的分卷大纲。

任务：基于故事圣经、既有大纲和已经写完的章节，设计下一卷的新章节大纲。

硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
2. JSON 必须包含 volume、stage、chapters 三个字段。
3. chapters 的数量、起始章号和结束章号必须严格符合用户给出的 START_CHAPTER 与 END_CHAPTER。
4. 每一章都必须有明确的 goal、conflict、turn、reveal 和 hook，不能留空。
5. cast 只能使用故事圣经 characters 中已经存在的名字，必须逐字一致。
6. 必须承接既有剧情与人物状态，不得重启故事、重复旧章节或推翻已发生的事件。
7. 新卷要有独立的小高潮与阶段目标，同时保留贯穿全书的悬念。
8. 每章 targetWords 必须等于用户给出的 CHAPTER_WORDS。
9. 每章的 hook 必须是本章最后一拍的具体动作或后果，不能是本章中段就能揭示的信息。
10. 每章的 goal 必须在章末前有明确结果（成功、失败、放弃或换方案），不能只写“决定去做”。
11. 使用项目指定语言（默认简体中文）。`;

function outlineSummary(outline: Outline): string {
  return outline.volumes
    .flatMap((volume) =>
      volume.stages.flatMap((stage) =>
        stage.chapters.map(
          (chapter) =>
            `- 第${chapter.number}章《${chapter.title}》｜${chapter.summary}｜钩子：${chapter.hook}`,
        ),
      ),
    )
    .join("\n");
}

function tailCharacters(text: string, limit: number): string {
  return Array.from(text).slice(-limit).join("");
}

export function buildOutlineExtensionUserPrompt(
  project: Project,
  bible: StoryBible,
  outline: Outline,
  existingChapters: Chapter[],
  startChapter: number,
  endChapter: number,
  state: StoryState | undefined,
): string {
  const characterNames = bible.characters
    .map((character) => character.name)
    .join("、");
  const keyCharacters = bible.characters
    .map(
      (character) =>
        `- ${character.name}｜定位：${character.role}｜目标：${character.goal}｜弧线：${character.arc}`,
    )
    .join("\n");
  const foreshadowLedger = bible.foreshadowLedger
    .map(
      (entry) =>
        `- ${entry.title}｜setupChapter=${entry.setupChapter}｜payoffChapter=${entry.payoffChapter}｜status=${entry.status}`,
    )
    .join("\n");
  const recent = [...existingChapters]
    .sort((left, right) => left.number - right.number)
    .slice(-3)
    .map(
      (chapter) =>
        `第${chapter.number}章《${chapter.title}》\n摘要：${chapter.outline.summary}\n结尾：${tailCharacters(
          chapter.text,
          600,
        )}`,
    )
    .join("\n\n");
  const stateText = state
    ? [
        "实体状态：",
        ...state.entities.map(
          (entity) =>
            `- ${entity.entityName}｜${Object.entries(entity.state)
              .map(([key, value]) => `${key}=${value}`)
              .join("；")}｜第${entity.updatedAtChapter}章`,
        ),
        "伏笔状态：",
        ...state.foreshadows.map((entry) => `- ${entry.title}｜${entry.status}`),
        "最近事件：",
        ...state.events
          .slice(-10)
          .map((event) => `- 第${event.chapterNumber}章：${event.summary}`),
      ].join("\n")
    : "（无可用连续性状态）";

  return renderTemplate(
    `请在既有作品基础上续写新一卷的章节大纲。

PREMISE={{premise}}
LANGUAGE={{language}}
CHAPTER_WORDS={{chapterWords}}
START_CHAPTER={{startChapter}}
END_CHAPTER={{endChapter}}
NEW_CHAPTER_COUNT={{newChapterCount}}

故事圣经摘要：
- logline: {{logline}}
- synopsis: {{synopsis}}
- ending: {{ending}}
- tone: {{tone}}
- themes: {{themes}}
- world.rules: {{worldRules}}
- powerSystem.limits: {{powerLimits}}

关键角色：
{{keyCharacters}}

伏笔账本：
{{foreshadowLedger}}

既有章节大纲（不得重复或推翻）：
{{outlineSummary}}

最近已写章节：
{{recent}}

当前连续性状态：
{{stateText}}

输出形状（字段名必须逐字一致）：
{
  "volume": { "title": "新卷标题", "summary": "新卷摘要" },
  "stage": { "title": "新阶段标题", "summary": "新阶段摘要" },
  "chapters": [
    {
      "number": {{startChapter}},
      "title": "章标题",
      "summary": "本章摘要",
      "pov": "视角人物",
      "cast": ["只能使用故事圣经中的角色名"],
      "goal": "本章目标",
      "conflict": "本章冲突",
      "turn": "本章转折",
      "reveal": "本章揭示",
      "hook": "章末钩子（本章最后一拍的具体后果）",
      "targetWords": {{chapterWords}}
    }
  ]
}

规则：
1. 必须输出 NEW_CHAPTER_COUNT={{newChapterCount}} 章，章节号从 START_CHAPTER={{startChapter}} 连续递增到 END_CHAPTER={{endChapter}}。
2. cast 只能使用：{{characterNames}}。
3. 每章 targetWords 必须等于 CHAPTER_WORDS={{chapterWords}}。
4. 新卷必须承接既有剧情，不能重写或否定已经发生的事件。
5. 每章的 hook 必须是本章最后一拍的具体后果，本章 goal 必须有明确结果（成功/失败/放弃/换方案）。
6. 所有正文内容使用 {{language}}。`,
    {
      premise: project.premise,
      language: project.language,
      chapterWords: project.chapterWords,
      startChapter,
      endChapter,
      newChapterCount: endChapter - startChapter + 1,
      logline: bible.logline,
      synopsis: bible.synopsis,
      ending: bible.ending,
      tone: bible.tone,
      themes: bible.themes.join("、") || "（无）",
      worldRules: bible.world.rules.join("；") || "（无）",
      powerLimits: bible.world.powerSystem.limits.join("；") || "（无）",
      keyCharacters: keyCharacters || "（无）",
      foreshadowLedger: foreshadowLedger || "（无）",
      outlineSummary: outlineSummary(outline) || "（无）",
      recent: recent || "（无）",
      stateText,
      characterNames,
    },
  );
}

export function buildOutlineExtensionRetryPrompt(
  base: string,
  issues: string[],
): string {
  const issueList =
    issues.length > 0
      ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
      : "（未提供具体问题）";

  return `${base}

上一次输出存在以下问题：
${issueList}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或任何额外文字；必须修复上述全部问题，并完全符合 volume/stage/chapters 结构与章节连续规则。`;
}

export function buildBibleRetryPrompt(base: string, error: string): string {
  return `${base}

上一次输出未通过校验，错误如下：
${error}

请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或任何额外文字；必须修复上述全部问题并完全符合 StoryBible schema。`;
}

export function buildOutlineRetryPrompt(base: string, issues: string[]): string {
  const issueList =
    issues.length > 0
      ? issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
      : "（未提供具体问题）";

  return `${base}

上一次输出存在以下问题：
${issueList}

 请只输出一个合法 JSON 对象，不要 Markdown 代码围栏、解释或任何额外文字；必须修复上述全部问题并完全符合 Outline schema 与章节连续规则。`;
}

export type ChapterPromptInput = ChapterContextInput;

export function buildChapterUserPrompt(input: ChapterPromptInput): string {
  const roundWords = input.roundWords ?? input.targetWords;
  const remainingWords = input.remainingWords ?? input.targetWords;
  const mustClose =
    input.isFinalRound === true || remainingWords <= roundWords;
  const closureRule = mustClose
    ? `本轮必须收束：达到或接近 ROUND_WORDS=${roundWords} 时，必须立即在本章大纲边界内收束，并留下大纲要求的 hook；不得为凑字数拖到下一章。`
    : `继续推进，不要提前收束，除非本轮结束时已达到 CHAPTER_TARGET_WORDS=${input.targetWords}。本轮达到 ROUND_WORDS=${roundWords} 但尚未达到全章目标时，应停在自然段落边界。`;

  return `${buildChapterContext(input)}

写作规则：
1. 只能使用上方列出的 cast 人物；不得临时新增有名字的角色。
2. 不要重复章节标题或章节号；开篇直接进入场景与动作。
3. 只完成本章大纲的 goal、conflict、turn、reveal 和 hook，必须在本章边界内收束。
4. 不得写入下一章才会发生的事件，也不得提前揭示下一章信息。
5. 只输出正文纯文本；不要 Markdown、标题、解释、创作说明或待确认问题。
6. 全章目标为 CHAPTER_TARGET_WORDS=${input.targetWords}，本轮目标为 ROUND_WORDS=${roundWords}；允许略多，但不要注水或重复已有内容。
7. ${closureRule}
8. 使用 LANGUAGE=${input.project.language}，保持视角、时态和人物称呼一致。

本章写作 Skill 硬约束：
- 本章必须是完整小弧线：目标→阻力→转折→收束→钩子，不能中途断掉。
- 本章 goal 必须在章末前有明确结果（成功、失败、放弃或换方案），不能只停在“决定去做”。
- 大纲 hook 必须是全章最后一个节拍；hook 出现后不得另起新场景。
- 开头三段内交代 POV、地点和当前动作；不要用“上一章/与此同时/不知道过了多久”开头。
- 结尾先收住本章冲突，再抛具体钩子；最后一句必须是完整句子。
- 最后一场戏必须完成动作—反应：拨号、发问、推门、按下按钮或提出请求之后，必须写出结果、回应或明确中断，不能停在人物刚开口的位置。
- 段落长短不一，句子长短交替；禁止 AI 套词、连续比喻、总结式或升华式结尾。
- 与上一章结尾、当前状态和本章大纲保持一致；不得新增有名字的角色。`;
}

function formatReviewIssue(issue: ReviewIssue, index: number): string {
  return [
    `问题 ${index + 1}：`,
    `- severity: ${issue.severity}`,
    `- type: ${issue.type}`,
    `- quote: ${issue.quote}`,
    `- problem: ${issue.problem}`,
    `- fix: ${issue.fix}`,
  ].join("\n");
}

export function buildReviewUserPrompt(
  chapter: Chapter,
  outlineChapter: OutlineChapter,
  previousReview?: Review,
): string {
  const revisionScope =
    previousReview === undefined
      ? ""
      : `

这是修订稿的复审。上一轮审校结论：
${previousReview.summary || "（无）"}

上一轮问题：
${previousReview.issues.map(formatReviewIssue).join("\n\n") || "（无具体问题）"}

复审规则：
1. 先逐条核对上一轮问题是否已在修订稿中解决；已解决的不要再列为 issue。
2. 只报告仍未解决的问题，以及修订稿中仍然存在的事实、逻辑、设定或章末完整性问题。
3. 不要用与上一轮无关的新偏好或细枝末节重新发起审核；如果发现上一轮遗漏且会阻断阅读的严重问题，请在 problem 中注明“上一轮遗漏”。
4. gate 按当前遗留问题判定；全部解决且没有新问题时用 pass。`;

  return `请审核下面的章节正文。

CHAPTER_NUMBER=${chapter.number}
TITLE=${chapter.title}
TARGET_WORDS=${outlineChapter.targetWords}

本章大纲：
- summary: ${outlineChapter.summary}
- pov: ${outlineChapter.pov}
- cast: ${outlineChapter.cast.join("、") || "（无）"}
- goal: ${outlineChapter.goal}
- conflict: ${outlineChapter.conflict}
- turn: ${outlineChapter.turn}
- reveal: ${outlineChapter.reveal}
- hook: ${outlineChapter.hook}

章节正文：
${chapter.text}
${revisionScope}

Review JSON 契约（只输出一个 JSON 对象，不要代码围栏或解释）：
{
  "gate": "pass" | "revise" | "block",
  "summary": "一句话审核结论",
  "issues": [
    {
      "severity": "low" | "medium" | "high",
      "type": "logic | character | setting | pacing | ai_flavor | hook | other",
      "quote": "原文中的具体摘录",
      "problem": "问题是什么",
      "fix": "可直接执行的修改方案"
    }
  ]
}

审核要求：
1. 检查逻辑、因果、人物动机、设定一致性、节奏、AI 味和章末钩子。
2. 没有阻塞问题时使用 pass；有明确可修问题时使用 revise；严重到无法继续时使用 block。
3. 每个 issue 都必须有 quote、problem 和 fix，不能只说“加强描写”。
4. 只输出合法 JSON，不要 Markdown 代码围栏、解释或额外文字。`;
}

export function buildEndingAuditUserPrompt(chapter: Chapter): string {
  const outlineChapter = chapter.outline;
  const text =
    chapter.text.length > 12_000
      ? chapter.text.slice(-12_000)
      : chapter.text;

  return `请只判断下面这一章的最后一场戏是否写完。

CHAPTER_NUMBER=${chapter.number}
TARGET_WORDS=${outlineChapter.targetWords}
CURRENT_WORDS=${chapter.wordCount}

本章大纲：
- summary: ${outlineChapter.summary}
- goal: ${outlineChapter.goal}
- conflict: ${outlineChapter.conflict}
- turn: ${outlineChapter.turn}
- reveal: ${outlineChapter.reveal}
- hook: ${outlineChapter.hook}

章节正文${chapter.text.length > 12_000 ? "（只截取最后 12000 字）" : ""}：
${text}

EndingAudit JSON 契约（只输出一个 JSON 对象，不要代码围栏或解释）：
{
  "complete": true | false,
  "reason": "一句话说明最后一场戏是否完成",
  "missing": "如果 complete 为 false，写明要补哪一拍；否则填空字符串"
}`;
}

export interface BoundaryPromptContext {
  previous: Chapter;
  next: Chapter;
  state?: StoryState;
}

function formatBoundaryState(state: StoryState | undefined): string {
  if (!state) return "（无）";

  const entities =
    state.entities.length > 0
      ? state.entities
          .slice(0, 8)
          .map(
            (entity) =>
              `- ${entity.entityName}｜${Object.entries(entity.state)
                .map(([key, value]) => `${key}=${value}`)
                .join("；")}`,
          )
          .join("\n")
      : "- （无）";
  const events =
    state.events.length > 0
      ? state.events
          .slice(-5)
          .map((event) => `- 第${event.chapterNumber}章：${event.summary}`)
          .join("\n")
      : "- （无）";

  return `实体：\n${entities}\n最近事件：\n${events}`;
}

function boundaryContext(input: BoundaryPromptContext): string {
  const {
    previous,
    next,
    state,
  } = input;
  const previousOutline = previous.outline;
  const nextOutline = next.outline;

  return `FROM_CHAPTER=${previous.number}
TO_CHAPTER=${next.number}
FROM_TITLE=${previous.title}
TO_TITLE=${next.title}

上一章大纲：
- goal: ${previousOutline.goal}
- conflict: ${previousOutline.conflict}
- turn: ${previousOutline.turn}
- reveal: ${previousOutline.reveal}
- hook: ${previousOutline.hook}

下一章大纲：
- goal: ${nextOutline.goal}
- conflict: ${nextOutline.conflict}
- turn: ${nextOutline.turn}
- reveal: ${nextOutline.reveal}
- hook: ${nextOutline.hook}

上一章结束时的连续性状态：
${formatBoundaryState(state)}

上一章最后十段（只能改最后 1-2 段）：
${lastParagraphs(previous.text, 10)}

下一章开头十段（只能改最前 1-2 段）：
${firstParagraphs(next.text, 10)}`;
}

export function buildBoundaryAuditUserPrompt(
  input: BoundaryPromptContext,
): string {
  return `请判断下面相邻两章的接缝类型，并给出最小修复动作。

${boundaryContext(input)}

BoundaryAudit JSON 契约（只输出一个 JSON 对象，不要代码围栏或解释）：
{
  "relation": "continue" | "cut" | "broken",
  "previousEndComplete": true | false,
  "previousEndHookEffective": true | false,
  "nextStartAnchored": true | false,
  "factChecks": [
    {
      "fact": "上一章结束时的硬约束：时间约定、地点、人物位置、伤势/能力代价、关键物品、已做出的决定、对别人的承诺",
      "status": "continued | deferred | ignored | contradicted",
      "evidence": "下一章开头承接它的具体文字；没有就写“未提及”"
    }
  ],
  "danglingThreads": ["上一章最后 20% 留下的、下一章开头没有处理的具体线索"],
  "contradictions": ["事实矛盾、人物瞬移、时间线冲突；没有则空数组"],
  "action": "none" | "close_previous" | "anchor_next" | "both" | "flag",
  "reason": "一句话说明判定理由",
  "repairBrief": "如果 action 不是 none，写一句最小修复要求；否则空字符串"
}

factChecks 要求：
- 必须逐条核对上一章结束时最硬的 1-8 条事实，不能只写一条泛泛的“人物连续”。
- 只核对会破坏读者理解的硬约束：明确的时间/地点约定、对别人的承诺或回电、影响行动的身体状态（失明/受伤/能量耗尽）、关键物品去向、已经做出的决定。
- 不要核对日常物品（耳塞、营养棒、外套）和可以自然延续的背景状态；这类最多标 continued，不要标 ignored。
- continued=下一章承接了；deferred=下一章明确推迟或说明稍后处理；ignored=下一章完全没有提且不是有意留白；contradicted=下一章写了相反事实。
- 有任何 ignored 时，action 不能是 none，优先 anchor_next；有任何 contradicted 时，action 必须是 flag。

判定提醒：
- continue 才要求强承接；cut 只要求锚点，不要强行因果。
- 章末有效钩子不等于中途断章；不要把有结果的悬念判成 broken。
- 只有 action 需要修复时才提出 repairBrief。`;
}

export function buildSeamRepairUserPrompt(
  input: BoundaryPromptContext & { audit: BoundaryAudit },
): string {
  return `请根据接缝审计结果，只修复相邻两章的接缝，不重写章节主体。

${boundaryContext(input)}

接缝审计：
${JSON.stringify(input.audit, null, 2)}

SeamRepair JSON 契约（只输出一个 JSON 对象，不要代码围栏或解释）：
{
  "previousTail": "要替换/追加到上一章末尾的 1-2 段；不需要时填空字符串",
  "previousParagraphs": 0 | 1 | 2,
  "nextHead": "要替换/追加到下一章开头 1-2 段；不需要时填空字符串",
  "nextParagraphs": 0 | 1 | 2,
  "notes": "一句话说明改了什么；无需修改时说明原因"
}

字段含义：
- previousParagraphs=0：把 previousTail 作为新段落追加到上一章末尾；1/2：替换上一章最后 1/2 段。
- nextParagraphs=0：把 nextHead 作为新段落插到下一章开头；1/2：替换下一章最前 1/2 段。
- previousTail 和 nextHead 至少有一个非空；每处不超过 300 字，最后一句必须是完整句子。
- 如果上一章结尾已经是有效钩子，不要动它，优先修下一章开头。
- 如果是 cut，只补时间/地点/视角锚点，不强行因果。
- 不得新增有名字的角色、剧情事件或设定；不得改 POV、时态、章节标题和原定 hook。`;
}

export function buildReviseUserPrompt(
  chapter: Chapter,
  issues: ReviewIssue[],
): string {
  const issueList =
    issues.length > 0
      ? issues.map(formatReviewIssue).join("\n\n")
      : "（无具体问题）";

  return `请根据审核问题改写下面的章节正文。

CHAPTER_NUMBER=${chapter.number}
TITLE=${chapter.title}
TARGET_WORDS=${chapter.outline.targetWords}

原章节正文：
${chapter.text}

审核问题：
${issueList}

改写规则：
1. 只修复上面列出的问题，不顺带重写无关段落。
2. 保留原有剧情走向、人物关系、场景和章节边界；不得新增有名字的角色。
3. 只输出改写后的正文纯文本；不要标题、Markdown、解释或问题清单。
4. 目标字数为 TARGET_WORDS=${chapter.outline.targetWords}，允许略多但不要注水。
5. 保持原章节的视角、时态和人物称呼一致。
6. 同时遵守写作 Skill：保证章节完整、因果连贯、开头落地、结尾收住，并去除 AI 味。
7. 不得删减或压缩结尾。如果原结尾停在最后一场戏的动作中途，先补完动作—反应，再收束并落地 hook。`;
}

function formatCastForState(cast: Character[]): string {
  if (cast.length === 0) return "（无）";

  return cast
    .map(
      (character) =>
        `- ${character.name}｜定位：${character.role}｜目标：${character.goal}｜声音：${character.voice}`,
    )
    .join("\n");
}

function formatForeshadowLedger(ledger: ForeshadowLedgerEntry[]): string {
  if (ledger.length === 0) return "（无）";

  return ledger
    .map(
      (entry) =>
        `- ${entry.title}｜setup=${entry.setupChapter}｜payoff=${entry.payoffChapter}｜status=${entry.status}`,
    )
    .join("\n");
}

function formatCanonicalNames(names: readonly string[]): string {
  return names.length > 0 ? names.map((name) => `- ${name}`).join("\n") : "（无）";
}

export function buildStateUserPrompt(
  chapter: Chapter,
  currentState: StoryState,
  cast: Character[],
  foreshadowLedger: ForeshadowLedgerEntry[],
  canonicalItems: readonly string[] = [],
  canonicalConcepts: readonly string[] = [],
): string {
  return `请只根据本章正文提取本章结束时的故事状态。

CHAPTER_NUMBER=${chapter.number}
TITLE=${chapter.title}

章节正文：
${chapter.text}

当前状态（仅用于对齐已有事实，不得把旧状态当成本章新事实）：
${JSON.stringify(currentState, null, 2)}

本章 cast：
${formatCastForState(cast)}

伏笔账本（foreshadows[].title 必须逐字复用以下 canonical title，不得改写、翻译或新造标题）：
${formatForeshadowLedger(foreshadowLedger)}

canonical 物品名（entities[].entityName 必须逐字复用以下名称之一）：
${formatCanonicalNames(canonicalItems)}

canonical 概念名（entities[].entityName 必须逐字复用以下名称之一）：
${formatCanonicalNames(canonicalConcepts)}

StoryState JSON 契约（只输出一个 JSON 对象，不要代码围栏或解释）：
{
  "entities": [
    {
      "entityName": "人物、物品或概念名",
      "state": { "字段名": "字段值" },
      "updatedAtChapter": ${chapter.number}
    }
  ],
  "relationships": [
    {
      "source": "关系起点",
      "target": "关系终点",
      "kind": "关系类型",
      "description": "本章确认的关系状态"
    }
  ],
  "foreshadows": [
    {
      "title": "必须逐字复用伏笔账本中的 canonical title",
      "status": "planned | open | progressed | resolved | abandoned",
      "note": "可选说明"
    }
  ],
  "events": [
    {
      "summary": "本章关键事件",
      "chapterNumber": ${chapter.number}
    }
  ]
}

提取规则：
1. 只提取正文中已经发生、可以直接确认的事实；不得推测、补写或发明设定。
2. entities 记录人物、物品或概念的当前状态；relationships 记录关系变化；foreshadows 记录伏笔状态；events 记录本章关键事件。
3. 物品与概念的 entityName 必须逐字复用上方 canonical 名称，不得使用简称、改写或新造名称。
4. 每个 event 的 chapterNumber 和每个 entity 的 updatedAtChapter 必须小于或等于 ${chapter.number}。
5. 无法确认的信息不要写入；没有变化的类别使用空数组。
6. 只输出合法 JSON，不要 Markdown 代码围栏、解释或额外文字。`;
}
