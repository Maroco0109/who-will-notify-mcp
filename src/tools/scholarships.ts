import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx, Notice } from "../types.js";
import { errText, capArray, summarize, SNIPPET_MAX } from "./util.js";
import {
  kstToday,
  addDays,
  isActive,
  byRecruitEndAsc,
  scholarshipStatus,
  byStatusThenRecruitEnd,
} from "../date.js";

// ============================================================================
// 장학금 공고(who-will-notify-mcp corpus) 구조화 조회 툴.
//   store(=notices.json, 출처 data.go.kr 15028252 한국장학재단 학자금지원정보)에서 읽는다.
//   - get_scholarship_dates: 모집기간 기준 필터/정렬(상시/모집중/마감임박).
//   - find_scholarships: 학년/소득/성적/대학구분/기관 facet 필터.
//   두 툴 모두 search_notices/list_notices/get_notice 와 동일한 장학금 공고 corpus 를 다룬다.
// ============================================================================

/** 부분일치(대소문자 무시, 값 부재 방어). */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function registerScholarshipTools(server: McpServer, ctx: ToolCtx): void {
  // NOTE: category=학자금유형구분 (상품구분은 편중 1796/54 → body 로만 보존).
  // ── get_scholarship_dates ──────────────────────────────────────────────
  server.registerTool(
    "get_scholarship_dates",
    {
      title: "장학금 모집기간 조회",
      description:
        "who-will-notify-mcp 서비스의 장학금 공고 corpus 에서 모집기간(모집시작일~모집종료일) 기준으로 공고를 필터·정렬해 " +
        "(상품명·운영기관·모집시작일·모집종료일·분류·홈페이지)를 반환합니다. " +
        "'마감 언제야 / 마감 임박 장학금 / 상시 접수 장학금' 류 질문에 kind 로 사용하세요. " +
        "모집종료일 오름차순(상시는 마지막)으로 정렬합니다.",
      annotations: {
        title: "장학금 모집기간 조회",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        kind: z
          .enum(["상시", "모집중", "마감임박", "all"])
          .optional()
          .describe(
            "모집상태 필터: 모집중(기본, 상시 포함)/마감임박(마감 임박, 상시 제외)/상시(상시 접수)/all",
          ),
        withinDays: z
          .number()
          .int()
          .optional()
          .describe("마감임박 기준 일수 (기본 14) — 오늘부터 N일 이내 마감"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const kind = args.kind ?? "모집중";
        const withinDays =
          typeof args.withinDays === "number" && args.withinDays > 0
            ? Math.floor(args.withinDays)
            : 14;
        const today = kstToday();
        const soon = addDays(today, withinDays);

        const filtered = notices.filter((n) => {
          switch (kind) {
            case "상시":
              return n.recruitEnd === null;
            case "마감임박":
              // 상시(null) 제외; today <= recruitEnd <= today+withinDays
              return (
                n.recruitEnd !== null &&
                n.recruitEnd >= today &&
                n.recruitEnd <= soon
              );
            case "all":
              return true;
            case "모집중":
            default:
              return isActive(n.recruitEnd, today);
          }
        });

        const rows = [...filtered].sort(byRecruitEndAsc).map((n) => ({
          id: n.id,
          title: n.title,
          organization: n.organization,
          recruitStart: n.recruitStart,
          recruitEnd: n.recruitEnd,
          category: n.category,
          sourceUrl: n.sourceUrl,
        }));

        return capArray(rows, { kind, withinDays, today });
      } catch (err) {
        return errText(err);
      }
    },
  );

  // ── find_scholarships ──────────────────────────────────────────────────
  // TODO(0b): confirm which facets have cardinality>1; drop near-single-valued facets.
  server.registerTool(
    "find_scholarships",
    {
      title: "장학금 조건 검색",
      description:
        "who-will-notify-mcp 서비스의 장학금 공고 corpus 를 학년/소득/성적/대학구분/운영기관/분류(학자금유형구분) 조건으로 필터해 요약을 반환합니다. " +
        "'소득 3분위 이하 신청 가능한 장학금 / 1학년이 받을 수 있는 장학금 / 특정 기관 장학금' 류 질문에 사용하세요. " +
        "결과는 모집중→마감임박→상시→마감 순으로 정렬되며 각 항목에 status 라벨이 붙습니다. status 로 특정 상태만 필터할 수 있습니다(기본: 전체).",
      annotations: {
        title: "장학금 조건 검색",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        gradeCriteria: z.string().optional().describe("학년구분 부분일치 (예: '1학년')"),
        incomeCriteria: z.string().optional().describe("소득기준 부분일치 (예: '소득 3구간')"),
        gpaCriteria: z.string().optional().describe("성적기준 부분일치 (예: '80점')"),
        universityType: z.string().optional().describe("대학구분 부분일치 (예: '대학(4년제)')"),
        organization: z.string().optional().describe("운영기관 부분일치 (예: '한국장학재단')"),
        category: z.string().optional().describe("분류(학자금유형구분) 부분일치 (예: '지역연고', '성적우수')"),
        status: z
          .enum(["모집중", "마감임박", "마감", "상시"])
          .optional()
          .describe("모집상태 필터 (기본: 필터 없음 = 전체)"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const today = kstToday();

        const matched = notices.filter((n: Notice) => {
          if (args.status && scholarshipStatus(n.recruitEnd, today) !== args.status) return false;
          if (args.gradeCriteria && !contains(n.gradeCriteria, args.gradeCriteria)) return false;
          if (args.incomeCriteria && !contains(n.incomeCriteria, args.incomeCriteria)) return false;
          if (args.gpaCriteria && !contains(n.gpaCriteria, args.gpaCriteria)) return false;
          if (args.universityType && !contains(n.universityType, args.universityType)) return false;
          if (args.organization && !contains(n.organization, args.organization)) return false;
          if (args.category && !contains(n.category, args.category)) return false;
          return true;
        });

        const items = [...matched]
          .sort((a, b) => byStatusThenRecruitEnd(a, b, today))
          .map((n) =>
            summarize(
              n,
              n.body.length <= SNIPPET_MAX ? n.body : `${n.body.slice(0, SNIPPET_MAX)}…`,
              today,
            ),
          );

        return capArray(items, {
          gradeCriteria: args.gradeCriteria ?? null,
          incomeCriteria: args.incomeCriteria ?? null,
          gpaCriteria: args.gpaCriteria ?? null,
          universityType: args.universityType ?? null,
          organization: args.organization ?? null,
          category: args.category ?? null,
          status: args.status ?? null,
        });
      } catch (err) {
        return errText(err);
      }
    },
  );
}
