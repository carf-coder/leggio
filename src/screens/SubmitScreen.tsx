// src/screens/SubmitScreen.tsx
// 画面4 提出/添削結果(SPEC v1 §5・§6-4)。
//   1. 写真1〜2枚を選ぶ → /transcribe で転写
//   2. 転写結果を標準テキストエリアで自由編集して確定
//   3. /correct で添削(誤読タイプ+根拠+説明・good・score)
//   4. 結果を弱点統計に記録し、該当文の分解ビューへのリンクを出す
// 合言葉未設定・API失敗時は自己採点モードに自動フォールバックする(SPEC§3)。

import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchPassage } from "../shared/content";
import { transcribeImages, correctTranslation, type TranscribeImage } from "../shared/api";
import {
  addCorrectionRecord,
  hasAccessToken,
  markPassageDone,
} from "../shared/storage";
import { goDrill, goReader, goSettings, goStats } from "../shared/router";
import {
  ISSUE_LABEL,
  type CorrectionIssue,
  type CorrectionResult,
  type IssueCode,
  type Passage,
} from "../shared/types";
import "../styles/submit.css";

interface Props {
  file: string;
}

type Mode = "llm" | "self";
type Step =
  | "choice"
  | "photo"
  | "transcribing"
  | "edit"
  | "correcting"
  | "result"
  | "self-score"
  | "self-done";

interface PickedImage {
  file: File;
  previewUrl: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function SubmitScreen({ file }: Props) {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("llm");
  const [step, setStep] = useState<Step>("choice");
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);

  const [images, setImages] = useState<PickedImage[]>([]);
  const [transcription, setTranscription] = useState("");
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  const [selectedTraps, setSelectedTraps] = useState<Map<number, Set<string>>>(new Map());

  useEffect(() => {
    setPassage(null);
    setError(null);
    setImages([]);
    setTranscription("");
    setResult(null);
    setWorkError(null);
    setFallbackMessage(null);
    setPhotoNotice(null);
    setSelectedTraps(new Map());
    setStep("choice");

    fetchPassage(file)
      .then(setPassage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [file]);

  const sentenceTexts = useMemo(() => (passage ? passage.sentences.map((s) => s.text) : []), [passage]);

  function fallbackToSelfScore(message: string) {
    setMode("self");
    setFallbackMessage(message);
    setStep("self-score");
  }

  function choosePhotoAi() {
    if (!hasAccessToken()) return; // ボタンは無効化されているはずだが念のため
    setMode("llm");
    setFallbackMessage(null);
    setPhotoNotice(null);
    setStep("photo");
  }

  function chooseSelfScore() {
    // 自発的な選択なので、自動フォールバック時とは違いフォールバック通知は出さない
    setMode("self");
    setFallbackMessage(null);
    setStep("self-score");
  }

  async function handlePickFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList).slice(0, 2);
    const next: PickedImage[] = picked.map((f) => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setImages(next);
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleTranscribe() {
    if (images.length === 0) return;
    setStep("transcribing");
    setWorkError(null);
    setPhotoNotice(null);
    try {
      const payload: TranscribeImage[] = await Promise.all(
        images.map(async (img) => ({ base64: await fileToBase64(img.file), mimeType: img.file.type || "image/jpeg" }))
      );
      const text = await transcribeImages(payload);
      if (text.trim().length === 0) {
        // 写真に判読可能な手書きが無い場合の正常系。APIは失敗していないので
        // 自己採点モードへはフォールバックせず、写真の選び直しを促す。
        setImages([]);
        setPhotoNotice("手書きが読み取れませんでした。明るい場所で、紙全体が入るように撮り直してください。");
        setStep("photo");
        return;
      }
      setTranscription(text);
      setStep("edit");
    } catch (e) {
      fallbackToSelfScore(
        `転写に失敗したため自己採点モードに切り替えました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async function handleCorrect() {
    if (!passage) return;
    setStep("correcting");
    setWorkError(null);
    try {
      const r = await correctTranslation(passage.text, sentenceTexts, transcription);
      setResult(r);
      addCorrectionRecord({
        id: newId(),
        ts: new Date().toISOString(),
        passageFile: file,
        passageId: passage.id,
        title_ja: passage.title_ja,
        mode: "llm",
        transcription: r.transcription,
        issues: r.issues,
        good: r.good,
        score: r.score,
      });
      markPassageDone(passage.id);
      setStep("result");
    } catch (e) {
      fallbackToSelfScore(
        `添削に失敗したため自己採点モードに切り替えました: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  function toggleTrap(sentenceIdx: number, code: string) {
    setSelectedTraps((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(sentenceIdx) ?? []);
      if (set.has(code)) set.delete(code);
      else set.add(code);
      next.set(sentenceIdx, set);
      return next;
    });
  }

  function submitSelfScore() {
    if (!passage) return;
    const issues: CorrectionIssue[] = [];
    for (const [sentenceIdx, codes] of selectedTraps) {
      for (const code of codes) {
        issues.push({
          sentenceIdx,
          code: code as IssueCode,
          userText: "",
          correct: "",
          evidence_it: passage.sentences[sentenceIdx]?.text ?? "",
          explain_ja: "自己採点で記録",
        });
      }
    }
    addCorrectionRecord({
      id: newId(),
      ts: new Date().toISOString(),
      passageFile: file,
      passageId: passage.id,
      title_ja: passage.title_ja,
      mode: "self",
      transcription: "",
      issues,
      good: [],
      score: null,
    });
    markPassageDone(passage.id);
    setStep("self-done");
  }

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

  return (
    <div class="container">
      <span class="eyebrow">{passage.title_ja}</span>
      {step !== "choice" ? (
        <span class="submit-mode-badge">{mode === "llm" ? "AI添削モード" : "自己採点モード"}</span>
      ) : null}

      {fallbackMessage ? <p class="submit-fallback-note">{fallbackMessage}</p> : null}

      {step === "choice" && (
        <div class="submit-step">
          <h1 class="page-title">和訳の確認方法を選ぶ</h1>
          <p class="drill-instruction">紙に書いた和訳を、AIに添削してもらうか、自分で模範訳と照らして採点するか選んでください。</p>

          <div class="submit-choice-list">
            <div>
              <button
                type="button"
                class="menu-card"
                disabled={!hasAccessToken()}
                onClick={choosePhotoAi}
              >
                <div class="menu-card__row">
                  <div>
                    <div class="menu-card__label">写真で提出</div>
                    <div class="menu-card__title">写真で提出してAI添削</div>
                    <div class="menu-card__meta">紙の和訳を撮影→転写確認→誤読タイプ付きで添削</div>
                  </div>
                  <span class="menu-card__arrow" aria-hidden="true">
                    &#8250;
                  </span>
                </div>
              </button>
              {!hasAccessToken() ? (
                <p class="submit-choice-note">
                  AI添削には設定画面で合言葉の入力が必要です。{" "}
                  <button type="button" class="issue-card__link" onClick={goSettings}>
                    設定画面へ &#8250;
                  </button>
                </p>
              ) : null}
            </div>

            <button type="button" class="menu-card" onClick={chooseSelfScore}>
              <div class="menu-card__row">
                <div>
                  <div class="menu-card__label">自分で採点</div>
                  <div class="menu-card__title">答えを見て自己採点</div>
                  <div class="menu-card__meta">模範訳と誤読チェックリストで自己採点し統計に記録</div>
                </div>
                <span class="menu-card__arrow" aria-hidden="true">
                  &#8250;
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {step === "photo" && (
        <div class="submit-step">
          <h1 class="page-title">和訳を写真で提出</h1>
          <p class="drill-instruction">紙に書いた和訳を撮影(またはライブラリから選択)してください。1〜2枚まで。</p>

          {photoNotice ? <p class="submit-fallback-note">{photoNotice}</p> : null}

          <label class="photo-picker">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handlePickFiles((e.target as HTMLInputElement).files)}
            />
            {images.length === 0 ? "タップして写真を選ぶ" : `${images.length}枚選択中(タップして選び直す)`}
          </label>

          {images.length > 0 ? (
            <div class="photo-thumbs">
              {images.map((img, i) => (
                <div class="photo-thumb" key={i}>
                  <img src={img.previewUrl} alt={`提出画像${i + 1}`} />
                  <button type="button" class="photo-thumb__remove" onClick={() => removeImage(i)} aria-label="削除">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div class="btn-row">
            <button
              type="button"
              class="btn btn--quiet"
              onClick={() => {
                setPhotoNotice(null);
                setStep("choice");
              }}
            >
              選択に戻る
            </button>
            <button type="button" class="btn btn--primary" disabled={images.length === 0} onClick={handleTranscribe}>
              写真を送信して転写する
            </button>
          </div>
        </div>
      )}

      {step === "transcribing" && (
        <div class="submit-step">
          <p class="loading">転写しています…</p>
        </div>
      )}

      {step === "edit" && (
        <div class="submit-step">
          <h1 class="page-title">転写結果を確認・修正</h1>
          <p class="drill-instruction">
            OCRの誤りをここで直してから添削に進みます。要約・言い換えはせず、書いた通りに直してください。
          </p>
          <textarea
            class="transcribe-textarea"
            value={transcription}
            onInput={(e) => setTranscription((e.target as HTMLTextAreaElement).value)}
          />
          {workError ? <p class="status-line status-line--error">{workError}</p> : null}
          <div class="btn-row">
            <button type="button" class="btn" onClick={() => setStep("photo")}>
              写真を選び直す
            </button>
            <button
              type="button"
              class="btn btn--primary"
              disabled={transcription.trim().length === 0}
              onClick={handleCorrect}
            >
              この内容で添削する
            </button>
          </div>
        </div>
      )}

      {step === "correcting" && (
        <div class="submit-step">
          <p class="loading">添削しています…</p>
        </div>
      )}

      {step === "result" && result ? (
        <div class="submit-step">
          <h1 class="page-title">添削結果</h1>

          <div class="result-score">
            <span class="result-score__value">{result.score.total}</span>
            <span class="result-score__unit">/ 10</span>
          </div>

          {result.issues.length === 0 ? (
            <p class="empty-state">指摘なし。よく読めています。</p>
          ) : (
            <div class="issue-list">
              {result.issues.map((issue, i) => (
                <div class="issue-card" key={i}>
                  <div class="issue-card__head">
                    <span class="issue-code-badge">{issue.code}</span>
                    <span class="issue-code-label">{ISSUE_LABEL[issue.code]}</span>
                  </div>
                  <div class="issue-card__row">
                    <span class="issue-card__row-label">あなたの訳</span>
                    {issue.userText}
                  </div>
                  <div class="issue-card__row">
                    <span class="issue-card__row-label">添削案</span>
                    {issue.correct}
                  </div>
                  <div class="issue-card__row">
                    <span class="issue-card__row-label">根拠</span>
                    {issue.evidence_it}
                  </div>
                  <p class="issue-card__explain">{issue.explain_ja}</p>
                  <button
                    type="button"
                    class="issue-card__link"
                    onClick={() => goDrill(file, issue.sentenceIdx)}
                  >
                    該当文の分解ビューへ &#8250;
                  </button>
                </div>
              ))}
            </div>
          )}

          {result.good.length > 0 ? (
            <ul class="good-list">
              {result.good.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          ) : null}

          <div class="btn-row">
            <button type="button" class="btn" onClick={() => goReader(file)}>
              パッセージに戻る
            </button>
            <button type="button" class="btn btn--primary" onClick={goStats}>
              統計を見る
            </button>
          </div>
        </div>
      ) : null}

      {step === "self-score" && (
        <div class="submit-step">
          <h1 class="page-title">自己採点</h1>
          <p class="drill-instruction">
            模範訳と照らして、自分の訳が引っかかりやすい点(誤読タイプ)をタップして記録してください。
          </p>

          <div class="model-ja" style="margin-bottom:20px;">
            <span class="model-ja__label">全体模範訳</span>
            {passage.model_ja_full}
          </div>

          {passage.sentences
            .filter((s) => s.traps.length > 0)
            .map((s) => (
              <div class="self-score-sentence" key={s.idx}>
                <div class="self-score-sentence__it">{s.text}</div>
                <div class="self-score-sentence__model">{s.model_ja}</div>
                <div class="trap-chip-row">
                  {s.traps.map((code) => {
                    const active = selectedTraps.get(s.idx)?.has(code) ?? false;
                    return (
                      <button
                        type="button"
                        key={code}
                        class={"trap-chip" + (active ? " trap-chip--active" : "")}
                        onClick={() => toggleTrap(s.idx, code)}
                      >
                        {code} {ISSUE_LABEL[code as IssueCode] ?? ""}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  class="issue-card__link"
                  onClick={() => goDrill(file, s.idx)}
                >
                  該当文の分解ビューへ &#8250;
                </button>
              </div>
            ))}

          <div class="btn-row">
            <button type="button" class="btn" onClick={() => goReader(file)}>
              パッセージに戻る
            </button>
            <button type="button" class="btn btn--primary" onClick={submitSelfScore}>
              記録する
            </button>
          </div>
        </div>
      )}

      {step === "self-done" && (
        <div class="submit-step">
          <h1 class="page-title">記録しました</h1>
          <p class="drill-instruction">誤読タイプの統計に反映されました。</p>
          <div class="btn-row">
            <button type="button" class="btn" onClick={() => goReader(file)}>
              パッセージに戻る
            </button>
            <button type="button" class="btn btn--primary" onClick={goStats}>
              統計を見る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
