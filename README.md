# discourse-cli

Discourse OpenAPI 기반 범용 CLI다.

## 현재 범위

- OpenAPI 동기화 및 캐시
- API operation 목록 조회
- `operationId` 기반 실행
- raw API 호출
- 마크다운 파일 기반 포스트 생성
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

## 문서

- [GitHub Pages](https://zarathucorp.github.io/discourse-cli/)
- [Quickstart](docs/QUICKSTART.md)
- [Usage](docs/USAGE.md)
- [Project Plan](docs/PROJECT_PLAN.md)

## 참고

- 현재는 사람이 읽기 쉬운 전용 명령보다 범용 API 실행에 초점이 있다.
- 일부 첨부파일은 포스트가 보여도 인증 없이는 다운로드되지 않을 수 있다.
- `posts create --raw-file`는 마크다운 안의 로컬 파일 링크를 업로드하고 웹 Composer와 같은 `upload://...` syntax로 치환한다.
- `posts update --post-id --raw-file`는 기존 포스트 수정에도 같은 치환 규칙을 적용한다.
