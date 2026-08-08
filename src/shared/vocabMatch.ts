// src/shared/vocabMatch.ts
// 画面2(リーダー)の語タップ用: 本文中の語トークンと vocab[].it を対応づける。
//
// 既知の制約(意図的なスコープ): vocab.it は辞書見出し形(不定詞・単数形)で
// 記録されているが、本文中の語は活用・曲用した形(例: occorrere -> occorre,
// facciata -> facciate)で出現する。オフライン環境で正規の伊語形態素解析は
// 導入していないため、ここでは「正規化した語の先頭が一致する」簡易ヒューリスティック
// でマッチングする。完全一致を優先し、なければ先頭共通部分(最短4文字)で判定する。
// 誤マッチ/取りこぼしが残ることは既知の限界としてWP3完了報告に明記する。

import type { Vocab } from "./types";

// 4文字だと "abitudine" と "abitabile"(vocab見出し)のような無関係語が
// 誤マッチした実機確認あり。5文字に上げて既知の6語(occorrere/risalire/
// comune/restituire/facciata/abitabile)の活用形マッチを保ったまま回避する。
const MIN_PREFIX = 5;

export function normalizeIt(word: string): string {
  return word
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")
    .toLowerCase()
    .replace(/'/g, "");
}

function vocabHeadword(v: Vocab): string {
  // "risalire a" のような複数語のvocabは内容語(先頭語)で照合する。
  const first = v.it.trim().split(/\s+/)[0] ?? v.it;
  return normalizeIt(first);
}

/** 本文中のトークン(生の語・punctuation付き)に対応するvocabエントリを1件だけ返す。ない場合はnull。 */
export function matchVocabForToken(token: string, vocab: Vocab[]): Vocab | null {
  const norm = normalizeIt(token);
  if (!norm) return null;

  // 1. 完全一致を優先
  for (const v of vocab) {
    if (vocabHeadword(v) === norm) return v;
  }

  // 2. 先頭共通部分による簡易マッチ(活用・曲用の吸収)
  for (const v of vocab) {
    const head = vocabHeadword(v);
    const len = Math.min(head.length, norm.length);
    if (len < MIN_PREFIX) continue;
    if (head.slice(0, MIN_PREFIX) === norm.slice(0, MIN_PREFIX)) return v;
  }

  return null;
}
