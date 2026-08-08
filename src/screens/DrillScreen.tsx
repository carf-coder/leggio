// src/screens/DrillScreen.tsx
// 画面3 1文ドリル(SPEC v1 §6-2):
//   (a) 主動詞タップ → (b) 節境界の指定(最外殻のみ判定) → (c) 骨格訳 → (d) 節の階層解説+model_ja
// 判定ロジックは src/shared/drill.ts(共有tokenizeのインデックスで判定)。

import { useEffect, useState } from "preact/hooks";
import { fetchPassage } from "../shared/content";
import { tokenize } from "../shared/tokenize";
import {
  judgeMainVerb,
  judgeBoundaries,
  clauseDepths,
  type BoundaryJudgement,
} from "../shared/drill";
import { recordTodayActivity } from "../shared/storage";
import { goDrill, goReader } from "../shared/router";
import type { ClauseType, Passage } from "../shared/types";
import "../styles/drill.css";

const CLAUSE_LABEL: Record<ClauseType, string> = {
  main: "主節",
  rel: "関係節",
  sub: "従属節",
  ins: "挿入",
  ger: "ジェルンディオ",
};

type Step = "verb" | "boundaries" | "skeleton" | "explain";
const STEPS: Step[] = ["verb", "boundaries", "skeleton", "explain"];

interface Props {
  file: string;
  sentenceIdx: number;
}

export function DrillScreen({ file, sentenceIdx }: Props) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("verb");

  const [verbCorrectIdx, setVerbCorrectIdx] = useState<number | null>(null);
  const [verbWrongIdx, setVerbWrongIdx] = useState<number | null>(null);

  const [userGaps, setUserGaps] = useState<Set<number>>(new Set());
  const [boundaryResult, setBoundaryResult] = useState<BoundaryJudgement | null>(null);

  useEffect(() => {
    setPassage(null);
    setError(null);
    setStep("verb");
    setVerbCorrectIdx(null);
    setVerbWrongIdx(null);
    setUserGaps(new Set());
    setBoundaryResult(null);
    fetchPassage(file)
      .then(setPassage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [file, sentenceIdx]);

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

  const sentence = passage.sentences[sentenceIdx];
  if (!sentence) {
    return (
      <div class="container">
        <p class="empty-state">この文は存在しません。</p>
      </div>
    );
  }

  const words = tokenize(sentence.text);
  const stepIdx = STEPS.indexOf(step);
  const hasNextSentence = sentenceIdx + 1 < passage.sentences.length;

  function handleVerbTap(idx: number) {
    if (verbCorrectIdx !== null) return;
    if (judgeMainVerb(sentence, idx)) {
      setVerbCorrectIdx(idx);
      setVerbWrongIdx(null);
    } else {
      setVerbWrongIdx(idx);
    }
  }

  function toggleGap(g: number) {
    setBoundaryResult(null);
    setUserGaps((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  function handleGrade() {
    setBoundaryResult(judgeBoundaries(sentence, userGaps));
  }

  function finishDrill() {
    recordTodayActivity();
    if (hasNextSentence) {
      goDrill(file, sentenceIdx + 1);
    } else {
      goReader(file);
    }
  }

  return (
    <div class="container">
      <div class="drill-progress">
        {STEPS.map((s, i) => (
          <span
            key={s}
            class={
              "drill-progress__dot" +
              (i === stepIdx
                ? " drill-progress__dot--active"
                : i < stepIdx
                  ? " drill-progress__dot--done"
                  : "")
            }
          />
        ))}
      </div>

      {step === "verb" && (
        <div class="drill-step">
          <h1 class="page-title">主動詞を見つける</h1>
          <p class="drill-instruction">
            この文の骨格をなす動詞(定動詞)をタップしてください。複合時制はどちらの語をタップしても正解です。
          </p>
          <div class="drill-sentence drill-sentence--wrap">
            {words.map((w, i) => (
              <span
                key={i}
                class={
                  "dword" +
                  (verbCorrectIdx === i ? " dword--correct" : "") +
                  (verbWrongIdx === i && verbCorrectIdx === null ? " dword--wrong" : "")
                }
                onClick={() => handleVerbTap(i)}
              >
                {w}{" "}
              </span>
            ))}
          </div>
          {verbCorrectIdx !== null ? (
            <p class="boundary-feedback boundary-feedback--correct">
              正解です。主動詞: {sentence.skeleton.mainVerb}
            </p>
          ) : verbWrongIdx !== null ? (
            <p class="boundary-feedback">違います。もう一度探してみましょう。</p>
          ) : null}
          <div class="btn-row">
            <button
              type="button"
              class="btn btn--primary"
              disabled={verbCorrectIdx === null}
              onClick={() => setStep("boundaries")}
            >
              次へ(節境界)
            </button>
          </div>
        </div>
      )}

      {step === "boundaries" && (
        <div class="drill-step">
          <h1 class="page-title">節の境界を区切る</h1>
          <p class="drill-instruction">
            語と語の「あいだ」をタップして、節の切れ目に印を置いてください。判定するのは最も外側の節だけです(入れ子の節は解説で扱います)。
          </p>
          <div class="drill-sentence drill-sentence--wrap">
            {words.map((w, i) => (
              <span key={i} style="display:inline-flex;align-items:center;">
                {i > 0 ? (
                  <span
                    class={
                      "gap" +
                      (userGaps.has(i) ? " gap--marked" : "") +
                      (boundaryResult?.missing.includes(i) ? " gap--missing" : "") +
                      (boundaryResult?.extra.includes(i) ? " gap--extra" : "")
                    }
                    onClick={() => toggleGap(i)}
                    role="button"
                    aria-label={`${i}語目の前に境界を置く`}
                  />
                ) : null}
                <span class="dword dword--static">{w}</span>
              </span>
            ))}
          </div>

          {boundaryResult ? (
            boundaryResult.correct ? (
              <p class="boundary-feedback boundary-feedback--correct">正解です。</p>
            ) : (
              <p class="boundary-feedback">
                まだ正解ではありません
                {boundaryResult.missing.length > 0 ? `(足りない境界 ${boundaryResult.missing.length}箇所)` : ""}
                {boundaryResult.extra.length > 0 ? `(余分な境界 ${boundaryResult.extra.length}箇所)` : ""}
                。赤い印を見直してください。
              </p>
            )
          ) : (
            <p class="drill-instruction" style="margin:14px 0 0;">
              印を置き終えたら採点してください。
            </p>
          )}

          <div class="btn-row">
            <button type="button" class="btn" onClick={handleGrade}>
              採点する
            </button>
            <button
              type="button"
              class="btn btn--primary"
              disabled={!boundaryResult?.correct}
              onClick={() => setStep("skeleton")}
            >
              次へ(骨格訳)
            </button>
          </div>
        </div>
      )}

      {step === "skeleton" && (
        <div class="drill-step">
          <h1 class="page-title">骨格訳を確認する</h1>
          <p class="drill-instruction">節を一旦外し、主語と動詞だけの骨格で意味を確かめます。</p>
          <div class="card skeleton-block">
            <div class="skeleton-row">
              <span class="skeleton-row__label">主語</span>
              <span class="skeleton-row__value">{sentence.skeleton.subject}</span>
            </div>
            <div class="skeleton-row">
              <span class="skeleton-row__label">主動詞</span>
              <span class="skeleton-row__value">{sentence.skeleton.mainVerb}</span>
            </div>
            <div class="skeleton-row">
              <span class="skeleton-row__label">骨格訳</span>
              <span class="skeleton-row__value skeleton-row__value--ja">
                {sentence.skeleton.core_ja}
              </span>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={() => setStep("explain")}>
              次へ(解説)
            </button>
          </div>
        </div>
      )}

      {step === "explain" && (
        <div class="drill-step">
          <h1 class="page-title">節の解説</h1>
          <p class="drill-instruction">挿入句を戻し、節の入れ子構造を確認してから全体訳を読みます。</p>

          <div class="clause-list">
            {sentence.clauses.map((c, i) => {
              const depth = clauseDepths(sentence.clauses)[i];
              return (
                <div key={i} class="clause-item" style={`margin-left:${depth * 16}px;`}>
                  <div class="clause-item__head">
                    <span class="clause-type-badge">{CLAUSE_LABEL[c.type]}</span>
                    <span class="clause-item__span">
                      語{c.span[0] + 1}–{c.span[1] + 1}
                    </span>
                  </div>
                  <p class="clause-item__note">{c.note_ja}</p>
                </div>
              );
            })}
          </div>

          <div class="model-ja">
            <span class="model-ja__label">模範訳</span>
            {sentence.model_ja}
          </div>

          <div class="btn-row">
            <button type="button" class="btn btn--primary" onClick={finishDrill}>
              {hasNextSentence ? "次の文へ" : "パッセージに戻る"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
