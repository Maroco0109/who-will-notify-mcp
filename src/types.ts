// ============================================================================
// 데이터 계약 (이 파일이 모든 모듈의 seam — 먼저 고정한다)
//
// 키 규칙:
//   id   = 정체성. seed-notices.json 에 직접 명시한 안정 키("notice-0001").
//          제목/본문이 바뀌어도 id 는 불변 → get_notice 퍼머링크/중복제거 안정.
//          절대 title+date 등 가변 콘텐츠에서 파생하지 않는다.
//   hash = 변경감지 전용. sha256(title|body|publishedAt).
//
// 구조화 데이터(courses[]/dates[])의 유일 진실원천은 seed-notices.json 이다.
// 크롤러는 게시판 HTML 에서 텍스트(title/body)만 추출하며, 구조화 필드는
// 절대 HTML 에서 재파싱하지 않고 seed 에서 id 로 JOIN 한다.
// ============================================================================

export type NoticeCategory =
  | "수강신청"
  | "개설과목"
  | "학사일정"
  | "장학"
  | "일반";

export interface CourseEntry {
  grade: number; // 1..4 대상 학년
  courseName: string; // "자료구조"
  professor: string; // "김정현"
  schedule: string; // "화 7-8교시, 목 7-8교시"
  credits?: number; // 3
  room?: string; // "공학관 401"
}

export interface DateEntry {
  label: string; // "1학년 수강신청" | "정정 기간" | "등록금 납부"
  start: string; // "2026-08-04" (KST 달력일)
  end?: string; // "2026-08-06"
  grade?: number; // 대상 학년(선택)
}

export interface Notice {
  id: string; // 안정 식별자 "notice-0001"
  title: string;
  body: string; // 전문 텍스트(검색 대상)
  category: NoticeCategory;
  semester?: string; // "2026-2"
  grade?: number; // 단일 학년 대상 공지면 그 학년
  courses?: CourseEntry[]; // category === "개설과목" 일 때 (출처: seed)
  dates?: DateEntry[]; // 수강신청/학사일정 공지 (출처: seed)
  publishedAt: string; // ISO8601 (게시일)
  sourceUrl: string; // GitHub Pages 상세 페이지 URL
  hash: string; // sha256(title|body|publishedAt) — 변경감지
}

export interface NoticeDB {
  notices: Notice[];
  syncedAt: string; // 마지막 동기화 시각(ISO8601)
  source: string; // "seed" | "sync"
}

export type StoreSource = "raw" | "baked" | "stale" | "empty";

export interface StoreStatus {
  lastRefresh: string; // ISO8601, 마지막 성공 새로고침 시각("" = 아직 없음)
  source: StoreSource; // 현재 캐시가 어디서 왔는지
  count: number; // 캐시된 공지 수
}

export interface NoticeStore {
  /** 캐시 공지 전체. 비었거나 TTL 만료면 best-effort refresh 후 반환. */
  all(): Promise<Notice[]>;
  /** id 로 단건 조회. */
  byId(id: string): Promise<Notice | undefined>;
  /** raw URL 재조회. 실패해도 throw 하지 않고 last-good/baked 유지(stale-serve). */
  refresh(force?: boolean): Promise<void>;
  /** 헬스/관측용 현재 상태. */
  status(): StoreStatus;
}

export interface ToolCtx {
  store: NoticeStore;
}
