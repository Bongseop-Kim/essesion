import { getMe } from "@essesion/api-client";
import { loginMutation } from "@essesion/api-client/query";
import { zLoginRequest } from "@essesion/api-client/zod";
import {
  ActionButton,
  Box,
  Callout,
  Divider,
  Flex,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { AUTH_PROVIDERS, type AuthProviderId } from "@/features/auth";
import {
  saveAuthReturnIfEmpty,
  takeAuthReturn,
} from "@/features/auth/model/return-after-login";
import { syncGuestCartToAccount } from "@/features/cart";
import { API_BASE_URL } from "@/shared/config/env";
import { useZodForm } from "@/shared/lib/form";
import { useSession } from "@/shared/store/session";

// 이스터에그: 제목을 5번 누르면 id/pw(테스트·운영 점검용) 로그인이 나타난다.
// 고객은 소셜 로그인만 쓰고 공개 회원가입도 없으므로 평소엔 숨겨둔다.
const STAFF_REVEAL_CLICKS = 5;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const status = useSession((s) => s.status);
  const [titleClicks, setTitleClicks] = useState(0);
  const staffLoginVisible = titleClicks >= STAFF_REVEAL_CLICKS;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useZodForm(zLoginRequest);

  const login = useMutation({
    ...loginMutation(),
    onSuccess: async (data) => {
      useSession.getState().setAccessToken(data.access_token);
      try {
        const me = await getMe();
        if (!me.data) {
          useSession.getState().clear();
          return;
        }
        useSession.getState().setUser(me.data);
        const fallback = (location.state as { from?: unknown } | null)?.from;
        const destination = takeAuthReturn() ?? {
          path: typeof fallback === "string" ? fallback : "/",
        };
        try {
          await syncGuestCartToAccount(queryClient);
          navigate(destination.path, {
            replace: true,
            state: destination.state,
          });
        } catch {
          navigate("/cart", { replace: true });
        }
      } catch {
        useSession.getState().clear();
      }
    },
  });

  // 이미 로그인 상태면 홈으로.
  if (status === "authenticated") return <Navigate to="/" replace />;

  const startOAuth = (provider: AuthProviderId) => {
    const fallback = (location.state as { from?: unknown } | null)?.from;
    saveAuthReturnIfEmpty({
      path: typeof fallback === "string" ? fallback : "/",
    });
    // OAuth는 SDK가 아니라 전체 페이지 이동 — api가 콜백에서 refresh 쿠키를 심는다.
    window.location.href = `${API_BASE_URL}/auth/${provider}/login`;
  };

  return (
    <Flex
      className="login-page-content"
      justify="center"
      align="center"
      flexGrow={1}
      px={{ base: "x4", md: "x8" }}
      py="x10"
    >
      <VStack gap="x6" width="full" maxWidth={400}>
        <VStack gap="x4" align="center">
          <Box
            width={72}
            height={72}
            display="flex"
            alignItems="center"
            justifyContent="center"
            aria-hidden
          >
            <LazyMotion features={domAnimation} strict>
              <m.span
                style={{ display: "inline-flex" }}
                initial={
                  reducedMotion
                    ? false
                    : { opacity: 0, scale: 0.7, y: 8, rotate: -12 }
                }
                animate={
                  reducedMotion
                    ? undefined
                    : {
                        opacity: 1,
                        scale: 1,
                        y: 0,
                        rotate: [-12, 16, -8, 12, -4, 0],
                      }
                }
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <Text textStyle="display1" className="login-emoji">
                  👋
                </Text>
              </m.span>
            </LazyMotion>
          </Box>
          <VStack gap="x2" align="center">
            <Text
              as="h1"
              textStyle="title1"
              className="select-none"
              onClick={() => setTitleClicks((n) => n + 1)}
            >
              로그인
            </Text>
            <Text
              as="p"
              textStyle="bodySm"
              color="fg.neutral-muted"
              align="center"
            >
              로그인하고 모든 서비스를 이용해 보세요.
            </Text>
          </VStack>
        </VStack>

        <VStack gap="x3">
          {AUTH_PROVIDERS.map((p) => (
            <ActionButton
              key={p.id}
              variant={p.variant}
              size="large"
              onClick={() => startOAuth(p.id)}
            >
              <img src={p.logoSrc} width={18} height={18} alt="" />
              {p.label}
            </ActionButton>
          ))}
        </VStack>

        {staffLoginVisible && (
          <>
            <Divider />
            {login.isError && (
              <Callout
                tone="critical"
                title="로그인 실패"
                description="이메일 또는 비밀번호를 확인해 주세요."
              />
            )}
            <form
              onSubmit={handleSubmit((values) =>
                login.mutate({ body: values }),
              )}
            >
              <VStack gap="x4">
                <TextField
                  label="이메일"
                  type="email"
                  autoComplete="email"
                  errorMessage={errors.email?.message}
                  {...register("email")}
                />
                <TextField
                  label="비밀번호"
                  type="password"
                  autoComplete="current-password"
                  errorMessage={errors.password?.message}
                  {...register("password")}
                />
                <ActionButton
                  type="submit"
                  size="large"
                  loading={login.isPending}
                >
                  로그인
                </ActionButton>
              </VStack>
            </form>
          </>
        )}
      </VStack>
    </Flex>
  );
}
