# db — 스키마 단일 소유처 (essesion-db)

SQLAlchemy 모델(`src/db/models/`)이 스키마의 source of truth, 변경은 Alembic 리비전 경유만 — DDL 직접 실행 금지 (AGENTS.md 대원칙). 기존 스키마와의 대응은 [MAPPING.md](./MAPPING.md).

## 명령어 (레포 루트 기준)

```bash
docker compose up -d                                              # 로컬 Postgres(pgvector)
uv run alembic -c db/alembic.ini upgrade head                     # 적용
uv run alembic -c db/alembic.ini check                            # 모델↔리비전 드리프트 검사
uv run alembic -c db/alembic.ini revision --autogenerate -m "..." # 새 리비전 (생성 후 반드시 검수)
uv run pytest tests/                                              # 마이그레이션 검증(testcontainers)
```

접속 URL은 `DATABASE_URL` env(기본 = compose 값).

아직 배포 전이므로 과거 revision이나 개발 데이터는 변환하지 않는다. 이전 스키마가 남아 있으면 해당 DB를 사용하는 프로세스를 중지하고 `essesion` 데이터베이스를 drop/recreate한 뒤 `upgrade head`와 로컬 seed를 실행한다. 실행 중인 DB를 자동으로 삭제하는 스크립트는 두지 않는다.

## 규칙

- **모델 변경 → 같은 커밋에 리비전 생성.** `tests/test_migrations.py`의 `alembic check`가 드리프트를 CI에서 잡는다.
- **CheckConstraint는 반드시 name 지정** — naming_convention이 `ck_<table>_<name>`으로 렌더링하며, 무명이면 autogenerate가 실패한다.
- **PG enum은 user_role 하나로 봉인.** ① 후속 리비전에서 같은 enum 참조 시 `postgresql.ENUM(..., name="user_role", create_type=False)`, ② 값 추가는 autogenerate가 감지 못함 — 수동 `op.execute("ALTER TYPE user_role ADD VALUE ...")`, ③ 새 enum 추가 금지(text+CHECK 사용).
- **DB 트리거·함수·뷰 금지** — 로직은 api로 (MAPPING.md §2). updated_at은 SQLAlchemy onupdate(raw SQL UPDATE는 갱신 안 됨을 전제).
- **db/ 밑에 pytest 테스트 두지 말 것** — pytest importlib 모드가 더미 부모 모듈 `db`를 만들어 실제 패키지를 가린다. 테스트는 루트 `tests/`에.
- pgvector는 베이스라인 리비전이 `CREATE EXTENSION`으로 활성화한다(로컬 compose·Cloud SQL 모두 지원). motif와 authoring 검색 임베딩은 Vertex AI 3072차원만 사용한다.

## 3단계(api)에서 쓸 것

`db.testing.migrated_postgres()` — pgvector 컨테이너 + upgrade head 완료된 asyncpg URL을 주는 컨텍스트 매니저. 인가 403 테스트(mock 금지)의 기반.
