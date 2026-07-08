# 모션

전환 시간(duration)·이징(ease) 체계와 애니메이션 규칙. 값은 [design-token-reference.md](./design-token-reference.md).

## duration

| 토큰 | 값 | 용도 |
|---|---|---|
| `--duration-fast` | 100ms | 마이크로 인터랙션(hover·pressed 색 전환) |
| `--duration-normal` | 200ms | 일반 전환 |
| `--duration-slow` | 300ms | 매크로(모달·시트 등장·퇴장) |

- duration은 `:root` 일반 변수라 Tailwind 유틸리티가 없다. `var(--duration-fast)`로 소비한다.

## ease

| 토큰 | 값 | 성격 |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.35, 0, 0.35, 1)` | 대칭 — 상태 전환·일반 |
| `--ease-enter` | `cubic-bezier(0, 0, 0.15, 1)` | 감속 — 등장(들어옴) |
| `--ease-exit` | `cubic-bezier(0.35, 0, 1, 1)` | 가속 — 퇴장(나감) |

- 매크로(>200ms)는 `enter`/`exit`를 **비대칭**으로 쓴다(등장은 감속, 퇴장은 가속). 마이크로는 `standard`.

## 사용

- CSS 변수로: `transition: background-color var(--duration-fast) var(--ease-standard)`.
- Tailwind 컴포넌트는 `transition-colors`(Button 패턴) + 위 변수 조합.
- motion 라이브러리 사용 시 동일 베지어 배열을 넘긴다: standard `[0.35, 0, 0.35, 1]`, enter `[0, 0, 0.15, 1]`, exit `[0.35, 0, 1, 1]`.

## 규칙

- **`transform`·`opacity`만 애니메이트한다.** `width`/`height`/`top`/`margin` 등 레이아웃 속성 애니메이션 금지(리플로우·저성능).
- `prefers-reduced-motion: reduce`를 존중 — 전환을 없애거나 최소화한다. → [inclusive-design.md](./inclusive-design.md)
- 임의 duration·베지어 금지. 위 토큰만 사용.
