// src/screens/HomeScreen.tsx
// 画面1 ホーム: 今日のメニュー(フェーズに応じ1文ドリル/パッセージへの導線)+連続日数(控えめ表示)。

import { useEffect, useState } from "preact/hooks";
import { fetchIndex } from "../shared/content";
import { getPhase, getStreak, type Streak } from "../shared/storage";
import { goDrill, goReader } from "../shared/router";
import type { ContentIndex, PassageIndexEntry, Phase } from "../shared/types";

const PHASE_LABEL: Record<Phase, string> = {
  P1: "P1 構文基礎",
  P2: "P2 全訳量産",
  P3: "P3 本番形式",
};

const GENRE_LABEL: Record<string, string> = {
  essay: "エッセイ",
  narrative: "物語",
  practical: "実用文",
};

export function HomeScreen() {
  const [index, setIndex] = useState<ContentIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState<Streak>({ count: 0, lastDate: null });
  const phase = getPhase();

  useEffect(() => {
    setStreak(getStreak());
    fetchIndex()
      .then(setIndex)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div class="container">
        <p class="status-line status-line--error">教材の読み込みに失敗しました: {error}</p>
      </div>
    );
  }

  if (!index) {
    return (
      <div class="container">
        <p class="loading">読み込み中…</p>
      </div>
    );
  }

  const phasePassages = index.passages.filter((p) => p.phase === phase);
  const today: PassageIndexEntry | undefined = phasePassages[0] ?? index.passages[0];

  return (
    <div class="container">
      <span class="eyebrow">{PHASE_LABEL[phase]}</span>
      <h1 class="page-title">今日のメニュー</h1>
      <p class="page-lede">紙に書く前の下ごしらえ。長い文をひとつずつ分解する。</p>

      {today ? (
        <>
          <button type="button" class="menu-card" onClick={() => goDrill(today.file, 0)}>
            <div class="menu-card__row">
              <div>
                <div class="menu-card__label">今日の1文</div>
                <div class="menu-card__title">{today.title_ja}の第1文を分解する</div>
                <div class="menu-card__meta">主動詞→節境界→骨格訳の順に確かめる</div>
              </div>
              <span class="menu-card__arrow" aria-hidden="true">
                &#8250;
              </span>
            </div>
          </button>

          <button type="button" class="menu-card" onClick={() => goReader(today.file)}>
            <div class="menu-card__row">
              <div>
                <div class="menu-card__label">パッセージを読む</div>
                <div class="menu-card__title">{today.title_ja}</div>
                <div class="menu-card__meta">
                  {GENRE_LABEL[today.genre] ?? today.genre} ・ 約{today.wordCount}語 ・{" "}
                  {today.sentenceCount}文
                </div>
              </div>
              <span class="menu-card__arrow" aria-hidden="true">
                &#8250;
              </span>
            </div>
          </button>
        </>
      ) : (
        <p class="empty-state">このフェーズの教材がまだありません。</p>
      )}

      <div class="streak">
        連続日数 <span class="streak__count">{streak.count}</span> 日
      </div>

      <h2 class="section-heading">教材一覧</h2>
      <div class="passage-list">
        {index.passages.map((p) => (
          <button
            key={p.id}
            type="button"
            class="menu-card"
            onClick={() => goReader(p.file)}
          >
            <div class="menu-card__row">
              <div>
                <div class="menu-card__label">{p.phase}</div>
                <div class="menu-card__title">{p.title_ja}</div>
                <div class="menu-card__meta">
                  {GENRE_LABEL[p.genre] ?? p.genre} ・ 約{p.wordCount}語 ・ {p.sentenceCount}文
                </div>
              </div>
              <span class="menu-card__arrow" aria-hidden="true">
                &#8250;
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
