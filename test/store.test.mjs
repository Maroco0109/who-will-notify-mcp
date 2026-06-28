// store 의 캐시 스코프 + stale-serve 검증.
// env 는 store.js import 전에 설정해야 한다(모듈 로드 시 const 로 읽음).
process.env.NOTICES_TTL_MS = "100000"; // TTL 충분히 길게
process.env.NOTICES_RAW_URL = "https://example.invalid/notices.json";
process.env.NOTICES_BAKED_PATH = new URL("../data/notices.json", import.meta.url)
  .pathname;

import test from "node:test";
import assert from "node:assert/strict";
import { createNoticeStore } from "../dist/store.js";

const realFetch = global.fetch;
function stubFetchOk(counter) {
  global.fetch = async () => {
    counter.n++;
    const body = Buffer.from(
      JSON.stringify({
        notices: [
          {
            id: "raw-1",
            title: "raw",
            body: "raw body",
            category: "일반",
            publishedAt: "2026-01-01T00:00:00+09:00",
            sourceUrl: "",
            hash: "h",
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
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(store.status().source, "raw");
});

test("stale-serve: fetch 실패 시 throw 없이 베이크 floor 반환", async () => {
  global.fetch = async () => {
    throw new Error("network down");
  };
  const store = createNoticeStore();
  const arr = await store.all(); // throw 하면 테스트 실패
  assert.ok(arr.length >= 30, "베이크된 notices.json(30건)으로 폴백");
  assert.equal(store.status().source, "baked");
});

test.after(() => {
  global.fetch = realFetch;
});
