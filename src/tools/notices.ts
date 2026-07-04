import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx } from "../types.js";
import { searchNotices, makeSnippet } from "../search.js";
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
      title: "공지 검색",
      description:
        "whowillnotify 서비스의 학과 공지 게시판에서 질문과 관련된 공지를 키워드로 검색해 요약(제목·분류·게시일·발췌)을 점수순으로 반환합니다. " +
        "질문에 답하기 위한 1차 진입점입니다. 본문 전체가 필요하면 반환된 id 로 get_notice 를 호출하세요.",
      annotations: {
        title: "공지 검색",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        query: z.string().describe("검색어/질문 (예: '1학년 수강신청', '운영체제 교수')"),
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
        const hits = searchNotices(notices, args.query, limit);
        const items = hits.map((h) =>
          summarize(h.notice, makeSnippet(h.notice, args.query, SNIPPET_MAX)),
        );
        return capArray(items, { query: args.query });
      } catch (err) {
        return errText(err);
      }
    },
  );

  // ── list_notices ───────────────────────────────────────────────────────
  server.registerTool(
    "list_notices",
    {
      title: "공지 목록",
      description:
        "whowillnotify 서비스에서 학과 공지를 최신순으로 나열합니다(요약만). 분류(category)나 학기(semester)로 필터링할 수 있습니다. " +
        "본문 전체는 get_notice 로 확인하세요.",
      annotations: {
        title: "공지 목록",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        category: z
          .enum(["수강신청", "개설과목", "학사일정", "장학", "일반"])
          .optional()
          .describe("분류 필터"),
        semester: z.string().optional().describe("학기 필터 (예: '2026-2')"),
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
        const filtered = notices
          .filter((n) => (args.category ? n.category === args.category : true))
          .filter((n) => (args.semester ? n.semester === args.semester : true))
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, limit)
          .map((n) =>
            summarize(n, n.body.length <= SNIPPET_MAX ? n.body : `${n.body.slice(0, SNIPPET_MAX)}…`),
          );
        return capArray(filtered, {
          category: args.category ?? null,
          semester: args.semester ?? null,
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
      title: "공지 상세",
      description:
        "whowillnotify 서비스에서 id 로 공지 한 건의 전체 내용(본문·개설과목·일정 포함)을 반환합니다. " +
        "본문 전문은 이 도구로만 제공됩니다. id 는 search_notices/list_notices 결과에서 얻으세요.",
      annotations: {
        title: "공지 상세",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        id: z.string().describe("공지 id (예: 'notice-0001')"),
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
