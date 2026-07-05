import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCtx, CourseEntry, DateEntry } from "../types.js";
import { errText, capArray } from "./util.js";

// ============================================================================
// 구조화 데이터 조회 툴.
//   courses[]/dates[] 는 store(=notices.json, 출처 seed)에서 읽는다.
//   게시판 HTML 에서 재파싱하지 않는다.
// ============================================================================

interface CourseRow extends CourseEntry {
  sourceNoticeId: string;
  sourceTitle: string;
}
interface DateRow extends DateEntry {
  sourceNoticeId: string;
  sourceTitle: string;
}

const KIND_KEYWORD: Record<string, string> = {
  수강신청: "수강신청",
  정정: "정정",
  등록금: "등록금",
};

export function registerCourseTools(server: McpServer, ctx: ToolCtx): void {
  // ── get_courses ────────────────────────────────────────────────────────
  server.registerTool(
    "get_courses",
    {
      title: "개설 과목 조회",
      description:
        "who-will-notify-mcp 서비스에서 2학기 개설 교과목을 학년/학기/담당교수로 조회해 (학년·과목명·담당교수·수업시간·학점·강의실) 목록을 반환합니다. " +
        "'1학년은 어떤 과목 들을 수 있어?' 같은 질문에 grade=1 로 사용하세요.",
      annotations: {
        title: "개설 과목 조회",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        grade: z.number().int().optional().describe("대상 학년 (1~4)"),
        semester: z.string().optional().describe("학기 (예: '2026-2')"),
        professor: z.string().optional().describe("담당 교수명 부분일치"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const rows: CourseRow[] = [];
        for (const n of notices) {
          if (!n.courses?.length) continue;
          if (args.semester && n.semester !== args.semester) continue;
          for (const c of n.courses) {
            if (args.grade !== undefined && c.grade !== args.grade) continue;
            if (args.professor && !c.professor.includes(args.professor)) continue;
            rows.push({ ...c, sourceNoticeId: n.id, sourceTitle: n.title });
          }
        }
        rows.sort((a, b) => a.grade - b.grade || a.courseName.localeCompare(b.courseName));
        return capArray(rows, {
          grade: args.grade ?? null,
          semester: args.semester ?? null,
          professor: args.professor ?? null,
        });
      } catch (err) {
        return errText(err);
      }
    },
  );

  // ── get_academic_dates ─────────────────────────────────────────────────
  server.registerTool(
    "get_academic_dates",
    {
      title: "학사 일정 조회",
      description:
        "who-will-notify-mcp 서비스에서 수강신청·정정·등록금 납부 등 학사 일정을 (구분·기간·대상학년)으로 반환합니다. " +
        "'수강신청 언제부터야?', '등록금 납부 기간 알려줘' 같은 질문에 kind 로 필터링하세요.",
      annotations: {
        title: "학사 일정 조회",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        kind: z
          .enum(["수강신청", "정정", "등록금", "all"])
          .optional()
          .describe("일정 구분 필터 (기본 all)"),
        grade: z.number().int().optional().describe("대상 학년 (1~4)"),
      },
    },
    async (args) => {
      try {
        const notices = await ctx.store.all();
        const kw = args.kind && args.kind !== "all" ? KIND_KEYWORD[args.kind] : undefined;
        const rows: DateRow[] = [];
        for (const n of notices) {
          if (!n.dates?.length) continue;
          for (const d of n.dates) {
            if (kw && !d.label.includes(kw)) continue;
            if (args.grade !== undefined && d.grade !== undefined && d.grade !== args.grade) {
              continue;
            }
            rows.push({ ...d, sourceNoticeId: n.id, sourceTitle: n.title });
          }
        }
        rows.sort((a, b) => a.start.localeCompare(b.start));
        return capArray(rows, {
          kind: args.kind ?? "all",
          grade: args.grade ?? null,
        });
      } catch (err) {
        return errText(err);
      }
    },
  );
}
