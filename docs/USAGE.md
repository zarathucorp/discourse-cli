# Usage

## 개요

현재 `discourse-cli`는 Discourse 공식 OpenAPI 문서를 기준으로 문서화된 API를 범용적으로 호출하는 CLI다.

핵심 명령:

- `spec sync`
- `api list`
- `api describe`
- `api run`
- `api call`
- `attachment download`

이 프로젝트는 아직 모든 기능을 사람이 읽기 쉬운 전용 서브커맨드로 나누지는 않았다.
대신 OpenAPI `operationId` 기반 실행과 raw path 호출로 넓은 범위를 커버한다.

## 설치

```bash
git clone https://github.com/zarathucorp/discourse-cli.git
cd discourse-cli
npm install
npm run build
npm link
discourse-cli --help
```

기본 사용은 글로벌 CLI다. 고정된 글로벌 설치가 더 맞는 환경이면 아래를 사용한다.

```bash
npm install -g /path/to/discourse-cli
discourse-cli --help
```

글로벌 명령을 만들 수 없는 환경에서만 문서의 `discourse-cli` 예시를 `node dist/cli.js`로 바꿔서 실행하면 된다.

## 인증

### Admin API

환경변수:

```bash
export DISCOURSE_BASE_URL=https://community.dev.zarathu.com
export DISCOURSE_API_KEY=your_api_key
export DISCOURSE_API_USERNAME=your_api_username
```

직접 옵션:

```bash
--base-url https://community.dev.zarathu.com
--api-key your_api_key
--api-username jwheo
```

### User API

필요한 경우 아래도 지원한다.

```bash
export DISCOURSE_USER_API_KEY=your_user_api_key
export DISCOURSE_USER_API_CLIENT_ID=your_client_id
```

## 명령 구조

```bash
discourse-cli spec sync
discourse-cli api list
discourse-cli api describe <operationId>
discourse-cli api run <operationId> [request options]
discourse-cli api call <METHOD> <path> [request options]
discourse-cli attachment download <url> [--output <path>]
```

## 공통 옵션

- `--base-url <url>`
- `--api-key <key>`
- `--api-username <username>`
- `--user-api-key <key>`
- `--user-api-client-id <id>`
- `--path key=value`
- `--query key=value`
- `--header key=value`
- `--body key=value`
- `--body-json <json>`
- `--form key=value`
- `--file field=/absolute/path/to/file`
- `--output <path>`

## OpenAPI 동기화

공식 OpenAPI 문서를 로컬 캐시에 저장한다.

```bash
discourse-cli spec sync
```

기본 캐시 위치:

```bash
.cache/discourse-openapi.json
```

다른 파일로 저장:

```bash
discourse-cli spec sync --spec-file /tmp/discourse-openapi.json
```

## API 목록 조회

전체 operation 목록:

```bash
discourse-cli api list
```

검색:

```bash
discourse-cli api list --search upload
```

메서드 필터:

```bash
discourse-cli api list --method GET
```

태그 필터:

```bash
discourse-cli api list --tag uploads
```

## API 설명 보기

예:

```bash
discourse-cli api describe createUpload
```

출력에는 아래 정보가 포함된다.

- `operationId`
- HTTP method
- path
- summary
- tags
- path/query/header 파라미터
- request body content type

## OpenAPI operation 실행

가장 중요한 명령이다. 문서화된 API를 `operationId` 기준으로 직접 실행한다.

### 카테고리 토픽 조회

```bash
discourse-cli api run listCategoryTopics \
  --path slug=asha-test \
  --path id=18
```

### 사용자 조회

```bash
discourse-cli api run getUser \
  --path username=jwheo
```

### 검색

```bash
discourse-cli api run search \
  --query q=test
```

### 파일 업로드

```bash
discourse-cli api run createUpload \
  --form type=composer \
  --form synchronous=true \
  --file file=/absolute/path/to/file.txt
```

## Raw API 호출

OpenAPI operationId를 몰라도 path를 알면 직접 호출할 수 있다.

### GET 호출

```bash
discourse-cli api call GET /categories.json
```

### POST 호출

```bash
discourse-cli api call POST /posts.json \
  --body topic_id=261 \
  --body raw='CLI write path test reply'
```

### JSON body 사용

```bash
node dist/cli.js api call POST /posts.json \
  --body-json '{"topic_id":261,"raw":"hello from json"}'
```

### 커스텀 헤더 추가

```bash
node dist/cli.js api call GET /site.json \
  --header Accept=application/json
```

## 첨부 다운로드

보호된 첨부파일은 인증 헤더가 필요할 수 있다.

```bash
node dist/cli.js attachment download \
  'https://community.dev.zarathu.com/uploads/short-url/ttYGeNlNYo8nIfWgNbxCJ5KrScJ.xlsx' \
  --output /tmp/download.xlsx
```

출력:

- 저장된 파일의 절대 경로

## 출력 규칙

- JSON 응답은 pretty print
- 텍스트 응답은 그대로 출력
- 바이너리 응답은 `--output`이 없으면 실패
- `attachment download`는 기본적으로 응답 헤더 또는 URL 기반 파일명으로 저장

## 현재 확인된 범위

안전한 읽기 점검 기준으로 실제 호출 확인:

- `getSite`
- `getSiteBasicInfo`
- `listCategories`
- `getCategory`
- `listCategoryTopics`
- `listLatestTopics`
- `listTopTopics`
- `listPosts`
- `getPost`
- `postReplies`
- `search`
- `listGroups`
- `getGroup`
- `listGroupMembers`
- `listTags`
- `getTag`
- `listTagGroups`
- `getTagGroup`
- `adminListUsers`
- `adminGetUser`
- `adminListUsersFlag`
- `getUser`
- `getUserEmails`
- `listUserActions`
- `listUsersPublic`
- `getNotifications`
- `getBackups`
- `attachment download`

주의:

- 사이트 설정이나 플러그인 상태에 따라 OpenAPI 문서에 있어도 실제 route가 `404`일 수 있다.
- 예: 일부 event/group/badge 관련 읽기 API는 현재 테스트 사이트에서 `404`가 발생했다.

## 한계

- 아직 사람 친화적인 전용 명령 세트는 없다.
- 문서화되지 않은 내부 API는 자동 커버 대상이 아니다.
- 위험한 쓰기 작업에 대한 별도 안전장치는 아직 없다.
- multipart, direct upload, plugin endpoint는 사이트 설정에 따라 실제 동작이 달라질 수 있다.

## 권장 사용 순서

1. `spec sync`
2. `api list --search <term>`
3. `api describe <operationId>`
4. `api run <operationId>`
5. 필요한 경우 `api call <METHOD> <path>`

## 관련 문서

- [Quickstart](QUICKSTART.md)
- [Project Plan](PROJECT_PLAN.md)
