import type { ActionButtonProps } from "@essesion/shared";

/** api가 지원하는 소셜 프로바이더 (auth 라우터의 OAuthProvider Literal과 일치).
 *  로고는 public 에셋(브랜드색 보존, 하네스 미스캔), 버튼색은 브랜드 토큰 variant. */
export type AuthProviderId = "kakao" | "naver" | "google" | "apple";

export const AUTH_PROVIDERS: {
  id: AuthProviderId;
  label: string;
  logoSrc: string;
  variant: ActionButtonProps["variant"];
}[] = [
  {
    id: "kakao",
    label: "카카오로 계속하기",
    logoSrc: "/icons/kakao.svg",
    variant: "kakao",
  },
  {
    id: "naver",
    label: "네이버로 계속하기",
    logoSrc: "/icons/naver.svg",
    variant: "naver",
  },
  {
    id: "google",
    label: "Google로 계속하기",
    logoSrc: "/icons/google.svg",
    variant: "neutralOutline",
  },
  {
    id: "apple",
    label: "Apple로 계속하기",
    logoSrc: "/icons/apple.svg",
    variant: "apple",
  },
];
