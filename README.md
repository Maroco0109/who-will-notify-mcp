# who-will-notify-mcp

이제 누가 공지해주냐... 의 **"누가"**를 맡는 MCP 서버.

학과 **공지사항**을 모아 컨텍스트화하고, 사용자의 질문에 그 컨텍스트로 답하는 카카오 **PlayMCP** 직등록형 MCP 서버입니다. 모든 기능은 **tool calling**으로만 제공되며, 전송은 **Streamable HTTP**(stateless)입니다.

```
질문: "이번에 1학년은 어떤 과목 들을 수 있어?"
답변: "1학년은 2학기에 프로그래밍기초(C언어), 웹 개발 기초, 이산수학을 수강할 수 있습니다.
       (출처: 2026학년도 2학기 컴퓨터공학과 개설 교과목 안내)"
```

## 아키텍처 ("repo-as-DB")

```
data/seed-notices.json  ── 유일 진실원천(공지 30건, 구조화 courses[]/dates[] 포함)
   │
   ├─ scripts/build-board.mjs ─► docs/  (GitHub Pages 정적 게시판)
   │
   └─ scripts/sync-notices.mjs  (= 매일 07:00 KST cron, .github/workflows/crawl.yml)
         게시판 fetch → 텍스트 추출 + seed JOIN(구조화) → data/notices.json 커밋
                                  │
                                  ▼
        raw.githubusercontent.com/.../data/notices.json
                                  │  (런타임 best-effort fetch, 프로세스 캐시 TTL 15분)
                                  ▼
        KakaoCloud 컨테이너 (Dockerfile) — express  POST /mcp · GET /health
        이미지에 notices.json 베이크(floor) → fetch 실패해도 stale-serve
```

- **게시판**: GitHub Pages 정적 사이트(`docs/`). 무료.
- **cron**: GitHub Actions `0 22 * * *` UTC(= 07:00 KST). 무료·독립 실행.
- **영속**: `data/notices.json`을 repo에 커밋(repo-as-DB). 서버는 런타임에 raw GitHub를 새로고침하고, 실패 시 이미지에 베이크된 floor를 서빙. KakaoCloud 자동재배포 여부와 무관하게 동작.

## MCP 툴 (5개)

| 툴 | 입력 | 반환 |
|---|---|---|
| `search_notices` | `query`, `limit?` | 점수순 공지 **요약**(id·title·snippet·분류·게시일) |
| `list_notices` | `category?`, `semester?`, `limit?` | 최신순 공지 **요약** |
| `get_notice` | `id` | 공지 **전문**(본문·개설과목·일정 포함) |
| `get_courses` | `grade?`, `semester?`, `professor?` | 개설 과목(학년·과목·교수·수업시간) |
| `get_academic_dates` | `kind?`, `grade?` | 학사 일정(수강신청·정정·등록금 납부) |

목록/검색은 요약만 반환하고 본문 전문은 `get_notice`로만 제공합니다(응답 크기 규율). 구조화 데이터(과목/일정)는 항상 JSON(seed 출처)에서 읽으며 HTML을 재파싱하지 않습니다.

## 로컬 개발 · 검증

```bash
npm install
npm run build-board            # seed → docs/ 정적 게시판 생성
npm run sync -- --from-seed    # 네트워크 없이 data/notices.json 부트스트랩
npm run typecheck && npm run build
npm test                       # node:test (id안정/캐시/stale-serve/구조화=JSON/크기규율)

# 서버 실행 + 호스트 하니스
npm run dev                    # 터미널 A — :3000
node scripts/host-test.mjs                    # 터미널 B — 배선 점검(키 불필요)
OPENAI_API_KEY=sk-... node scripts/host-test.mjs "1학년은 어떤 과목 들을 수 있어?"

# 헬스/전송 확인
curl localhost:3000/health        # {"status":"ok",...,"source":"baked","count":30}
curl -o /dev/null -w "%{http_code}" localhost:3000/mcp   # 405 (stateless)
```

크롤 모드(`npm run sync`)는 `PAGES_BASE` 환경변수의 게시판을 fetch합니다(기본: 배포된 GitHub Pages). 로컬에서 docs/를 정적 서빙하면 `PAGES_BASE=http://localhost:PORT`로도 검증할 수 있습니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 |
| `NOTICES_RAW_URL` | raw GitHub `data/notices.json` | 런타임 공지 소스 |
| `NOTICES_TTL_MS` | `900000` (15분) | 캐시 새로고침 주기 |
| `NOTICES_FETCH_TIMEOUT_MS` | `8000` | raw fetch 타임아웃 |
| `NOTICES_MAX_BYTES` | `524288` (512KB) | ingest 상한 |
| `NOTICES_BAKED_PATH` | `./data/notices.json` | 베이크 floor 경로 |
| `PAGES_BASE` | 배포 Pages URL | 게시판 베이스(빌드/크롤 스크립트) |
| `RATE_LIMIT_MAX` | `120` | IP당 분당 요청 한도 |

## 배포 · PlayMCP 등록 체크리스트 (사용자 수행)

> 코드/게시판/데이터는 준비 완료. 아래 콘솔 조작은 **사용자가 직접** 수행합니다(브라우저 로그인·OTP·버튼 클릭은 대행 불가).

1. **push & 공개**: `git push` 후 GitHub repo를 public으로, **Actions 활성화**, **Settings → Pages → Source = `main` / `docs`** 설정.
2. **게시판 확인**: `https://maroco0109.github.io/who-will-notify-mcp/` 가 뜨는지 확인.
3. **첫 동기화**: GitHub **Actions → `daily-notice-sync` → Run workflow**(수동) 1회 실행 → `data/notices.json` 커밋 확인. *(이미지 빌드 전에 floor를 채움)*
4. **MCP 서버 배포**: KakaoCloud **Git 소스 빌드**(`https://playmcp.kakaocloud.io/my-mcp`) → 이 repo 연결 → **Dockerfile 자동 감지** 빌드/배포 → **MCP Endpoint URL** 복사.
   - 배포 후 사소한 커밋을 push해 **자동 재배포 여부(YES/NO)를 기록**해 두세요(자동재배포가 안 되더라도 서버는 런타임 fetch로 갱신됩니다).
5. **임시 등록**: PlayMCP 콘솔(`https://playmcp.kakao.com/console?tab=draft`) → 새 MCP 서버 등록 → Endpoint URL 붙여넣기 → 저장(카카오 로그인 + OTP 2차인증).
6. **테스트**: PlayMCP **AI 채팅**에서 확인:
   - "이번에 1학년은 어떤 과목 들을 수 있어?"
   - "2학기 수강신청 언제부터야?"
   - "등록금 납부 기간 알려줘"
7. **심사 요청**: 콘솔에서 **"심사 요청"** 클릭.
8. **유지보수 메모**: GitHub Actions 스케줄은 **repo 60일 무활동 시 자동 비활성화**됩니다. 데모를 오래 살려두려면 캘린더 리마인더를 두거나 가끔 커밋하세요.

## 라이선스

테스트/데모용 더미 데이터. 공지 내용은 실제와 무관합니다.
