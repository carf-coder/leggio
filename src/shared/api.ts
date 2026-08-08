// src/shared/api.ts
// Cloudflare Workerプロキシ(worker/)への呼び出しクライアント。SPEC v1 §3・§5。
// 合言葉未設定・通信失敗・スキーマ不正のいずれの場合も例外を投げる。
// 呼び出し側(SubmitScreen)はこれをcatchして自己採点モードにフォールバックする。

import { getAccessToken, getWorkerEndpoint } from "./storage";
import { ISSUE_CODES, type CorrectionResult, type IssueCode } from "./types";

export interface TranscribeImage {
  base64: string;
  mimeType: string;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const token = getAccessToken();
  if (!token) {
    throw new Error("合言葉が設定されていません");
  }
  const endpoint = getWorkerEndpoint().replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Workerに接続できませんでした: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === "string") message = parsed.error;
    } catch {
      // テキストのまま使う
    }
    throw new Error(`Worker応答エラー (HTTP ${res.status}): ${message.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Workerの応答がJSONとして解析できません");
  }
}

export async function transcribeImages(images: TranscribeImage[]): Promise<string> {
  const obj = (await postJson("/transcribe", { images })) as { transcription?: unknown };
  if (typeof obj.transcription !== "string") {
    throw new Error("転写結果の形式が不正です");
  }
  return obj.transcription;
}

function isIssueCode(v: unknown): v is IssueCode {
  return typeof v === "string" && (ISSUE_CODES as string[]).includes(v);
}

/** SPEC §4.3スキーマの最小限の実行時検証。不正なら例外を投げる。 */
export function validateCorrectionResult(obj: unknown): CorrectionResult {
  if (!obj || typeof obj !== "object") throw new Error("添削結果がオブジェクトではありません");
  const o = obj as Record<string, unknown>;
  if (typeof o.transcription !== "string") throw new Error("transcriptionが不正です");
  if (!Array.isArray(o.issues)) throw new Error("issuesが不正です");
  const issues = o.issues.map((it, i) => {
    if (!it || typeof it !== "object") throw new Error(`issues[${i}]が不正です`);
    const x = it as Record<string, unknown>;
    if (typeof x.sentenceIdx !== "number") throw new Error(`issues[${i}].sentenceIdxが不正です`);
    if (!isIssueCode(x.code)) throw new Error(`issues[${i}].codeが不正です`);
    for (const f of ["userText", "correct", "evidence_it", "explain_ja"]) {
      if (typeof x[f] !== "string") throw new Error(`issues[${i}].${f}が不正です`);
    }
    return {
      sentenceIdx: x.sentenceIdx,
      code: x.code,
      userText: x.userText as string,
      correct: x.correct as string,
      evidence_it: x.evidence_it as string,
      explain_ja: x.explain_ja as string,
    };
  });
  if (!Array.isArray(o.good) || !o.good.every((g) => typeof g === "string")) {
    throw new Error("goodが不正です");
  }
  if (!o.score || typeof o.score !== "object") throw new Error("scoreが不正です");
  const score = o.score as Record<string, unknown>;
  if (typeof score.total !== "number") throw new Error("score.totalが不正です");

  return {
    transcription: o.transcription,
    issues,
    good: o.good as string[],
    score: { total: score.total, detail: typeof score.detail === "string" ? score.detail : undefined },
  };
}

export async function correctTranslation(
  sourceIt: string,
  sentences: string[],
  transcription: string
): Promise<CorrectionResult> {
  const obj = await postJson("/correct", { sourceIt, sentences, transcription });
  return validateCorrectionResult(obj);
}
