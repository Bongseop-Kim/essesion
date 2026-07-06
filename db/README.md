# db — Alembic (스키마 단일 소유처)

스키마 변경은 여기 Alembic 리비전 경유만 — DDL 직접 실행 금지 (AGENTS.md 대원칙).

2단계(스키마 재설계)에서 기존 스키마 검토 → 새 스키마 설계 → **기존→새 매핑 표** 작성 후, 재설계된 새 스키마의 첫 리비전을 베이스라인으로 생성한다. pgvector는 첫 리비전에서 `CREATE EXTENSION IF NOT EXISTS vector`로 활성화(로컬 compose·Cloud SQL 모두 지원).
