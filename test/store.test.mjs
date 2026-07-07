// store 의 캐시 스코프 + stale-serve 검증.
// env 는 store.js import 전에 설정해야 한다(모듈 로드 시 const 로 읽음).
process.env.NOTICES_TTL_MS = "100000"; // TTL 충분히 길게
process.env.NOTICES_RAW_URL = "https://example.invalid/notices.json";
process.env.NOTICES_BAKED_PATH = new URL(
  "./fixtures/notices.sample.json",
  import.meta.url,
).pathname;

import test from "node:test";
import assert from "node:assert/strict";
// ⚠️ store.js 는 모듈 로드 시 env 를 const 로 읽는다. ESM 정적 import 는 hoist 되어
//    위 env 설정보다 먼저 평가되므로, env 가 반영되도록 동적 import 를 쓴다.
const { createNoticeStore } = await import("../dist/store.js");

const realFetch = global.fetch;
function stubFetchOk(counter) {
  global.fetch = async () => {
    counter.n++;
    const body = Buffer.from(
      JSON.stringify({
        notices: [
          {
            id: "sch-raw1",
            title: "raw 장학금",
            body: "raw body",
            category: "국가장학금",
            organization: "한국장학재단",
            recruitStart: "2026-03-02",
            recruitEnd: "2999-03-20",
            sourceUrl: "",
            hash: "h",
          },
          {
            id: "sch-raw2",
            title: "raw 상시 대출",
            body: "raw 상시 body",
            category: "학자금대출",
            organization: "한국장학재단",
            recruitStart: "2026-01-02",
            recruitEnd: null,
            sourceUrl: "",
            hash: "h2",
          },
        ],
        syncedAt: "now",
        source: "raw",
      }),
    );
    return {
      ok: true,
      headers: { get: () => null },
      async arrayBuffer() {
        return body;
      },
    };
  };
}

test("캐시 스코프: TTL 내 두 번째 호출은 재fetch 하지 않음", async () => {
  const counter = { n: 0 };
  stubFetchOk(counter);
  const store = createNoticeStore();
  const a = await store.all();
  const b = await store.all();
  assert.equal(counter.n, 1, "fetch 는 한 번만 호출되어야 함");
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.equal(store.status().source, "raw");
});

test("stale-serve: fetch 실패 시 throw 없이 베이크 floor 반환", async () => {
  global.fetch = async () => {
    throw new Error("network down");
  };
  const store = createNoticeStore();
  const arr = await store.all(); // throw 하면 테스트 실패
  // TODO(0b): set to MIN_WRITTEN (실 floor 확정 후). 지금은 fixture 규모 기준.
  assert.ok(arr.length >= 1, "베이크된 fixture floor 로 폴백");
  assert.equal(store.status().source, "baked");
});

test.after(() => {
  global.fetch = realFetch;
});
