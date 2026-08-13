#!/usr/bin/env node
// scripts/e2e-smoke.mjs
// WP4完了基準の通しE2Eスモークテスト(Playwright, 375px幅)。
//
//   1. mock-worker(ダミーモード)を起動
//   2. `vite preview` で本番ビルド(dist/)を配信
//   3. 主線フロー: 提出画面の2択で「写真で提出してAI添削」を選び、写真提出
//      (wp1/sample_handwriting.jpgを読み取り専用で使用)→ 転写編集 → 添削表示
//      → 統計に反映、をエラーなしで通す
//   4. 合言葉不一致時に自己採点モードへ自動フォールバックする(通知あり)ことを確認する
//   5. 合言葉設定済みでも「答えを見て自己採点」を自発的に選ぶと、通知なしで
//      自己採点フローに入り統計に記録されることを確認する
//   6. 合言葉未設定時は「写真で提出してAI添削」ボタンが無効化され、設定画面への
//      案内が表示されることを確認する
//   7. 判読可能な手書きが無い写真(空転写、実使用で判明した正常系)では自己採点へ
//      フォールバックせず、photoステップに留まり撮り直しの通知を出すことを確認する
//   8. 上記の直後に正常な写真で再送信すると、通常の転写→編集フローに戻れることを確認する
//      (既存の正常転写フローが不変であることの確認を兼ねる)
//
// 事前に `npm run build` を実行してdist/を最新化しておくこと。
// 使い方: node scripts/e2e-smoke.mjs

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

// scripts/mock-worker.mjs の EMPTY_TEST_MIME_TYPE と同じ値。
// mock-worker.mjs はimport時にHTTPサーバーを起動する副作用があるため、ここでは
// 値を直接持たせて別プロセス起動(spawnProc)経由でのみ使う。
const EMPTY_TEST_MIME_TYPE = "image/x-empty-test";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SAMPLE_IMAGE = join(ROOT, "wp1", "sample_handwriting.jpg");

const WORKER_PORT = 8799;
const WORKER_TOKEN = "e2e-token";
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const WORKER_URL = `http://localhost:${WORKER_PORT}`;

function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) {
          resolve();
          return;
        }
      } catch {
        // まだ起動していない
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`タイムアウト: ${url} が起動しませんでした`));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

function spawnProc(cmd, args, env, label) {
  const proc = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: "pipe" });
  proc.stdout.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  return proc;
}

async function main() {
  if (!existsSync(SAMPLE_IMAGE)) {
    throw new Error(`テスト画像がありません: ${SAMPLE_IMAGE}`);
  }
  if (!existsSync(join(ROOT, "dist", "index.html"))) {
    throw new Error("dist/index.html がありません。先に `npm run build` を実行してください。");
  }

  console.log("== mock-worker(ダミーモード)を起動 ==");
  const worker = spawnProc(
    "node",
    ["scripts/mock-worker.mjs"],
    { PORT: String(WORKER_PORT), ACCESS_TOKEN: WORKER_TOKEN, ALLOWED_ORIGIN: "*" },
    "mock-worker"
  );
  await waitForHttp(WORKER_URL + "/transcribe").catch(() => {}); // 404でも起動確認になる

  console.log("== vite preview を起動 ==");
  const preview = spawnProc(
    "npx",
    ["vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
    {},
    "vite-preview"
  );
  await waitForHttp(PREVIEW_URL);

  // このマシンには playwright 付属のChromiumリビジョンがキャッシュされていないため、
  // システムのGoogle Chromeをチャンネル指定で使う。
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  let failures = 0;
  function assert(cond, message) {
    if (!cond) {
      failures += 1;
      console.error(`NG: ${message}`);
    } else {
      console.log(`OK: ${message}`);
    }
  }

  try {
    /* ---------------- テスト0: ホーム画面(今日の1文/パッセージの日替わり選定)が壊れていない ---------------- */
    await page.goto(PREVIEW_URL);
    await page.waitForSelector("text=今日のメニュー");
    assert(await page.getByRole("button", { name: /今日の1文/ }).isVisible(), "ホームに「今日の1文」カードが表示される");
    assert(await page.getByRole("button", { name: /パッセージを読む/ }).isVisible(), "ホームに「パッセージを読む」カードが表示される");
    assert((await page.locator(".empty-state").count()) === 0, "「教材がまだありません」エラー表示が出ていない");

    /* ---------------- テスト1: 主線フロー(AI添削) ---------------- */
    await page.goto(PREVIEW_URL);
    await page.getByRole("button", { name: "設定" }).click();
    await page.locator('input[placeholder*="自己採点"]').fill(WORKER_TOKEN);
    await page.locator('input[inputmode="url"]').fill(WORKER_URL);

    await page.goto(`${PREVIEW_URL}/#/reader/2026-08-07_p0001.json`);
    await page.getByRole("button", { name: "和訳を写真で提出する" }).click();
    await page.waitForSelector("text=和訳の確認方法を選ぶ");
    await page.getByRole("button", { name: "写真で提出してAI添削" }).click();
    await page.waitForSelector("text=和訳を写真で提出");

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_IMAGE);
    assert((await page.locator(".photo-thumb").count()) === 1, "写真サムネイルが1枚表示される");

    await page.getByRole("button", { name: "写真を送信して転写する" }).click();
    await page.waitForSelector(".transcribe-textarea", { timeout: 15000 });
    const transcriptionValue = await page.locator(".transcribe-textarea").inputValue();
    assert(transcriptionValue.trim().length > 0, "転写結果がテキストエリアに入っている");

    await page.getByRole("button", { name: "この内容で添削する" }).click();
    await page.waitForSelector(".result-score__value", { timeout: 15000 });
    const score = await page.locator(".result-score__value").innerText();
    assert(/^\d+$/.test(score.trim()), `添削結果のscoreが数値で表示される (score=${score})`);
    const issueCount = await page.locator(".issue-card").count();
    console.log(`issue件数: ${issueCount}`);

    await page.getByRole("button", { name: "統計を見る" }).click();
    await page.waitForSelector(".recent-list, .empty-state");
    const recentText = await page.locator(".recent-list").innerText().catch(() => "");
    assert(recentText.includes("イタリアの広場"), "統計の直近記録にパッセージ名が反映されている");
    const progressText = await page.locator(".progress-card__value").innerText();
    assert(progressText.trim() === "1", `パッセージ消化数が1に更新されている (実測=${progressText})`);

    /* ---------------- テスト2: 合言葉不一致→自己採点モードへのフォールバック ---------------- */
    await page.getByRole("button", { name: "設定" }).click();
    await page.locator('input[placeholder*="自己採点"]').fill("wrong-token-mismatch");

    await page.goto(`${PREVIEW_URL}/#/reader/2026-08-07_p0002.json`);
    await page.getByRole("button", { name: "和訳を写真で提出する" }).click();
    await page.waitForSelector("text=和訳の確認方法を選ぶ");
    await page.getByRole("button", { name: "写真で提出してAI添削" }).click();
    await page.waitForSelector("text=和訳を写真で提出");
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_IMAGE);
    await page.getByRole("button", { name: "写真を送信して転写する" }).click();

    await page.waitForSelector(".submit-fallback-note", { timeout: 15000 });
    const fallbackText = await page.locator(".submit-fallback-note").innerText();
    assert(fallbackText.includes("自己採点モード"), `フォールバック通知が表示される: ${fallbackText}`);
    assert((await page.locator(".self-score-sentence").count()) > 0, "自己採点モードの誤読チェックリストが表示される");

    await page.locator(".trap-chip").first().click();
    await page.getByRole("button", { name: "記録する" }).click();
    await page.waitForSelector("text=記録しました", { timeout: 10000 });

    /* ---------------- テスト3: 合言葉設定済みでも自発的に自己採点を選べる(通知なし) ---------------- */
    await page.getByRole("button", { name: "設定" }).click();
    await page.locator('input[placeholder*="自己採点"]').fill(WORKER_TOKEN); // 合言葉を正しい値に戻す

    await page.goto(`${PREVIEW_URL}/#/reader/2026-08-07_p0003.json`);
    await page.getByRole("button", { name: "和訳を写真で提出する" }).click();
    await page.waitForSelector("text=和訳の確認方法を選ぶ");
    assert(
      await page.getByRole("button", { name: "写真で提出してAI添削" }).isEnabled(),
      "合言葉設定済みなら写真ボタンが有効"
    );
    await page.getByRole("button", { name: "答えを見て自己採点" }).click();
    await page.waitForSelector(".self-score-sentence", { timeout: 10000 });
    assert(
      (await page.locator(".submit-fallback-note").count()) === 0,
      "自発的な自己採点選択ではフォールバック通知が出ない"
    );
    await page.locator(".trap-chip").first().click();
    await page.getByRole("button", { name: "記録する" }).click();
    await page.waitForSelector("text=記録しました", { timeout: 10000 });

    await page.getByRole("button", { name: "統計を見る" }).click();
    await page.waitForSelector(".recent-list, .empty-state");
    const progressAfterSelf = await page.locator(".progress-card__value").innerText();
    assert(progressAfterSelf.trim() === "3", `自発的自己採点も含めパッセージ消化数が3に更新される (実測=${progressAfterSelf})`);

    /* ---------------- テスト4: 合言葉未設定時は写真ボタン無効+案内表示 ---------------- */
    await page.getByRole("button", { name: "設定" }).click();
    await page.locator('input[placeholder*="自己採点"]').fill("");

    await page.goto(`${PREVIEW_URL}/#/reader/2026-08-07_p0004.json`);
    await page.getByRole("button", { name: "和訳を写真で提出する" }).click();
    await page.waitForSelector("text=和訳の確認方法を選ぶ");
    assert(
      await page.getByRole("button", { name: "写真で提出してAI添削" }).isDisabled(),
      "合言葉未設定なら写真ボタンが無効"
    );
    assert(
      (await page.locator(".submit-choice-note").innerText()).includes("合言葉の入力が必要です"),
      "合言葉未設定時の案内文言が表示される"
    );
    await page.getByRole("button", { name: "設定画面へ" }).click();
    await page.waitForSelector("text=添削サーバーURL", { timeout: 10000 });
    assert(page.url().includes("#/settings"), "設定画面へのリンクで遷移する");

    /* ---------------- テスト5: 空転写(判読可能な手書きが無い正常系)は自己採点へ
       フォールバックせず、photoステップに留まり撮り直しの通知を出す ---------------- */
    // 直前のテスト4で設定画面に遷移済み(ヘッダーの「設定」リンクは現在のページなので非表示)。
    await page.locator('input[placeholder*="自己採点"]').fill(WORKER_TOKEN);

    await page.goto(`${PREVIEW_URL}/#/reader/2026-08-07_p0005.json`);
    await page.getByRole("button", { name: "和訳を写真で提出する" }).click();
    await page.waitForSelector("text=和訳の確認方法を選ぶ");
    await page.getByRole("button", { name: "写真で提出してAI添削" }).click();
    await page.waitForSelector("text=和訳を写真で提出");

    await page.locator('input[type="file"]').setInputFiles({
      name: "blank.png",
      mimeType: EMPTY_TEST_MIME_TYPE,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // 中身はダミー(mock-workerはmimeTypeだけ見る)
    });
    await page.getByRole("button", { name: "写真を送信して転写する" }).click();

    await page.waitForSelector(".submit-fallback-note", { timeout: 15000 });
    const emptyNoticeText = await page.locator(".submit-fallback-note").innerText();
    assert(
      emptyNoticeText.includes("手書きが読み取れませんでした"),
      `空転写時に撮り直しの通知が表示される: ${emptyNoticeText}`
    );
    assert(await page.getByRole("heading", { name: "和訳を写真で提出" }).isVisible(), "photoステップに留まる(自己採点へ落ちない)");
    assert((await page.locator(".photo-thumb").count()) === 0, "選択済み写真がクリアされ選び直せる");
    assert(
      (await page.locator(".submit-mode-badge").innerText()) === "AI添削モード",
      "モードはAI添削のまま(自己採点へフォールバックしていない)"
    );

    /* ---------------- テスト6: 直後に正常な写真で再送信すると通常フローに戻れる ---------------- */
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_IMAGE);
    assert((await page.locator(".photo-thumb").count()) === 1, "撮り直し後、写真サムネイルが1枚表示される");
    await page.getByRole("button", { name: "写真を送信して転写する" }).click();
    await page.waitForSelector(".transcribe-textarea", { timeout: 15000 });
    const recoveredTranscription = await page.locator(".transcribe-textarea").inputValue();
    assert(recoveredTranscription.trim().length > 0, "撮り直し後は通常通り転写結果が入る");
    assert((await page.locator(".submit-fallback-note").count()) === 0, "編集ステップでは撮り直し通知が消える");

    /* ---------------- コンソールエラーの確認 ---------------- */
    // テスト2(合言葉不一致)は意図的に401を発生させるフローで、Chromeは
    // fetchの非2xx応答をブラウザ側で自動的にconsole.errorへも出す(アプリ側のバグではない)。
    // それ以外の予期しないエラーが無いことを確認する。
    const unexpectedErrors = consoleErrors.filter((e) => !e.includes("401"));
    assert(unexpectedErrors.length === 0, `予期しないコンソール/ページエラーが0件 (実測=${unexpectedErrors.length})`);
    for (const e of consoleErrors) console.log(`  console message: ${e}`);
  } finally {
    await browser.close();
    worker.kill();
    preview.kill();
  }

  console.log("==============================");
  if (failures > 0) {
    console.error(`E2Eスモーク: ${failures}件 NG`);
    process.exitCode = 1;
  } else {
    console.log("E2Eスモーク: 全項目PASS");
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
