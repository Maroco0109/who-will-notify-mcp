import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  BODY_MAX,
  apiRowToNotice,
  normalizeApiResponse,
  normalizeTuple,
  contentHash,
} from "../scripts/lib.mjs";

const MOCK = JSON.parse(
  readFileSync(join(ROOT, "test", "fixtures", "api-sample.mock.json"), "utf-8"),
);

/** null-safe recruitEnd 오름차순 비교자: null(상시) 은 항상 LAST. */
function byRecruitEndAsc(a, b) {
  if (a.recruitEnd === null && b.recruitEnd === null) return 0;
  if (a.recruitEnd === null) return 1; // a 를 뒤로
  if (b.recruitEnd === null) return -1; // b 를 뒤로
  return a.recruitEnd.localeCompare(b.recruitEnd);
}

test("모든 행이 예외 없이 매핑된다", () => {
  const notices = normalizeApiResponse(MOCK);
  assert.equal(notices.length, MOCK.data.length);
  for (const n of notices) {
    assert.equal(typeof n.id, "string");
    assert.ok(n.id.startsWith("sch-"));
    assert.equal(typeof n.title, "string");
    assert.equal(typeof n.body, "string");
  }
});

test("category 는 학자금유형구분에서 매핑되고, 상품구분은 body 로 접혀 검색성 유지", () => {
  const notices = normalizeApiResponse(MOCK);
  const row1 = notices.find((n) => n.sourceNo === "1");
  assert.ok(row1);
  // 학자금유형구분="장학금" → category
  assert.equal(row1.category, "장학금");
  // 상품구분="국가장학금" 은 category 가 아니라 body 로 접혀 검색 가능해야 함
  assert.ok(row1.body.includes("국가장학금"), "상품구분 값이 body 에 포함");
  // 대출 유형 행도 확인
  const row2 = notices.find((n) => n.sourceNo === "2");
  assert.equal(row2.category, "대출");
});

test("상시 행(번호 2, 모집종료일 \"\") → recruitEnd === null", () => {
  const notices = normalizeApiResponse(MOCK);
  const row2 = notices.find((n) => n.sourceNo === "2");
  assert.ok(row2);
  assert.equal(row2.recruitEnd, null);
  // recruitStart 는 유효 날짜이므로 유지
  assert.equal(row2.recruitStart, "2026-01-02");
});

test("id 결정성: 같은 응답을 두 번 정규화 → 같은 id", () => {
  const a = normalizeApiResponse(MOCK);
  const b = normalizeApiResponse(MOCK);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].id, b[i].id);
  }
});

test("normalizeTuple: 내부 연속공백 축약 + (재단) 접미사 제거 + NFC", () => {
  // 내부 double-space 축약
  assert.equal(normalizeTuple("a  b"), "a b");
  // 후행 괄호 접미사 제거 (row 번호 4 의 운영기관명)
  assert.equal(normalizeTuple("한국장학재단(재단)"), "한국장학재단");
  // 앞뒤 double-space trim (row 번호 4 의 상품명)
  assert.equal(normalizeTuple("  푸른등대 기부장학금  "), "푸른등대 기부장학금");
  // NFC: 자모 결합형(NFD) 입력을 정준결합형으로 정규화
  const nfd = "한"; // ㅎ+ㅏ+ㄴ → "한" (NFD)
  assert.equal(normalizeTuple(nfd), "한".normalize("NFC"));
});

test("id 는 title 튜플의 함수: body 만 바뀌면 id 안정, hash 변함", () => {
  // 주의: title 이 바뀌면 id 도 바뀐다(title 이 id 튜플에 포함되므로).
  // 따라서 안정성은 "body 만" 바꿔서 검증한다 — id 는 그대로, hash 는 변한다.
  const notices = normalizeApiResponse(MOCK);
  const base = notices[0];
  const mutatedRow = { ...MOCK.data[0], "지원내역 상세내용": "완전히 다른 본문 내용" };
  const mutated = apiRowToNotice(mutatedRow);
  assert.equal(mutated.id, base.id); // id 안정(title/organization/recruitStart 불변)
  assert.notEqual(mutated.hash, base.hash); // hash 변경감지 발동
  // sanity: title 을 바꾸면 id 도 바뀐다
  const titleChanged = apiRowToNotice({ ...MOCK.data[0], "상품명": "다른 상품명" });
  assert.notEqual(titleChanged.id, base.id);
});

test("body 는 BODY_MAX 로 캡된다", () => {
  const notices = normalizeApiResponse(MOCK);
  for (const n of notices) {
    assert.ok(n.body.length <= BODY_MAX);
  }
  // 초과 입력이 캡되는지 명시 검증
  const huge = "가".repeat(BODY_MAX + 500);
  const capped = apiRowToNotice({ ...MOCK.data[0], "지원내역 상세내용": huge });
  assert.equal(capped.body.length, BODY_MAX);
});

test("hash 결정성: 같은 입력 → 같은 hash", () => {
  assert.equal(
    contentHash("t", "b", "2026-01-01", "2026-02-01"),
    contentHash("t", "b", "2026-01-01", "2026-02-01"),
  );
});

test("null recruitEnd(상시) 행은 recruitEnd 오름차순 정렬 시 LAST", () => {
  const notices = normalizeApiResponse(MOCK);
  const sorted = [...notices].sort(byRecruitEndAsc);
  // 상시(번호 2)는 recruitEnd === null → 마지막
  assert.equal(sorted[sorted.length - 1].sourceNo, "2");
  // null 은 정확히 하나뿐이고, 그 앞은 모두 dated
  const nulls = sorted.filter((n) => n.recruitEnd === null);
  assert.equal(nulls.length, 1);
  for (let i = 0; i < sorted.length - 1; i++) {
    assert.notEqual(sorted[i].recruitEnd, null);
  }
});
