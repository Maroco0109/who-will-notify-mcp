import type { Notice } from "./types.js";

// ============================================================================
// 키워드/전문 검색 (임베딩 없음 — ~30건 규모에 충분)
//   가중치: 제목 ×3, 태그(분류·학년·학기) ×2, 본문+과목+일정 ×1
// ============================================================================

export interface ScoredNotice {
  notice: Notice;
  score: number;
}

// 한국어 조사 가벼운 절단(2글자 이상 토큰에만)
const JOSA = ["으로", "에서", "에게", "까지", "부터", "은", "는", "이", "가", "을", "를", "의", "에", "도", "와", "과", "로"];

function stripJosa(tok: string): string {
  if (tok.length < 2) return tok;
  for (const j of JOSA) {
    if (tok.length > j.length && tok.endsWith(j)) return tok.slice(0, -j.length);
  }
  return tok;
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,./()[\]{}!?~·:;"'`]+/)
    .map((t) => stripJosa(t.trim()))
    .filter((t) => t.length >= 1);
}

function countOcc(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

function haystacks(n: Notice): { title: string; tags: string; body: string } {
  const courseText = (n.courses ?? [])
    .map((c) => `${c.grade}학년 ${c.courseName} ${c.professor} ${c.schedule} ${c.room ?? ""}`)
    .join(" ");
  const dateText = (n.dates ?? [])
    .map((d) => `${d.label} ${d.start} ${d.end ?? ""} ${d.grade ? `${d.grade}학년` : ""}`)
    .join(" ");
  return {
    title: n.title.toLowerCase(),
    tags: `${n.category} ${n.semester ?? ""} ${n.grade ? `${n.grade}학년` : ""}`.toLowerCase(),
    body: `${n.body} ${courseText} ${dateText}`.toLowerCase(),
  };
}

function scoreNotice(n: Notice, tokens: string[]): number {
  const h = haystacks(n);
  let score = 0;
  for (const t of tokens) {
    score += 3 * countOcc(h.title, t);
    score += 2 * countOcc(h.tags, t);
    score += 1 * countOcc(h.body, t);
  }
  return score;
}

export function searchNotices(
  notices: Notice[],
  query: string,
  limit: number,
): ScoredNotice[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return notices
    .map((notice) => ({ notice, score: scoreNotice(notice, tokens) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.notice.publishedAt.localeCompare(a.notice.publishedAt),
    )
    .slice(0, limit);
}

/** 본문에서 질의어 주변을 잘라 ≤maxLen 스니펫 생성. */
export function makeSnippet(notice: Notice, query: string, maxLen = 200): string {
  const body = notice.body;
  const tokens = tokenize(query);
  const lower = body.toLowerCase();
  let pos = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return body.length <= maxLen ? body : `${body.slice(0, maxLen)}…`;
  const start = Math.max(0, pos - 40);
  const slice = body.slice(start, start + maxLen);
  return `${start > 0 ? "…" : ""}${slice}${start + maxLen < body.length ? "…" : ""}`;
}
