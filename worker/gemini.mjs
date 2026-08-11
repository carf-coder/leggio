// worker/gemini.mjs
// Gemini REST呼び出し・プロンプト・添削JSONスキーマ。
// wp1/run_wp1.mjs (実証済み) から流用。Cloudflare Workers / Node の両方の fetch 実行環境で動く
// (依存はグローバル fetch のみ)。worker/index.mjs と scripts/mock-worker.mjs から共有される。

export const DEFAULT_MODEL = "gemini-3.6-flash";
export const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const ISSUE_CODES = ["SYN", "MOD", "REF", "MOOD", "LEX", "OMIT", "ADD"];

export const TRANSCRIBE_PROMPT = [
  "この画像は、設問用紙に手書きで書かれた日本語の解答です。",
  "手書き部分のみを、書かれている通りに転写してください。",
  "",
  "厳守事項:",
  "- 印刷された設問文・注意書き・QRコード・ページ番号などは一切転写しない。手書き文字だけを対象にする。",
  "- 誤字・脱字・言い回しの不自然さを善意で直さない。書かれている通りに原文追従する。",
  "- 要約・言い換え・敬体常体の統一をしない。",
  "- 解説・前置き・見出しを付けず、転写した本文だけを出力する。",
  "- 改行は解答の改行に合わせる。判読不能な文字は □ 1文字で置く。",
  "- 複数枚の画像が渡された場合は、1枚目→2枚目の順につなげて1つの解答として転写する。",
  "- 判読可能な手書き文字が1文字も見つからない場合は、説明文を書かず、正確に NO_HANDWRITING とだけ出力する。",
].join("\n");

// 手書きが見つからないときにモデルへ要求する番兵トークン。
// worker/index.mjs はこの値(のみの応答)を空転写として扱う。
export const NO_HANDWRITING_SENTINEL = "NO_HANDWRITING";

/**
 * 添削プロンプトを組み立てる。
 * @param {string} sourceIt イタリア語原文全体(段落区切りは\n\n)
 * @param {string[]} sentenceTexts 文単位のイタリア語(0始まりindexで提示し、sentenceIdxの根拠にする)
 * @param {string} transcription 学習者の和訳(転写確定済み)
 */
export function buildCorrectionPrompt(sourceIt, sentenceTexts, transcription) {
  const numberedSentences = (sentenceTexts || [])
    .map((s, i) => `${i}: ${s}`)
    .join("\n");
  return [
    "あなたはイタリア語和訳の添削者です。学習者が紙に書いた和訳を添削します。",
    "",
    "【イタリア語原文】",
    sourceIt,
    "",
    "【原文の文一覧(0始まりindex。sentenceIdxの判定に使う)】",
    numberedSentences,
    "",
    "【学習者の和訳(転写確定済み)】",
    transcription,
    "",
    "この和訳の誤読を指摘し、指定されたJSONスキーマで出力してください。",
    "",
    "規則:",
    "- transcription には、学習者の和訳をそのまま入れる。",
    "- issues[] は誤読ごとに1件。code は次のenumから選ぶ:",
    "  SYN=主動詞・骨格の取り違え / MOD=修飾先の誤り / REF=代名詞・所有形容詞の照応ミス /",
    "  MOOD=接続法・条件法・時制の見落とし / LEX=語義の取り違え / OMIT=訳し漏れ / ADD=原文にない内容の付加",
    "- sentenceIdx には上記の文一覧のindexを入れる。",
    "- userText には学習者の訳の該当箇所、correct には正しい訳、evidence_it には根拠となる原文の断片を入れる。",
    "- explain_ja は「なぜそう読めるか」を断定でなく根拠提示の形で1〜2文で書く。",
    "- good[] にはうまく訳せた点を1〜2個。",
    "- score.total は10点満点の整数。",
  ].join("\n");
}

// Gemini structured output 用スキーマ (SPEC §4.3)
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    transcription: { type: "STRING" },
    issues: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sentenceIdx: { type: "INTEGER" },
          code: { type: "STRING", enum: ISSUE_CODES },
          userText: { type: "STRING" },
          correct: { type: "STRING" },
          evidence_it: { type: "STRING" },
          explain_ja: { type: "STRING" },
        },
        required: [
          "sentenceIdx",
          "code",
          "userText",
          "correct",
          "evidence_it",
          "explain_ja",
        ],
        propertyOrdering: [
          "sentenceIdx",
          "code",
          "userText",
          "correct",
          "evidence_it",
          "explain_ja",
        ],
      },
    },
    good: { type: "ARRAY", items: { type: "STRING" } },
    score: {
      type: "OBJECT",
      properties: {
        total: { type: "INTEGER" },
        detail: { type: "STRING" },
      },
      required: ["total"],
      propertyOrdering: ["total", "detail"],
    },
  },
  required: ["transcription", "issues", "good", "score"],
  propertyOrdering: ["transcription", "issues", "good", "score"],
};

/**
 * Gemini generateContent を呼ぶ。呼び出し元(worker/index.mjs・mock-worker.mjs)が
 * apiKey・model・parts・generationConfig を渡す。ネットワーク/HTTP/パース失敗時は例外を投げる。
 */
/**
 * @param {boolean} [allowEmpty] trueの場合、本文が空でも例外を投げず空文字を返す。
 *   実使用で判明した正常系: 写真に判読可能な手書きが無いと、Geminiは
 *   finishReason=STOPのまま空文字を返すことがある(エラーではない)。
 *   転写(/transcribe)呼び出しはこれを許容し、添削(/correct)側は従来通り例外を投げる。
 */
export async function callGemini(apiKey, model, parts, generationConfig, allowEmpty = false) {
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
  };
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`ネットワークエラー: ${e && e.message ? e.message : e}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`応答がJSONではありません: ${text.slice(0, 500)}`);
  }
  const cand = json.candidates && json.candidates[0];
  if (!cand) {
    throw new Error(`候補が返りませんでした (promptFeedback=${JSON.stringify(json.promptFeedback || null)})`);
  }
  const outParts = (cand.content && cand.content.parts) || [];
  const out = outParts
    .filter((x) => typeof x.text === "string" && x.thought !== true)
    .map((x) => x.text)
    .join("");
  if (!out && !allowEmpty) {
    throw new Error(`本文が空です (finishReason=${cand.finishReason || "不明"})`);
  }
  return out;
}

/** 固定のダミー転写(GEMINI_API_KEY未設定時のmock-worker用)。 */
export function dummyTranscription() {
  return "劇場が静まると、若い歌手はひとり舞台に残り、あれほど熱烈に拍手を送ってくれた聴衆が、シーズンの終わりのあとも自分の名前を覚えていてくれるだろうかと自問した。";
}

/** 固定のダミー添削結果(GEMINI_API_KEY未設定時のmock-worker用)。SPEC §4.3準拠。 */
export function dummyCorrection(transcription) {
  return {
    transcription,
    issues: [
      {
        sentenceIdx: 0,
        code: "MOOD",
        userText: "覚えていてくれるだろうか",
        correct: "覚えていてくれるだろうか(過去における未来・条件法過去)",
        evidence_it: "avrebbe ricordato",
        explain_ja: "avrebbe ricordato は条件法過去(過去における未来)で、単純な推量とは時制のニュアンスが異なる可能性があります。",
      },
    ],
    good: ["文全体の流れは自然に訳せています。", "sola のニュアンスも拾えています。"],
    score: { total: 8, detail: "ダミー添削(mock-worker・GEMINI_API_KEY未設定)" },
  };
}
