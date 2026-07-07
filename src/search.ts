import type { Notice } from "./types.js";
import { byRecruitEndAsc, scholarshipStatus, statusRank, kstToday } from "./date.js";

// ============================================================================
// 키워드/전문 검색 (임베딩 없음 — 장학금 공고 규모에 충분)
//   가중치: 제목 ×3, 태그(분류·기관·대학구분·학년) ×2, 본문 ×1
// ============================================================================

export interface ScoredNotice {
  notice: Notice;
  score: number;
}

// 한국어 조사 가벼운 절단(2글자 이상 토큰에만)
const JOSA = ["으로", "에서", "에게", "까지", "부터", "은", "는", "이", "가", "을", "를", "의", "에", "도", "와", "과", "로"];

// 도메인 불용어: 거의 모든 공고에 등장해 변별력이 없는 토큰. 검색에서 제외해
// "하버드대 교환학생 장학금" 같은 범위 밖 질의가 '장학금' 매칭으로 오탐되지 않게 한다.
const STOPWORDS = new Set([
  "장학금", "장학생", "장학", "지원", "신청", "대상", "공고", "관련", "있어", "알려줘", "뭐",
]);

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
    .filter((t) => t.length >= 1 && !STOPWORDS.has(t));
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
  return {
    title: n.title.toLowerCase(),
    tags: `${n.category} ${n.organization} ${n.universityType} ${n.gradeCriteria}`.toLowerCase(),
    body: n.body.toLowerCase(),
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
  const today = kstToday();
  return notices
    .map((notice) => ({ notice, score: scoreNotice(notice, tokens) }))
    .filter((s) => s.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // 동점 tiebreak: 활성 먼저(statusRank) → recruitEnd 오름차순(상시 last, null-safe)
        statusRank(scholarshipStatus(a.notice.recruitEnd, today)) -
          statusRank(scholarshipStatus(b.notice.recruitEnd, today)) ||
        byRecruitEndAsc(a.notice, b.notice),
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
