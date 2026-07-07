// ============================================================================
// 동기화 스크립트 공유 유틸 (순수 Node, 무의존)
//
// 출처: data.go.kr 15028252 (한국장학재단_학자금지원정보) odcloud 파일데이터 API.
// JSON 키 = 한글 컬럼명 그대로. 응답 래퍼 = { page, perPage, totalCount, data:[...] }.
// ⚠️ 일부 JSON 키는 공백 포함(예: "성적기준 상세내용") → 반드시 대괄호 접근.
// ============================================================================
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

/** body 합성 상한(문자 수). Korean UTF-8 본문 검색 대상. */
export const BODY_MAX = 8000;

/** 프룬 보존창(일). recruitEnd 가 이 일수보다 오래 지난 마감 공고는 프룬. */
export const PRUNE_DAYS = 180;
/** pre-prune 정규화(shape 통과) 최소 건수(파국 감지, 실측 1850 대비). */
export const SOURCE_COMPLETENESS_MIN = 1500;
/** post-prune 기록 최소 건수(파국 감지, 실측 1013 대비). */
export const MIN_WRITTEN = 300;
/** shape 실패 허용 상한(초과 시 whole-run abort). */
export const SHAPE_FAIL_MAX_RATIO = 0.05;
/** 출력 크기 상한(bytes). store.ts 와 동일 env/기본값(16MB)을 공유. */
export const NOTICES_MAX_BYTES = Number(
  process.env.NOTICES_MAX_BYTES ?? 16 * 1024 * 1024,
);

/**
 * Asia/Seoul 달력 기준 오늘("YYYY-MM-DD"). (Change #7)
 * Actions 는 UTC 로 도므로 raw UTC 날짜 금지 — 프룬/분류의 단일 기준.
 * (런타임 TS 는 src/date.ts 의 kstToday() 를 사용; 이건 sync-prune 용 동형 helper.)
 */
export function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}

/** "YYYY-MM-DD" 에 days 를 더한 달력일("YYYY-MM-DD"). UTC 자정 기준 순수 산술. days 음수 가능. */
export function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** sha256(title|body|recruitStart|recruitEnd) — 변경감지 전용 해시(publishedAt 제거). */
export function contentHash(title, body, recruitStart, recruitEnd) {
  return createHash("sha256")
    .update(`${title}|${body}|${recruitStart ?? ""}|${recruitEnd ?? ""}`)
    .digest("hex");
}

/**
 * id/정규화 튜플용 정규화:
 *   NFC 정규화 → trim → 내부 연속 공백 1칸 축약 → 후행 괄호 접미사 제거(예: "(재단)") → trim.
 * 예) "한국장학재단(재단)" → "한국장학재단", "  푸른등대  기부  " → "푸른등대 기부".
 */
export function normalizeTuple(s) {
  return String(s ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/**
 * 모집 인스턴스 정체성 id.
 *   id = "sch-" + sha256(norm(상품명)|norm(운영기관명)|norm(모집시작일))[:12].
 * 정규화(normalizeTuple)로 공백/괄호접미사 변동을 흡수해 월별 재조회 간 안정성 확보.
 */
export function scholarshipId({ title, organization, recruitStart }) {
  const tuple = `${normalizeTuple(title)}|${normalizeTuple(organization)}|${normalizeTuple(recruitStart || "")}`;
  return "sch-" + createHash("sha256").update(tuple).digest("hex").slice(0, 12);
}

/** 문자열 정규화(값 부재/비문자 방어 + trim). */
function str(v) {
  return String(v ?? "").trim();
}

/**
 * 날짜 문자열 정규화.
 *   "" / "상시" / 부재 → null. 그 외 "YYYY-MM-DD" 형태면 그대로, 아니면 null(방어적).
 * ⚠️ 이후 정렬/비교에서 null 을 반드시 가드할 것 — null.localeCompare 금지.
 */
function normalizeDate(v) {
  const s = str(v);
  if (s === "" || s === "상시") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * odcloud 한 행(한글 키, 값은 문자열) → Notice.
 * ⚠️ 공백 포함 키는 대괄호 접근 필수(예: row["성적기준 상세내용"]).
 */
export function apiRowToNotice(row) {
  const title = str(row["상품명"]);
  const organization = str(row["운영기관명"]);
  const recruitStart = normalizeDate(row["모집시작일"]);
  const recruitEnd = normalizeDate(row["모집종료일"]);

  // body: 지원내역/특정자격/자격제한/제출서류/선발방법 상세내용 + 상품구분 합성 후 BODY_MAX cap.
  // ⚠️ category 는 학자금유형구분(카디널리티 유의미)으로 매핑하므로, 편중된 상품구분 값은
  //    검색성 유지를 위해 body 로 접어 넣는다(0b: 상품구분 1796/54 편중 → facet 부적합).
  const body = [
    str(row["지원내역 상세내용"]),
    str(row["특정자격 상세내용"]),
    str(row["자격제한 상세내용"]),
    str(row["제출서류 상세내용"]),
    str(row["선발방법 상세내용"]),
    str(row["상품구분"]),
  ]
    .filter((s) => s.length > 0)
    .join("\n")
    .slice(0, BODY_MAX);

  return {
    id: scholarshipId({ title, organization, recruitStart }),
    sourceNo: str(row["번호"]),
    title,
    body,
    category: str(row["학자금유형구분"]), // 0b: 카디널리티 유의미(지역연고/소득구분/성적우수…). 상품구분은 body 로만 보존.
    organization,
    organizationType: str(row["운영기관구분"]),
    universityType: str(row["대학구분"]),
    gradeCriteria: str(row["학년구분"]),
    major: str(row["학과구분"]),
    gpaCriteria: str(row["성적기준 상세내용"]),
    incomeCriteria: str(row["소득기준 상세내용"]),
    selectionCount: str(row["선발인원 상세내용"]),
    selectionMethod: str(row["선발방법 상세내용"]),
    specificQualification: str(row["특정자격 상세내용"]),
    restrictions: str(row["자격제한 상세내용"]),
    residencyRequired: str(row["지역거주여부 상세내용"]),
    recommendationRequired: str(row["추천필요여부 상세내용"]),
    documents: str(row["제출서류 상세내용"]),
    sourceUrl: str(row["홈페이지 주소"]),
    recruitStart,
    recruitEnd,
    hash: contentHash(title, body, recruitStart, recruitEnd),
  };
}

/**
 * 전체 응답 래퍼 { data:[...] } → Notice[].
 * data 배열이 없으면 빈 배열.
 */
export function normalizeApiResponse(json) {
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.map((row) => apiRowToNotice(row));
}

// ============================================================================
// 순수·오프라인-테스트 가능 동기화 파이프라인 (네트워크 없음).
//   sync-notices.mjs 는 페치만 담당하고, 아래 순수 함수들을 조립해 gate/write 한다.
// ============================================================================

/**
 * 응답 바디 텍스트 → 파싱된 페이지 JSON.
 *   비JSON(XML/HTML 인증·쿼터 에러: `<`로 시작) 이거나 data[] 배열이 없으면 throw.
 *   ⚠️ 에러 메시지에 바디/URL/키를 절대 담지 않는다(고정 문자열만).
 */
export function parsePage(text) {
  const t = String(text ?? "").trimStart();
  if (!t.startsWith("{")) {
    throw new Error("non-JSON response body (XML/HTML error envelope)");
  }
  const json = JSON.parse(t);
  if (!Array.isArray(json?.data)) {
    throw new Error("response missing data[] array");
  }
  return json;
}

/** 단건 shape 검증(sync 경계의 실질 garbage 가드). */
export function shapeOk(n) {
  if (typeof n?.title !== "string" || n.title.trim() === "") return false;
  if (!(n.recruitEnd === null || /^\d{4}-\d{2}-\d{2}$/.test(n.recruitEnd))) {
    return false;
  }
  if (typeof n.organization !== "string" || n.organization.trim() === "") {
    return false;
  }
  if (typeof n.body !== "string" || n.body.length < 1 || n.body.length > BODY_MAX) {
    return false;
  }
  return true;
}

/** shape 게이트: 실패 행 DROP. 반환 { kept, dropped, total }. */
export function shapeGate(notices) {
  const kept = [];
  let dropped = 0;
  for (const n of notices) {
    if (shapeOk(n)) kept.push(n);
    else dropped++;
  }
  return { kept, dropped, total: notices.length };
}

/**
 * 프룬: recruitEnd 가 null(상시) 이거나 (kstToday - PRUNE_DAYS) 이상이면 유지.
 * 반환 { kept, pruned, floor }.
 */
export function pruneEnded(notices, today = kstToday()) {
  const floor = addDaysStr(today, -PRUNE_DAYS);
  const kept = notices.filter(
    (n) => n.recruitEnd === null || n.recruitEnd >= floor,
  );
  return { kept, pruned: notices.length - kept.length, floor };
}

/** recruitEnd 오름차순(상시=null 은 LAST) + title tiebreak. null-safe. */
function cmpForWrite(a, b) {
  if (a.recruitEnd === null && b.recruitEnd === null) {
    return a.title.localeCompare(b.title);
  }
  if (a.recruitEnd === null) return 1;
  if (b.recruitEnd === null) return -1;
  return a.recruitEnd.localeCompare(b.recruitEnd) || a.title.localeCompare(b.title);
}

/**
 * 페이지 배열(파싱 완료) → { ok, db?, serialized?, summary?, reason? }.
 * 네트워크 없음 — 게이트 전부 순수. 실패 시 ok:false + redacted reason(파일 미기록).
 *
 * 게이트 순서: 완전성(fetched===totalCount) → shape 비율(≤5%) → 최소건수(first/subsequent)
 *              → 크기(<maxBytes) → 키 유출 가드. 하나라도 실패하면 ok:false.
 *
 * @param {object} o
 * @param {object[]} o.pages          파싱된 페이지 JSON 배열(각각 data[] 보유).
 * @param {number}   o.previousCount  직전 notices 수(0 이면 first-run 강한 게이트).
 * @param {string}   [o.key]          serviceKey — serialized 에 포함되면 abort(유출 가드).
 * @param {string}   [o.today]        KST 오늘("YYYY-MM-DD").
 * @param {number}   [o.maxBytes]     출력 크기 상한.
 */
export function buildDb({
  pages,
  previousCount = 0,
  key,
  today = kstToday(),
  maxBytes = NOTICES_MAX_BYTES,
}) {
  const fail = (reason) => ({ ok: false, reason });

  const totalCount = Number(pages?.[0]?.totalCount);
  const rows = pages.flatMap((p) => (Array.isArray(p.data) ? p.data : []));
  const fetched = rows.length;

  // 완전성: 부분 페이징(mid-paging) 감지.
  if (!Number.isFinite(totalCount) || fetched !== totalCount) {
    return fail(`incomplete fetch: fetched ${fetched} !== totalCount ${totalCount}`);
  }

  const normalized = rows.map((row) => apiRowToNotice(row));

  // shape 게이트: 실패 행 DROP; >5% 면 source-corruption tripwire → whole-run abort.
  const { kept, dropped } = shapeGate(normalized);
  const shapeRatio = normalized.length > 0 ? dropped / normalized.length : 0;
  if (shapeRatio > SHAPE_FAIL_MAX_RATIO) {
    return fail(
      `shape-fail ratio ${(shapeRatio * 100).toFixed(1)}% > ${(SHAPE_FAIL_MAX_RATIO * 100).toFixed(0)}%`,
    );
  }
  const prePrune = kept.length;

  // 프룬(180일).
  const { kept: written, pruned: prunedEnded } = pruneEnded(kept, today);
  const writtenCount = written.length;

  // 최소건수 게이트.
  if (previousCount === 0) {
    if (prePrune < SOURCE_COMPLETENESS_MIN) {
      return fail(`first-run pre-prune ${prePrune} < SOURCE_COMPLETENESS_MIN ${SOURCE_COMPLETENESS_MIN}`);
    }
    if (writtenCount < MIN_WRITTEN) {
      return fail(`first-run written ${writtenCount} < MIN_WRITTEN ${MIN_WRITTEN}`);
    }
  } else {
    const floorCount = Math.max(MIN_WRITTEN, Math.floor(0.5 * previousCount));
    if (writtenCount < floorCount) {
      return fail(`written ${writtenCount} < floor ${floorCount}`);
    }
  }

  const sorted = [...written].sort(cmpForWrite);
  const db = { notices: sorted, syncedAt: new Date().toISOString(), source: "sync" };
  const serialized = `${JSON.stringify(db, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf-8");

  // 크기 게이트(writer/reader 합의): 서빙 불가한 파일 기록 금지.
  if (bytes >= maxBytes) {
    return fail(`payload too large: ${bytes}B >= maxBytes ${maxBytes}`);
  }
  // 키 유출 가드: serialized 에 serviceKey 가 섞이면 abort.
  if (key && serialized.includes(key)) {
    return fail("serviceKey leaked into serialized payload");
  }

  return {
    ok: true,
    db,
    serialized,
    summary: {
      fetched,
      totalCount,
      normalized: normalized.length,
      droppedShape: dropped,
      prunedEnded,
      written: writtenCount,
      bytes,
    },
  };
}
