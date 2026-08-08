// src/shared/router.ts
// スマホ専用PWAの3画面(ホーム/リーダー/1文ドリル)を切り替える最小限のハッシュルーター。
// 外部ルーティングライブラリは使わない(依存を増やさない)。

import { useEffect, useState } from "preact/hooks";

export type Route =
  | { name: "home" }
  | { name: "reader"; file: string }
  | { name: "drill"; file: string; sentenceIdx: number }
  | { name: "submit"; file: string }
  | { name: "stats" }
  | { name: "settings" };

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "reader" && parts[1]) {
    return { name: "reader", file: parts[1] };
  }
  if (parts[0] === "drill" && parts[1] && parts[2] !== undefined) {
    const idx = Number(parts[2]);
    if (Number.isInteger(idx) && idx >= 0) {
      return { name: "drill", file: parts[1], sentenceIdx: idx };
    }
  }
  if (parts[0] === "submit" && parts[1]) {
    return { name: "submit", file: parts[1] };
  }
  if (parts[0] === "stats") {
    return { name: "stats" };
  }
  if (parts[0] === "settings") {
    return { name: "settings" };
  }
  return { name: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

export function goHome(): void {
  location.hash = "#/";
}

export function goReader(file: string): void {
  location.hash = `#/reader/${encodeURIComponent(file)}`;
}

export function goDrill(file: string, sentenceIdx: number): void {
  location.hash = `#/drill/${encodeURIComponent(file)}/${sentenceIdx}`;
}

export function goSubmit(file: string): void {
  location.hash = `#/submit/${encodeURIComponent(file)}`;
}

export function goStats(): void {
  location.hash = "#/stats";
}

export function goSettings(): void {
  location.hash = "#/settings";
}
