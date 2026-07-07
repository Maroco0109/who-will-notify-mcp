import { startHttpServer } from "./server.js";
import { createNoticeStore } from "./store.js";
import { registerNoticeTools } from "./tools/notices.js";
import { registerScholarshipTools } from "./tools/scholarships.js";
import { INSTRUCTIONS } from "./instructions.js";
import type { ToolCtx } from "./types.js";

// ── 의존성 조립 ──────────────────────────────────────────────────────────────
const store = createNoticeStore();
const ctx: ToolCtx = { store };

// 콜드 스타트 워밍업(best-effort) — 실패해도 베이크 floor 로 서빙
void store.all().catch(() => {});

startHttpServer({
  port: Number(process.env.PORT ?? 3000),
  serviceName: "who-will-notify-mcp",
  version: "0.1.0",
  instructions: INSTRUCTIONS,
  register: (server) => {
    registerNoticeTools(server, ctx); // search_notices / list_notices / get_notice
    registerScholarshipTools(server, ctx); // get_scholarship_dates / find_scholarships
  },
  health: () => store.status(),
});
