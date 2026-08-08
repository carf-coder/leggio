// src/screens/StatsScreen.tsx
// 画面5 統計(SPEC v1 §6-5): 誤読タイプ別の累計・直近推移、パッセージ消化数。
// チャートライブラリ不使用・CSSバーで簡素に表示する。

import { useEffect, useState } from "preact/hooks";
import { fetchIndex } from "../shared/content";
import { getCorrections, getPassagesDone, getStats } from "../shared/storage";
import { ISSUE_CODES, ISSUE_LABEL, type ContentIndex, type CorrectionRecord, type IssueStats } from "../shared/types";
import "../styles/stats.css";

export function StatsScreen() {
  const [stats, setStats] = useState<IssueStats>({});
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [passagesDoneCount, setPassagesDoneCount] = useState(0);
  const [index, setIndex] = useState<ContentIndex | null>(null);

  useEffect(() => {
    setStats(getStats());
    setCorrections(getCorrections());
    setPassagesDoneCount(getPassagesDone().length);
    fetchIndex()
      .then(setIndex)
      .catch(() => setIndex(null));
  }, []);

  const maxCount = Math.max(1, ...ISSUE_CODES.map((c) => stats[c]?.count ?? 0));
  const totalPassages = index?.passages.length ?? 0;
  const progressPct = totalPassages > 0 ? Math.min(100, Math.round((passagesDoneCount / totalPassages) * 100)) : 0;

  return (
    <div class="container">
      <h1 class="page-title">弱点統計</h1>
      <p class="page-lede">誤読タイプ別の累計と、パッセージの消化状況。</p>

      <h2 class="section-heading" style="margin-top:0;border-top:none;padding-top:0;">
        パッセージ消化数
      </h2>
      <div class="card progress-card-wrap">
        <div class="progress-card">
          <span>
            <span class="progress-card__value">{passagesDoneCount}</span>
            <span style="color:var(--ink-faint);font-size:13px;"> / {totalPassages}本</span>
          </span>
          <span style="color:var(--ink-faint);font-size:13px;">{progressPct}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style={`width:${progressPct}%`} />
        </div>
      </div>

      <h2 class="section-heading">誤読タイプ別 累計</h2>
      {ISSUE_CODES.every((c) => !stats[c] || stats[c]!.count === 0) ? (
        <p class="empty-state">まだ記録がありません。添削・自己採点を行うとここに表示されます。</p>
      ) : (
        <div class="card">
          {ISSUE_CODES.map((code) => {
            const entry = stats[code];
            const count = entry?.count ?? 0;
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div class="stat-bar-row" key={code}>
                <span class="stat-bar-row__label">
                  {code} <span style="font-weight:400;color:var(--ink-faint);">{ISSUE_LABEL[code]}</span>
                </span>
                <span class="stat-bar-track">
                  <span class="stat-bar-fill" style={`width:${pct}%`} />
                </span>
                <span class="stat-bar-row__count">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <h2 class="section-heading">直近の記録</h2>
      {corrections.length === 0 ? (
        <p class="empty-state">まだ記録がありません。</p>
      ) : (
        <div class="recent-list">
          {corrections.slice(0, 10).map((c) => (
            <div class="recent-item" key={c.id}>
              <span class="recent-item__title">
                {c.title_ja} ・ {c.mode === "llm" ? "AI添削" : "自己採点"} ・{" "}
                {new Date(c.ts).toLocaleDateString("ja-JP")}
              </span>
              <span class="recent-item__codes">
                {Array.from(new Set(c.issues.map((i) => i.code)))
                  .slice(0, 4)
                  .map((code) => (
                    <span class="recent-item__code" key={code}>
                      {code}
                    </span>
                  ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
