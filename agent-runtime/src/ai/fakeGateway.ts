import {
  OutlineSchema,
  ReviewSchema,
  StoryBibleSchema,
  StoryStateSchema,
  countWords,
  type Outline,
  type OutlineChapter,
  type OutlineStage,
  type StoryBible,
  type StoryState,
} from "../domain/schemas.js";
import type { AiGateway, GenerateRequest } from "./gateway.js";

const CHAPTER_BEATS = [
  {
    title: "灰烬里的脚印",
    summary: "林砚在旧城石阶发现一串不属于任何活人的脚印。",
    goal: "确认脚印的主人",
    conflict: "巡夜人提前封住巷口",
    turn: "脚印在墙前凭空消失",
    reveal: "墙后藏着一道旧地脉刻痕",
    hook: "苏晚认出刻痕的笔迹",
  },
  {
    title: "熄灯之前",
    summary: "苏晚带林砚去一间只在天黑后开门的旧灯铺。",
    goal: "在熄灯前问出线索",
    conflict: "灯铺老板只肯回答一个问题",
    turn: "老板叫出了林砚师父的名字",
    reveal: "师父曾在这里寄存一盏灯",
    hook: "灯罩内侧刻着第二个地址",
  },
  {
    title: "钟楼下的影子",
    summary: "顾沉在钟楼约见林砚，提出一笔看似公平的交易。",
    goal: "试探顾沉知道多少",
    conflict: "顾沉句句都踩在秘密边缘",
    turn: "钟声掩盖了第三个人的脚步",
    reveal: "顾沉也在寻找同一个目击者",
    hook: "钟楼的门从里面被推开",
  },
  {
    title: "第二盏灯",
    summary: "旧城长街亮起第二盏本不该存在的灯。",
    goal: "找到点灯的人",
    conflict: "每靠近一步，灯就熄灭一盏",
    turn: "最后一盏灯照出苏晚的旧伤",
    reveal: "点灯人用的是宗门失传的手法",
    hook: "黑暗里有人叫出苏晚的乳名",
  },
  {
    title: "失约的目击者",
    summary: "三人按暗号赴约，等来的却是一封被烧焦的信。",
    goal: "读完信上的残句",
    conflict: "信纸一碰就碎",
    turn: "林砚用灯烟熏出隐藏字迹",
    reveal: "目击者一直替他们传信",
    hook: "信末留着顾沉的私印",
  },
  {
    title: "地脉回响",
    summary: "林砚触碰地脉印，听见旧城大火当夜的回声。",
    goal: "听清回响里的最后一句话",
    conflict: "每次回响都会伤及经脉",
    turn: "苏晚替他续上第二段回响",
    reveal: "大火并非天灾",
    hook: "回声里出现第四个人的呼吸",
  },
  {
    title: "旧伤",
    summary: "苏晚的旧伤在追查中复发，她被迫讲出部分过去。",
    goal: "从苏晚口中问出宗门旧事",
    conflict: "苏晚不相信任何解释",
    turn: "林砚交出自己的秘密作为交换",
    reveal: "苏晚曾见过同样的地脉印",
    hook: "她画出的图案少了一角",
  },
  {
    title: "墙后的房间",
    summary: "脚印消失的墙后藏着一间被封死的房间。",
    goal: "打开封墙而不惊动巡夜人",
    conflict: "墙面刻满反噬术式",
    turn: "顾沉从另一侧推开墙",
    reveal: "房间里摆着三盏同款的灯",
    hook: "其中一盏还留着余温",
  },
  {
    title: "三人各执一词",
    summary: "林砚、苏晚与顾沉对同一夜的记忆完全不同。",
    goal: "拼出旧城大火的共同真相",
    conflict: "每个人的证词都对自己有利",
    turn: "苏晚发现自己也记错了一段",
    reveal: "有人动过他们的记忆",
    hook: "桌上的茶仍是热的",
  },
  {
    title: "不请自来的客人",
    summary: "一个自称目击者的人主动找上门，却只肯见林砚。",
    goal: "确认来人的身份",
    conflict: "来人知道只有师父才知道的暗语",
    turn: "暗语最后一句是求救",
    reveal: "真正的目击者被关在城中",
    hook: "窗外响起第二次敲门声",
  },
  {
    title: "夜半封城",
    summary: "巡夜人提前封城，所有线索被逼进一条窄巷。",
    goal: "在天亮前送出消息",
    conflict: "每条出口都有人把守",
    turn: "顾沉主动为他们让开一条路",
    reveal: "封城令并非行会签发",
    hook: "城门外传来古兽的低鸣",
  },
  {
    title: "天亮之前",
    summary: "林砚必须在钟声停止前做出选择。",
    goal: "保住地脉印并救出目击者",
    conflict: "两件事只能先做一件",
    turn: "苏晚提出第三种办法",
    reveal: "地脉印的裂纹指向钟楼地下",
    hook: "钟声在最后一刻停住",
  },
] as const;

const STAGE_TITLES = ["第一阶段 灰烬里的线索", "第二阶段 钟楼下的交易"] as const;

const PROSE_SENTENCES = [
  "夜风从旧城的屋脊上压下来，带着潮湿的灰烬气味。",
  "林砚停在巷口，指尖贴着那半枚冰凉的地脉印。",
  "墙后有人压低了呼吸，像在等一个错误的脚步。",
  "苏晚没有回头，只把一盏快要熄灭的灯递给他。",
  "灯火在风里晃了晃，照见石阶上新鲜的脚印。",
  '"别出声。"苏晚的嘴唇几乎没动，目光已经越过他的肩头。',
  "远处传来钟声，一下，又一下，敲得长街发空。",
  "顾沉站在钟楼的阴影里，礼貌地朝他们点了点头。",
  "林砚知道，今夜的退路已经被人提前封死。",
  "巷子深处飘来焦木味，像一场没有烧完的旧梦。",
  "苏晚把灯芯压低，火苗缩成针尖大小。",
  '"你听见了吗？"林砚问。',
  "回答他的只有瓦片上一声轻响。",
  "那道裂纹在地脉印表面缓缓延伸，像一条醒来的细蛇。",
  "顾沉的声音从高处落下来，温和得近乎残忍。",
  '"把东西留下，我可以当今晚没见过你们。"',
  "林砚没有退，反而向前半步，把苏晚挡在身后。",
  "风忽然停了，整条街只剩三个人的呼吸。",
  "苏晚袖口的血迹在灯下显得格外刺眼。",
  "旧城的钟又响了一次，这一次近得像在耳边。",
  "林砚听见自己的心跳，先于所有答案撞在胸腔里。",
  "瓦檐上的黑影动了，像被这句话惊醒。",
  "顾沉抬手，钟楼的阴影随之向前挪了一寸。",
  "苏晚忽然笑了，笑意却没有抵达眼底。",
  "石阶尽头亮起第二盏灯，灯光来自他们身后。",
  "林砚终于明白，目击者一直跟在他们中间。",
  '"走吧。"苏晚说，"再晚一步，灯就灭了。"',
  "林砚把地脉印收回掌心，裂纹却隔着皮肤发烫。",
] as const;

function markerNumber(user: string, name: string, fallback: number): number {
  const match = new RegExp(`(?:^|\\n)\\s*${name}=(\\d+)`, "i").exec(user);
  const value = Number.parseInt(match?.[1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function premiseFrom(user: string): string {
  const marker = /(?:^|\n)\s*PREMISE\s*=\s*(.+?)\s*(?:\n|$)/i.exec(user);
  if (marker?.[1]?.trim()) return marker[1].trim();

  const line = user
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !/^[A-Z_]+=/.test(value));
  return line ?? "一个普通少年在旧城意外觉醒。";
}

function makeBible(premise: string, maxChapters: number): StoryBible {
  const safeMax = Math.max(1, maxChapters);
  const storyBible: StoryBible = {
    logline: `${premise} 林砚必须在旧城沉没前找到师父留下的答案。`,
    synopsis: `故事围绕“${premise}”展开。林砚与苏晚追查旧城大火，顾沉则在暗处推动另一场交易。`,
    genre: ["东方玄幻", "成长"],
    audience: "中文网络小说读者",
    themes: ["成长", "信任", "代价"],
    tone: "冷峻中带热血",
    pov: "第三人称限知",
    tense: "过去时",
    ending: "林砚以半枚地脉印为代价封住古兽，并公开旧城大火的真相。",
    world: {
      rules: ["灵力来自地脉", "越阶施术必受反噬", "地名与誓言具有约束力"],
      powerSystem: {
        levels: ["引气", "凝脉", "开府", "化神"],
        costs: ["消耗寿元", "透支经脉", "留下地脉烙印"],
        limits: ["无法同时操控两种地脉", "情绪失控时术式会反卷"],
      },
      factions: ["玄烬宗"],
      society: ["旧城行会掌握粮道", "守夜人负责记录异常"],
      taboos: ["不得唤醒地脉深处的古兽"],
    },
    characters: [
      {
        name: "林砚",
        role: "主角",
        goal: "查清师父失踪的真相",
        motivation: "保护仅存的家人与旧城",
        wound: "幼年目睹旧城大火",
        arc: "从只想自保到主动承担代价",
        voice: "寡言但观察细致",
        secrets: ["体内藏有半枚地脉印"],
        relationships: ["苏晚是并肩同伴", "顾沉是必须面对的对手"],
      },
      {
        name: "苏晚",
        role: "同伴",
        goal: "找回被夺走的宗门典籍",
        motivation: "替师门洗清污名",
        wound: "曾被同门背叛",
        arc: "学会重新信任他人",
        voice: "冷静、准确、偶尔尖锐",
        secrets: ["知道旧城大火的另一版本"],
        relationships: ["与林砚互相试探后结盟"],
      },
      {
        name: "顾沉",
        role: "对手",
        goal: "夺取地脉印",
        motivation: "证明自己配得上宗主之位",
        wound: "长期被父亲否定",
        arc: "从执念走向自我毁灭",
        voice: "礼貌而压迫",
        secrets: ["修炼了玄烬宗禁术"],
        relationships: ["把林砚视为必须超越的变量"],
      },
    ],
    items: ["半枚地脉印"],
    concepts: ["地脉回响"],
    styleGuide: {
      pov: "第三人称限知",
      tense: "过去时",
      sentenceRhythm: "长短句交替，关键处用短句收束",
      dialogueRatio: "约百分之三十五",
      descriptionDensity: "中等，优先动作与感官",
      bannedPhrases: ["不禁", "嘴角微扬"],
      aiFlavorBlacklist: ["仿佛", "似乎", "某种"],
      webNovelPrinciples: ["每章有钩子", "信息密度高", "冲突推动情节"],
    },
    foreshadowLedger: [
      { setupChapter: 1, payoffChapter: Math.min(2, safeMax), title: "地脉印的裂纹", status: "planned" },
      { setupChapter: Math.min(2, safeMax), payoffChapter: Math.min(3, safeMax), title: "旧城大火的目击者", status: "planned" },
      { setupChapter: 1, payoffChapter: Math.min(4, safeMax), title: "顾沉的禁术印记", status: "planned" },
    ],
    assumptions: ["地脉印共有两半", "旧城位于地脉交汇处"],
  };

  return StoryBibleSchema.parse(storyBible);
}

function makeOutlineChapter(number: number, chapterWords: number): OutlineChapter {
  const beat = CHAPTER_BEATS[(number - 1) % CHAPTER_BEATS.length]!;

  return {
    number,
    title: `第${number}章 ${beat.title}`,
    summary: beat.summary,
    pov: number % 2 === 1 ? "林砚" : "苏晚",
    cast: number % 3 === 0 ? ["林砚", "顾沉"] : ["林砚", "苏晚"],
    goal: beat.goal,
    conflict: beat.conflict,
    turn: beat.turn,
    reveal: beat.reveal,
    hook: beat.hook,
    targetWords: chapterWords,
  };
}

function makeOutline(maxChapters: number, chapterWords: number): Outline {
  const safeMax = Math.max(1, maxChapters);
  const firstStageCount = Math.ceil(safeMax / 2);
  const chapters = Array.from({ length: safeMax }, (_, index) =>
    makeOutlineChapter(index + 1, chapterWords),
  );

  const outline: Outline = {
    volumes: [
      {
        number: 1,
        title: "第一卷 旧城火",
        summary: "林砚追查师父失踪与旧城大火。",
        stages: [
          {
            number: 1,
            title: STAGE_TITLES[0]!,
            summary: "林砚接触地脉印并发现第一层线索。",
            chapters: chapters.slice(0, firstStageCount),
          },
        ],
      },
    ],
  };

  if (safeMax > 1) {
    const secondStage: OutlineStage = {
      number: 2,
      title: STAGE_TITLES[1]!,
      summary: "线索指向玄烬宗，代价开始出现。",
      chapters: chapters.slice(firstStageCount),
    };
    outline.volumes[0]!.stages.push(secondStage);
  }

  return OutlineSchema.parse(outline);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeProseParagraph(random: () => number): string {
  const size = PROSE_SENTENCES.length;
  const first = Math.floor(random() * size);
  const offset = 1 + Math.floor(random() * (size - 1));
  const second = (first + offset) % size;
  return `${PROSE_SENTENCES[first]!}${PROSE_SENTENCES[second]!}`;
}

function prose(targetWords: number, chapterNumber: number, round: number): string {
  const random = seededRandom(chapterNumber * 7919 + round * 104729 + 17);
  const counts = new Map<string, number>();
  const pieces: string[] = [];
  let length = 0;

  while (length < targetWords) {
    let paragraph = "";

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const candidate = makeProseParagraph(random);
      if ((counts.get(candidate) ?? 0) < 2) {
        paragraph = candidate;
        break;
      }
    }

    if (!paragraph) {
      throw new Error("Unable to generate varied fake prose.");
    }

    counts.set(paragraph, (counts.get(paragraph) ?? 0) + 1);
    pieces.push(paragraph);
    length += countWords(paragraph);
  }

  return pieces.join("\n\n");
}

function makeState(chapterNumber: number): StoryState {
  const state: StoryState = {
    entities: [
      {
        entityName: "林砚",
        state: {
          location: "旧城石阶",
          goal: "查清师父失踪的真相",
          condition: "左臂擦伤",
        },
        updatedAtChapter: chapterNumber,
      },
    ],
    relationships: [
      {
        source: "林砚",
        target: "苏晚",
        kind: "同伴",
        description: "暂时结盟，彼此仍有隐瞒",
      },
    ],
    foreshadows: [
      {
        title: "地脉印的裂纹",
        status: "open",
        note: "裂纹比昨日更深",
      },
    ],
    events: [
      {
        summary: `第${chapterNumber}章，林砚与苏晚在旧城石阶发现新的脚印。`,
        chapterNumber,
      },
    ],
  };

  return StoryStateSchema.parse(state);
}

export class FakeAiGateway implements AiGateway {
  async generateText(req: GenerateRequest): Promise<string> {
    switch (req.kind) {
      case "bible": {
        const maxChapters = markerNumber(req.user, "MAX_CHAPTERS", 6);
        return JSON.stringify(StoryBibleSchema.parse(makeBible(premiseFrom(req.user), maxChapters)));
      }

      case "outline": {
        const maxChapters = markerNumber(req.user, "MAX_CHAPTERS", 6);
        const chapterWords = markerNumber(req.user, "CHAPTER_WORDS", 800);
        return JSON.stringify(OutlineSchema.parse(makeOutline(maxChapters, chapterWords)));
      }

      case "outline_extension": {
        const startChapter = markerNumber(req.user, "START_CHAPTER", 1);
        const endChapter = markerNumber(
          req.user,
          "END_CHAPTER",
          startChapter,
        );
        const chapterWords = markerNumber(req.user, "CHAPTER_WORDS", 800);
        const chapters = Array.from(
          { length: Math.max(0, endChapter - startChapter + 1) },
          (_, index) => makeOutlineChapter(startChapter + index, chapterWords),
        );
        return JSON.stringify({
          volume: {
            title: `第${Math.ceil(startChapter / 10)}卷 续章`,
            summary: `林砚与苏晚继续追查旧城大火之后的新线索。`,
          },
          stage: {
            title: "续写阶段 未熄的灯",
            summary: "旧线索尚未收束，新的对手已经出现。",
          },
          chapters,
        });
      }

      case "chapter": {
        const targetWords = markerNumber(
          req.user,
          "ROUND_WORDS",
          markerNumber(
            req.user,
            "CHAPTER_TARGET_WORDS",
            markerNumber(req.user, "TARGET_WORDS", 800),
          ),
        );
        const chapterNumber = markerNumber(req.user, "CHAPTER_NUMBER", 1);
        const round = markerNumber(req.user, "ROUND", 1);
        return prose(targetWords, chapterNumber, round);
      }

      case "review": {
        return JSON.stringify(
          ReviewSchema.parse({
            gate: "pass",
            summary: "结构与人物动机清晰，节奏达标，可以进入下一章。",
            issues: [],
          }),
        );
      }

      case "ending_audit": {
        return JSON.stringify({
          complete: true,
          reason: "测试用结尾：最后一场戏已经完成动作—反应。",
          missing: "",
        });
      }

      case "boundary_audit": {
        return JSON.stringify({
          relation: "cut",
          previousEndComplete: true,
          previousEndHookEffective: true,
          nextStartAnchored: true,
          factChecks: [],
          danglingThreads: [],
          contradictions: [],
          action: "none",
          reason: "测试用接缝：场景切换有锚点，不需要改动。",
          repairBrief: "",
        });
      }

      case "seam_repair": {
        return JSON.stringify({
          previousTail: "",
          previousParagraphs: 0,
          nextHead: "",
          nextParagraphs: 0,
          notes: "测试用接缝：无需修补。",
        });
      }

      case "chapter_memory": {
        const chapterNumber = markerNumber(req.user, "CHAPTER_NUMBER", 1);
        const fromChapter = markerNumber(
          req.user,
          "SUMMARY_FROM",
          Math.max(1, chapterNumber - 4),
        );
        const toChapter = markerNumber(
          req.user,
          "SUMMARY_TO",
          chapterNumber,
        );
        return JSON.stringify({
          brief: `第${chapterNumber}章，林砚继续追查旧城线索，并付出了一点代价。章末的新线索把调查推向下一处地点。`,
          digest: {
            coreSettings: [
              {
                type: "world",
                name: "地脉",
                detail: `第${chapterNumber}章继续确认灵力来自地脉。`,
              },
            ],
            characters: [
              {
                name: "林砚",
                roleInChapter: "主角",
                goal: `完成第${chapterNumber}章的调查`,
                change: "掌握了新的线索，但付出了一点代价。",
              },
            ],
            plotNodes: [
              {
                summary: `林砚在第${chapterNumber}章追查旧城线索。`,
                impact: "线索指向下一处地点。",
              },
            ],
            relationshipProgress: [
              {
                source: "林砚",
                target: "苏晚",
                change: "信任略有增加",
                reason: "两人共同承担了一次风险。",
              },
            ],
            foreshadows: [
              {
                title: "地脉印的裂纹",
                action: "progress",
                note: `第${chapterNumber}章裂纹继续扩大。`,
              },
            ],
          },
          summary: {
            fromChapter,
            toChapter,
            text: `第${fromChapter}到${toChapter}章，林砚与苏晚继续追查旧城大火与地脉印的线索。两人在一次次试探中建立了更深的信任，也发现顾沉与玄烬宗的禁术有关。章末的新线索把调查推向下一处地点。`,
          },
        });
      }

      case "state": {
        const chapterNumber = markerNumber(req.user, "CHAPTER_NUMBER", 1);
        return JSON.stringify(StoryStateSchema.parse(makeState(chapterNumber)));
      }

      case "revise": {
        const targetWords = markerNumber(req.user, "TARGET_WORDS", 800);
        const chapterNumber = markerNumber(req.user, "CHAPTER_NUMBER", 1);
        const round = markerNumber(req.user, "ROUND", 1);
        return prose(targetWords, chapterNumber, round);
      }

      default: {
        const unexpected: never = req.kind;
        throw new Error(`Unsupported generate kind: ${String(unexpected)}`);
      }
    }
  }
}
