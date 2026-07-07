// ============================================================================
// KST("Asia/Seoul") 달력 기준 날짜 유틸 (Change #7)
//
//   Actions/컨테이너는 UTC 로 도는 경우가 많으므로 raw UTC 날짜를 쓰면 안 된다.
//   "오늘"은 항상 Asia/Seoul 달력일(YYYY-MM-DD)로 계산한다.
//   모집중/마감임박/상시 분류의 단일 기준.
//
//   ⚠️ recruitEnd 는 null(상시) 가능 → 어떤 비교/정렬에서도 null 을 먼저 가드.
//      null.localeCompare 절대 금지.
// ============================================================================

/** Asia/Seoul 달력 기준 오늘("YYYY-MM-DD"). en-CA 로케일이 YYYY-MM-DD 를 만든다. */
export function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}

/** "YYYY-MM-DD" 에 days 를 더한 달력일("YYYY-MM-DD"). UTC 자정 기준 순수 산술. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 모집중(active) 판정: recruitEnd 가 null(상시) 이거나 오늘 이상이면 active.
 * recruitEnd < today 이면 ENDED(마감).
 */
export function isActive(recruitEnd: string | null, today = kstToday()): boolean {
  return recruitEnd === null || recruitEnd >= today;
}

/**
 * null-safe recruitEnd 오름차순 비교자. null(상시) 은 항상 LAST 버킷.
 * 정렬 대상은 { recruitEnd } 를 가진 객체.
 */
export function byRecruitEndAsc(
  a: { recruitEnd: string | null },
  b: { recruitEnd: string | null },
): number {
  if (a.recruitEnd === null && b.recruitEnd === null) return 0;
  if (a.recruitEnd === null) return 1; // a 를 뒤로
  if (b.recruitEnd === null) return -1; // b 를 뒤로
  return a.recruitEnd.localeCompare(b.recruitEnd);
}

// ============================================================================
// 모집상태 라벨 (Phase 3 — 0b 실측 반영: 활성 29/1850뿐 → 하드 hide 폐기, 라벨로 대체)
//   상시   : recruitEnd === null (상시 접수)
//   마감임박: today <= recruitEnd <= today+soonDays
//   모집중 : recruitEnd > today+soonDays
//   마감   : recruitEnd < today
// ============================================================================
export type ScholarshipStatus = "상시" | "마감임박" | "모집중" | "마감";

/** recruitEnd(+오늘, soonDays) → 모집상태 라벨. */
export function scholarshipStatus(
  recruitEnd: string | null,
  today = kstToday(),
  soonDays = 14,
): ScholarshipStatus {
  if (recruitEnd === null) return "상시";
  if (recruitEnd < today) return "마감";
  const soon = addDays(today, soonDays);
  return recruitEnd <= soon ? "마감임박" : "모집중";
}

/**
 * 정렬 우선순위(작을수록 먼저). 활성(마감임박→모집중) → 상시 → 마감.
 * 마감임박을 모집중보다 앞에 둬 임박 공고가 상단 노출된다.
 */
export function statusRank(status: ScholarshipStatus): number {
  switch (status) {
    case "마감임박":
      return 0;
    case "모집중":
      return 1;
    case "상시":
      return 2;
    case "마감":
      return 3;
    default:
      return 4;
  }
}

/**
 * status-priority(활성 먼저, 마감 last) → recruitEnd 오름차순 비교자.
 * today 를 한 번만 계산해 넘기면 대량 정렬에서 재계산을 피한다.
 */
export function byStatusThenRecruitEnd(
  a: { recruitEnd: string | null },
  b: { recruitEnd: string | null },
  today = kstToday(),
): number {
  const ra = statusRank(scholarshipStatus(a.recruitEnd, today));
  const rb = statusRank(scholarshipStatus(b.recruitEnd, today));
  if (ra !== rb) return ra - rb;
  return byRecruitEndAsc(a, b);
}
