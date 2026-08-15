# Production 운영 점검 정리 (2026-08-15)

완료된 운영자 체크를 실제 production과 기존 배포 기록으로 다시 확인하고 체크리스트에서 제거했다.

| 항목 | 결과 |
|---|---|
| OpenTofu | `plan` no-change |
| GCP runtime | Cloud Run 3서비스 Ready, migrate job Ready, Cloud SQL 17 PITR, GCS 2버킷, finalize queue 확인 |
| Secret Manager·GitHub | 시크릿 컨테이너 15개 모두 enabled version 보유, `VITE_*` 5개와 Cloudflare secret 확인 |
| Readiness | 공개 API 200, generate/finalize worker 200 `database=ready`, run.app 직통 403 |
| Batch | Scheduler 5종 enabled, 주기 작업의 API 로그 200 |
| Cloudflare | root·app·admin 200, www→root 301, admin 보안 헤더 확인 |
| Admin dashboard | 전체 capability가 `ready`·`real`·`oidc`임을 화면에서 확인 |
| GCP alert | `api uptime failure` 복구 알림 메일 수신 확인 |
| 초기 데이터·migration | [production bootstrap](./production-bootstrap-2026-08-15.md)의 Alembic head, motif 97/97, embedding 97/97, authoring example 25/25, 갤러리 6건 기록 재확인 |
| Admin 콘텐츠 | concrete-paint motif 표본과 첫 진입 디자인 예시 큐레이션을 화면에서 확인(사용자 확인) |
| Renovate | GitHub App의 Renovate Only·Scan and Alert 설치 완료(사용자 확인) |
| `production.tfvars` | Google Drive 백업 완료(사용자 확인) |
| Authoring eval | compile·retrieval 30/30 통과. family recall 0.667의 추가 유료 재실행은 생략 |
