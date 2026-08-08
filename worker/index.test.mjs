// worker/index.test.mjs
// worker/index.mjs のBearer検証・回数制限・CORSロジックのユニットテスト。
// Node単体で動く(wrangler不要): node --test worker/index.test.mjs
// Node 18+ のグローバル Request/Response/fetch を使う。

import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  checkAuth,
  corsResult,
  consumeRateLimit,
  resetRateLimitForTests,
} from "./index.mjs";

const ENV = {
  ACCESS_TOKEN: "correct-horse-battery-staple",
  ALLOWED_ORIGIN: "https://friend.github.io",
  GEMINI_API_KEY: "dummy-key-not-used-because-fetch-is-stubbed",
  DAILY_LIMIT: 3,
};

function req(path, init) {
  return new Request(`https://worker.example.com${path}`, init);
}

/* ---------------- checkAuth ---------------- */

test("checkAuth: Authorizationヘッダがなければ拒否", () => {
  const r = req("/correct", { method: "POST" });
  assert.equal(checkAuth(r, ENV), false);
});

test("checkAuth: 合言葉が一致しなければ拒否", () => {
  const r = req("/correct", {
    method: "POST",
    headers: { Authorization: "Bearer wrong-token" },
  });
  assert.equal(checkAuth(r, ENV), false);
});

test("checkAuth: 合言葉が一致すれば許可", () => {
  const r = req("/correct", {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.ACCESS_TOKEN}` },
  });
  assert.equal(checkAuth(r, ENV), true);
});

test("checkAuth: ACCESS_TOKEN未設定なら常に拒否", () => {
  const r = req("/correct", {
    method: "POST",
    headers: { Authorization: "Bearer anything" },
  });
  assert.equal(checkAuth(r, { ACCESS_TOKEN: "" }), false);
});

/* ---------------- corsResult ---------------- */

test("corsResult: 許可オリジンと一致すればAccess-Control-Allow-Originを付与", () => {
  const r = req("/correct", {
    method: "POST",
    headers: { Origin: ENV.ALLOWED_ORIGIN },
  });
  const c = corsResult(r, ENV);
  assert.equal(c.allowed, true);
  assert.equal(c.headers["Access-Control-Allow-Origin"], ENV.ALLOWED_ORIGIN);
});

test("corsResult: 許可オリジンと不一致なら拒否", () => {
  const r = req("/correct", {
    method: "POST",
    headers: { Origin: "https://evil.example.com" },
  });
  const c = corsResult(r, ENV);
  assert.equal(c.allowed, false);
});

test("corsResult: Originヘッダがない直接呼び出しは許可扱い(ヘッダは付与しない)", () => {
  const r = req("/correct", { method: "POST" });
  const c = corsResult(r, ENV);
  assert.equal(c.allowed, true);
  assert.equal(c.headers["Access-Control-Allow-Origin"], undefined);
});

/* ---------------- consumeRateLimit ---------------- */

test("consumeRateLimit: 上限内は許可・カウントが増える", () => {
  resetRateLimitForTests();
  const r1 = consumeRateLimit(3);
  const r2 = consumeRateLimit(3);
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r2.count, 2);
});

test("consumeRateLimit: 上限に達すると拒否される", () => {
  resetRateLimitForTests();
  consumeRateLimit(2);
  consumeRateLimit(2);
  const r3 = consumeRateLimit(2);
  assert.equal(r3.allowed, false);
});

/* ---------------- fetchハンドラ(結合) ---------------- */

test("fetch: Origin不一致は403", async () => {
  resetRateLimitForTests();
  const res = await worker.fetch(
    req("/correct", {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    }),
    ENV
  );
  assert.equal(res.status, 403);
});

test("fetch: 合言葉不一致は401", async () => {
  resetRateLimitForTests();
  const res = await worker.fetch(
    req("/correct", {
      method: "POST",
      headers: {
        Origin: ENV.ALLOWED_ORIGIN,
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceIt: "x", transcription: "y" }),
    }),
    ENV
  );
  assert.equal(res.status, 401);
});

test("fetch: 認証OKでも回数上限を超えると429", async () => {
  resetRateLimitForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
      }),
      { status: 200 }
    );
  try {
    const make = () =>
      worker.fetch(
        req("/correct", {
          method: "POST",
          headers: {
            Origin: ENV.ALLOWED_ORIGIN,
            Authorization: `Bearer ${ENV.ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sourceIt: "x", sentences: ["x"], transcription: "y" }),
        }),
        ENV
      );
    const results = [];
    for (let i = 0; i < ENV.DAILY_LIMIT + 1; i++) {
      results.push(await make());
    }
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 429).length, 1);
    assert.equal(statuses[statuses.length - 1], 429);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch: OPTIONSプリフライトは許可オリジンでCORSヘッダ付き204を返す", async () => {
  resetRateLimitForTests();
  const res = await worker.fetch(
    req("/correct", {
      method: "OPTIONS",
      headers: { Origin: ENV.ALLOWED_ORIGIN },
    }),
    ENV
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ENV.ALLOWED_ORIGIN);
});
