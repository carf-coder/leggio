// src/shared/dailyPick.ts
// ホーム画面の「今日の1文」「今日のパッセージ」を決定的に選ぶ純関数。
// 従来は phasePassages[0] 固定だったため、教材が増えても常に同じ1本目しか
// 提示されない問題があった。日付ベースの安定ハッシュで選択する。
//
// 決定則(コーディネーター仕様):
// - 今日のパッセージ = 未消化(donePassageIds外)の候補から、
//   hash(dateStr) mod 候補数 で決定的に選ぶ。未消化ゼロなら全候補から同方式(復習扱い)。
// - 今日の1文 = 選ばれたパッセージ内で、hash(dateStr + passageId) mod sentenceCount で
//   文indexを決定的に選ぶ。
// - ハッシュは暗号強度不要。同一入力に対し常に同一出力を返すことだけを保証する。

import type { PassageIndexEntry } from "./types";

export interface DailyPick {
  passage: PassageIndexEntry;
  sentenceIdx: number;
  /** true = 未消化候補が無く、既読パッセージから復習として選ばれた */
  isReview: boolean;
}

/** 単純な文字列ハッシュ(djb2風)。非負の32bit整数を返す。暗号強度は不要。 */
export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * 今日のパッセージ・1文を決定的に選ぶ。
 * @param dateStr 端末ローカル日付(YYYY-MM-DD)
 * @param phasePassages 現在のフェーズのパッセージ一覧(index.json由来)
 * @param donePassageIds 消化済みパッセージID一覧(localStorage由来)
 * @returns 候補が1件も無ければ null
 */
export function pickDaily(
  dateStr: string,
  phasePassages: PassageIndexEntry[],
  donePassageIds: string[]
): DailyPick | null {
  if (phasePassages.length === 0) return null;

  const doneSet = new Set(donePassageIds);
  const undone = phasePassages.filter((p) => !doneSet.has(p.id));
  const isReview = undone.length === 0;
  const candidates = isReview ? phasePassages : undone;

  const passageIdx = hashString(dateStr) % candidates.length;
  const passage = candidates[passageIdx];

  const sentenceCount = passage.sentenceCount > 0 ? passage.sentenceCount : 1;
  const sentenceIdx = hashString(`${dateStr}:${passage.id}`) % sentenceCount;

  return { passage, sentenceIdx, isReview };
}
