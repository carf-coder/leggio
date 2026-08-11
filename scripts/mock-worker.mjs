#!/usr/bin/env node
// scripts/mock-worker.mjs
// 開発用モック: worker/ と同一のエンドポイント(POST /transcribe, POST /correct)を
// Nodeのhttpサーバーとして提供する。
//
// - GEMINI_API_KEY が環境変数にあれば実APIへ中継する(worker/gemini.mjs を共用)。
// - なければ固定のダミー転写/添削JSONを返す(自己採点モードのテスト・オフライン開発用)。
// - 認証(Bearer合言葉)・CORS・回数制限は worker/index.mjs のロジックをそのまま使う
//   (合言葉不一致時に自己採点モードへ落ちる動作をこのモックでも再現するため)。
//
// 使い方:
//   node scripts/mock-worker.mjs
//   PORT=8787 ACCESS_TOKEN=test-token GEMINI_API_KEY=xxxx node scripts/mock-worker.mjs
//
// 環境変数:
//   PORT           既定 8787
//   ACCESS_TOKEN   既定 "dev-token"(合言葉。アプリ側の設定画面に入力する値と揃える)
//   ALLOWED_ORIGIN 既定 "*"(開発用に緩め。本番Workerでは特定オリジンに絞る)
//   MODEL          既定 gemini-3.6-flash
//   DAILY_LIMIT    既定 20
//   GEMINI_API_KEY 未設定ならダミーモード

import { createServer } from "node:http";
import { checkAuth, corsResult, consumeRateLimit } from "../worker/index.mjs";
import {
  DEFAULT_MODEL,
  TRANSCRIBE_PROMPT,
  buildCorrectionPrompt,
  RESPONSE_SCHEMA,
  callGemini,
  dummyTranscription,
  dummyCorrection,
} from "../worker/gemini.mjs";

const PORT = Number(process.env.PORT || 8787);
const ENV = {
  ACCESS_TOKEN: process.env.ACCESS_TOKEN || "dev-token",
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || "*",
  MODEL: process.env.MODEL || DEFAULT_MODEL,
  DAILY_LIMIT: Number(process.env.DAILY_LIMIT || 20),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
};
const DUMMY_MODE = !ENV.GEMINI_API_KEY;

// 開発用フック(E2E用): このmimeTypeの画像を送ると、判読不能な手書き(空転写)を再現する。
export const EMPTY_TEST_MIME_TYPE = "image/x-empty-test";

function corsHeadersFor(originHeader) {
  if (ENV.ALLOWED_ORIGIN === "*") {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
  }
  const c = corsResult({ headers: { get: (k) => (k === "Origin" ? originHeader : null) } }, ENV);
  return c.headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, headers, bodyObj) {
  const body = JSON.stringify(bodyObj);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const cors = corsHeadersFor(origin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (req.method !== "POST" || (req.url !== "/transcribe" && req.url !== "/correct")) {
    send(res, 404, cors, { error: "not found" });
    return;
  }

  const authHeader = req.headers["authorization"] || "";
  const fakeReqForAuth = { headers: { get: (k) => (k.toLowerCase() === "authorization" ? authHeader : null) } };
  if (!checkAuth(fakeReqForAuth, ENV)) {
    send(res, 401, cors, { error: "合言葉が一致しません" });
    return;
  }

  const rate = consumeRateLimit(ENV.DAILY_LIMIT);
  if (!rate.allowed) {
    send(res, 429, cors, { error: `本日の呼び出し回数(${rate.limit}回)の上限に達しました` });
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    send(res, 400, cors, { error: "リクエストボディがJSONではありません" });
    return;
  }

  try {
    if (req.url === "/transcribe") {
      const images = Array.isArray(body.images)
        ? body.images
        : body.imageBase64
          ? [{ base64: body.imageBase64, mimeType: body.mimeType || "image/jpeg" }]
          : [];

      if (DUMMY_MODE) {
        // 開発用フック(E2E用): 判読不能な手書き画像を模したmimeTypeを渡すと
        // 空転写(実使用の「本文空」正常系)を再現できる。
        const isEmptyTest = images.some((img) => img && img.mimeType === EMPTY_TEST_MIME_TYPE);
        send(res, 200, cors, { transcription: isEmptyTest ? "" : dummyTranscription() });
        return;
      }
      const parts = [{ text: TRANSCRIBE_PROMPT }];
      for (const img of images) {
        if (!img || !img.base64) continue;
        parts.push({ inline_data: { mime_type: img.mimeType || "image/jpeg", data: img.base64 } });
      }
      // allowEmpty=true: worker/index.mjsと同じく、判読可能な手書きが無い場合の空文字応答を許容する。
      const text = await callGemini(
        ENV.GEMINI_API_KEY,
        ENV.MODEL,
        parts,
        { temperature: 0, maxOutputTokens: 4096 },
        true
      );
      send(res, 200, cors, { transcription: text.trim() });
      return;
    }

    // /correct
    const { sourceIt, sentences, transcription } = body;
    if (typeof sourceIt !== "string" || typeof transcription !== "string") {
      send(res, 400, cors, { error: "sourceIt / transcription が必要です" });
      return;
    }
    if (DUMMY_MODE) {
      send(res, 200, cors, dummyCorrection(transcription));
      return;
    }
    const prompt = buildCorrectionPrompt(sourceIt, Array.isArray(sentences) ? sentences : [], transcription);
    const text = await callGemini(ENV.GEMINI_API_KEY, ENV.MODEL, [{ text: prompt }], {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    });
    send(res, 200, cors, JSON.parse(text));
  } catch (e) {
    send(res, 502, cors, { error: e && e.message ? e.message : String(e) });
  }
});

server.listen(PORT, () => {
  console.log(
    `mock-worker: http://localhost:${PORT} で起動 (${DUMMY_MODE ? "ダミーモード" : `実API中継 model=${ENV.MODEL}`})`
  );
  console.log(`  ACCESS_TOKEN=${ENV.ACCESS_TOKEN}`);
});
