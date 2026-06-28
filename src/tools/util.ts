import type { Notice } from "../types.js";

// 툴 응답 공통 유틸 ──────────────────────────────────────────────────────────

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
export const SNIPPET_MAX = 200;
export const RESPONSE_SOFT_CAP_BYTES = 25 * 1024; // 응답 크기 규율(PlayMCP 심사 대비)

export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

/** MCP 텍스트 결과 한 개. */
export function ok(result: unknown): {
  content: { type: "text"; text: string }[];
} {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

export function errText(err: unknown): {
  content: { type: "text"; text: string }[];
} {
  const msg = err instanceof Error ? err.message : String(err);
  return ok({ error: msg });
}

/**
 * 배열 응답이 소프트 캡을 넘으면 뒤에서부터 잘라 캡 이하로 맞춘다.
 * 반환에 truncated/total 메타를 붙여 호스트가 인지하게 한다.
 */
export function capArray<T>(
  items: T[],
  meta: Record<string, unknown> = {},
): { content: { type: "text"; text: string }[] } {
  let arr = items;
  let truncated = false;
  while (arr.length > 0) {
    const payload = { ...meta, total: items.length, returned: arr.length, truncated, items: arr };
    const text = JSON.stringify(payload);
    if (Buffer.byteLength(text, "utf-8") <= RESPONSE_SOFT_CAP_BYTES) {
      return { content: [{ type: "text" as const, text }] };
    }
    arr = arr.slice(0, Math.max(1, Math.floor(arr.length * 0.8)) - 1);
    truncated = true;
    if (arr.length <= 1) {
      const payload = { ...meta, total: items.length, returned: arr.length, truncated: true, items: arr };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    }
  }
  return ok({ ...meta, total: items.length, returned: 0, truncated: true, items: [] });
}

/** 목록/검색용 공지 요약(본문 전문 제외). */
export interface NoticeSummary {
  id: string;
  title: string;
  category: string;
  publishedAt: string;
  snippet: string;
}

export function summarize(n: Notice, snippet: string): NoticeSummary {
  return {
    id: n.id,
    title: n.title,
    category: n.category,
    publishedAt: n.publishedAt,
    snippet: snippet.slice(0, SNIPPET_MAX),
  };
}
