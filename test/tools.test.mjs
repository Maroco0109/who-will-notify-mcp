import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerNoticeTools } from "../dist/tools/notices.js";
import { registerScholarshipTools } from "../dist/tools/scholarships.js";
import { clampLimit, DEFAULT_LIMIT, MAX_LIMIT } from "../dist/tools/util.js";

// 결정적 fixture (새 장학금 스키마). active=2999-*, ended=2000-*, 상시=null.
const db = JSON.parse(
  readFileSync(new URL("./fixtures/notices.sample.json", import.meta.url)),
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

test("search_notices: 요약만 반환(body 전문 없음), snippet ≤ 200, status 라벨 포함", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("search_notices", { query: "국가장학금" });
  assert.ok(res.items.length > 0);
  for (const s of res.items) {
    assert.ok(!("body" in s), "목록에는 본문 전문이 없어야 함");
    assert.ok("snippet" in s && s.snippet.length <= 200);
    assert.ok(s.id && s.title && s.category);
    assert.ok("recruitEnd" in s, "요약에 recruitEnd 포함");
    assert.ok(
      ["모집중", "마감임박", "상시", "마감"].includes(s.status),
      "요약에 status 라벨 포함",
    );
  }
});

test("search_notices: 매칭 없으면 빈 items", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("search_notices", { query: "양자컴퓨팅블록체인우주선x" });
  assert.deepEqual(res.items, []);
});

test("search_notices: 마감 공고도 검색됨(하드 hide 폐기), status=마감 라벨", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("search_notices", { query: "서울형" });
  const hit = res.items.find((s) => s.id === "sch-ended01");
  assert.ok(hit, "마감 공고도 기본 검색에 노출");
  assert.equal(hit.status, "마감");
});

test("get_notice: 전체 본문 제공", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("get_notice", { id: "sch-active01" });
  assert.equal(res.id, "sch-active01");
  assert.ok(res.body.length > 0);
  assert.equal(res.organization, "한국장학재단");
});

test("get_notice: 없는 id → not_found", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("get_notice", { id: "sch-none9999" });
  assert.equal(res.error, "not_found");
});

test("list_notices: 전체 반환 + status-priority 정렬(모집중 먼저, 마감 last)", async () => {
  const call = harness(registerNoticeTools);
  const res = await call("list_notices", {});
  const ids = res.items.map((s) => s.id);
  // 모집중 2건(recruitEnd asc) → 상시 → 마감
  assert.deepEqual(ids, ["sch-active01", "sch-active02", "sch-sangsi01", "sch-ended01"]);
  // 마감 공고도 포함되고 라벨이 마감
  const ended = res.items.find((s) => s.id === "sch-ended01");
  assert.equal(ended.status, "마감");
});

test("list_notices: status 필터", async () => {
  const call = harness(registerNoticeTools);
  const onlyEnded = await call("list_notices", { status: "마감" });
  assert.deepEqual(onlyEnded.items.map((s) => s.id), ["sch-ended01"]);
  const onlyOpen = await call("list_notices", { status: "모집중" });
  assert.deepEqual(onlyOpen.items.map((s) => s.id).sort(), ["sch-active01", "sch-active02"]);
  const onlySangsi = await call("list_notices", { status: "상시" });
  assert.deepEqual(onlySangsi.items.map((s) => s.id), ["sch-sangsi01"]);
});

test("find_scholarships: 기관 facet 매칭(전체, status-priority 정렬)", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("find_scholarships", { organization: "한국장학재단" });
  // active01(모집중) + sangsi01(상시) — 마감 정렬은 뒤. ended01 은 org 불일치.
  assert.deepEqual(res.items.map((s) => s.id), ["sch-active01", "sch-sangsi01"]);
});

test("find_scholarships: category(학자금유형구분) facet + status-priority 정렬(마감 포함)", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("find_scholarships", { category: "교외장학금" });
  // active02(모집중) 먼저, ended01(마감) last
  assert.deepEqual(res.items.map((s) => s.id), ["sch-active02", "sch-ended01"]);
});

test("find_scholarships: status 필터(마감만)", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("find_scholarships", { status: "마감" });
  assert.deepEqual(res.items.map((s) => s.id), ["sch-ended01"]);
});

test("find_scholarships: 소득기준 facet 부분일치", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("find_scholarships", { incomeCriteria: "농어업인" });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, "sch-active02");
});

test("get_scholarship_dates(kind=상시): recruitEnd null 공고만", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("get_scholarship_dates", { kind: "상시" });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, "sch-sangsi01");
  assert.equal(res.items[0].recruitEnd, null);
});

test("get_scholarship_dates(kind=모집중, 기본): 활성 공고 recruitEnd 오름차순 + 상시 last", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("get_scholarship_dates", {});
  const ids = res.items.map((s) => s.id);
  // 활성 3건, 마감(sch-ended01) 제외, 상시(null)는 마지막
  assert.deepEqual(ids, ["sch-active01", "sch-active02", "sch-sangsi01"]);
});

test("get_scholarship_dates(kind=마감임박): 상시 제외, 먼 미래/과거 마감은 창 밖 → 빈 결과", async () => {
  const call = harness(registerScholarshipTools);
  const res = await call("get_scholarship_dates", { kind: "마감임박", withinDays: 14 });
  assert.deepEqual(res.items, []);
});
