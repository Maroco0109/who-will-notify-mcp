import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerNoticeTools } from "../dist/tools/notices.js";
import { registerCourseTools } from "../dist/tools/courses.js";
import { clampLimit, DEFAULT_LIMIT, MAX_LIMIT } from "../dist/tools/util.js";

const db = JSON.parse(
  readFileSync(new URL("../data/notices.json", import.meta.url)),
);
const store = {
  async all() {
    return db.notices;
  },
  async byId(id) {
    return db.notices.find((n) => n.id === id);
  },
  async refresh() {},
  status() {
    return { lastRefresh: "", source: "baked", count: db.notices.length };
  },
};

function harness(register) {
  const handlers = new Map();
  const fakeServer = { registerTool: (name, _cfg, h) => handlers.set(name, h) };
  register(fakeServer, { store });
  return async (name, args) => {
    const r = await handlers.get(name)(args);
    return JSON.parse(r.content[0].text);
  };
}

test("clampLimit: 기본/최대/최소", () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(999), MAX_LIMIT);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(7), 7);
});

test("get_courses(grade=1): 구조화 데이터를 JSON(seed 출처)에서 반환", async () => {
  const call = harness(registerCourseTools);
  const res = await call("get_courses", { grade: 1 });
  assert.ok(res.items.length >= 2);
  for (const c of res.items) {
    assert.equal(c.grade, 1);
    assert.ok(typeof c.professor === "string" && c.professor.length > 0);
    assert.ok(typeof c.schedule === "string" && c.schedule.includes("교시"));
    // HTML 태그가 섞이면 재파싱 흔적 → 실패
    assert.ok(!/[<>]/.test(JSON.stringify(c)), "HTML 파편 없음");
  }
  assert.ok(res.items.some((c) => c.courseName.includes("C언어")));
});

test("get_academic_dates(kind=수강신청): 일정 반환", async () => {
  const call = harness(registerCourseTools);
  const res = await call("get_academic_dates", { kind: "수강신청" });
  assert.ok(res.items.length >= 1);
  for (const d of res.items) assert.ok(d.label.includes("수강신청"));
});

test("search_notices: 요약만 반환(body 전문 없음), snippet ≤ 200", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("search_notices", { query: "1학년 수강신청" });
  assert.ok(res.items.length > 0);
  for (const s of res.items) {
    assert.ok(!("body" in s), "목록에는 본문 전문이 없어야 함");
    assert.ok("snippet" in s && s.snippet.length <= 200);
    assert.ok(s.id && s.title && s.category && s.publishedAt);
  }
});

test("get_notice: 전체 본문 + 구조화 제공", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("get_notice", { id: "notice-0002" });
  assert.equal(res.id, "notice-0002");
  assert.ok(res.body.length > 0);
  assert.ok(Array.isArray(res.courses) && res.courses.length > 0);
});

test("get_notice: 없는 id → not_found", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("get_notice", { id: "notice-9999" });
  assert.equal(res.error, "not_found");
});
