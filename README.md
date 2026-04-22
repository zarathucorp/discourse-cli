# discourse-cli

<h1 align="center"><font color="red">절대 PUBLIC으로 전환하지 말 것, 필요시 새로운 리포지토리 생성</font></h1>

Discourse OpenAPI 기반 범용 CLI다.

## 현재 범위

- OpenAPI 동기화 및 캐시
- API operation 목록 조회
- `operationId` 기반 실행
- raw API 호출
- 마크다운 파일 기반 포스트 생성 및 수정
- 사용자별 게시글/대화 export
- 인증된 첨부 다운로드

## 요구사항

- Node.js 25+
- npm

## 빠른 시작

```bash
git clone https://github.com/zarathucorp/discourse-cli.git
cd discourse-cli
npm install
npm run build
npm link
discourse-cli --help
```

기본 사용 방식은 글로벌 CLI로 `discourse-cli`를 실행하는 것이다.

고정된 글로벌 설치가 더 맞는 환경이면 아래처럼 설치할 수 있다.

```bash
npm install -g /absolute/path/to/discourse-cli
discourse-cli --help
```

글로벌 명령을 만들 수 없는 환경이면 저장소 안에서 직접 실행한다.

```bash
node dist/cli.js --help
```

인증은 환경변수로 주는 방식을 권장한다.

```bash
export DISCOURSE_BASE_URL=https://community.dev.zarathu.com
export DISCOURSE_API_KEY=your_api_key
export DISCOURSE_API_USERNAME=your_api_username
```

첫 점검은 읽기 전용 호출부터 시작하는 편이 안전하다.

```bash
discourse-cli spec sync
discourse-cli api run getUser --path username=jwheo
```

자주 쓰는 워크플로우는 아래 두 가지다.

```bash
discourse-cli posts create --title 'hello' --category 4 --raw-file ./post.md
discourse-cli conversations export --user hyeonekim --output-dir ./exports/conversations
```

## 문서

- [GitHub Pages](https://zarathucorp.github.io/discourse-cli/)
- [Quickstart](docs/QUICKSTART.md)
- [Usage](docs/USAGE.md)
- [Project Plan](docs/PROJECT_PLAN.md)

## 사용자 게시글/대화 Export

특정 사용자가 글을 남긴 topic을 topic별 폴더로 export할 수 있다.
공개 게시판의 작성글과 답글, 개인 메시지 inbox/sent를 함께 모아 `conversation.json`, `transcript.md`, `attachments/` 형태로 저장한다.

관리자 권한이 있는 API key를 권장한다.

```bash
export DISCOURSE_BASE_URL=https://community.zarathu.com
export DISCOURSE_API_KEY=your_admin_api_key
export DISCOURSE_API_USERNAME=your_admin_username
```

username으로 실행:

```bash
discourse-cli conversations export \
  --user hyeonekim \
  --output-dir ./exports/conversations
```

숫자 id로 실행:

```bash
discourse-cli conversations export \
  --user-id 1142 \
  --output-dir ./exports/conversations
```

첨부 없이 빠르게 확인:

```bash
discourse-cli conversations export \
  --user hyeonekim \
  --output-dir ./exports/conversations \
  --skip-attachments
```

- `--user <username>`: username으로 대상 지정
- `--user-id <id|username>`: 숫자 id 또는 username으로 대상 지정
- `--output-dir <path>`: 저장 루트 지정. 기본값 `exports/conversations`
- `--page-size <count>`: 목록 조회 페이지 크기 조정. 기본값 `40`
- `--skip-attachments`: 첨부 다운로드 생략


## 마크다운 파일로 포스트 작성

긴 글은 먼저 로컬 마크다운 파일로 작성한 뒤 올리는 편이 안전하다.

예시 `post.md`:

```md
# 긴 글 테스트

본문입니다.

![diagram](./images/diagram.png)

[report](./files/report.xlsx)
```

새 토픽 생성:

```bash
discourse-cli posts create \
  --title '긴 글 테스트' \
  --category 4 \
  --raw-file ./post.md
```

기존 포스트 수정:

```bash
discourse-cli posts update \
  --post-id 395 \
  --raw-file ./post.md \
  --edit-reason 'revise markdown draft'
```

`--raw-file`를 쓰면 로컬 이미지와 첨부 링크를 먼저 업로드한 뒤, Discourse 웹 Composer와 같은 `upload://...` syntax로 치환해서 전송한다.

## 참고

- 현재는 사람이 읽기 쉬운 전용 명령보다 범용 API 실행에 초점이 있다.
- 일부 첨부파일은 포스트가 보여도 인증 없이는 다운로드되지 않을 수 있다.
- `posts create --raw-file`는 마크다운 안의 로컬 파일 링크를 업로드하고 웹 Composer와 같은 `upload://...` syntax로 치환한다.
- `posts update --post-id --raw-file`는 기존 포스트 수정에도 같은 치환 규칙을 적용한다.
