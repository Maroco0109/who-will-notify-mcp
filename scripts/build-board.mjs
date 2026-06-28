// ============================================================================
// build-board.mjs — seed-notices.json → docs/ 정적 게시판 HTML 생성
//
//   node scripts/build-board.mjs
//
// 산출물:
//   docs/index.html              공지 목록(.notice-row 테이블)
//   docs/notice/<id>.html        상세 페이지(data-* 속성 + .notice-body)
//   docs/assets/style.css        스타일
//
// 크롤러(sync-notices.mjs)는 이 마크업의 텍스트(title/body/date)만 추출하고,
// 구조화 데이터(courses/dates)는 HTML 이 아니라 seed 에서 JOIN 한다.
// 상세 페이지의 표는 사람이 보기 위한 표시용일 뿐 크롤 소스가 아니다.
// ============================================================================
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadSeed, escapeHtml, ymd, detailUrl } from "./lib.mjs";

const DOCS = join(ROOT, "docs");
const seed = loadSeed();
const dept = seed.meta?.department ?? "학과";
const notices = [...seed.notices].sort((a, b) =>
  b.publishedAt.localeCompare(a.publishedAt),
);

function page(title, bodyHtml, depth = 0) {
  const cssPath = `${"../".repeat(depth)}assets/style.css`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${cssPath}" />
</head>
<body>
<main class="container">
${bodyHtml}
</main>
</body>
</html>
`;
}

function coursesTable(courses) {
  const rows = courses
    .map(
      (c) => `      <tr class="course-row">
        <td>${c.grade}학년</td>
        <td>${escapeHtml(c.courseName)}</td>
        <td>${escapeHtml(c.professor)}</td>
        <td>${escapeHtml(c.schedule)}</td>
        <td>${c.credits ?? ""}</td>
        <td>${escapeHtml(c.room ?? "")}</td>
      </tr>`,
    )
    .join("\n");
  return `    <table class="course-table">
      <thead><tr><th>학년</th><th>과목명</th><th>담당교수</th><th>수업시간</th><th>학점</th><th>강의실</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

function datesTable(dates) {
  const rows = dates
    .map(
      (d) => `      <tr class="date-row">
        <td>${escapeHtml(d.label)}</td>
        <td>${escapeHtml(d.start)}${d.end ? ` ~ ${escapeHtml(d.end)}` : ""}</td>
      </tr>`,
    )
    .join("\n");
  return `    <table class="date-table">
      <thead><tr><th>구분</th><th>기간</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>`;
}

// ── docs/ 초기화 ────────────────────────────────────────────────────────────
rmSync(DOCS, { recursive: true, force: true });
mkdirSync(join(DOCS, "notice"), { recursive: true });
mkdirSync(join(DOCS, "assets"), { recursive: true });

// ── 목록 페이지 ──────────────────────────────────────────────────────────────
const listRows = notices
  .map(
    (n) => `    <tr class="notice-row" data-id="${n.id}">
      <td class="col-id">${n.id}</td>
      <td class="col-category">${escapeHtml(n.category)}</td>
      <td class="col-title"><a href="notice/${n.id}.html">${escapeHtml(n.title)}</a></td>
      <td class="col-date">${ymd(n.publishedAt)}</td>
    </tr>`,
  )
  .join("\n");

const indexHtml = page(
  `${dept} 공지사항`,
  `  <h1>${escapeHtml(dept)} 공지사항</h1>
  <p class="board-desc">학과 공지사항 게시판 (테스트용 더미 데이터 ${notices.length}건)</p>
  <table class="notice-list">
    <thead><tr><th>번호</th><th>분류</th><th>제목</th><th>게시일</th></tr></thead>
    <tbody>
${listRows}
    </tbody>
  </table>`,
  0,
);
writeFileSync(join(DOCS, "index.html"), indexHtml, "utf-8");

// ── 상세 페이지 ──────────────────────────────────────────────────────────────
for (const n of notices) {
  let extra = "";
  if (n.courses?.length) extra += `\n${coursesTable(n.courses)}`;
  if (n.dates?.length) extra += `\n${datesTable(n.dates)}`;

  const detailHtml = page(
    n.title,
    `  <p class="breadcrumb"><a href="../index.html">← 목록</a></p>
  <article class="notice-detail" data-id="${n.id}" data-category="${escapeHtml(n.category)}" data-published="${escapeHtml(n.publishedAt)}">
    <h1 class="notice-title">${escapeHtml(n.title)}</h1>
    <div class="notice-meta">분류: ${escapeHtml(n.category)} · 게시일: ${ymd(n.publishedAt)}</div>
    <p class="notice-body">${escapeHtml(n.body)}</p>${extra}
  </article>`,
    1,
  );
  writeFileSync(join(DOCS, "notice", `${n.id}.html`), detailHtml, "utf-8");
}

// ── 스타일 ──────────────────────────────────────────────────────────────────
const css = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", sans-serif; margin: 0; line-height: 1.6; }
.container { max-width: 920px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 8px; }
.board-desc, .notice-meta { color: #6b7280; font-size: .9rem; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: .92rem; vertical-align: top; }
th { background: #f9fafb; font-weight: 600; }
.col-id { white-space: nowrap; color: #9ca3af; font-variant-numeric: tabular-nums; }
.col-category { white-space: nowrap; }
.col-date { white-space: nowrap; color: #6b7280; }
.notice-list a { color: inherit; text-decoration: none; }
.notice-list a:hover { text-decoration: underline; }
.breadcrumb a { color: #2563eb; text-decoration: none; }
.notice-title { font-size: 1.3rem; margin: 8px 0; }
.notice-body { margin: 16px 0; white-space: pre-wrap; }
.course-table th, .date-table th { background: #eef2ff; }
@media (prefers-color-scheme: dark) {
  body { background: #0b0f17; color: #e5e7eb; }
  th { background: #111827; }
  .course-table th, .date-table th { background: #1e1b4b; }
  th, td { border-color: #1f2937; }
}
`;
writeFileSync(join(DOCS, "assets", "style.css"), css, "utf-8");

console.log(
  `[build-board] docs/ 생성 완료: 공지 ${notices.length}건 (index.html + notice/*.html)`,
);
console.log(`[build-board] 게시판 URL(예상): ${detailUrl("notice-0001").replace("/notice/notice-0001.html", "/index.html")}`);
