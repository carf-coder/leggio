// src/shared/tokenize.ts
// 語トークン化の唯一の定義(SPEC v1 §4.1)。
// content/validate.mjs の tokenize と完全に同一の挙動でなければならない。
// 独自のトークン化ロジックをここ以外で再実装しないこと。
//
//   tokenize(s) = s.trim().split(/\s+/).filter(Boolean)
//
// span はこの分割に対する0始まりの閉区間 [開始語, 終了語]。

export function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
