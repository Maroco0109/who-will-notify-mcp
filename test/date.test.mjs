import test from "node:test";
import assert from "node:assert/strict";
import {
  scholarshipStatus,
  statusRank,
  byStatusThenRecruitEnd,
  addDays,
} from "../dist/date.js";

// 고정 기준일 주입 → 결정적. 실제 kstToday 와 무관.
const TODAY = "2026-07-07";

test("scholarshipStatus: 4개 라벨 경계(고정 today 주입)", () => {
  // 상시(null)
  assert.equal(scholarshipStatus(null, TODAY, 14), "상시");
  // 마감(과거)
  assert.equal(scholarshipStatus("2026-07-06", TODAY, 14), "마감");
  // 마감임박: 오늘 ~ 오늘+14 이내
  assert.equal(scholarshipStatus(TODAY, TODAY, 14), "마감임박"); // 경계: 오늘
  assert.equal(scholarshipStatus(addDays(TODAY, 14), TODAY, 14), "마감임박"); // 경계: +14
  assert.equal(scholarshipStatus(addDays(TODAY, 7), TODAY, 14), "마감임박");
  // 모집중: 오늘+14 초과
  assert.equal(scholarshipStatus(addDays(TODAY, 15), TODAY, 14), "모집중");
  assert.equal(scholarshipStatus("2999-12-31", TODAY, 14), "모집중");
});

test("statusRank: 활성(마감임박<모집중) < 상시 < 마감", () => {
  assert.ok(statusRank("마감임박") < statusRank("모집중"));
  assert.ok(statusRank("모집중") < statusRank("상시"));
  assert.ok(statusRank("상시") < statusRank("마감"));
});

test("byStatusThenRecruitEnd: status-priority 후 recruitEnd 오름차순, 상시는 마감 앞", () => {
  const rows = [
    { id: "ended", recruitEnd: "2026-07-06" }, // 마감
    { id: "sangsi", recruitEnd: null }, // 상시
    { id: "soon", recruitEnd: addDays(TODAY, 5) }, // 마감임박
    { id: "open2", recruitEnd: "2999-12-31" }, // 모집중(뒤)
    { id: "open1", recruitEnd: "2999-01-01" }, // 모집중(앞)
  ];
  const sorted = [...rows].sort((a, b) => byStatusThenRecruitEnd(a, b, TODAY));
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["soon", "open1", "open2", "sangsi", "ended"],
  );
});
