import test from "node:test";
import assert from "node:assert/strict";
import { contentHash, scholarshipId, normalizeTuple } from "../scripts/lib.mjs";

test("contentHash 결정성: 같은 입력(title|body|recruitStart|recruitEnd) → 같은 hash", () => {
  assert.equal(
    contentHash("t", "b", "2026-01-01", "2026-02-01"),
    contentHash("t", "b", "2026-01-01", "2026-02-01"),
  );
});

test("contentHash: null 과 \"\" recruitEnd 는 동일 취급(?? '')", () => {
  assert.equal(
    contentHash("t", "b", "2026-01-01", null),
    contentHash("t", "b", "2026-01-01", ""),
  );
});

test("contentHash: body 가 바뀌면 hash 변함(변경감지)", () => {
  assert.notEqual(
    contentHash("t", "b1", "2026-01-01", "2026-02-01"),
    contentHash("t", "b2", "2026-01-01", "2026-02-01"),
  );
});

test("scholarshipId: 'sch-' 접두 + 결정성", () => {
  const id = scholarshipId({
    title: "국가장학금",
    organization: "한국장학재단",
    recruitStart: "2026-03-02",
  });
  assert.ok(id.startsWith("sch-"));
  assert.equal(
    id,
    scholarshipId({
      title: "국가장학금",
      organization: "한국장학재단",
      recruitStart: "2026-03-02",
    }),
  );
});

test("scholarshipId 안정성: 괄호 접미사/공백 변동은 정규화로 흡수 → 같은 id", () => {
  const a = scholarshipId({
    title: "  푸른등대 기부장학금  ",
    organization: "한국장학재단(재단)",
    recruitStart: "2026-04-01",
  });
  const b = scholarshipId({
    title: "푸른등대 기부장학금",
    organization: "한국장학재단",
    recruitStart: "2026-04-01",
  });
  assert.equal(a, b);
});

test("scholarshipId: recruitStart 가 바뀌면 id 변함(다른 모집 인스턴스)", () => {
  const a = scholarshipId({ title: "T", organization: "O", recruitStart: "2026-01-01" });
  const b = scholarshipId({ title: "T", organization: "O", recruitStart: "2026-02-01" });
  assert.notEqual(a, b);
});

test("normalizeTuple: NFC + trim + 연속공백 축약 + 후행 괄호 접미사 제거", () => {
  assert.equal(normalizeTuple("a  b"), "a b");
  assert.equal(normalizeTuple("한국장학재단(재단)"), "한국장학재단");
  assert.equal(normalizeTuple("  푸른등대 기부장학금  "), "푸른등대 기부장학금");
});
