// src/screens/ReaderScreen.tsx
// 画面2 リーダー: パッセージ本文(段落表示・セリフ体)。語タップでvocabのヒント表示
// (該当語のみ。vocabにない語は何も出ない)。

import { useEffect, useState } from "preact/hooks";
import { fetchPassage } from "../shared/content";
import { tokenize } from "../shared/tokenize";
import { matchVocabForToken } from "../shared/vocabMatch";
import { goDrill, goSubmit } from "../shared/router";
import type { Passage, Vocab } from "../shared/types";
import "../styles/reader.css";

const GENRE_LABEL: Record<string, string> = {
  essay: "エッセイ",
  narrative: "物語",
  practical: "実用文",
};

interface Props {
  file: string;
}

export function ReaderScreen({ file }: Props) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeVocab, setActiveVocab] = useState<Vocab | null>(null);

  useEffect(() => {
    setPassage(null);
    setError(null);
    setActiveKey(null);
    setActiveVocab(null);
    fetchPassage(file)
      .then(setPassage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [file]);

  if (error) {
    return (
      <div class="container">
        <p class="status-line status-line--error">パッセージの読み込みに失敗しました: {error}</p>
      </div>
    );
  }

  if (!passage) {
    return (
      <div class="container">
        <p class="loading">読み込み中…</p>
      </div>
    );
  }

  const paragraphs = passage.text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  function handleWordTap(key: string, token: string) {
    const vocab = matchVocabForToken(token, passage!.vocab);
    if (!vocab) return; // vocabにない語は何も出ない
    setActiveKey(key);
    setActiveVocab(vocab);
  }

  return (
    <div class="container">
      <span class="eyebrow">{GENRE_LABEL[passage.genre] ?? passage.genre}</span>
      <h1 class="passage-title">{passage.title_ja}</h1>
      <p class="passage-meta">
        約{passage.wordCount}語 ・ {passage.sentences.length}文 ・ 語をタップすると語注が出ます
      </p>

      <div class="passage-text">
        {paragraphs.map((para, pIdx) => {
          const words = tokenize(para);
          return (
            <p key={pIdx}>
              {words.map((w, wIdx) => {
                const key = `${pIdx}-${wIdx}`;
                const hasVocab = matchVocabForToken(w, passage.vocab) !== null;
                const isActive = activeKey === key;
                return (
                  <span key={key}>
                    <span
                      class={
                        "word" +
                        (hasVocab ? " word--vocab" : "") +
                        (isActive ? " word--vocab-active" : "")
                      }
                      onClick={() => handleWordTap(key, w)}
                    >
                      {w}
                    </span>
                    {wIdx < words.length - 1 ? " " : ""}
                  </span>
                );
              })}
            </p>
          );
        })}
      </div>

      {activeVocab ? (
        <div class="vocab-note">
          <span class="vocab-note__it">{activeVocab.it}</span>
          <span class="vocab-note__ja">{activeVocab.ja}</span>
          <span class="vocab-note__hint">{activeVocab.hint}</span>
        </div>
      ) : null}

      <div class="drill-cta">
        <div class="btn-row" style="margin-top:0;">
          <button type="button" class="btn btn--primary" onClick={() => goDrill(file, 0)}>
            この文章の1文ドリルを始める
          </button>
          <button type="button" class="btn" onClick={() => goSubmit(file)}>
            和訳を写真で提出する
          </button>
        </div>
      </div>
    </div>
  );
}
