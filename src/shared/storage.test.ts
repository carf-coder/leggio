// src/shared/storage.test.ts
// エクスポート/インポート往復・弱点統計蓄積のユニットテスト(SPEC v1 §7 WP4完了基準)。
// 実行: node --test src/shared/storage.test.ts
//
// Node単体の `node --test` はデフォルトでは localStorage を提供しない
// (`--localstorage-file` 相当のフラグが必要)ため、テスト実行環境限定の
// 最小限のインメモリ Storage ポリフィルをここで用意する(本番コードには影響しない)。

{
  // Node --test はデフォルトで動作する localStorage を提供しない(グローバルの
  // `localStorage` は存在するが setItem 等が未実装)ため、常に自前実装で上書きする。
  const store = new Map<string, string>();
  const polyfill: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = polyfill;
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  addCorrectionRecord,
  exportStateJson,
  getAccessToken,
  getCorrections,
  getPassagesDone,
  getPhase,
  getStats,
  getWorkerEndpoint,
  importStateJson,
  markPassageDone,
  setAccessToken,
  setPhase,
  setWorkerEndpoint,
} from "./storage.ts";
import type { CorrectionRecord } from "./types";

function clearAll() {
  localStorage.clear();
}

test("addCorrectionRecord: 履歴に追加され、issuesのcodeごとに統計が加算される", () => {
  clearAll();
  const record: CorrectionRecord = {
    id: "r1",
    ts: new Date().toISOString(),
    passageFile: "2026-08-07_p0001.json",
    passageId: "p0001",
    title_ja: "テスト文章",
    mode: "llm",
    transcription: "テスト訳",
    issues: [
      {
        sentenceIdx: 0,
        code: "MOOD",
        userText: "x",
        correct: "y",
        evidence_it: "avrebbe ricordato",
        explain_ja: "説明",
      },
      {
        sentenceIdx: 1,
        code: "REF",
        userText: "x2",
        correct: "y2",
        evidence_it: "il suo nome",
        explain_ja: "説明2",
      },
    ],
    good: ["良い点"],
    score: { total: 8 },
  };
  addCorrectionRecord(record);

  const stats = getStats();
  assert.equal(stats.MOOD?.count, 1);
  assert.equal(stats.REF?.count, 1);
  assert.equal(stats.SYN, undefined);

  const list = getCorrections();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "r1");
});

test("markPassageDone: 重複しても1件だけ記録される", () => {
  clearAll();
  markPassageDone("p0001");
  markPassageDone("p0001");
  markPassageDone("p0002");
  assert.deepEqual(getPassagesDone().sort(), ["p0001", "p0002"]);
});

test("エクスポート→インポート往復でlocalStorage状態が一致する", () => {
  clearAll();
  setAccessToken("secret-token-123");
  setWorkerEndpoint("https://worker.example.workers.dev");
  setPhase("P2");
  markPassageDone("p0001");
  addCorrectionRecord({
    id: "r2",
    ts: new Date().toISOString(),
    passageFile: "2026-08-07_p0002.json",
    passageId: "p0002",
    title_ja: "往復テスト",
    mode: "self",
    transcription: "",
    issues: [
      {
        sentenceIdx: 0,
        code: "OMIT",
        userText: "",
        correct: "",
        evidence_it: "sola",
        explain_ja: "自己採点で記録",
      },
    ],
    good: [],
    score: null,
  });

  const beforeExport = {
    token: getAccessToken(),
    endpoint: getWorkerEndpoint(),
    phase: getPhase(),
    passagesDone: getPassagesDone(),
    corrections: getCorrections(),
    stats: getStats(),
  };

  const json = exportStateJson();

  // 別状態へ切り替えてから、インポートで元の状態に復元できることを確認する
  clearAll();
  assert.equal(getAccessToken(), "");
  assert.equal(getPassagesDone().length, 0);

  importStateJson(json);

  assert.deepEqual(
    {
      token: getAccessToken(),
      endpoint: getWorkerEndpoint(),
      phase: getPhase(),
      passagesDone: getPassagesDone(),
      corrections: getCorrections(),
      stats: getStats(),
    },
    beforeExport
  );
});

test("importStateJson: 不正なJSONは例外を投げ、既存状態を変更しない", () => {
  clearAll();
  setAccessToken("keep-me");
  assert.throws(() => importStateJson("{ not json"));
  assert.equal(getAccessToken(), "keep-me");
});

test("importStateJson: version情報がない場合は例外を投げる", () => {
  clearAll();
  assert.throws(() => importStateJson(JSON.stringify({ phase: "P1" })));
});
