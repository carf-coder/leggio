// src/shared/storage.ts
// SPEC v1 §3: 状態はlocalStorage。
// WP3: フェーズ・連続日数。WP4: 合言葉・Workerエンドポイント・添削履歴・弱点統計・
// エクスポート/インポート(SPEC §3「モバイル前提の方式」・§6画面6)。

import type { CorrectionRecord, IssueCode, IssueStats, Phase } from "./types";

const KEY_PHASE = "oir.phase";
const KEY_STREAK = "oir.streak";
const KEY_ACCESS_TOKEN = "oir.accessToken";
const KEY_WORKER_ENDPOINT = "oir.workerEndpoint";
const KEY_CORRECTIONS = "oir.corrections";
const KEY_STATS = "oir.stats";
const KEY_PASSAGES_DONE = "oir.passagesDone";

const DEFAULT_PHASE: Phase = "P1";

/** 開発時の既定Workerエンドポイント(scripts/mock-worker.mjsの既定ポート)。 */
// 本番の添削プロキシを既定にする(URLは秘密ではない。認証は合言葉が担う)。
// ローカル開発時は設定画面で http://localhost:8787 に差し替える。
export const DEFAULT_WORKER_ENDPOINT = (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  ? "http://localhost:8787"
  : "https://leggio-proxy.carf-coder.workers.dev";

const MAX_CORRECTIONS = 200;
const MAX_EXAMPLES_PER_ISSUE = 5;

export function getPhase(): Phase {
  const v = localStorage.getItem(KEY_PHASE);
  if (v === "P1" || v === "P2" || v === "P3") return v;
  return DEFAULT_PHASE;
}

export function setPhase(phase: Phase): void {
  localStorage.setItem(KEY_PHASE, phase);
}

export interface Streak {
  count: number;
  lastDate: string | null; // YYYY-MM-DD
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function getStreak(): Streak {
  const raw = localStorage.getItem(KEY_STREAK);
  if (!raw) return { count: 0, lastDate: null };
  try {
    const parsed = JSON.parse(raw) as Streak;
    if (typeof parsed.count === "number") return parsed;
  } catch {
    // 壊れたデータは無視して初期状態を返す
  }
  return { count: 0, lastDate: null };
}

/** 今日、日課(ドリル等)をこなしたことを記録し、更新後の連続日数を返す。 */
export function recordTodayActivity(): Streak {
  const today = todayStr();
  const prev = getStreak();
  let count: number;
  if (prev.lastDate === today) {
    count = prev.count || 1;
  } else if (prev.lastDate === yesterdayStr()) {
    count = (prev.count || 0) + 1;
  } else {
    count = 1;
  }
  const next: Streak = { count, lastDate: today };
  localStorage.setItem(KEY_STREAK, JSON.stringify(next));
  return next;
}

/* ------------------------------------------------------------------ */
/* 合言葉・Workerエンドポイント(画面6 設定)                            */
/* ------------------------------------------------------------------ */

export function getAccessToken(): string {
  return localStorage.getItem(KEY_ACCESS_TOKEN) || "";
}

export function setAccessToken(token: string): void {
  const v = token.trim();
  if (v) localStorage.setItem(KEY_ACCESS_TOKEN, v);
  else localStorage.removeItem(KEY_ACCESS_TOKEN);
}

export function getWorkerEndpoint(): string {
  return localStorage.getItem(KEY_WORKER_ENDPOINT) || DEFAULT_WORKER_ENDPOINT;
}

export function setWorkerEndpoint(url: string): void {
  const v = url.trim();
  if (v) localStorage.setItem(KEY_WORKER_ENDPOINT, v);
  else localStorage.removeItem(KEY_WORKER_ENDPOINT);
}

/** 合言葉が設定されているか(未設定なら自己採点モードへ自動フォールバック・SPEC§3)。 */
export function hasAccessToken(): boolean {
  return getAccessToken().length > 0;
}

/* ------------------------------------------------------------------ */
/* 添削履歴・弱点統計(画面4/5)                                         */
/* ------------------------------------------------------------------ */

export function getCorrections(): CorrectionRecord[] {
  const raw = localStorage.getItem(KEY_CORRECTIONS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CorrectionRecord[];
  } catch {
    // 壊れたデータは無視
  }
  return [];
}

function setCorrections(list: CorrectionRecord[]): void {
  localStorage.setItem(KEY_CORRECTIONS, JSON.stringify(list.slice(0, MAX_CORRECTIONS)));
}

export function getStats(): IssueStats {
  const raw = localStorage.getItem(KEY_STATS);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as IssueStats;
  } catch {
    // 壊れたデータは無視
  }
  return {};
}

function setStats(stats: IssueStats): void {
  localStorage.setItem(KEY_STATS, JSON.stringify(stats));
}

/** 誤読タイプ1件を弱点統計に加算する。 */
export function recordIssueOccurrence(code: IssueCode, example: string): void {
  const stats = getStats();
  const prev = stats[code] || { count: 0, lastSeen: "", examples: [] };
  const examples = [example, ...prev.examples].filter(Boolean).slice(0, MAX_EXAMPLES_PER_ISSUE);
  stats[code] = { count: prev.count + 1, lastSeen: new Date().toISOString(), examples };
  setStats(stats);
}

/** 添削・自己採点1件を履歴に記録し、含まれる誤読タイプをすべて統計に反映する。 */
export function addCorrectionRecord(record: CorrectionRecord): void {
  const list = getCorrections();
  list.unshift(record);
  setCorrections(list);
  for (const issue of record.issues) {
    recordIssueOccurrence(issue.code, issue.evidence_it || issue.userText || issue.explain_ja || "");
  }
}

/* ------------------------------------------------------------------ */
/* パッセージ消化数(画面5 統計)                                        */
/* ------------------------------------------------------------------ */

export function getPassagesDone(): string[] {
  const raw = localStorage.getItem(KEY_PASSAGES_DONE);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // 壊れたデータは無視
  }
  return [];
}

export function markPassageDone(passageId: string): void {
  const list = getPassagesDone();
  if (!list.includes(passageId)) {
    list.push(passageId);
    localStorage.setItem(KEY_PASSAGES_DONE, JSON.stringify(list));
  }
}

/* ------------------------------------------------------------------ */
/* エクスポート/インポート(SPEC§3 モバイル前提: クリップボード+共有シート)   */
/* ------------------------------------------------------------------ */

const EXPORT_VERSION = 1;

interface ExportedState {
  version: number;
  exportedAt: string;
  phase: Phase;
  streak: Streak;
  accessToken: string;
  workerEndpoint: string;
  corrections: CorrectionRecord[];
  stats: IssueStats;
  passagesDone: string[];
}

export function exportStateJson(): string {
  const state: ExportedState = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    phase: getPhase(),
    streak: getStreak(),
    accessToken: getAccessToken(),
    workerEndpoint: getWorkerEndpoint(),
    corrections: getCorrections(),
    stats: getStats(),
    passagesDone: getPassagesDone(),
  };
  return JSON.stringify(state, null, 2);
}

/** インポートJSONを検証してlocalStorageに反映する。失敗時は例外を投げ、状態を変更しない。 */
export function importStateJson(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("JSONとして読み取れませんでした");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("データの形式が不正です");
  }
  const s = parsed as Partial<ExportedState>;
  if (typeof s.version !== "number") {
    throw new Error("バージョン情報がありません(このアプリのエクスポートデータではない可能性があります)");
  }

  if (s.phase === "P1" || s.phase === "P2" || s.phase === "P3") setPhase(s.phase);
  if (s.streak && typeof s.streak.count === "number") {
    localStorage.setItem(KEY_STREAK, JSON.stringify(s.streak));
  }
  if (typeof s.accessToken === "string") setAccessToken(s.accessToken);
  if (typeof s.workerEndpoint === "string") setWorkerEndpoint(s.workerEndpoint);
  if (Array.isArray(s.corrections)) setCorrections(s.corrections);
  if (s.stats && typeof s.stats === "object") setStats(s.stats);
  if (Array.isArray(s.passagesDone)) {
    localStorage.setItem(KEY_PASSAGES_DONE, JSON.stringify(s.passagesDone));
  }
}
