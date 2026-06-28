import test from "node:test";
import assert from "node:assert/strict";
import { contentHash, seedToNotice } from "../scripts/lib.mjs";

test("id 안정성: 제목이 바뀌면 hash 는 변하지만 id 는 불변", () => {
  const seed = {
    id: "notice-0001",
    title: "원래 제목",
    body: "본문",
    category: "일반",
    publishedAt: "2026-07-01T00:00:00+09:00",
  };
  const a = seedToNotice(seed);
  const b = seedToNotice({ ...seed, title: "수정된 제목" });
  assert.equal(a.id, b.id); // id = 정체성, 불변
  assert.notEqual(a.hash, b.hash); // hash = 변경감지, 변함
});

test("hash 결정성: 같은 입력 → 같은 hash", () => {
  assert.equal(
    contentHash("t", "b", "2026-01-01"),
    contentHash("t", "b", "2026-01-01"),
  );
});

test("seedToNotice: 구조화 필드(courses/dates) 보존", () => {
  const n = seedToNotice({
    id: "notice-0002",
    title: "개설과목",
    body: "본문",
    category: "개설과목",
    publishedAt: "2026-07-01T00:00:00+09:00",
    courses: [{ grade: 1, courseName: "C", professor: "P", schedule: "화 7-8교시" }],
  });
  assert.equal(n.courses.length, 1);
  assert.equal(n.courses[0].schedule, "화 7-8교시");
  assert.ok(n.sourceUrl.endsWith("/notice/notice-0002.html"));
});
