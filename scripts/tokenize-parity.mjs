#!/usr/bin/env node
// scripts/tokenize-parity.mjs
// content/validate.mjs の tokenize と src/shared/tokenize.ts の tokenize が
// 全パッセージ・全sentenceに対して同一の結果を返すことを実証する。
// content/ 配下は触らない方針のため、validate.mjs はソースから tokenize の
// 定義そのものを取り出して実行する(重複実装を勝手に信用しない)。

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VALIDATE_PATH = join(ROOT, "content", "validate.mjs");
const PASSAGES_DIR = join(ROOT, "content", "passages");
const SHARED_TOKENIZE_PATH = join(ROOT, "src", "shared", "tokenize.ts");

// --- 1. content/validate.mjs のソースから tokenize の定義を抽出して実行する ---
const validateSrc = readFileSync(VALIDATE_PATH, "utf8");
const m = validateSrc.match(/const tokenize = (\([^)]*\) => [^\n]+;)/);
if (!m) {
  console.error("FAIL: content/validate.mjs から tokenize の定義を抽出できなかった");
  process.exit(1);
}
const referenceTokenize = new Function(`return ${m[1].replace(/;$/, "")}`)();

// --- 2. src/shared/tokenize.ts の実装を読み込む(Node 25 のTS直接実行) ---
const { tokenize: sharedTokenize } = await import(pathToFileURL(SHARED_TOKENIZE_PATH).href);

// --- 3. 全パッセージ・全sentenceで比較 ---
const files = readdirSync(PASSAGES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error("FAIL: content/passages にJSONが見つからない");
  process.exit(1);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

let checked = 0;
let mismatches = 0;

for (const file of files) {
  const d = JSON.parse(readFileSync(join(PASSAGES_DIR, file), "utf8"));

  const targets = [
    { label: "text", text: d.text },
    ...(Array.isArray(d.sentences)
      ? d.sentences.map((s) => ({ label: `sentences[${s.idx}]`, text: s.text }))
      : []),
  ];

  for (const t of targets) {
    checked++;
    const ref = referenceTokenize(t.text);
    const shared = sharedTokenize(t.text);
    if (!arraysEqual(ref, shared)) {
      mismatches++;
      console.log(`MISMATCH ${file} ${t.label}`);
      console.log(`  validate.mjs : ${JSON.stringify(ref)}`);
      console.log(`  shared/tokenize.ts: ${JSON.stringify(shared)}`);
    }
  }
  console.log(`checked ${file} (${targets.length}件)`);
}

console.log("---");
console.log(`${checked}件中 ${checked - mismatches}件一致 / ${mismatches}件不一致`);
if (mismatches === 0) {
  console.log("PASS: tokenize-parity");
  process.exit(0);
} else {
  console.log("FAIL: tokenize-parity");
  process.exit(1);
}
