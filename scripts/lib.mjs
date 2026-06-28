// ============================================================================
// 빌드/동기화 스크립트 공유 유틸 (순수 Node, 무의존)
// ============================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

// GitHub Pages / raw 기본 베이스 (환경변수로 덮어쓰기 가능)
export const PAGES_BASE = (
  process.env.PAGES_BASE ?? "https://maroco0109.github.io/who-will-notify-mcp"
).replace(/\/$/, "");

/** sha256(title|body|publishedAt) — 변경감지 전용 해시. */
export function contentHash(title, body, publishedAt) {
  return createHash("sha256")
    .update(`${title}|${body}|${publishedAt}`)
    .digest("hex");
}

/** 공지 상세 페이지 URL. */
export function detailUrl(id) {
  return `${PAGES_BASE}/notice/${id}.html`;
}

/** seed-notices.json 로드 → { meta, notices } */
export function loadSeed() {
  const raw = readFileSync(join(ROOT, "data", "seed-notices.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.notices)) {
    throw new Error("seed-notices.json: notices 배열이 없습니다.");
  }
  return parsed;
}

/**
 * seed 1건 → 완전한 Notice (hash·sourceUrl 채움).
 * 구조화 필드(courses/dates)는 seed 그대로 보존한다.
 */
export function seedToNotice(s) {
  const publishedAt = s.publishedAt;
  return {
    id: s.id,
    title: s.title,
    body: s.body,
    category: s.category,
    ...(s.semester !== undefined ? { semester: s.semester } : {}),
    ...(s.grade !== undefined ? { grade: s.grade } : {}),
    ...(s.courses !== undefined ? { courses: s.courses } : {}),
    ...(s.dates !== undefined ? { dates: s.dates } : {}),
    publishedAt,
    sourceUrl: detailUrl(s.id),
    hash: contentHash(s.title, s.body, publishedAt),
  };
}

/** 구조화 필드를 seed 에서 id 로 JOIN 하기 위한 인덱스. */
export function seedStructuredIndex(seed) {
  const idx = new Map();
  for (const s of seed.notices) {
    idx.set(s.id, {
      ...(s.courses !== undefined ? { courses: s.courses } : {}),
      ...(s.dates !== undefined ? { dates: s.dates } : {}),
      ...(s.semester !== undefined ? { semester: s.semester } : {}),
      ...(s.grade !== undefined ? { grade: s.grade } : {}),
      category: s.category,
    });
  }
  return idx;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ISO8601 → "YYYY-MM-DD" (KST 달력일 표기, 단순 절단). */
export function ymd(iso) {
  return String(iso).slice(0, 10);
}
