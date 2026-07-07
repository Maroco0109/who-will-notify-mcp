import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchNotices, tokenize, makeSnippet } from "../dist/search.js";

const db = JSON.parse(
  readFileSync(new URL("./fixtures/notices.sample.json", import.meta.url)),
);
const notices = db.notices;

test("tokenize: 조사 절단 + 분리", () => {
  const t = tokenize("국가장학금은 소득기준이 어떻게 돼?");
  assert.ok(t.includes("국가장학금")); // '국가장학금은' → 조사 '은' 절단
  assert.ok(t.includes("소득기준")); // '소득기준이' → 조사 '이' 절단
});

test("searchNotices: 제목 매칭이 상위로", () => {
  const hits = searchNotices(notices, "국가장학금", 5);
  assert.ok(hits.length > 0);
  // 제목에 '국가장학금'을 가진 sch-active01 이 최상위
  assert.equal(hits[0].notice.id, "sch-active01");
  // 점수 내림차순
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].score >= hits[i].score);
  }
});

test("searchNotices: 태그(운영기관) 매칭", () => {
  const hits = searchNotices(notices, "농어촌희망재단", 5);
  assert.ok(hits.some((h) => h.notice.id === "sch-active02"));
});

test("searchNotices: 매칭 없으면 빈 결과", () => {
  assert.equal(searchNotices(notices, "양자컴퓨팅블록체인우주선", 5).length, 0);
});

test("makeSnippet: 길이 ≤ 200", () => {
  for (const n of notices) {
    const s = makeSnippet(n, "등록금", 200);
    assert.ok(s.length <= 200 + 2); // 양끝 '…' 여유
  }
});
