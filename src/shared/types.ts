// src/shared/types.ts
// SPEC v1 §4.1 パッセージスキーマの型定義。

export type Phase = "P1" | "P2" | "P3";
export type Genre = "essay" | "narrative" | "practical";
export type ClauseType = "rel" | "sub" | "ins" | "ger" | "main";
export type VocabHint = "辞書を引くべき" | "推測可";

export interface Skeleton {
  mainVerb: string;
  subject: string;
  core_ja: string;
}

export interface Clause {
  span: [number, number];
  type: ClauseType;
  note_ja: string;
}

export interface Sentence {
  idx: number;
  text: string;
  words: number;
  skeleton: Skeleton;
  clauses: Clause[];
  model_ja: string;
  traps: string[];
}

export interface Vocab {
  it: string;
  ja: string;
  hint: VocabHint;
}

export interface Passage {
  id: string;
  phase: Phase;
  genre: Genre;
  wordCount: number;
  title_ja: string;
  text: string;
  sentences: Sentence[];
  model_ja_full: string;
  vocab: Vocab[];
}

export interface PassageIndexEntry {
  id: string;
  file: string;
  phase: Phase;
  genre: Genre;
  wordCount: number;
  title_ja: string;
  sentenceCount: number;
}

export interface ContentIndex {
  generatedAt: string;
  passages: PassageIndexEntry[];
}

// --- WP4: 添削(SPEC v1 §4.2/§4.3)・統計・設定関連の型 ---

/** 誤読タイプ(SPEC §4.2)。 */
export type IssueCode = "SYN" | "MOD" | "REF" | "MOOD" | "LEX" | "OMIT" | "ADD";

export const ISSUE_CODES: IssueCode[] = ["SYN", "MOD", "REF", "MOOD", "LEX", "OMIT", "ADD"];

export const ISSUE_LABEL: Record<IssueCode, string> = {
  SYN: "主動詞・骨格の取り違え",
  MOD: "修飾先の誤り",
  REF: "代名詞・所有形容詞の照応ミス",
  MOOD: "接続法・条件法・時制の見落とし",
  LEX: "語義の取り違え",
  OMIT: "訳し漏れ",
  ADD: "原文にない内容の付加",
};

/** LLM添削結果の1指摘(SPEC §4.3)。 */
export interface CorrectionIssue {
  sentenceIdx: number;
  code: IssueCode;
  userText: string;
  correct: string;
  evidence_it: string;
  explain_ja: string;
}

/** LLM添削結果(SPEC §4.3)。 */
export interface CorrectionResult {
  transcription: string;
  issues: CorrectionIssue[];
  good: string[];
  score: { total: number; detail?: string };
}

/** 弱点統計に蓄積する添削・自己採点の1件(localStorage永続用)。 */
export interface CorrectionRecord {
  id: string;
  ts: string; // ISO
  passageFile: string;
  passageId: string;
  title_ja: string;
  mode: "llm" | "self";
  transcription: string;
  issues: CorrectionIssue[];
  good: string[];
  score: { total: number; detail?: string } | null;
}

/** 誤読タイプ別の弱点統計(SPEC §4.2)。 */
export interface IssueStatEntry {
  count: number;
  lastSeen: string; // ISO
  examples: string[]; // evidence_it や説明の断片。直近数件のみ保持
}

export type IssueStats = Partial<Record<IssueCode, IssueStatEntry>>;
