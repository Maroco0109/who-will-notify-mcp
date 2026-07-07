// ============================================================================
// sync-notices.mjs — data.go.kr 15028252 odcloud API → data/notices.json
//
//   node --env-file=.env scripts/sync-notices.mjs
//
// 동작:
//   1) odcloud 페이징 fetch(page/perPage, returnType=JSON) — totalCount 완주까지 루프
//   2) 각 응답 → parsePage(비JSON/데이터부재 거부) → buildDb(정규화+shape+prune+게이트)
//   3) 모든 게이트 통과 시에만 data/notices.json 기록({ notices, syncedAt, source:"sync" })
//
// ⚠️ 키 유출 방지: 요청 URL(=serviceKey 포함)을 어떤 로그/에러 문자열에도 절대 담지 않는다.
//    실패 시 `HTTP ${status} on page ${page}` 처럼 비밀 없는 문자열만 던진다.
//    실패(네트워크/게이트) 시 비정상 종료 — 빈/부분 notices.json 을 쓰지 않는다.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { ROOT, parsePage, buildDb, kstToday } from "./lib.mjs";

const OUT = join(ROOT, "data", "notices.json");
// 월 갱신 시 데이터셋 uddi 가 새로 발급된다. 최신본은 repo variable DATA_GO_KR_UDDI 로
// 덮어쓰고, 미설정(빈 문자열 포함) 시 아래 기본값(확인된 최신본)을 쓴다. (|| 로 falsy 안전)
// TODO(follow-up): OAS(infuser.odcloud.kr) 에서 최신 uddi 자동탐색해 월별 수동갱신 제거.
const UDDI =
  process.env.DATA_GO_KR_UDDI || "16645324-7d91-4a1e-a603-a0f2e0029cbb";
const BASE = `https://api.odcloud.kr/api/15028252/v1/uddi:${UDDI}`;
const PER_PAGE = 1000;
const PAGE_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 15000;

/** ⚠️ 절대 로그/에러에 노출 금지 — serviceKey 포함 URL 을 만든다. */
function pageUrl(page) {
  const params = new URLSearchParams({
    page: String(page),
    perPage: String(PER_PAGE),
    returnType: "JSON",
    serviceKey: process.env.DATA_GO_KR_KEY ?? "",
  });
  return `${BASE}?${params.toString()}`;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 페이지 1건 fetch → parsePage. 실패 시 비밀 없는 문자열만 throw. */
async function fetchPage(page) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl(page), { signal: ctrl.signal });
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} on page ${page}`); // url/키 미포함
    }
    const text = await res.text();
    return parsePage(text); // 비JSON/데이터부재 거부(고정 문자열)
  } finally {
    clearTimeout(timer);
  }
}

/** 직전 notices 수(게이트 first/subsequent 분기용). 없음/손상 → 0. */
function loadPreviousCount() {
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf-8"));
    return Array.isArray(parsed.notices) ? parsed.notices.length : 0;
  } catch {
    return 0;
  }
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    console.error("[sync] 실패: DATA_GO_KR_KEY 환경변수가 없습니다.");
    process.exit(1);
  }

  const pages = [];
  let fetched = 0;
  let totalCount = Infinity;
  for (let page = 1; fetched < totalCount; page++) {
    const json = await fetchPage(page);
    if (page === 1) {
      totalCount = Number(json.totalCount);
      if (!Number.isFinite(totalCount) || totalCount <= 0) {
        console.error("[sync] 실패: totalCount 파싱 불가(응답 형식 이상).");
        process.exit(1);
      }
    }
    pages.push(json);
    fetched += json.data.length;
    if (json.data.length === 0) break; // 안전: 무한 루프 방지
    if (fetched < totalCount) await delay(PAGE_DELAY_MS);
  }

  const res = buildDb({
    pages,
    previousCount: loadPreviousCount(),
    key,
    today: kstToday(),
  });
  if (!res.ok) {
    console.error(`[sync] 게이트 실패(파일 미기록): ${res.reason}`);
    process.exit(1);
  }

  // pre-write 키 유출 가드(#1) — buildDb 도 검사하지만 기록 직전 재확인.
  assert(!res.serialized.includes(key), "serviceKey leak — aborting write");

  writeFileSync(OUT, res.serialized, "utf-8");
  const s = res.summary;
  console.log(
    `[sync] fetched ${s.fetched}/${s.totalCount}, normalized ${s.normalized}, ` +
      `droppedShape ${s.droppedShape}, prunedEnded ${s.prunedEnded}, ` +
      `written ${s.written}, bytes ${s.bytes}`,
  );
}

try {
  await main();
} catch (err) {
  // err.message 는 fetchPage/parsePage 의 비밀 없는 고정 문자열만 담긴다.
  console.error(`[sync] 실패: ${err.message}`);
  process.exit(1);
}
