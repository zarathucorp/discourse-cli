# Discourse CLI Wrapper 프로젝트 기획서

작성일: 2026-04-09

## 1. 목표

Discourse 사이트의 API를 터미널에서 일관된 CLI 방식으로 사용할 수 있는 범용 래퍼를 만든다.

핵심 목표:

- 관리자 API 키 또는 User API Key 기반 인증 지원
- Discourse 공식 API 스펙 기준으로 가능한 넓은 커버리지 확보
- 사람이 읽기 쉬운 서브커맨드와 자동화 친화적인 JSON 출력 동시 제공
- 최신 Discourse 릴리스 변화에 따라 CLI도 빠르게 따라갈 수 있는 구조 확보

중요한 전제:

- "API key만 있으면 모든 기능"은 엄밀히는 성립하지 않는다.
- Admin API는 `Api-Key`와 `Api-Username`이 필요하다.
- User API Key는 `user_api_key`와 `user_api_client_id`가 필요하다.
- 실제 수행 가능 범위는 해당 키가 가진 권한과 Discourse가 공개한 API 범위에 제한된다.
- 플러그인 전용 기능, 비공개 내부 엔드포인트, UI 전용 동작은 별도 대응이 필요하다.

## 2. 권장 기술 스택

### 추천안

- 언어: TypeScript
- 런타임: Node.js LTS
- CLI 프레임워크: `oclif`
- HTTP: 내장 `fetch` 또는 `undici`
- 스펙 처리: `openapi-typescript` + 커스텀 코드 생성 스크립트
- 검증: `zod`
- 테스트: `vitest`

### 추천 이유

- Discourse 공식 API 문서가 OpenAPI로 공개되어 있어 생성 기반 개발에 유리하다.
- Discourse 공식 `discourse-mcp`와 커뮤니티 `discourse2`가 모두 TypeScript 기반이라 참고 자산이 많다.
- `oclif`는 명령 수가 많은 대형 CLI에 적합하다.
- 타입 안정성과 JSON 직렬화 경험이 좋아 자동완성, 도움말, 파이프 처리에 유리하다.
- 향후 플러그인 명령 추가, shell completion, config/profile 확장도 자연스럽다.

### 대안

옵션 A. Python + `Typer`

- 장점: 구현 속도가 빠르고 CLI UX가 단순하다.
- 단점: OpenAPI 기반 전체 명령 자동 생성과 타입 안정성은 TypeScript 쪽이 더 편하다.

옵션 B. Go + `Cobra`

- 장점: 단일 바이너리 배포가 쉽다.
- 단점: 스펙 변화 추적과 코드 생성 커스터마이징 비용이 커질 수 있다.

결론:

- 이 프로젝트는 "명령 수가 많고, 최신 API 변화 추적이 중요하고, 자동 생성 비중이 높다"는 점에서 TypeScript가 가장 균형이 좋다.

## 3. 제품 방향

이 프로젝트는 단순한 SDK보다 "운영용 CLI"에 가깝게 설계해야 한다.

권장 방향:

- 기본은 사람이 쓰기 쉬운 명령 제공
- 항상 `--json` 출력 지원
- 모든 명령은 비대화형 실행 가능
- 실패 시 명확한 exit code 반환
- 최신 공식 OpenAPI와 동기화 가능한 생성 파이프라인 제공
- 공식 스펙 밖 엔드포인트 대응용 escape hatch 제공

예시 UX:

```bash
discourse topics list --category dev --json
discourse topics get --id 123
discourse posts create --topic-id 123 --raw-file body.md
discourse users get --username sam
discourse admin users suspend --id 42 --until 2026-04-30 --reason "spam"
discourse api call GET /site.json
```

## 4. 아키텍처 제안

### 4.1 명령 계층

1. Generated commands
- OpenAPI에서 추출한 경로/메서드 기반 명령
- 전체 API 커버리지의 기반

2. Curated commands
- 자주 쓰는 작업을 사람이 이해하기 쉬운 이름으로 재구성
- 예: `topics list`, `posts create`, `users suspend`

3. Escape hatch
- `discourse api call METHOD /path`
- 공식 스펙 누락, 플러그인 API, 급한 운영 작업 대응

이 3계층이 같이 있어야 "모든 기능" 요구와 실사용 편의성을 같이 잡을 수 있다.

### 4.2 내부 모듈

- `auth`
  - admin api key
  - user api key
  - profile loading
  - env var loading
- `client`
  - request builder
  - retry / timeout / pagination
  - error normalization
- `schema`
  - OpenAPI fetch
  - command manifest generation
  - type generation
- `commands`
  - generated
  - curated
  - api call
- `output`
  - table
  - json
  - raw
- `config`
  - multi-site profiles
  - default site
  - secret path handling

## 5. 기능 범위

### MVP

- 인증
  - Admin API Key
  - User API Key
  - 환경변수 / profile 파일 지원
- 읽기 기능
  - site
  - categories
  - topics
  - posts
  - users
  - groups
  - search
- 쓰기 기능
  - topic 생성
  - post 생성/수정/삭제
  - user 관리 일부
  - upload
- 공통 기능
  - `--json`
  - pagination
  - timeout
  - debug 로그
  - `api call` fallback

### V1

- OpenAPI 기반 generated command 본격 도입
- shell completion
- 다중 사이트 profile
- dry-run 가능한 명령 일부 지원
- write 안전장치
  - `--confirm`
  - `--allow-writes`
- rate limit / 429 재시도

### V2

- plugin endpoint extension mechanism
- batch commands
- jq-friendly output presets
- stdin/file piping
- changelog 기반 API diff 리포트

## 6. 최신 버전 대응 전략

이 프로젝트의 가장 중요한 설계 포인트는 "핸드메이드 명령 중심"이 아니라 "스펙 동기화 중심"이어야 한다는 점이다.

권장 전략:

- CI에서 `https://docs.discourse.org/openapi.json`을 주기적으로 확인
- 스펙 변경 시 타입/명령 manifest 재생성
- 생성 결과 diff 검토 후 릴리스
- 주요 curated command는 별도 E2E 테스트 유지
- 최소 1개의 최신 stable Discourse와 1개의 latest 채널을 대상으로 검증

현재 확인 결과:

- 공식 OpenAPI 문서는 `latest` 기준으로 제공된다.
- 현재 스펙에는 79개 path, 93개 operation이 있다.
- 공식 저장소 태그 기준 2026-03-31에 `v2026.3.0`이 만들어졌고, 같은 날 다음 채널인 `v2026.4.0-latest` 개발이 시작됐다.

따라서 최신 대응이 중요하면, 서드파티 SDK 추종보다 공식 OpenAPI 직접 추종이 더 안전하다.

## 7. 기존 저장소 리서치

### 7.1 `discourse/discourse_api`

- 링크: [discourse/discourse_api](https://github.com/discourse/discourse_api)
- 성격: Discourse 공식 Ruby API 클라이언트
- 상태:
  - GitHub API 기준 `updated_at`: 2026-03-31
  - `pushed_at`: 2025-12-09
- 평가:
  - 공식 프로젝트라 신뢰도는 높다.
  - 하지만 CLI가 아니라 Ruby SDK다.
  - 최신 Discourse에서 "쓸 수 있을 가능성"은 높지만, 현재 OpenAPI 전체 커버리지 또는 CLI UX를 제공한다는 근거는 부족하다.

### 7.2 `gadicc/discourse2`

- 링크: [gadicc/discourse2](https://github.com/gadicc/discourse2)
- 성격: TypeScript SDK, OpenAPI 기반 생성
- 상태:
  - README에서 OpenAPI를 하루 2회 확인한다고 명시
  - GitHub 릴리스 최신 버전 `v1.2.0` 게시일: 2025-10-11
  - GitHub API 기준 `pushed_at`: 2025-10-11
- 평가:
  - 설계 방향은 매우 좋고 참고 가치가 높다.
  - 다만 2026-04-09 시점의 최신 Discourse 태그(`v2026.3.0`, `v2026.4.0-latest`)와 실제 호환을 입증하는 최근 릴리스나 커밋 근거는 확인하지 못했다.
  - 즉, 참고용으로는 좋지만 기반 의존성으로 바로 채택하기엔 최신성 검증이 약하다.

### 7.3 `discourse/discourse-mcp`

- 링크: [discourse/discourse-mcp](https://github.com/discourse/discourse-mcp)
- 성격: Discourse 공식 MCP 서버
- 상태:
  - GitHub API 기준 `updated_at`: 2026-04-06
  - `pushed_at`: 2026-04-01
  - README에서 Admin API Key와 User API Key 모두 지원
  - write safety, profile, retry, timeout 등 운영 기능 포함
- 평가:
  - 전통적인 shell CLI는 아니지만, 현재 가장 활발히 유지되는 "명령형 인터페이스"에 가깝다.
  - 최신 Discourse 버전 대응 가능성이 가장 높다.
  - 특히 인증 모델, write 안전장치, profile 구조는 적극 참고할 가치가 있다.

### 7.4 `jvanvinkenroye/discourse-cli`

- 링크: [jvanvinkenroye/discourse-cli](https://github.com/jvanvinkenroye/discourse-cli)
- 성격: Python 기반 CLI
- 상태:
  - 생성일: 2026-02-15
  - GitHub API 기준 `pushed_at`: 2026-02-15
  - README 기준 범위:
    - `users list`
    - `users get`
    - `admin suspend`
    - `api GET /site.json`
- 평가:
  - 최근에 만들어진 점은 좋다.
  - 하지만 범용 full-coverage CLI라기보다는 admin task용 초기 버전에 가깝다.
  - 스타, 포크, 릴리스, 호환성 검증 근거가 거의 없어 기반 채택 대상보다는 벤치마크 수준이다.

### 7.5 `oblakeerickson/discourse_cli`

- 링크: [oblakeerickson/discourse_cli](https://github.com/oblakeerickson/discourse_cli)
- 성격: 오래된 Ruby CLI
- 상태:
  - GitHub API 기준 `pushed_at`: 2021-11-24
  - README 명령 수가 제한적
- 평가:
  - 2026년 최신 Discourse 기준으로는 유지보수 신뢰도가 낮다.
  - 참고 우선순위는 낮다.

### 종합 판단

- "최신 Discourse에서도 될 가능성이 높은 범용 명령형 프로젝트"로는 공식 `discourse-mcp`가 가장 강하다.
- 하지만 이것은 MCP 서버이지 일반 shell CLI는 아니다.
- 일반 CLI 형태에서 "전 API 커버리지 + 최신 버전 추종"을 동시에 만족하는 성숙한 공개 저장소는 현재 확인 범위에서는 없다.
- 따라서 새로 만드는 가치가 충분하다.

## 8. 권장 구현 전략

### 추천안

직접 신규 구현하되, 아래 원칙을 따른다.

- 공식 OpenAPI를 단일 진실 원천으로 사용
- `oclif`로 CLI 골격 구성
- generated command + curated command + `api call` fallback 동시 제공
- `discourse-mcp`의 auth/profile/safety 아이디어 참고
- 특정 서드파티 SDK에 종속되지 않음

### 이유

- 최신 Discourse 버전 변화 추적이 가장 중요하다.
- "모든 기능" 요구는 결국 스펙 생성 체계 없이는 유지되지 않는다.
- 커뮤니티 SDK는 참고 가치가 높지만, 최신성 검증이 끊기는 순간 운영 리스크가 커진다.

## 9. 성공 기준

- 최신 stable Discourse에서 주요 read/write 명령이 정상 동작
- latest 채널에서도 generated command가 스펙 기준으로 생성 가능
- `--json` 출력만으로 자동화 스크립트 작성 가능
- 인증/권한 실패 시 오류 메시지가 명확함
- 신규 API path 추가 시 수동 코드 수정 없이 명령 반영 가능

## 10. 초기 일정 제안

1주차

- CLI 골격
- auth/profile/env 처리
- 공통 HTTP client
- `api call` 명령

2주차

- OpenAPI 파서
- generated manifest
- topics/posts/users/category 기본 명령

3주차

- write 명령
- output formatter
- pagination / retry / error normalization

4주차

- E2E 테스트
- 최신 stable / latest 검증
- 문서화 및 패키징

## 11. 결론

이 프로젝트는 TypeScript + Node.js + `oclif` 조합이 가장 적합하다.

이유는 다음 3가지다.

- 최신 Discourse 대응의 핵심인 OpenAPI 생성 흐름과 궁합이 좋다.
- 명령 수가 많은 대형 CLI 구조를 안정적으로 가져갈 수 있다.
- 공식 `discourse-mcp`와 커뮤니티 `discourse2`에서 참고할 TypeScript 자산이 있다.

단, 구현 전략은 "SDK 하나 골라 감싸기"보다 "공식 OpenAPI 직접 추종"이 맞다.

## 12. 참고 소스

- Discourse API Docs: [docs.discourse.org](https://docs.discourse.org)
- Discourse OpenAPI: [openapi.json](https://docs.discourse.org/openapi.json)
- Discourse 공식 저장소: [discourse/discourse](https://github.com/discourse/discourse)
- Discourse API 문서 저장소: [discourse/discourse_api_docs](https://github.com/discourse/discourse_api_docs)
- 공식 Ruby SDK: [discourse/discourse_api](https://github.com/discourse/discourse_api)
- 공식 MCP 서버: [discourse/discourse-mcp](https://github.com/discourse/discourse-mcp)
- 커뮤니티 TypeScript SDK: [gadicc/discourse2](https://github.com/gadicc/discourse2)
- 커뮤니티 Python CLI: [jvanvinkenroye/discourse-cli](https://github.com/jvanvinkenroye/discourse-cli)
- 구형 Ruby CLI: [oblakeerickson/discourse_cli](https://github.com/oblakeerickson/discourse_cli)
- User API key 생성 가이드 예시: [Discourse MCP Setup in OpenCode CLI](https://meta.discourse.org/t/discourse-mcp-setup-in-opencode-cli/398378)
