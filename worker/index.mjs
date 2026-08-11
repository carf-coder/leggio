// worker/index.mjs
// Cloudflare Worker (素のfetchハンドラ)。SPEC v1 §3。
// POST /transcribe (画像base64→転写) と POST /correct (原文+確定転写→添削JSON) を提供する。
//
// 認証: Authorization: Bearer <合言葉> を env.ACCESS_TOKEN と比較する。
// 回数制限: 日付キーの簡易メモリカウンタ(env.DAILY_LIMIT、既定20)。
//   Workersは同一isolateが使い回されることが多いが、isolate再生成時はリセットされる。
//   「世界で一人しか使わない」前提のため、SPEC通り厳密性より実装の単純さを優先する。
// CORS: env.ALLOWED_ORIGIN と一致するOriginのみ許可する。
//
// このファイルはキーを含まない。GEMINI_API_KEY・ACCESS_TOKEN は `wrangler secret put` で投入する。

import {
  DEFAULT_MODEL,
  TRANSCRIBE_PROMPT,
  buildCorrectionPrompt,
  RESPONSE_SCHEMA,
  callGemini,
} from "./gemini.mjs";

/* ------------------------------------------------------------------ */
/* 回数制限(日付キーの簡易メモリカウンタ)                              */
/* ------------------------------------------------------------------ */

let rateLimitState = { day: null, count: 0 };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 1回分の呼び出しを消費しようとする。上限に達していればallowed=falseを返す。 */
export function consumeRateLimit(limit) {
  const day = todayKey();
  if (rateLimitState.day !== day) {
    rateLimitState = { day, count: 0 };
  }
  if (rateLimitState.count >= limit) {
    return { allowed: false, count: rateLimitState.count, limit };
  }
  rateLimitState.count += 1;
  return { allowed: true, count: rateLimitState.count, limit };
}

/** テスト専用: 回数制限カウンタをリセットする。本番コードパスからは呼ばれない。 */
export function resetRateLimitForTests() {
  rateLimitState = { day: null, count: 0 };
}

/* ------------------------------------------------------------------ */
/* 認証・CORS                                                          */
/* ------------------------------------------------------------------ */

/** Authorization: Bearer <token> が env.ACCESS_TOKEN と一致するか検証する。 */
export function checkAuth(request, env) {
  const expected = (env && env.ACCESS_TOKEN) || "";
  if (!expected) return false; // シークレット未設定は常に拒否
  const header = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return false;
  return m[1] === expected;
}

/**
 * Originを検証し、CORSヘッダを組み立てる。
 * env.ALLOWED_ORIGIN と一致する場合のみ許可ヘッダを付与する。
 * Originヘッダがないリクエスト(非ブラウザからの直接呼び出し)は許可扱いにする
 * (ブラウザのCORSはOriginヘッダの偽装ができないため、ここでの主目的=Pagesドメイン限定は保たれる)。
 */
export function corsResult(request, env) {
  const allowedOrigin = (env && env.ALLOWED_ORIGIN) || "";
  const origin = request.headers.get("Origin");
  if (!origin) {
    return { allowed: true, headers: {} };
  }
  if (!allowedOrigin || origin !== allowedOrigin) {
    return { allowed: false, headers: {} };
  }
  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      Vary: "Origin",
    },
  };
}

function jsonResponse(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  });
}

/* ------------------------------------------------------------------ */
/* エンドポイント実装                                                  */
/* ------------------------------------------------------------------ */

export async function handleTranscribe(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストボディがJSONではありません" }, 400, corsHeaders);
  }
  const images = Array.isArray(body.images)
    ? body.images
    : body.imageBase64
      ? [{ base64: body.imageBase64, mimeType: body.mimeType || "image/jpeg" }]
      : [];
  if (images.length === 0) {
    return jsonResponse({ error: "images が空です" }, 400, corsHeaders);
  }

  const model = (env && env.MODEL) || DEFAULT_MODEL;
  const parts = [{ text: TRANSCRIBE_PROMPT }];
  for (const img of images) {
    if (!img || !img.base64) continue;
    parts.push({
      inline_data: { mime_type: img.mimeType || "image/jpeg", data: img.base64 },
    });
  }

  try {
    // allowEmpty=true: 写真に判読可能な手書きが無い場合、Geminiは正常に空文字を返すことがある。
    // これはエラーではないため、502にせず200 {transcription:""} を返す(SubmitScreen側で
    // 「手書きが読み取れなかった」通知として扱う)。
    const text = await callGemini(
      env.GEMINI_API_KEY,
      model,
      parts,
      { temperature: 0, maxOutputTokens: 4096 },
      true
    );
    return jsonResponse({ transcription: text.trim() }, 200, corsHeaders);
  } catch (e) {
    return jsonResponse({ error: `転写に失敗しました: ${e.message}` }, 502, corsHeaders);
  }
}

export async function handleCorrect(request, env, corsHeaders) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストボディがJSONではありません" }, 400, corsHeaders);
  }
  const { sourceIt, sentences, transcription } = body;
  if (typeof sourceIt !== "string" || typeof transcription !== "string") {
    return jsonResponse({ error: "sourceIt / transcription が必要です" }, 400, corsHeaders);
  }

  const model = (env && env.MODEL) || DEFAULT_MODEL;
  const prompt = buildCorrectionPrompt(sourceIt, Array.isArray(sentences) ? sentences : [], transcription);

  try {
    const text = await callGemini(env.GEMINI_API_KEY, model, [{ text: prompt }], {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    });
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "添削結果がJSONとして解析できません" }, 502, corsHeaders);
    }
    return jsonResponse(obj, 200, corsHeaders);
  } catch (e) {
    return jsonResponse({ error: `添削に失敗しました: ${e.message}` }, 502, corsHeaders);
  }
}

/* ------------------------------------------------------------------ */
/* fetchハンドラ本体                                                   */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsResult(request, env);

    if (request.method === "OPTIONS") {
      if (!cors.allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors.headers });
    }

    if (!cors.allowed) {
      return jsonResponse({ error: "許可されていないOriginです" }, 403);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "POSTのみ対応しています" }, 405, cors.headers);
    }

    if (url.pathname !== "/transcribe" && url.pathname !== "/correct") {
      return jsonResponse({ error: "not found" }, 404, cors.headers);
    }

    if (!checkAuth(request, env)) {
      return jsonResponse({ error: "合言葉が一致しません" }, 401, cors.headers);
    }

    const limit = Number((env && env.DAILY_LIMIT) || 20);
    const rate = consumeRateLimit(limit);
    if (!rate.allowed) {
      return jsonResponse(
        { error: `本日の呼び出し回数(${rate.limit}回)の上限に達しました` },
        429,
        cors.headers
      );
    }

    if (url.pathname === "/transcribe") {
      return handleTranscribe(request, env, cors.headers);
    }
    return handleCorrect(request, env, cors.headers);
  },
};
