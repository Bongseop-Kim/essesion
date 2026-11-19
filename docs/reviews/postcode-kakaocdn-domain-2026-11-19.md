# 우편번호 스크립트 t1.kakaocdn.net 이전 — 실행 기록 (2026-11-19)

플랜 `docs/plans/postcode-kakaocdn-domain.md`(삭제)를 실행했다. `t1.daumcdn.net` 제공이 2026-11-30에 끝나기
전에 스토어 주소 검색의 스크립트 도메인과 CSP를 `t1.kakaocdn.net`으로 옮겼다.

## 한 일

- `apps/store/src/features/shipping/model/use-daum-postcode.ts` — 스크립트 URL의 호스트만 바꿨다.
- `apps/store/public/_headers` — `script-src`의 `t1.daumcdn.net`을 `t1.kakaocdn.net`으로 바꿨다. `img-src`는
  `*.daumcdn.net`과 `postcode.map.daum.net`을 지우고 `t1.kakaocdn.net`을 넣었다.
- 레포에 `daumcdn`·`postcode.map.daum.net` 참조가 남지 않았다(`docs/reviews` 제외).

## 검증

- `pnpm lint`, 스토어 typecheck·test 통과.
- 로컬 스토어의 배송지 등록 폼에서 확인했다. 스크립트가 `t1.kakaocdn.net`에서 로드되고, 팝업에 종료 안내
  공지가 없고, 주소를 고르면 우편번호(13529)와 주소 칸이 채워진다.

## 남은 확인

- **CSP는 확인하지 못했다.** 로컬 dev 서버는 `_headers`를 적용하지 않는다. 배포 뒤 프로덕션 스토어에서 주소
  검색을 열어 콘솔에 `Refused to load`가 없는지 보고, `curl -sI https://essesion.com/ | grep -i content-security`로
  `t1.kakaocdn.net`이 들어갔는지 본다. 깨지면 원인은 대개 CSP 누락이다.
- 2026-11-30이 지나면 옛 도메인이 사라져 revert로는 되돌릴 수 없다. 그 뒤에는 앞으로 고친다.
