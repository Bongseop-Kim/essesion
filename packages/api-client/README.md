# @essesion/api-client

**`src/`와 `openapi.json`은 전부 생성물** — 손으로 편집 금지. api의 OpenAPI 스펙에서 Hey API(@hey-api/openapi-ts) + TanStack Query + zod 플러그인으로 생성 (ARCHITECTURE §3).

api 스펙(라우터·스키마) 변경 시:

```bash
pnpm codegen   # 레포 루트 — openapi.json 추출 + src/ 재생성
```

재생성 결과를 **같은 커밋에 포함**할 것 — CI `codegen-drift` 잡이 재생성 diff가 남으면 실패한다. `@hey-api/openapi-ts`는 정확 핀(버전 갱신 = 생성물 diff이므로 Renovate PR에서 재생성해 함께 커밋).
