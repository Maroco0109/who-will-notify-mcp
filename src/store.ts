import { readFileSync } from "node:fs";
import type {
  Notice,
  NoticeDB,
  NoticeStore,
  StoreSource,
  StoreStatus,
} from "./types.js";

// ============================================================================
// NoticeStore — 프로세스 싱글톤 데이터층
//
//   McpServer 는 요청마다 새로 만들지만(server.ts), 이 store 는 프로세스 전역
//   싱글톤으로 캐시·single-flight·TTL 을 공유한다. (요청 스코프 캐시는 무의미)
//
//   진실원천: raw.githubusercontent.com 의 data/notices.json (cron 이 갱신).
//   런타임 새로고침은 best-effort — 실패해도 throw 하지 않고 last-good 또는
//   이미지에 베이크된 floor(./data/notices.json)를 계속 서빙(stale-serve)한다.
// ============================================================================

const RAW_URL =
  process.env.NOTICES_RAW_URL ??
  "https://raw.githubusercontent.com/Maroco0109/who-will-notify-mcp/main/data/notices.json";
const TTL_MS = Number(process.env.NOTICES_TTL_MS ?? 15 * 60 * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.NOTICES_FETCH_TIMEOUT_MS ?? 8000);
const MAX_BYTES = Number(process.env.NOTICES_MAX_BYTES ?? 512 * 1024);
const BAKED_PATH = process.env.NOTICES_BAKED_PATH ?? "./data/notices.json";

function validateNotices(parsed: unknown): Notice[] {
  const db = parsed as NoticeDB;
  if (!db || !Array.isArray(db.notices)) {
    throw new Error("invalid notices db: notices[] 없음");
  }
  for (const n of db.notices) {
    if (
      typeof n?.id !== "string" ||
      typeof n?.title !== "string" ||
      typeof n?.body !== "string" ||
      typeof n?.publishedAt !== "string"
    ) {
      throw new Error("invalid notice shape");
    }
  }
  return db.notices;
}

async function fetchRaw(): Promise<Notice[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(RAW_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cl = Number(res.headers.get("content-length") ?? "0");
    if (cl && cl > MAX_BYTES) throw new Error(`response too large: ${cl}B`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`response too large: ${buf.byteLength}B`);
    }
    return validateNotices(JSON.parse(buf.toString("utf-8")));
  } finally {
    clearTimeout(timer);
  }
}

export function createNoticeStore(): NoticeStore {
  let notices: Notice[] = [];
  let source: StoreSource = "empty";
  let lastRefresh = ""; // 마지막 raw 성공 시각
  let fetchedAt = 0; // 마지막 시도 시각(성공/실패 모두) — TTL 백오프 기준
  let bakedTried = false;
  let inFlight: Promise<void> | null = null;

  function loadBaked(): void {
    if (bakedTried) return;
    bakedTried = true;
    try {
      const arr = validateNotices(JSON.parse(readFileSync(BAKED_PATH, "utf-8")));
      if (notices.length === 0) {
        notices = arr;
        source = "baked";
      }
    } catch {
      /* 베이크 파일 없음/손상 — empty 유지 */
    }
  }

  async function doRefresh(): Promise<void> {
    try {
      notices = await fetchRaw();
      source = "raw";
      lastRefresh = new Date().toISOString();
    } catch {
      // stale-serve: 절대 throw 하지 않는다
      if (notices.length === 0) {
        loadBaked(); // floor 시도 → "baked" 또는 "empty"
      } else if (source === "raw") {
        source = "stale";
      }
      // baked 인 채로 실패하면 baked 유지
    } finally {
      fetchedAt = Date.now();
    }
  }

  function refresh(force = false): Promise<void> {
    const fresh = Date.now() - fetchedAt < TTL_MS;
    if (!force && notices.length > 0 && fresh) return Promise.resolve();
    if (inFlight) return inFlight; // single-flight: 동시 만료 시 한 번만 fetch
    inFlight = doRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function all(): Promise<Notice[]> {
    if (notices.length === 0) loadBaked(); // 콜드 스타트 floor 우선
    await refresh(false);
    return notices;
  }

  async function byId(id: string): Promise<Notice | undefined> {
    return (await all()).find((n) => n.id === id);
  }

  function status(): StoreStatus {
    return { lastRefresh, source, count: notices.length };
  }

  return { all, byId, refresh, status };
}
