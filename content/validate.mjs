#!/usr/bin/env node
// content/validate.mjs
// SPEC v1 §4.1 のパッセージJSONを検証する。依存ゼロ(Node標準のみ)。
//   node content/validate.mjs            … content/passages/*.json を全件検証
//   node content/validate.mjs a.json b.json … 指定ファイルのみ検証
// 終了コード: 全件PASSなら0、1件でも違反があれば1。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PASSAGES_DIR = join(HERE, "passages");

const PHASES = ["P1", "P2", "P3"];
const GENRES = ["essay", "narrative", "practical"];
const CLAUSE_TYPES = ["rel", "sub", "ins", "ger"];
const TRAP_CODES = ["SYN", "MOD", "REF", "MOOD", "LEX", "OMIT", "ADD"];
const HINTS = ["辞書を引くべき", "推測可"];
const FILENAME_RE = /^(\d{4})-(\d{2})-(\d{2})_([A-Za-z0-9]+)\.json$/;

// フェーズ別の難度レンジ(content/calibration.md §3 と一致させること)
const PHASE_RANGE = {
  P1: { words: [100, 130], maxSentence: [25, 35] },
  P2: { words: [180, 250], maxSentence: [40, 60] },
  P3: { words: [350, 450], maxSentence: [40, 70] },
};

// 語の数え方の唯一の定義。clauses[].span の語インデックスはこの分割に対する0始まりの閉区間。
const tokenize = (s) => s.trim().split(/\s+/).filter(Boolean);

function validateFile(path) {
  const errors = [];
  const warnings = [];
  const file = basename(path);
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { file, errors: [`ファイルを読めない: ${e.message}`], warnings };
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    return { file, errors: [`JSONとして不正: ${e.message}`], warnings };
  }

  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  // --- ファイル名 ---
  const m = FILENAME_RE.exec(file);
  if (!m) E(`ファイル名が YYYY-MM-DD_<id>.json の形式でない`);

  // --- トップレベル必須フィールド ---
  for (const k of ["id", "phase", "genre", "wordCount", "title_ja", "text", "sentences", "model_ja_full", "vocab"]) {
    if (!(k in d)) E(`必須フィールド欠落: ${k}`);
  }
  if (!nonEmptyStr(d.id)) E(`id が空`);
  else if (m && m[4] !== d.id) E(`ファイル名のid(${m[4]})とid(${d.id})が不一致`);
  if (!PHASES.includes(d.phase)) E(`phase が不正: ${JSON.stringify(d.phase)}`);
  if (!GENRES.includes(d.genre)) E(`genre が不正: ${JSON.stringify(d.genre)}`);
  if (!nonEmptyStr(d.title_ja)) E(`title_ja が空`);
  if (!nonEmptyStr(d.text)) E(`text が空`);
  if (!nonEmptyStr(d.model_ja_full)) E(`model_ja_full が空`);
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(raw)) E(`絵文字が含まれている`);

  // --- 語数 ---
  const textWords = nonEmptyStr(d.text) ? tokenize(d.text).length : 0;
  if (typeof d.wordCount !== "number" || !Number.isInteger(d.wordCount) || d.wordCount <= 0) {
    E(`wordCount が正の整数でない: ${JSON.stringify(d.wordCount)}`);
  } else if (textWords > 0) {
    const diff = Math.abs(d.wordCount - textWords) / textWords;
    if (diff > 0.10) E(`wordCount(${d.wordCount})が本文実測(${textWords}語)と10%超ずれている`);
  }

  // --- sentences ---
  if (!Array.isArray(d.sentences) || d.sentences.length === 0) {
    E(`sentences が空の配列`);
    return { file, errors, warnings };
  }
  let sumWords = 0;
  let maxSentence = 0;
  d.sentences.forEach((s, i) => {
    const tag = `sentences[${i}]`;
    if (s.idx !== i) E(`${tag}: idx が ${i} でない(${s.idx})`);
    if (!nonEmptyStr(s.text)) { E(`${tag}: text が空`); return; }
    const w = tokenize(s.text);
    sumWords += w.length;
    maxSentence = Math.max(maxSentence, w.length);
    if (s.words !== w.length) E(`${tag}: words(${s.words})が実測(${w.length})と不一致`);
    if (nonEmptyStr(d.text) && !d.text.includes(s.text)) E(`${tag}: text が本文中に見つからない(表記ゆれの疑い)`);

    // skeleton
    const sk = s.skeleton;
    if (!sk || typeof sk !== "object") E(`${tag}: skeleton がない`);
    else for (const k of ["mainVerb", "subject", "core_ja"]) {
      if (!nonEmptyStr(sk[k])) E(`${tag}: skeleton.${k} が空`);
    }

    // clauses
    if (!Array.isArray(s.clauses) || s.clauses.length === 0) E(`${tag}: clauses が空`);
    else s.clauses.forEach((c, j) => {
      const ct = `${tag}.clauses[${j}]`;
      if (!Array.isArray(c.span) || c.span.length !== 2 || !c.span.every(Number.isInteger)) {
        E(`${ct}: span が[整数,整数]でない`);
      } else {
        const [a, b] = c.span;
        if (a < 0 || b < 0) E(`${ct}: span に負の値`);
        if (a > b) E(`${ct}: span の開始(${a})が終了(${b})より後`);
        if (b > w.length - 1) E(`${ct}: span 終了(${b})が語数上限(${w.length - 1})を超過`);
      }
      if (!CLAUSE_TYPES.includes(c.type)) E(`${ct}: type が不正: ${JSON.stringify(c.type)}`);
      if (!nonEmptyStr(c.note_ja)) E(`${ct}: note_ja が空`);
    });

    // model_ja / traps
    if (!nonEmptyStr(s.model_ja)) E(`${tag}: model_ja が空`);
    if (!Array.isArray(s.traps) || s.traps.length === 0) E(`${tag}: traps が空`);
    else {
      for (const t of s.traps) if (!TRAP_CODES.includes(t)) E(`${tag}: traps に不正なコード: ${JSON.stringify(t)}`);
      if (new Set(s.traps).size !== s.traps.length) E(`${tag}: traps に重複`);
    }
  });

  if (textWords > 0 && sumWords !== textWords) {
    E(`sentences の語数合計(${sumWords})が本文の語数(${textWords})と不一致(分割漏れ・重複の疑い)`);
  }

  // --- vocab ---
  if (!Array.isArray(d.vocab) || d.vocab.length === 0) E(`vocab が空`);
  else d.vocab.forEach((v, i) => {
    if (!nonEmptyStr(v.it)) E(`vocab[${i}]: it が空`);
    if (!nonEmptyStr(v.ja)) E(`vocab[${i}]: ja が空`);
    if (!HINTS.includes(v.hint)) E(`vocab[${i}]: hint が不正: ${JSON.stringify(v.hint)}`);
  });

  // --- 難度レンジ(逸脱は警告。意図的な逸脱を検品で判断できるようにする)---
  const r = PHASE_RANGE[d.phase];
  if (r) {
    if (textWords < r.words[0] || textWords > r.words[1]) {
      W(`語数 ${textWords} が ${d.phase} の目標 ${r.words[0]}〜${r.words[1]} の外`);
    }
    if (maxSentence < r.maxSentence[0] || maxSentence > r.maxSentence[1]) {
      W(`最長文 ${maxSentence}語 が ${d.phase} の目標 ${r.maxSentence[0]}〜${r.maxSentence[1]} の外`);
    }
  }

  return { file, errors, warnings, stats: { words: textWords, maxSentence, sentences: d.sentences.length } };
}

const args = process.argv.slice(2);
let files;
if (args.length > 0) {
  files = args.map((a) => resolve(a));
} else {
  files = readdirSync(PASSAGES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(PASSAGES_DIR, f));
}

if (files.length === 0) {
  console.error("検証対象のJSONが1件もない");
  process.exit(1);
}

let failed = 0;
let warned = 0;
for (const f of files) {
  if (!statSync(f).isFile()) continue;
  const r = validateFile(f);
  const st = r.stats ? ` (${r.stats.words}語 / ${r.stats.sentences}文 / 最長${r.stats.maxSentence}語)` : "";
  if (r.errors.length === 0) {
    console.log(`PASS  ${r.file}${st}`);
  } else {
    failed++;
    console.log(`FAIL  ${r.file}${st}`);
    for (const e of r.errors) console.log(`        ERROR ${e}`);
  }
  for (const w of r.warnings) { warned++; console.log(`        WARN  ${w}`); }
}

console.log(`---\n${files.length}件中 ${files.length - failed}件PASS / ${failed}件FAIL / 警告${warned}件`);
process.exit(failed === 0 ? 0 : 1);
