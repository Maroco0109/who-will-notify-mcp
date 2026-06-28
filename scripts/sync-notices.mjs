// ============================================================================
// sync-notices.mjs — 게시판 크롤 + seed JOIN → data/notices.json
//
//   node scripts/sync-notices.mjs              # 크롤 모드(기본): Pages 게시판 fetch
//   node scripts/sync-notices.mjs --from-seed  # 부트스트랩: 네트워크 없이 seed 로 생성
//
// 동작(크롤 모드):
//   1) Pages index.html fetch → .notice-row 에서 텍스트 공지(id·title·date·category) 추출
//   2) 각 상세 fetch → data-published, .notice-body 텍스트 추출
//   3) 구조화 필드(courses/dates/semester/grade)는 HTML 이 아니라 seed 에서 id 로 JOIN
//   4) hash=sha256(title|body|publishedAt), id 기준 upsert (새 id=삽입, hash 변경 시 교체)
//   5) data/notices.json 작성 ({ notices, syncedAt, source })
//
// 실패(네트워크/파싱 오류) 시 비정상 종료한다 — 빈/부분 notices.json 을 쓰지 않는다.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  PAGES_BASE,
  contentHash,
  detailUrl,
  loadSeed,
  seedToNotice,
  seedStructuredIndex,
} from "./lib.mjs";

const OUT = join(ROOT, "data", "notices.json");
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 15000);

function unescapeHtml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function loadExisting() {
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf-8"));
    if (Array.isArray(parsed.notices)) return parsed.notices;
  } catch {
    /* 없음/손상 — 빈 목록에서 시작 */
  }
  return [];
}

function writeOut(notices, source) {
  notices.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const db = { notices, syncedAt: new Date().toISOString(), source };
  writeFileSync(OUT, `${JSON.stringify(db, null, 2)}\n`, "utf-8");
}

/** id 기준 upsert. 반환: { merged, added, updated, unchanged } */
function upsertById(existing, incoming) {
  const byId = new Map(existing.map((n) => [n.id, n]));
  let added = 0,
    updated = 0,
    unchanged = 0;
  for (const n of incoming) {
    const prev = byId.get(n.id);
    if (!prev) {
      byId.set(n.id, n);
      added++;
    } else if (prev.hash !== n.hash) {
      byId.set(n.id, n);
      updated++;
    } else {
      unchanged++;
    }
  }
  return { merged: [...byId.values()], added, updated, unchanged };
}

// ── 부트스트랩 모드: seed → notices (네트워크 없음) ──────────────────────────
async function fromSeed() {
  const seed = loadSeed();
  const incoming = seed.notices.map(seedToNotice);
  const { merged, added, updated, unchanged } = upsertById(loadExisting(), incoming);
  writeOut(merged, "seed");
  console.log(
    `[sync --from-seed] 총 ${merged.length}건 (added ${added}, updated ${updated}, unchanged ${unchanged})`,
  );
}

// ── 크롤 모드: Pages 게시판 fetch + seed JOIN ───────────────────────────────
function parseListRows(html) {
  const rows = [];
  const rowRe =
    /<tr class="notice-row" data-id="([^"]+)">([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const id = m[1];
    const cell = m[2];
    const titleM = cell.match(
      /<td class="col-title"><a href="([^"]+)">([\s\S]*?)<\/a>/,
    );
    const catM = cell.match(/<td class="col-category">([\s\S]*?)<\/td>/);
    const dateM = cell.match(/<td class="col-date">([\s\S]*?)<\/td>/);
    if (!titleM) throw new Error(`목록 행 파싱 실패(${id}): 제목 셀 없음`);
    rows.push({
      id,
      title: unescapeHtml(titleM[2].trim()),
      detailHref: titleM[1],
      category: catM ? unescapeHtml(catM[1].trim()) : "일반",
      date: dateM ? dateM[1].trim() : "",
    });
  }
  return rows;
}

function parseDetail(html, id) {
  const pubM = html.match(/data-published="([^"]+)"/);
  const bodyM = html.match(/<p class="notice-body">([\s\S]*?)<\/p>/);
  if (!pubM) throw new Error(`상세 파싱 실패(${id}): data-published 없음`);
  if (!bodyM) throw new Error(`상세 파싱 실패(${id}): .notice-body 없음`);
  return {
    publishedAt: pubM[1],
    body: unescapeHtml(bodyM[1].trim()),
  };
}

async function fromCrawl() {
  const seed = loadSeed();
  const structured = seedStructuredIndex(seed);

  const indexUrl = `${PAGES_BASE}/index.html`;
  const indexHtml = await fetchText(indexUrl);
  const rows = parseListRows(indexHtml);
  if (rows.length === 0) {
    throw new Error(`게시판 목록에서 공지를 찾지 못했습니다: ${indexUrl}`);
  }

  const incoming = [];
  for (const row of rows) {
    const url = new URL(row.detailHref, `${indexUrl}`).toString();
    const detailHtml = await fetchText(url);
    const { publishedAt, body } = parseDetail(detailHtml, row.id);

    // 구조화 데이터는 HTML 이 아니라 seed 에서 JOIN (seed 우선)
    const s = structured.get(row.id) ?? {};
    incoming.push({
      id: row.id,
      title: row.title,
      body,
      category: s.category ?? row.category,
      ...(s.semester !== undefined ? { semester: s.semester } : {}),
      ...(s.grade !== undefined ? { grade: s.grade } : {}),
      ...(s.courses !== undefined ? { courses: s.courses } : {}),
      ...(s.dates !== undefined ? { dates: s.dates } : {}),
      publishedAt,
      sourceUrl: detailUrl(row.id),
      hash: contentHash(row.title, body, publishedAt),
    });
  }

  const { merged, added, updated, unchanged } = upsertById(loadExisting(), incoming);
  writeOut(merged, "sync");
  console.log(
    `[sync] 크롤 ${incoming.length}건 → 총 ${merged.length}건 (added ${added}, updated ${updated}, unchanged ${unchanged})`,
  );
}

const useSeed = process.argv.includes("--from-seed");
try {
  await (useSeed ? fromSeed() : fromCrawl());
} catch (err) {
  console.error(`[sync] 실패: ${err.message}`);
  process.exit(1); // 빈/부분 notices.json 커밋 방지
}
