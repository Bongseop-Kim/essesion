import type { ActionButtonProps } from "@essesion/shared";

/** api가 지원하는 소셜 프로바이더 (auth 라우터의 Literal["google","kakao"]와 일치).
 *  로고는 public 에셋(브랜드색 보존, 하네스 미스캔), 버튼색은 브랜드 토큰 variant.
 *  네이버는 토큰·variant·로고가 준비돼 있으나 api OAuth 지원 후 여기에 추가한다. */
export type AuthProviderId = "google" | "kakao";

export const AUTH_PROVIDERS: {
  id: AuthProviderId;
  label: string;
  logoSrc: string;
  variant: ActionButtonProps["variant"];
}[] = [
  {
    id: "google",
    label: "Google로 계속하기",
    logoSrc: "/icons/google.svg",
    variant: "neutralOutline",
  },
  {
    id: "kakao",
    label: "카카오로 계속하기",
    logoSrc: "/icons/kakao.svg",
    variant: "kakao",
  },
];
