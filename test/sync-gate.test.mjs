import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, parsePage, buildDb } from "../scripts/lib.mjs";

// 오프라인: 네트워크 없이 순수 게이트 함수만 검증(작은 in-memory fixture).
const MOCK = JSON.parse(
  readFileSync(join(ROOT, "test", "fixtures", "api-sample.mock.json"), "utf-8"),
);
const BASE_ROW = MOCK.data[0];

/** 유효 행 하나(미래 recruitEnd 로 프룬 무관), over 로 필드 덮어쓰기. */
function makeRow(i, over = {}) {
  return {
    ...BASE_ROW,
    "번호": String(i),
    "상품명": `상품 ${i}`,
    "모집종료일": "2999-12-31",
    ...over,
  };
}
/** 파싱된 페이지 하나(기본 totalCount = data 길이). */
function makePage(rows, totalCount = rows.length) {
  return {
    page: 1,
    perPage: rows.length,
    currentCount: rows.length,
    totalCount,
    matchCount: totalCount,
    data: rows,
  };
}
function validRows(n, mutate) {
  const rows = Array.from({ length: n }, (_, i) => makeRow(i));
  if (mutate) mutate(rows);
  return rows;
}

// ── parsePage: 에러 바디 / 데이터부재 거부 ───────────────────────────────────
test("parsePage: 비JSON(XML/HTML) 바디 거부", () => {
  assert.throws(
    () => parsePage("<OpenAPI_ServiceResponse><cmmMsgHeader/></OpenAPI_ServiceResponse>"),
    /non-JSON/,
  );
  assert.throws(() => parsePage("  <html>Rate limit</html>"), /non-JSON/);
});

test("parsePage: data[] 배열 없는 응답 거부", () => {
  assert.throws(
    () => parsePage(JSON.stringify({ page: 1, totalCount: 1 })),
    /missing data/,
  );
  assert.throws(
    () => parsePage(JSON.stringify({ data: "not-an-array" })),
    /missing data/,
  );
});

test("parsePage: 정상 페이지는 통과", () => {
  const p = parsePage(JSON.stringify(makePage([makeRow(1)])));
  assert.ok(Array.isArray(p.data));
  assert.equal(p.data.length, 1);
});

// ── buildDb 게이트 ──────────────────────────────────────────────────────────
test("partial-paging: fetched !== totalCount → ok:false, 파일 미기록", () => {
  const page = makePage(validRows(5), 1850); // totalCount 1850 인데 5건만
  const res = buildDb({ pages: [page], previousCount: 0, key: "UNUSED" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /incomplete/);
});

test(">5% shape-fail → whole-run abort(ok:false)", () => {
  // 20건 중 2건 빈 제목(10% > 5%). fetched === totalCount 로 완전성은 통과.
  const rows = validRows(20, (r) => {
    r[3]["상품명"] = "";
    r[7]["상품명"] = "   ";
  });
  const res = buildDb({ pages: [makePage(rows)], previousCount: 100, key: "UNUSED" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /shape/);
});

test("dropped 행(빈 제목)은 출력에서 제외되고 나머지는 기록", () => {
  // 320건 중 1건 빈 제목(번호 999) → 드롭. 0.3% < 5%. previousCount>0 → floor 300.
  const rows = validRows(320, (r) => {
    r[5] = makeRow(999, { "상품명": "" });
  });
  const res = buildDb({ pages: [makePage(rows)], previousCount: 100, key: "UNUSED" });
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.db.notices.length, 319);
  assert.ok(!res.db.notices.some((n) => n.sourceNo === "999"), "드롭 행 부재");
  assert.ok(!res.db.notices.some((n) => n.title.trim() === ""), "빈 제목 부재");
  assert.equal(res.summary.droppedShape, 1);
});

test("size 초과 예산 → ok:false(서빙 불가 파일 미기록)", () => {
  const res = buildDb({
    pages: [makePage(validRows(320))],
    previousCount: 100,
    key: "UNUSED",
    maxBytes: 10, // 강제로 작게
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /too large/);
});

test("subsequent-run 최소건수 floor 미달 → ok:false", () => {
  // 100건만 기록 예정, previousCount 1000 → floor max(300,500)=500 → 미달
  const res = buildDb({ pages: [makePage(validRows(100))], previousCount: 1000, key: "UNUSED" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /floor/);
});

test("first-run: pre-prune < SOURCE_COMPLETENESS_MIN → ok:false", () => {
  const res = buildDb({ pages: [makePage(validRows(100))], previousCount: 0, key: "UNUSED" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /pre-prune/);
});

test("키는 serialized 출력에 절대 포함되지 않는다", () => {
  const key = "ZZ_SECRET_KEY_ABC123";
  const res = buildDb({ pages: [makePage(validRows(320))], previousCount: 100, key });
  assert.equal(res.ok, true, res.reason);
  assert.ok(!res.serialized.includes(key), "serialized 에 키 없음");
});

test("키 유출 가드: serialized 에 키가 섞이면 abort", () => {
  // 데이터에 실제로 존재하는 문자열을 key 로 넘기면 가드가 발동해야 한다.
  const res = buildDb({ pages: [makePage(validRows(320))], previousCount: 100, key: "상품 5" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /leak/);
});
