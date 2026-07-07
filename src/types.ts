// ============================================================================
// 데이터 계약 (이 파일이 모든 모듈의 seam — 먼저 고정한다)
//
// 출처: data.go.kr 15028252 (한국장학재단_학자금지원정보) odcloud 파일데이터 API.
// 각 Notice = 하나의 장학금 "모집 인스턴스"(recruitment instance).
//
// 키 규칙:
//   id   = 정체성. 하지만 이제 **모집 인스턴스 콘텐츠 해시**에서 파생한다:
//          id = "sch-" + sha256(norm(상품명)|norm(운영기관명)|norm(모집시작일))[:12].
//          이는 이전 계약(types.ts:8 "절대 가변 콘텐츠에서 id 를 파생하지 않는다")을
//          **의도적으로 뒤집는다**. 이유: API 는 안정적인 업무키를 보장하지 않으므로
//          (번호는 월별 인덱스 churn 위험) 정체성을 스스로 도출해야 월별 재조회 간
//          get_notice 퍼머링크/중복제거가 유지된다. 정규화(normalizeTuple)가
//          공백/괄호접미사 변동을 흡수해 id 안정성을 보강한다.
//   hash = 변경감지 전용. sha256(title|body|recruitStart|recruitEnd) (publishedAt 제거).
//
// 모든 필드는 API 필드에서 직접 유래한다(무허구 원칙). 번호는 정체성이 아닌
// 추적용 sourceNo 로만 보존한다.
// ============================================================================

// TODO(0b): finalize enum from real 상품구분/학자금유형구분 distribution.
// 실제 값 분포는 Phase 0b(실키 응답) 전까지 미확정 → 잘못된 enum 을 하드코딩하지 않고
// 잠정적으로 string 으로 둔다.
export type NoticeCategory = string;

export interface Notice {
  id: string; // "sch-" + sha256(norm(상품명)|norm(운영기관명)|norm(모집시작일))[:12]
  sourceNo: string; // 원본 "번호" — 추적용(정체성 아님)
  title: string; // 상품명
  body: string; // 지원내역/특정자격/자격제한/제출서류/선발방법 합성(검색 대상), BODY_MAX cap
  category: NoticeCategory; // 상품구분 / 학자금유형구분
  organization: string; // 운영기관명
  organizationType: string; // 운영기관구분
  universityType: string; // 대학구분
  gradeCriteria: string; // 학년구분
  major: string; // 학과구분
  gpaCriteria: string; // 성적기준 상세내용
  incomeCriteria: string; // 소득기준 상세내용
  selectionCount: string; // 선발인원 상세내용
  selectionMethod: string; // 선발방법 상세내용
  specificQualification: string; // 특정자격 상세내용
  restrictions: string; // 자격제한 상세내용
  residencyRequired: string; // 지역거주여부 상세내용
  recommendationRequired: string; // 추천필요여부 상세내용
  documents: string; // 제출서류 상세내용
  sourceUrl: string; // 홈페이지 주소 (실제 외부 URL)
  recruitStart: string | null; // 모집시작일 "YYYY-MM-DD" | null(상시/부재)
  recruitEnd: string | null; // 모집종료일 "YYYY-MM-DD" | null(상시/부재)
  hash: string; // sha256(title|body|recruitStart|recruitEnd) — 변경감지
}

export interface NoticeDB {
  notices: Notice[];
  syncedAt: string; // 마지막 동기화 시각(ISO8601)
  source: string; // "sync"(API 동기화) | "baked"(Docker 베이크 floor)
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
