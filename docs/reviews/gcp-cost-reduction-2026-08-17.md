# GCP 고정비 절감 실행 기록 (2026-08-17)

비용 조사(청구 export 부재로 리소스·메트릭 역추적) 결과 고정비의 대부분이 Cloud SQL
`db-g1-small`(월 ~₩50k)이었다. 월 활성 유저 100명 미만·DB 수십 MB 규모에 과스펙으로 판단,
아래를 실행했다. 예상 고정비 월 ~₩50k → ~₩20k.

## 실행한 것

1. **Cloud SQL tier `db-g1-small` → `db-f1-micro`** — `production.tfvars`에 `db_tier` 추가,
   in-place update로 apply(재시작 수 분). HA는 원래 ZONAL이라 변화 없음. 디스크(SSD 10GB)·
   자동 백업·PITR은 유지(ARCHITECTURE §5, 비용 미미).
2. **컨테이너 취약점 자동 스캔 비활성화** (푸시당 $0.26) — `infra/main.tf`의
   `google_project_service.apis` 목록에서 `containerscanning.googleapis.com` 제거 + apply.
   `disable_on_destroy = false`라 API가 켜진 채 남아 `gcloud services disable`로 직접 껐다.

같은 apply에 audit.tf의 서비스 계정 키 알림 필터 개선분(레포에 있었으나 미적용 드리프트)이
함께 반영됐다.

## 검증

- `gcloud sql instances describe essesion-pg` → `db-f1-micro RUNNABLE`
- `https://api.essesion.shop/readyz` → 200, `database: ready` / `/products` → 200 (DB 조회 경로)
- `containerscanning` enabled 목록에서 제거 확인
- 참고: 배포 리비전에는 `/healthz` 라우트가 아직 없어(로컬 코드에만 존재) 검증은 `/readyz`로 했다.

## 되돌리는 법 / 상향 신호

`db_tier`를 `db-g1-small`로 되돌려 apply(동일하게 재시작 수 분). 상향 신호: 생성 요청 p95
지연 악화, api 로그의 connection 에러(f1-micro `max_connections≈25`, api pool 5/인스턴스).
스캔 재활성화는 main.tf 목록 복원 후 apply.

## 남긴 과제

- 청구 BigQuery export 활성화(콘솔, 무료) — 다음 비용 분석부터 SKU 단위 조회 가능.
- 티어 다운그레이드는 8월 청구서에 일할 반영되므로 9월 청구서에서 효과 확인.
