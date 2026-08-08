// src/screens/SettingsScreen.tsx
// 画面6 設定(SPEC v1 §6-6・§3): 合言葉(アクセストークン)・Workerエンドポイント・
// フェーズ切替・データエクスポート(クリップボードコピー+共有シート)/インポート(貼付)。
// PCなしで完結すること(友人の端末はスマホ/タブレットのみ)。

import { useEffect, useState } from "preact/hooks";
import {
  DEFAULT_WORKER_ENDPOINT,
  exportStateJson,
  getAccessToken,
  getPhase,
  getWorkerEndpoint,
  importStateJson,
  setAccessToken,
  setPhase,
  setWorkerEndpoint,
} from "../shared/storage";
import type { Phase } from "../shared/types";
import "../styles/settings.css";

const PHASES: { value: Phase; label: string }[] = [
  { value: "P1", label: "P1 構文基礎" },
  { value: "P2", label: "P2 全訳量産" },
  { value: "P3", label: "P3 本番形式" },
];

export function SettingsScreen() {
  const [token, setToken] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [phase, setPhaseState] = useState<Phase>("P1");

  const [exportText, setExportText] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    setToken(getAccessToken());
    setEndpoint(getWorkerEndpoint());
    setPhaseState(getPhase());
  }, []);

  function handleTokenChange(v: string) {
    setToken(v);
    setAccessToken(v);
  }

  function handleEndpointChange(v: string) {
    setEndpoint(v);
    setWorkerEndpoint(v);
  }

  function handlePhaseChange(p: Phase) {
    setPhaseState(p);
    setPhase(p);
  }

  async function handleExport() {
    const json = exportStateJson();
    setExportText(json);
    setExportMessage(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: "opera-italian-reader データ", text: json });
        setExportMessage("共有シートを開きました。");
        return;
      }
    } catch {
      // 共有がキャンセルされた場合はクリップボードにフォールバック
    }
    try {
      await navigator.clipboard.writeText(json);
      setExportMessage("クリップボードにコピーしました。");
    } catch {
      setExportMessage("自動コピーに失敗しました。下のテキストを手動でコピーしてください。");
    }
  }

  function handleImport() {
    setImportError(null);
    setImportMessage(null);
    try {
      importStateJson(importText);
      setToken(getAccessToken());
      setEndpoint(getWorkerEndpoint());
      setPhaseState(getPhase());
      setImportMessage("インポートしました。");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div class="container">
      <h1 class="page-title">設定</h1>

      <div class="settings-section">
        <span class="settings-label">合言葉</span>
        <input
          class="text-input"
          type="text"
          inputmode="text"
          autocomplete="off"
          placeholder="未設定(自己採点モードになります)"
          value={token}
          onInput={(e) => handleTokenChange((e.target as HTMLInputElement).value)}
        />
        <p class="status-line">
          {token ? "AI添削モードが使えます。" : "未設定です。提出画面は自己採点モードで動作します。"}
        </p>
      </div>

      <div class="settings-section">
        <span class="settings-label">添削サーバーURL</span>
        <input
          class="text-input"
          type="text"
          inputmode="url"
          autocomplete="off"
          placeholder={DEFAULT_WORKER_ENDPOINT}
          value={endpoint}
          onInput={(e) => handleEndpointChange((e.target as HTMLInputElement).value)}
        />
        <p class="status-line">開発・受け渡し時に指定されたURLをそのまま入力してください。</p>
      </div>

      <div class="settings-section">
        <span class="settings-label">フェーズ</span>
        <div class="phase-toggle">
          {PHASES.map((p) => (
            <button
              type="button"
              key={p.value}
              class={"phase-toggle__btn" + (phase === p.value ? " phase-toggle__btn--active" : "")}
              onClick={() => handlePhaseChange(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <h2 class="section-heading">データのバックアップ</h2>

      <div class="settings-section">
        <span class="settings-label">エクスポート</span>
        <p class="drill-instruction" style="margin-bottom:12px;">
          進捗・添削履歴・弱点統計・設定をまとめて書き出します。共有シートまたはクリップボードコピーで、機種変時などに使ってください。
        </p>
        <div class="btn-row" style="margin-top:0;">
          <button type="button" class="btn btn--primary" onClick={handleExport}>
            エクスポート(共有/コピー)
          </button>
        </div>
        {exportMessage ? <p class="status-line">{exportMessage}</p> : null}
        {exportText ? (
          <textarea class="export-textarea" readOnly value={exportText} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
        ) : null}
      </div>

      <div class="settings-section">
        <span class="settings-label">インポート</span>
        <p class="drill-instruction" style="margin-bottom:12px;">
          エクスポートしたテキストをここに貼り付けてください。
        </p>
        <textarea
          class="export-textarea"
          placeholder="ここに貼り付け"
          value={importText}
          onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)}
        />
        <div class="btn-row">
          <button type="button" class="btn btn--primary" disabled={importText.trim().length === 0} onClick={handleImport}>
            インポートする
          </button>
        </div>
        {importMessage ? <p class="status-line">{importMessage}</p> : null}
        {importError ? <p class="status-line status-line--error">{importError}</p> : null}
      </div>
    </div>
  );
}
