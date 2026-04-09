# discourse-cli

Discourse OpenAPI 기반 범용 CLI다.

## 현재 범위

- OpenAPI 동기화 및 캐시
- API operation 목록 조회
- `operationId` 기반 실행
- raw API 호출
- 인증된 첨부 다운로드

## 요구사항

- Node.js 25+
- npm

## 빠른 시작

```bash
npm install
npm run build
node dist/cli.js --help
```

글로벌로도 사용할 수 있다.

```bash
npm link
discourse-cli --help
```

## 문서

- [GitHub Pages](https://zarathucorp.github.io/discourse-cli/)
- [Quickstart](docs/QUICKSTART.md)
- [Usage](docs/USAGE.md)
- [Project Plan](docs/PROJECT_PLAN.md)

## 참고

- 현재는 사람이 읽기 쉬운 전용 명령보다 범용 API 실행에 초점이 있다.
- 일부 첨부파일은 포스트가 보여도 인증 없이는 다운로드되지 않을 수 있다.
