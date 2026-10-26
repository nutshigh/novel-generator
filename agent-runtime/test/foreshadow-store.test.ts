import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteForeshadowStore,
  type ForeshadowStore,
} from "../src/domain/foreshadowStore.js";
import type { ForeshadowLedgerEntry } from "../src/domain/schemas.js";

const stores: ForeshadowStore[] = [];

function makeStore(): ForeshadowStore {
  const store = new SqliteForeshadowStore(undefined);
  stores.push(store);
  return store;
}

const ledger: ForeshadowLedgerEntry[] = [
  {
    title: "地脉印的裂纹",
    setupChapter: 1,
    payoffChapter: 4,
    status: "planned",
  },
  {
    title: "旧城大火的目击者",
    setupChapter: 2,
    payoffChapter: 6,
    status: "planned",
  },
];

afterEach(() => {
  while (stores.length > 0) stores.pop()!.close();
});

describe("SqliteForeshadowStore", () => {
  it("seeds the bible ledger and opens chapter-one setups", () => {
    const store = makeStore();
    store.seed("book-1", ledger);

    const records = store.list("book-1");

    expect(records.map((record) => record.title)).toEqual([
      "地脉印的裂纹",
      "旧城大火的目击者",
    ]);
    expect(records[0]!.status).toBe("open");
    expect(records[1]!.status).toBe("planned");
  });

  it("tracks progress, payoff and resolved/unresolved views", () => {
    const store = makeStore();
    store.seed("book-1", ledger);

    store.upsert("book-1", {
      title: "地脉印的裂纹",
      chapterNumber: 2,
      action: "progress",
      note: "裂纹扩大。",
    });
    store.upsert("book-1", {
      title: "地脉印的裂纹",
      chapterNumber: 4,
      action: "payoff",
      note: "裂纹被封印。",
    });

    const records = store.list("book-1");
    const crack = records.find((record) => record.title === "地脉印的裂纹")!;
    expect(crack.status).toBe("resolved");
    expect(crack.resolvedChapter).toBe(4);
    expect(crack.note).toBe("裂纹被封印。");

    const state = store.toStoryState("book-1", 4);
    expect(state).toContainEqual({
      title: "地脉印的裂纹",
      status: "resolved",
      note: "裂纹被封印。",
    });
  });

  it("hides future setups and future payoffs", () => {
    const store = makeStore();
    store.seed("book-1", ledger);
    store.upsert("book-1", {
      title: "地脉印的裂纹",
      chapterNumber: 4,
      action: "payoff",
    });

    expect(store.listForChapter("book-1", 1).map((record) => record.title)).toEqual([
      "地脉印的裂纹",
    ]);
    expect(store.listForChapter("book-1", 2).map((record) => record.title)).toEqual([
      "地脉印的裂纹",
      "旧城大火的目击者",
    ]);
  });

  it("applies digest actions and is idempotent", () => {
    const store = makeStore();
    store.seed("book-1", ledger);

    const digest = [
      {
        title: "地脉印的裂纹",
        action: "progress" as const,
        note: "第2章继续推进。",
      },
      {
        title: "新出现的灯",
        action: "setup" as const,
        note: "第2章新埋。",
      },
    ];
    store.applyDigest("book-1", 2, digest);
    store.applyDigest("book-1", 2, digest);

    const records = store.list("book-1");
    expect(records.find((record) => record.title === "新出现的灯")?.status).toBe(
      "open",
    );
    expect(
      records.find((record) => record.title === "地脉印的裂纹")?.status,
    ).toBe("progressed");
  });

  it("keeps future planned ledger entries when rewriting an earlier chapter", () => {
    const store = makeStore();
    store.seed("book-1", [
      {
        title: "很晚才出现的伏笔",
        setupChapter: 10,
        payoffChapter: 12,
        status: "planned",
      },
    ]);

    store.resetFromChapter("book-1", 5);

    expect(store.list("book-1").map((record) => record.title)).toEqual([
      "很晚才出现的伏笔",
    ]);
  });

  it("rolls story state back when a chapter is rewritten", () => {
    const store = makeStore();
    store.seed("book-1", ledger);
    store.upsert("book-1", {
      title: "地脉印的裂纹",
      chapterNumber: 2,
      action: "progress",
    });
    store.upsert("book-1", {
      title: "地脉印的裂纹",
      chapterNumber: 4,
      action: "payoff",
    });

    store.resetFromChapter("book-1", 4);

    const crack = store
      .list("book-1")
      .find((record) => record.title === "地脉印的裂纹")!;
    expect(crack.status).toBe("progressed");
    expect(crack.resolvedChapter).toBeUndefined();
  });
});
