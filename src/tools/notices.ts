import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../types.js";
import { searchNotices, makeSnippet } from "../search.js";
import { kstToday, scholarshipStatus, byStatusThenRecruitEnd } from "../date.js";
import {
  ok,
  errText,
  capArray,
  clampLimit,
  summarize,
  SNIPPET_MAX,
} from "./util.js";

export function registerNoticeTools(server: McpServer, ctx: ToolCtx): void {
  // ── search_notices ─────────────────────────────────────────────────────
  server.registerTool(
    "search_notices",
    {
      title: "장학금 공고 검색",
      description:
        "who-will-notify-mcp 서비스의 장학금 공고 corpus 에서 질문과 관련된 공고를 키워드로 검색해 요약(제목·분류·상태·모집기간·발췌)을 반환합니다. " +
        "질문에 답하기 위한 1차 진입점입니다. 본문 전체가 필요하면 반환된 id 로 get_notice 를 호출하세요. " +
        "결과는 모집중→마감임박→상시→마감 순으로 정렬되며 각 항목에 status(모집중/마감임박/상시/마감) 라벨이 붙습니다. " +
        "특정 상태만 보려면 status 로 필터하세요(기본: 전체).",
      annotations: {
        title: "장학금 공고 검색",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        query: z.string().describe("검색어/질문 (예: '국가장학금', '소득 3구간 장학금')"),
        limit: z
          .number()
          .int()
          .optional()
          .describe("반환 개수 (기본 10, 최대 50)"),
        status: z
          .enum(["모집중", "마감임박", "마감", "상시"])
          .optional()
          .describe("모집상태 필터 (기본: 필터 없음 = 전체)"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const limit = clampLimit(args.limit);
        const today = kstToday();
        const pool = args.status
          ? notices.filter(
              (n) => scholarshipStatus(n.recruitEnd, today) === args.status,
            )
          : notices;
        // 전 매칭을 얻은 뒤 status-priority→recruitEnd 로 재정렬하고 limit 만큼 자른다.
        const hits = searchNotices(pool, args.query, pool.length);
        const ordered = hits
          .map((h) => h.notice)
          .sort((a, b) => byStatusThenRecruitEnd(a, b, today))
          .slice(0, limit);
        const items = ordered.map((n) =>
          summarize(n, makeSnippet(n, args.query, SNIPPET_MAX), today),
        );
        return capArray(items, { query: args.query, status: args.status ?? null });
      } catch (err) {
        return errText(err);
      }
    },
  );

  // ── list_notices ───────────────────────────────────────────────────────
  server.registerTool(
    "list_notices",
    {
      title: "장학금 공고 목록",
      description:
        "who-will-notify-mcp 서비스의 장학금 공고 corpus 를 모집중→마감임박→상시→마감 순으로 나열합니다(요약만, 각 항목에 status 라벨). " +
        "분류(category=학자금유형구분)와 status 로 필터링할 수 있습니다(기본: 전체). 본문 전체는 get_notice 로 확인하세요.",
      annotations: {
        title: "장학금 공고 목록",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        category: z.string().optional().describe("분류(학자금유형구분) 필터 (예: '지역연고', '성적우수')"),
        status: z
          .enum(["모집중", "마감임박", "마감", "상시"])
          .optional()
          .describe("모집상태 필터 (기본: 필터 없음 = 전체)"),
        limit: z
          .number()
          .int()
          .optional()
          .describe("반환 개수 (기본 10, 최대 50)"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const limit = clampLimit(args.limit);
        const today = kstToday();
        const filtered = notices
          .filter((n) => (args.category ? n.category === args.category : true))
          .filter((n) =>
            args.status
              ? scholarshipStatus(n.recruitEnd, today) === args.status
              : true,
          )
          .sort((a, b) => byStatusThenRecruitEnd(a, b, today))
          .slice(0, limit)
          .map((n) =>
            summarize(
              n,
              n.body.length <= SNIPPET_MAX ? n.body : `${n.body.slice(0, SNIPPET_MAX)}…`,
              today,
            ),
          );
        return capArray(filtered, {
          category: args.category ?? null,
          status: args.status ?? null,
        });
      } catch (err) {
        return errText(err);
      }
    },
  );

  // ── get_notice ─────────────────────────────────────────────────────────
  server.registerTool(
    "get_notice",
    {
      title: "장학금 공고 상세",
      description:
        "who-will-notify-mcp 서비스의 장학금 공고 corpus 에서 id 로 공고 한 건의 전체 내용(본문·자격·모집기간·제출서류 등)을 반환합니다. " +
        "본문 전문은 이 도구로만 제공됩니다. 마감된 공고도 id 로는 조회할 수 있습니다. id 는 search_notices/list_notices/find_scholarships 결과에서 얻으세요.",
      annotations: {
        title: "장학금 공고 상세",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        id: z.string().describe("공고 id (예: 'sch-a1b2c3d4e5f6')"),
      },
    },
    async (args) => {
      try {
        const notice = await ctx.store.byId(args.id);
        if (!notice) {
          return ok({ error: "not_found", id: args.id, hint: "search_notices 로 올바른 id 를 먼저 찾으세요." });
        }
        return ok(notice);
      } catch (err) {
        return errText(err);
      }
    },
  );
}
