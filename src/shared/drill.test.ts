// src/shared/drill.test.ts
// 1文ドリルの判定ロジック(judgeMainVerb / judgeBoundaries)のユニットテスト。
// 実行: node --test src/shared/drill.test.ts (Node 25 のTS直接実行)

import test from "node:test";
import assert from "node:assert/strict";
import { judgeMainVerb, judgeBoundaries, outermostClauses, clauseDepths } from "./drill.ts";
import type { Sentence } from "./types";

// content/passages/2026-08-07_p0001.json の sentences[0] を素材にする
// (che以下は語9〜18のrel節。文頭・文末の暗黙境界を除くと期待ギャップは {9, 19} だが
//  19は語数-1=18が最終語のため文末境界にあたり対象外 → 期待ギャップは {9} のみ)
const SENT_SIMPLE: Sentence = {
  idx: 0,
  text:
    "In quasi tutte le città italiane esiste una piazza che i cittadini considerano il centro della propria vita comune.",
  words: 19,
  skeleton: {
    mainVerb: "esiste",
    subject: "una piazza",
    core_ja: "ほぼすべてのイタリアの都市に、ひとつの広場がある。",
  },
  clauses: [{ span: [9, 18], type: "rel", note_ja: "che以下はpiazzaを修飾する関係節。" }],
  model_ja: "…",
  traps: ["MOD"],
};

// 入れ子節を持つ素材: 外側[9,20] ins / 内側[10,20] sub
// (2026-08-07_p0001.json sentences[4] をそのまま使用)
const SENT_NESTED: Sentence = {
  idx: 4,
  text:
    "Alcune amministrazioni, però, hanno deciso di restituirle ai pedoni, convinte che una città senza luoghi d'incontro diventi col tempo meno abitabile.",
  words: 21,
  skeleton: {
    mainVerb: "hanno deciso",
    subject: "Alcune amministrazioni",
    core_ja: "一部の自治体は決めた。",
  },
  clauses: [
    { span: [9, 20], type: "ins", note_ja: "convinte以下は主語に係る叙述的付加。" },
    { span: [10, 20], type: "sub", note_ja: "convinteに従属するche節。" },
  ],
  model_ja: "…",
  traps: ["MOOD"],
};

// ---------- (a) 主動詞タップ判定 ----------

test("judgeMainVerb: 正しい語のインデックスで正解になる", () => {
  // "esiste" は語インデックス6
  assert.equal(judgeMainVerb(SENT_SIMPLE, 6), true);
});

test("judgeMainVerb: 別の語では不正解になる", () => {
  // "piazza" は主動詞ではない
  assert.equal(judgeMainVerb(SENT_SIMPLE, 8), false);
});

test("judgeMainVerb: 複合形はいずれの語をタップしても正解になる", () => {
  const sent: Sentence = {
    ...SENT_NESTED,
    text: "Alcune amministrazioni hanno deciso di restituirle ai pedoni.",
    words: 8,
  };
  // tokens: Alcune(0) amministrazioni(1) hanno(2) deciso(3) di(4) restituirle(5) ai(6) pedoni.(7)
  assert.equal(judgeMainVerb(sent, 2), true); // hanno
  assert.equal(judgeMainVerb(sent, 3), true); // deciso
  assert.equal(judgeMainVerb(sent, 1), false); // amministrazioni
});

test("judgeMainVerb: 範囲外のインデックスは不正解になる", () => {
  assert.equal(judgeMainVerb(SENT_SIMPLE, 99), false);
  assert.equal(judgeMainVerb(SENT_SIMPLE, -1), false);
});

// ---------- outermostClauses / clauseDepths ----------

test("outermostClauses: 単一節はそのまま最外殻になる", () => {
  const outer = outermostClauses(SENT_SIMPLE.clauses);
  assert.equal(outer.length, 1);
});

test("outermostClauses: 内側節は最外殻から除外される", () => {
  const outer = outermostClauses(SENT_NESTED.clauses);
  assert.equal(outer.length, 1);
  assert.deepEqual(outer[0].span, [9, 20]);
});

test("clauseDepths: 最外殻は深さ0、内側節は深さ1になる", () => {
  const depths = clauseDepths(SENT_NESTED.clauses);
  assert.deepEqual(depths, [0, 1]);
});

// ---------- (b) 節境界判定 ----------

test("judgeBoundaries: 正解の境界を過不足なく置くと正解になる", () => {
  const r = judgeBoundaries(SENT_SIMPLE, [9]);
  assert.equal(r.correct, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
});

test("judgeBoundaries: 境界が1つ欠けていると不正解になる", () => {
  const r = judgeBoundaries(SENT_SIMPLE, []);
  assert.equal(r.correct, false);
  assert.deepEqual(r.missing, [9]);
});

test("judgeBoundaries: 節に対応しない余分な境界を置くと不正解になる", () => {
  const r = judgeBoundaries(SENT_SIMPLE, [9, 3]);
  assert.equal(r.correct, false);
  assert.deepEqual(r.extra, [3]);
});

test("judgeBoundaries: 最外殻の節(ins)を正しく置けば内側節(sub)を置いていなくても正解になる", () => {
  // 期待ギャップ: 外側[9,20] -> start=9, end+1=21(=語数-1なので文末境界=対象外) -> {9}
  const r = judgeBoundaries(SENT_NESTED, [9]);
  assert.equal(r.correct, true);
});

test("judgeBoundaries: 内側節(sub)の境界だけを置いた場合は不正解(足りない境界=missing)になる", () => {
  // 内側のstartギャップ(10)だけ置いても、外側のstartギャップ(9)がないので不正解
  const r = judgeBoundaries(SENT_NESTED, [10]);
  assert.equal(r.correct, false);
  assert.ok(r.missing.includes(9));
});

test("judgeBoundaries: 最外殻に加えて内側節の境界を置いても不正解にならない(判定対象外)", () => {
  // 外側の正解(9)に加えて内側節のstartギャップ(10)を置いても、
  // 10は内側節の実在する境界なので「余分な境界」として不正解の原因にならない。
  const r = judgeBoundaries(SENT_NESTED, [9, 10]);
  assert.equal(r.correct, true);
  assert.deepEqual(r.extra, []);
});
