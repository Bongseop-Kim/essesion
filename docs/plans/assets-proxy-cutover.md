# assets 프록시 개통 — `PUBLIC_ASSETS_ORIGIN` 켜기

**전제**: `docs/reviews/perf-cost-reduction-2026-08-19.md` 7번의 남은 절반이다. 코드(워커·api
설정·CSP·deploy)는 이미 있고 **main 머지 → CI 성공 → 배포 완료 이후에만** 실행한다.
2026-08-19 기준 `https://assets.essesion.shop`은 아직 응답하지 않는다 — 워커와 custom domain이
배포되지 않은 상태다.

순서 정본은 `infra/README.md`, 요약은 `infra/cloudflare/README.md`.

## 왜 필요한가

`infra/cloudflare/assets-proxy`는 GCS 공개 버킷 앞에 Cloudflare 캐시를 두어 egress·Class B
요청·DATA_READ 감사 로그를 줄인다(객체 키가 content-hash라 1년 immutable 캐시가 안전).

그런데 **api는 `PUBLIC_ASSETS_ORIGIN`이 설정돼야 프록시 URL을 발급한다.** 미설정이면
`public_asset_url`이 종전대로 `storage.googleapis.com` 직통을 반환한다(동작 보존이 의도였다).
즉 지금은 "프록시를 만들어놓고 아무도 안 쓰는" 상태이고, 이 플랜이 그 스위치를 켠다.

## 범위 밖 (non-goals)

- **DB에 이미 저장된 직통 URL 마이그레이션.** 상품 이미지는 저장 시점 URL이 영속되는데, 버킷
  공개 읽기가 유지되므로 깨지지 않는다. 캐시 혜택은 해당 상품을 재저장하면 자연히 따라온다.
- **3차 변경 apply**(cloudrun 인스턴스·풀 축소, Artifact Registry cleanup policy,
  cancel-stale-orders 30분) — 별건이다. 다만 아직 apply되지 않았다면 절차 4의 plan에 함께 뜬다.
- assets-proxy 워커 자체의 설정 변경. `BUCKET`은 `wrangler.jsonc`의 고정 리터럴이다.

## 실행 조건 — 순서를 어기면 서비스가 깨진다

1. main 머지 → CI 성공 → `deploy.yml`이 assets-proxy 워커와 custom domain을 만든 뒤.
2. **`assets.essesion.shop`이 200을 주기 전에는 절대 tfvars를 켜지 않는다.** 순서를 어기면
   api가 죽은 호스트로 이미지 URL을 발급한다 — 새로 저장되는 모든 이미지가 깨진다.
3. plan 직전 **tfvars 정본을 버킷에서 내려받는다.** 컴퓨터가 여러 대라 로컬 사본은 정본이
   아니고, 낡은 tfvars로 apply하면 라이브 설정이 조용히 되돌아간다(`infra/README.md`).

## 절차

### 1. tfvars 정본 내려받기

```
gsutil cp gs://essesion-tfstate/production.tfvars infra/production.tfvars
```

`infra/production.tfvars`는 gitignore 대상이라 저장소에 없다. 정본은 상태 버킷에 있다.

### 2. 프록시가 살아났는지 확인 — 200이어야 한다

```
curl -sI "https://assets.essesion.shop/$(curl -s https://api.essesion.shop/products?limit=1 | jq -r '.[0].image' | sed 's|.*ysindustry-assets/||')" | head -5
```

`products` 응답의 `image`는 `https://storage.googleapis.com/ysindustry-assets/products/…` 형태라
`ysindustry-assets/` 뒤 경로만 떼어 프록시 호스트에 붙이는 것이다(2026-08-19 실측 확인).

번거로우면 admin에서 상품 이미지 URL을 하나 복사해 `storage.googleapis.com/ysindustry-assets`
부분만 `assets.essesion.shop`으로 바꿔 브라우저로 열어도 된다.

**200 + `cf-cache-status` 헤더**가 나와야 다음으로 간다. 아니면 여기서 멈추고 워커 배포부터 본다.

### 3. tfvars에서 주석 해제

`infra/production.tfvars:29` — `api_extra_env` 블록(22행) 안의 다음 줄에서 `#`을 뗀다.

```
PUBLIC_ASSETS_ORIGIN = "https://assets.essesion.shop"
```

### 4. plan — api env 1건만 떠야 한다

```
tofu -chdir=infra plan -var-file=production.tfvars
```

**api Cloud Run 서비스의 환경변수 1건 외에 다른 변경이 뜨면 멈추고 원인을 본다.** 단,
위 non-goals의 3차 변경이 아직 apply되지 않았다면 그 묶음(cloudrun 인스턴스·풀, Artifact
Registry cleanup, scheduler 30분)이 함께 뜨는 것은 정상이다.

### 5. apply

```
tofu -chdir=infra apply -var-file=production.tfvars
```

### 6. tfvars를 버킷에 올린다 — 빠뜨리면 다음 apply가 되돌린다

```
gsutil cp infra/production.tfvars gs://essesion-tfstate/production.tfvars
```

## 검증

- **새로 발급되는 URL**: 상품을 하나 재저장하거나 새 생성물을 만든 뒤, 반환된 이미지 URL이
  `https://assets.essesion.shop/…`인지 확인.
- **캐시 적중**: 같은 URL을 두 번 요청해 `cf-cache-status`가 `MISS` → `HIT`으로 바뀌는지.
- **비용 신호**: 며칠 뒤 GCS DATA_READ 로그 볼륨과 Class B 요청 수가 줄었는지
  (`docs/reviews/gcp-cost-reduction-2026-08-17.md`의 관측 방법 참조).
- 기존 상품 이미지(직통 URL)가 여전히 열리는지 — 버킷 공개 읽기가 유지되므로 열려야 정상이다.

## 되돌리는 법

절차 3의 줄을 다시 주석 처리 → `apply` → **절차 6을 다시 수행**(버킷 업로드). api가 직통 URL
발급으로 복귀한다. 되돌려도 이미 DB에 저장된 프록시 URL은 워커가 살아 있는 한 계속 동작한다.

**상향 신호**: `cf-cache-status`가 계속 `MISS`면 캐시가 안 먹는 것이다. 쿼리 스트링이 붙어
캐시 키가 분열되는 경우가 대표적인데, 워커가 쿼리를 버리도록 되어 있으니 그렇다면 워커 쪽을 본다.

## 실패 모드

**절차 6(버킷 업로드) 누락이 이 플랜의 실패 모드다.** apply는 성공했는데 정본이 갱신되지 않아,
다음 사람이 낡은 tfvars로 apply하면 방금 켠 설정이 조용히 꺼진다. 로그도 경고도 남지 않는다.

그 다음은 절차 2를 건너뛰고 켜는 것 — 죽은 호스트로 URL이 발급되고, 그렇게 저장된 URL은
프록시를 나중에 살려도 이미 DB에 박혀 있다.
