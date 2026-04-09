# Quickstart

## 개요

`discourse-cli`는 현재 Discourse OpenAPI 기반 범용 CLI다.
지금은 사람이 읽기 쉬운 전용 서브커맨드보다 `operationId` 실행과 raw API 호출에 초점이 있다.

지원 실행 방식:

- 로컬 실행: `node dist/cli.js ...`
- 글로벌 링크: `npm link`
- 글로벌 설치: `npm install -g <local-path>`

주의:

- 현재 패키지는 `private: true`라서 npm registry publish 용도는 아니다.
- 로컬 경로나 git source로 설치해서 사용하는 방식은 가능하다.

## 요구사항

### macOS

- Node.js 25+
- npm

권장 확인:

```bash
node -v
npm -v
```

### Linux

- Node.js 25+
- npm

배포판 기본 Node가 오래된 경우 NodeSource, `nvm`, `fnm` 중 하나로 최신 버전을 맞추는 편이 안전하다.

## 설치

### macOS

```bash
cd /path/to/discourse-cli
npm install
npm run build
```

### Linux

```bash
cd /path/to/discourse-cli
npm install
npm run build
```

## 글로벌 사용

### 방법 1: npm link

개발 중에는 이 방식이 가장 단순하다.

#### macOS

```bash
cd /path/to/discourse-cli
npm install
npm run build
npm link
discourse-cli --help
```

#### Linux

```bash
cd /path/to/discourse-cli
npm install
npm run build
npm link
discourse-cli --help
```

### 방법 2: 로컬 경로를 글로벌 설치

빌드 결과가 있는 상태에서 설치한다.

#### macOS

```bash
cd /path/to/discourse-cli
npm install
npm run build
npm install -g /path/to/discourse-cli
discourse-cli --help
```

#### Linux

```bash
cd /path/to/discourse-cli
npm install
npm run build
npm install -g /path/to/discourse-cli
discourse-cli --help
```

## 인증 설정

### Admin API

#### macOS / Linux

```bash
export DISCOURSE_BASE_URL=https://community.dev.zarathu.com
export DISCOURSE_API_KEY=your_api_key
export DISCOURSE_API_USERNAME=your_api_username
```

### User API

필요하면 아래도 지원한다.

```bash
export DISCOURSE_USER_API_KEY=your_user_api_key
export DISCOURSE_USER_API_CLIENT_ID=your_client_id
```

## 첫 실행

### 1. OpenAPI 동기화

```bash
discourse-cli spec sync
```

### 2. API 검색

```bash
discourse-cli api list --search topic
```

### 3. API 설명 확인

```bash
discourse-cli api describe listCategoryTopics
```

### 4. 실제 호출

```bash
discourse-cli api run listCategoryTopics \
  --path slug=asha-test \
  --path id=18
```

## 자주 쓰는 예제

### 사용자 조회

```bash
discourse-cli api run getUser \
  --path username=jwheo
```

### 검색

```bash
discourse-cli api run search \
  --query q=asha
```

### 토픽 조회

```bash
discourse-cli api call GET /t/261.json
```

### 댓글 작성

```bash
discourse-cli api call POST /posts.json \
  --body topic_id=261 \
  --body raw='hello from discourse-cli'
```

### 댓글 수정

```bash
discourse-cli api call PUT /posts/392.json \
  --body-json '{"post":{"raw":"edited from discourse-cli"}}'
```

### 파일 업로드

```bash
discourse-cli api run createUpload \
  --form type=composer \
  --file 'files[]=/absolute/path/to/file.txt'
```

### 첨부 다운로드

```bash
discourse-cli attachment download \
  'https://community.dev.zarathu.com/uploads/short-url/example.txt' \
  --output /tmp/example.txt
```

## 문제 해결

### `discourse-cli: command not found`

- `npm link` 또는 `npm install -g`가 성공했는지 확인
- `npm bin -g` 경로가 `PATH`에 잡혀 있는지 확인
- 설치 전에 `npm run build`를 했는지 확인

### `fetch failed`

- `DISCOURSE_BASE_URL`, `DISCOURSE_API_KEY`, `DISCOURSE_API_USERNAME` 값 확인
- 보호된 첨부파일이면 인증 헤더가 필요한지 확인
- `upload://...` 값은 다운로드 URL이 아니므로 `url` 또는 `short_path`를 사용

### `404 Not Found`

- 해당 사이트에서 route가 비활성화되었거나 플러그인이 빠졌을 수 있음
- OpenAPI 문서에 있어도 실제 사이트에서 없을 수 있음

## 다음 문서

- [Usage](USAGE.md)
- [Project Plan](PROJECT_PLAN.md)
