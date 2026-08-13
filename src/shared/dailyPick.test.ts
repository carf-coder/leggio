// src/shared/dailyPick.test.ts
// ホーム画面の「今日の1文」「今日のパッセージ」選定ロジックのユニットテスト。
// 実行: node --test src/shared/dailyPick.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { pickDaily, hashString } from "./dailyPick.ts";
import type { PassageIndexEntry } from "./types";

function entry(id: string, sentenceCount: number): PassageIndexEntry {
  return {
    id,
    file: `2026-08-07_${id}.json`,
    phase: "P1",
    genre: "essay",
    wordCount: 100,
    title_ja: `テスト文章${id}`,
    sentenceCount,
  };
}

const THREE: PassageIndexEntry[] = [entry("p0001", 5), entry("p0002", 6), entry("p0003", 4)];

test("同一日・同一入力なら常に同じ結果になる(安定)", () => {
  const r1 = pickDaily("2026-08-13", THREE, []);
  const r2 = pickDaily("2026-08-13", THREE, []);
  assert.ok(r1 && r2);
  assert.equal(r1!.passage.id, r2!.passage.id);
  assert.equal(r1!.sentenceIdx, r2!.sentenceIdx);
  assert.equal(r1!.isReview, r2!.isReview);
});

test("日が変わると(候補2以上で)選択が変わりうる", () => {
  // 30日分試して、候補が固定されないことを確認する(全て同じ結果だと固定バグの再発になる)
  const seen = new Set<string>();
  for (let day = 1; day <= 30; day++) {
    const dateStr = `2026-08-${String(day).padStart(2, "0")}`;
    const r = pickDaily(dateStr, THREE, []);
    seen.add(`${r!.passage.id}:${r!.sentenceIdx}`);
  }
  assert.ok(seen.size > 1, `30日分の選択結果が1パターンしかない(固定されている): ${[...seen].join(", ")}`);
});

test("未消化のパッセージが優先される(消化済みは候補から除外)", () => {
  const doneIds = ["p0001", "p0003"]; // p0002だけ未消化
  for (let day = 1; day <= 30; day++) {
    const dateStr = `2026-08-${String(day).padStart(2, "0")}`;
    const r = pickDaily(dateStr, THREE, doneIds);
    assert.equal(r!.passage.id, "p0002");
    assert.equal(r!.isReview, false);
  }
});

test("全パッセージ消化済みなら全候補から選ぶ復習フォールバックになる", () => {
  const doneIds = THREE.map((p) => p.id);
  const r = pickDaily("2026-08-13", THREE, doneIds);
  assert.ok(r);
  assert.equal(r!.isReview, true);
  assert.ok(THREE.some((p) => p.id === r!.passage.id));
});

test("候補が1本だけでも動作する", () => {
  const one = [entry("p0009", 7)];
  const r = pickDaily("2026-08-13", one, []);
  assert.ok(r);
  assert.equal(r!.passage.id, "p0009");
  assert.ok(r!.sentenceIdx >= 0 && r!.sentenceIdx < 7);
  assert.equal(r!.isReview, false);
});

test("候補が0件ならnullを返す", () => {
  assert.equal(pickDaily("2026-08-13", [], []), null);
});

test("sentenceIdxは常にsentenceCountの範囲内に収まる", () => {
  for (let day = 1; day <= 30; day++) {
    const dateStr = `2026-08-${String(day).padStart(2, "0")}`;
    const r = pickDaily(dateStr, THREE, []);
    const passage = THREE.find((p) => p.id === r!.passage.id)!;
    assert.ok(r!.sentenceIdx >= 0 && r!.sentenceIdx < passage.sentenceCount);
  }
});

test("hashString: 同じ文字列は常に同じ値、非負整数を返す", () => {
  assert.equal(hashString("2026-08-13"), hashString("2026-08-13"));
  assert.ok(Number.isInteger(hashString("2026-08-13")));
  assert.ok(hashString("2026-08-13") >= 0);
});
