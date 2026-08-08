// src/App.tsx
// アプリ骨格: 3画面(ホーム/リーダー/1文ドリル)をハッシュルートで切り替える。

import { useRoute, goHome, goStats, goSettings } from "./shared/router";
import { HomeScreen } from "./screens/HomeScreen";
import { ReaderScreen } from "./screens/ReaderScreen";
import { DrillScreen } from "./screens/DrillScreen";
import { SubmitScreen } from "./screens/SubmitScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import "./styles/app-shell.css";

const TITLES: Record<string, string> = {
  reader: "リーダー",
  drill: "今日の1文",
  submit: "提出・添削",
  stats: "統計",
  settings: "設定",
};

export function App() {
  const route = useRoute();

  return (
    <div class="shell">
      <header class="shell-header">
        {route.name !== "home" ? (
          <button
            type="button"
            class="shell-header__back"
            aria-label="ホームに戻る"
            onClick={goHome}
          >
            &#8592;
          </button>
        ) : null}
        {route.name === "home" ? (
          <span class="shell-header__wordmark">
            Legg<span class="shell-header__wordmark-accent">ì</span>o
          </span>
        ) : (
          <span class="shell-header__title">{TITLES[route.name]}</span>
        )}
        <span class="shell-header__nav">
          {route.name !== "stats" ? (
            <button type="button" class="shell-header__navlink" onClick={goStats}>
              統計
            </button>
          ) : null}
          {route.name !== "settings" ? (
            <button type="button" class="shell-header__navlink" onClick={goSettings}>
              設定
            </button>
          ) : null}
        </span>
      </header>
      <main class="shell-main">
        {route.name === "home" && <HomeScreen />}
        {route.name === "reader" && <ReaderScreen file={route.file} />}
        {route.name === "drill" && (
          <DrillScreen file={route.file} sentenceIdx={route.sentenceIdx} />
        )}
        {route.name === "submit" && <SubmitScreen file={route.file} />}
        {route.name === "stats" && <StatsScreen />}
        {route.name === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
