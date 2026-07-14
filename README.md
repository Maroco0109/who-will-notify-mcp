# who-will-notify-mcp

이제 누가 공지해주냐... 의 **"누가"**를 맡는 MCP 서버.

전국 **장학금 공고**(한국장학재단·공공데이터포털)를 모아 컨텍스트화하고, 사용자의 질문에 그 컨텍스트로 답하는 카카오 **PlayMCP** 직등록형 MCP 서버입니다. 모든 기능은 **tool calling**으로만 제공되며, 전송은 **Streamable HTTP**(stateless)입니다. 답변은 **실데이터**(공공누리 제1유형, 재배포 허용)에만 근거하며 지어내지 않습니다.

```
질문: "소득 3분위 이하 신청 가능한 장학금 있어?"
답변: "'대학생장학금'(지역연고, 모집중~2026-12-04)이 소득기준 중위 100% 이하 대상입니다.
       (출처: find_scholarships → 대학생장학금)"
```

## 데이터 출처

- **공공데이터포털** `data.go.kr` — **한국장학재단_학자금지원정보(대학생)** (dataset id **15028252**).
- **라이선스**: 공공누리 제1유형("이용허락범위 제한 없음") — **출처표시 시 재배포 허용**.
- **접근**: odcloud 오픈API(REST, JSON), `serviceKey` 인증. 월 단위 갱신, 약 1,850건.
- 각 행 = 하나의 **장학 공고**: 상품명(제목)·지원내역/자격(본문)·모집시작일~모집종료일(기간)·구조화 facet(학자금유형·학년·소득·성적·대학구분·기관).

## 아키텍처 ("repo-as-DB")

```
data.go.kr 15028252 (한국장학재단 학자금지원정보, 공공누리 1유형)
   │  scripts/sync-notices.mjs  (= 매주 월 07:00 KST cron, .github/workflows/crawl.yml)
   │    odcloud API 페이징 fetch → 정규화 → 안전게이트 → 180일 보존 → data/notices.json 커밋
   │      · 안전게이트: 에러봉투/비JSON reject · 완전성(fetched===totalCount)
   │        · shape drop(>5% abort) · 최소건수 floor · 크기(NOTICES_MAX_BYTES) · 키 pre-write assert
   ▼
data/notices.json  (repo-as-DB 영속 저장소, 약 1,013건)
   │
   ▼
raw.githubusercontent.com/.../data/notices.json
   │  (런타임 best-effort fetch, 프로세스 캐시 TTL 15분)
   ▼
KakaoCloud 컨테이너 (Dockerfile, TZ=Asia/Seoul) — express  POST /mcp · GET /health
   이미지에 notices.json 베이크(floor) → fetch 실패해도 stale-serve
```

- **cron**: GitHub Actions `0 22 * * 0` UTC(= 월 07:00 KST). 원천이 월 갱신이라 주 1회로 충분. Actions secret `DATA_GO_KR_KEY` 필요.
- **영속**: `data/notices.json`을 repo에 커밋(repo-as-DB). 서버는 런타임에 raw GitHub를 새로고침하고, 실패 시 이미지에 베이크된 floor를 서빙.
- **키 격리**: `serviceKey`는 **크롤 쪽(GitHub Actions + 로컬 `.env`)에만** 존재. 배포되는 MCP 서버는 키가 필요 없습니다(미리 만들어진 `notices.json`만 읽음).
- **모집상태**: 런타임이 **KST 오늘** 기준으로 각 공고 상태(`모집중`/`마감임박`/`마감`/`상시`)를 계산해 라벨링하고, 검색/목록을 **모집중 우선**으로 정렬합니다.

## MCP 툴 (5개)

| 툴 | 입력 | 반환 |
|---|---|---|
| `search_notices` | `query`, `status?`, `limit?` | 키워드 관련 공고 **요약**(id·제목·발췌·기관·모집기간·**상태**), 모집중 우선 |
| `list_notices` | `category?`, `status?`, `limit?` | 공고 **요약** 목록(모집중 우선, 상태 라벨) |
| `get_notice` | `id` | 공고 **전문**(지원내역·자격·제출서류·모집기간·기관·홈페이지) |
| `get_scholarship_dates` | `kind?`(모집중/마감임박/상시/all), `withinDays?` | 모집기간 기준 조회 — "지금 신청 가능한 / 마감 임박" |
| `find_scholarships` | `category?`(학자금유형), `gradeCriteria?`, `incomeCriteria?`, `gpaCriteria?`, `universityType?`, `organization?`, `status?` | 조건(자격) facet 필터 |

- 목록/검색은 요약만 반환하고 본문 전문은 `get_notice`로만 제공합니다(응답 크기 규율).
- `category`는 **학자금유형구분**(지역연고·성적우수·특기자·소득구분·장애인·기타 등)입니다.
- 마감된 공고도 검색에는 포함되며(대부분 연간 반복 장학금이라 정보 가치 있음) **상태 라벨**로 구분됩니다. "지금 신청 가능한 것만"은 `get_scholarship_dates({kind:"모집중"})`를 사용하세요.

## 로컬 개발 · 검증

```bash
npm install
cp .env.example .env            # DATA_GO_KR_KEY= 에 data.go.kr 일반 인증키 입력
npm run sync                    # data.go.kr fetch → 안전게이트 → data/notices.json 생성(.env 로드)
npm run typecheck
npm test                        # node:test (정규화/id안정/안전게이트/상태라벨/캐시/stale-serve)

# 서버 실행 + 호스트 하니스
npm run dev                     # 터미널 A — :3000
node scripts/host-test.mjs                    # 터미널 B — 배선 점검(키 불필요)
OPENAI_API_KEY=sk-... node scripts/host-test.mjs "소득 3분위 이하 신청 가능한 장학금 있어?"

# 헬스/전송 확인
curl localhost:3000/health        # {"status":"ok",...,"source":"baked","count":1013}
curl -o /dev/null -w "%{http_code}" localhost:3000/mcp   # 405 (stateless)
```

`serviceKey`는 URL 쿼리 파라미터라 로그에 남으면 유출됩니다 — sync 스크립트는 URL/키를 어떤 로그·에러에도 출력하지 않고, `data/notices.json` 작성 직전 키 포함 여부를 assert합니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 |
| `NOTICES_RAW_URL` | raw GitHub `data/notices.json` | 런타임 공고 소스 |
| `NOTICES_TTL_MS` | `900000` (15분) | 캐시 새로고침 주기 |
| `NOTICES_FETCH_TIMEOUT_MS` | `8000` | raw fetch 타임아웃 |
| `NOTICES_MAX_BYTES` | `16777216` (16MB) | ingest 상한(약 1,013건 여유 수용) |
| `NOTICES_BAKED_PATH` | `./data/notices.json` | 베이크 floor 경로 |
| `RATE_LIMIT_MAX` | `120` | IP당 분당 요청 한도 |
| `TZ` | `Asia/Seoul` (Dockerfile) | 모집상태 KST 계산용 |
| `DATA_GO_KR_KEY` | — | **크롤 전용**(로컬 `.env` / Actions secret). 런타임 서버엔 불필요 |
| `DATA_GO_KR_UDDI` | 최신본 기본값 | (선택) 월 갱신 시 최신 데이터셋 uddi 로 덮어쓰기 |

## PlayMCP / 카카오 MCP Hub 등록 정보 (복붙용)

> 심사 규칙상 **모든 툴 description에 서비스명 `who-will-notify-mcp` 포함** + **모든 툴 annotations**(`title`/`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) 정의 — 현재 코드가 충족합니다.

| 항목 | 값 |
|---|---|
| **서버 이름 / 식별자** | who-will-notify-mcp |
| **한 줄 소개** | 한국장학재단(공공데이터포털) 장학금 공고를 컨텍스트화해 "지금 신청 가능한 장학금?", "소득 3분위 대상 있어?" 같은 질문에 출처와 함께 답하는 MCP 서버 |
| **카테고리** | 교육 / 장학 / 정보 검색 |
| **태그** | `장학금`, `학자금`, `공공데이터`, `한국장학재단`, `검색`, `read-only` |
| **전송 방식** | Streamable HTTP (stateless) — `POST /mcp` |
| **인증** | 불필요(공개 read-only) |
| **개인정보 수집** | 없음(공공누리 제1유형 공개 장학 데이터만 read-only 조회) |

### 상세 설명 (Description)

> 한국장학재단이 공공데이터포털에 개방한 **전국 장학금 공고 약 1,000건**(공공누리 제1유형)을 구조화해 담아두고, 사용자의 자연어 질문을 tool calling으로 받아 관련 장학 공고·모집기간·자격조건을 **출처와 함께** 반환하는 `who-will-notify-mcp` MCP 서버입니다. 검색/목록은 요약만, 본문 전문은 `get_notice`로만 제공하며, 각 공고의 **모집상태(모집중/마감임박/마감)**를 실시간으로 라벨링합니다. 모든 툴은 **읽기 전용(read-only)** 이라 데이터를 변경하지 않습니다.

### 대표 질문 (예시 프롬프트)

- `지금 신청 가능한 장학금 있어?` → `get_scholarship_dates({ kind: "모집중" })`
- `마감 임박한 장학금 알려줘` → `get_scholarship_dates({ kind: "마감임박" })`
- `소득 3분위 이하 신청 가능한 장학금 있어?` → `find_scholarships({ incomeCriteria: "..." })`
- `성적우수 장학금 찾아줘` → `find_scholarships({ category: "성적우수" })`
- `장애인 대상 장학금 있어?` → `search_notices({ query: "장애인" })`
- `그 장학금 제출서류가 뭐야?` → `get_notice({ id: "sch-..." })`

### 툴 요약 (annotations 포함)

5개 툴 모두 `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

| 툴 | description(서비스명 포함) 요약 | 입력 |
|---|---|---|
| `search_notices` | who-will-notify-mcp에서 질문 키워드로 장학 공고 요약을 검색(모집중 우선·상태 라벨) | `query`, `status?`, `limit?` |
| `list_notices` | who-will-notify-mcp에서 장학 공고를 나열(유형/상태 필터) | `category?`, `status?`, `limit?` |
| `get_notice` | who-will-notify-mcp에서 id로 장학 공고 전문 반환 | `id` |
| `get_scholarship_dates` | who-will-notify-mcp에서 모집기간 기준(모집중/마감임박/상시) 조회 | `kind?`, `withinDays?` |
| `find_scholarships` | who-will-notify-mcp에서 자격조건(유형·학년·소득·성적·대학·기관) 필터 | `category?`, `gradeCriteria?`, `incomeCriteria?`, `gpaCriteria?`, `universityType?`, `organization?`, `status?` |

## 배포 · PlayMCP 등록 체크리스트 (사용자 수행)

> 코드/데이터는 준비 완료. 아래 콘솔 조작은 **사용자가 직접** 수행합니다(브라우저 로그인·OTP는 대행 불가).

1. **GitHub secret 등록**: repo **Settings → Secrets and variables → Actions → New repository secret** → `DATA_GO_KR_KEY` = data.go.kr 일반 인증키. *(주 1회 자동 sync에 필요)*
2. **push & Actions 활성화**: `main`에 머지/푸시 → `raw.githubusercontent`가 새 `data/notices.json`을 서빙 → 런타임 파이프라인 활성. Actions 활성화 확인.
3. **첫 동기화(선택)**: GitHub **Actions → `weekly-scholarship-sync` → Run workflow**(수동) 1회 실행 → `data/notices.json` 갱신 커밋 확인.
4. **MCP 서버 배포**: KakaoCloud **Git 소스 빌드** → 이 repo 연결 → **Dockerfile 자동 감지**(`TZ=Asia/Seoul` 포함) 빌드/배포 → **MCP Endpoint URL** 복사.
5. **임시 등록**: PlayMCP 콘솔 → 새 MCP 서버 등록 → Endpoint URL 붙여넣기 → 저장(카카오 로그인 + OTP).
6. **테스트**: PlayMCP **AI 채팅**에서 위 "대표 질문"으로 확인.
7. **심사 요청**: 콘솔에서 **"심사 요청"** 클릭.
8. **월 갱신 메모**: 원천 데이터셋 uddi는 월 갱신 시 새로 발급됩니다. 최신 uddi를 repo variable `DATA_GO_KR_UDDI`에 넣으면 코드 변경 없이 반영됩니다. (Actions 스케줄은 repo 60일 무활동 시 자동 비활성화 — 가끔 커밋 권장.)

## 라이선스

- **데이터**: 한국장학재단 / 공공데이터포털, **공공누리 제1유형**(출처표시). 본 서버는 해당 공개 데이터를 read-only로 재배포합니다.
- **코드**: 개인 프로젝트.
