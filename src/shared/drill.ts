// src/shared/drill.ts
// 画面3(1文ドリル)の判定ロジック。SPEC v1 §6-2:
//   (a) 主動詞タップ: skeleton.mainVerb と照合。複合形は語のいずれかタップで正解
//   (b) 節境界の指定: 語の間をタップして境界マーカーを置く方式。
//       正誤判定は最外殻のclausesのみ(深さ1)。内側節は判定対象外。
//
// 判定はすべて共有 tokenize のインデックスで行う(SPEC §4.1)。

import { tokenize } from "./tokenize.ts";
import type { Clause, Sentence } from "./types";

// ---------- (a) 主動詞タップ判定 ----------

/** 単語の前後から文字でない記号(句読点・コロン等)を除いて小文字化する。 */
export function normalizeWord(word: string): string {
  return word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase();
}

/**
 * skeleton.mainVerb のテキストから候補語の集合を作る。
 * 例: "vengono occupate / fa (等位の二つの主節)" -> {"vengono","occupate","fa"}
 * 括弧内の注記は候補から除外し、"/" で並記された複合形はすべて候補に含める
 * (SPEC: 複合形は語のいずれかタップで正解)。
 */
export function mainVerbCandidates(mainVerbField: string): Set<string> {
  const withoutNotes = mainVerbField.replace(/\([^)]*\)/g, "");
  const candidates = new Set<string>();
  for (const part of withoutNotes.split("/")) {
    for (const w of tokenize(part)) {
      const norm = normalizeWord(w);
      if (norm) candidates.add(norm);
    }
  }
  return candidates;
}

/** タップした語インデックスが主動詞として正解かどうかを判定する。 */
export function judgeMainVerb(sentence: Sentence, tappedIndex: number): boolean {
  const tokens = tokenize(sentence.text);
  if (tappedIndex < 0 || tappedIndex >= tokens.length) return false;
  const candidates = mainVerbCandidates(sentence.skeleton.mainVerb);
  return candidates.has(normalizeWord(tokens[tappedIndex]));
}

// ---------- (b) 節境界判定 ----------

/**
 * 節境界は「語と語の間のギャップ番号」で表す。
 * ギャップ g は トークン[g-1] と トークン[g] の間(1 <= g <= tokenCount-1)。
 * 文頭・文末は暗黙の境界のため、マーカーの対象にしない。
 */
export function clauseGaps(clause: Pick<Clause, "span">, tokenCount: number): number[] {
  const [a, b] = clause.span;
  const gaps: number[] = [];
  if (a > 0 && a <= tokenCount - 1) gaps.push(a);
  const endGap = b + 1;
  if (endGap > 0 && endGap <= tokenCount - 1) gaps.push(endGap);
  return gaps;
}

/**
 * 他のどの節にも(スパンとして)真に包含されない節=最外殻の節を返す。
 * 同一スパンの節が複数ある場合はどちらも最外殻として扱う(互いに真の包含関係にないため)。
 */
export function outermostClauses(clauses: Clause[]): Clause[] {
  return clauses.filter((c, i) => {
    return !clauses.some((other, j) => {
      if (i === j) return false;
      const [as, ae] = c.span;
      const [bs, be] = other.span;
      const containsOrEqual = bs <= as && ae <= be;
      const strictlyLarger = bs < as || be > ae;
      return containsOrEqual && strictlyLarger;
    });
  });
}

/**
 * 各節の入れ子の深さ(他の節に真に包含されている回数)を返す。
 * 最外殻の節は深さ0。解説ビュー(d)の階層表示に使う。
 */
export function clauseDepths(clauses: Clause[]): number[] {
  return clauses.map((c, i) => {
    let depth = 0;
    for (let j = 0; j < clauses.length; j++) {
      if (i === j) continue;
      const other = clauses[j];
      const [as, ae] = c.span;
      const [bs, be] = other.span;
      const containsOrEqual = bs <= as && ae <= be;
      const strictlyLarger = bs < as || be > ae;
      if (containsOrEqual && strictlyLarger) depth++;
    }
    return depth;
  });
}

function gapSet(clauses: Clause[], tokenCount: number): Set<number> {
  const s = new Set<number>();
  for (const c of clauses) for (const g of clauseGaps(c, tokenCount)) s.add(g);
  return s;
}

export interface BoundaryJudgement {
  correct: boolean;
  /** 置くべきだったのに置かれなかった境界(最外殻のみ) */
  missing: number[];
  /** 節境界のどこにも対応しない、置くべきでなかった境界 */
  extra: number[];
  /** 判定に使った最外殻の期待ギャップ(参考用) */
  expected: number[];
}

/**
 * ユーザーが置いた境界マーカー(ギャップ番号の集合)を、最外殻の節境界とだけ照合する。
 * 内側節のギャップに一致するマーカーは「不正解の原因にしない」(判定対象外・無視)。
 * どの節のギャップにも対応しない位置に置かれたマーカーのみ「余分な境界」として不正解にする。
 */
export function judgeBoundaries(
  sentence: Sentence,
  userGaps: Iterable<number>,
): BoundaryJudgement {
  const tokenCount = tokenize(sentence.text).length;
  const outer = outermostClauses(sentence.clauses);
  const expectedSet = gapSet(outer, tokenCount);
  const allowedSet = gapSet(sentence.clauses, tokenCount); // 最外殻+内側すべて

  const userSet = new Set(userGaps);
  const missing = [...expectedSet].filter((g) => !userSet.has(g)).sort((a, b) => a - b);
  const extra = [...userSet].filter((g) => !allowedSet.has(g)).sort((a, b) => a - b);

  return {
    correct: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    expected: [...expectedSet].sort((a, b) => a - b),
  };
}
