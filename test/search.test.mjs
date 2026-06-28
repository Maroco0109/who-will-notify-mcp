import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchNotices, tokenize, makeSnippet } from "../dist/search.js";

const db = JSON.parse(
  readFileSync(new URL("../data/notices.json", import.meta.url)),
);
const notices = db.notices;

test("tokenize: 조사 절단 + 분리", () => {
  const t = tokenize("1학년 수강신청은 언제부터야?");
  assert.ok(t.includes("1학년"));
  assert.ok(t.includes("수강신청")); // '수강신청은' → 조사 '은' 절단
});

test("searchNotices: 제목 매칭이 상위로", () => {
  const hits = searchNotices(notices, "수강신청 일정", 5);
  assert.ok(hits.length > 0);
  // 수강신청 안내 공지(notice-0001)가 최상위 후보에 포함
  assert.ok(hits.some((h) => h.notice.id === "notice-0001"));
  // 점수 내림차순
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1].score >= hits[i].score);
  }
});

test("searchNotices: 매칭 없으면 빈 결과", () => {
  assert.equal(searchNotices(notices, "양자컴퓨팅블록체인우주선", 5).length, 0);
});

test("makeSnippet: 길이 ≤ 200", () => {
  for (const n of notices) {
    const s = makeSnippet(n, "수강신청", 200);
    assert.ok(s.length <= 200 + 2); // 양끝 '…' 여유
  }
});
