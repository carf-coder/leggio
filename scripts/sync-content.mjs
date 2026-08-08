#!/usr/bin/env node
// scripts/sync-content.mjs
// content/passages/*.json を public/content/passages/ に「コピー」し、
// 一覧マニフェスト public/content/passages/index.json を生成する。
// dev起動・buildの前に実行される構成(package.json の predev/prebuild)。
//
// 安全規律(2026-08-07 インシデント後の絶対条件):
// - content/ 配下は読み取り専用。書き込み・削除を一切行わない。
// - public/content/passages/ を含め、このスクリプトはコピー(上書き保存)のみ行い、
//   ディレクトリの削除(rmSync等)・移動は一切行わない。
//   同名ファイルは上書きされるが、これは意図した「コピーの再実行」であり削除ではない。

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, "content", "passages");
const OUT_DIR = join(ROOT, "public", "content", "passages");

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error(`content/passages にJSONが見つからない: ${SRC_DIR}`);
  process.exit(1);
}

const passages = [];
for (const file of files) {
  const raw = readFileSync(join(SRC_DIR, file), "utf8");
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    console.error(`JSONとして不正: ${file}: ${e.message}`);
    process.exit(1);
  }
  writeFileSync(join(OUT_DIR, file), raw);
  passages.push({
    id: d.id,
    file,
    phase: d.phase,
    genre: d.genre,
    wordCount: d.wordCount,
    title_ja: d.title_ja,
    sentenceCount: Array.isArray(d.sentences) ? d.sentences.length : 0,
  });
}

const index = {
  generatedAt: new Date().toISOString(),
  passages,
};
writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");

console.log(`sync-content: ${passages.length}件のパッセージを public/content/passages/ に同期しました`);
