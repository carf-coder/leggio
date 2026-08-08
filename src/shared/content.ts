// src/shared/content.ts
// public/content/ 配下の静的JSON(scripts/sync-content.mjs が生成)を取得する。

import type { ContentIndex, Passage } from "./types";

const BASE = `${import.meta.env.BASE_URL}content`;

export async function fetchIndex(): Promise<ContentIndex> {
  const res = await fetch(`${BASE}/passages/index.json`);
  if (!res.ok) throw new Error(`index.json の取得に失敗しました(${res.status})`);
  return (await res.json()) as ContentIndex;
}

export async function fetchPassage(file: string): Promise<Passage> {
  const res = await fetch(`${BASE}/passages/${file}`);
  if (!res.ok) throw new Error(`${file} の取得に失敗しました(${res.status})`);
  return (await res.json()) as Passage;
}
