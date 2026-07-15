import {
  ActionButton,
  Box,
  Callout,
  Layout,
  LayoutContent,
  TextField,
  VStack,
} from "@essesion/shared";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router";

import { useAdminSession } from "../shared/session/admin-session";
import { RouteHeading } from "../shared/ui/route-heading";

type LoginLocationState = {
  from?: string;
};

function safeReturnPath(state: unknown) {
  const from = (state as LoginLocationState | null)?.from;
  return typeof from === "string" &&
    from.startsWith("/") &&
    !from.startsWith("//")
    ? from
    : "/";
}

export function LoginPage() {
  const location = useLocation();
  const { state, login, retryBootstrap } = useAdminSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>();

  if (state.status === "authenticated") {
    return (
      <Navigate to={safeReturnPath(location.state)} replace /> // harness-ignore -- 인증 완료 뒤 원래 관리자 경로로 복귀
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(undefined);
    try {
      await login({ email, password });
    } catch {
      setErrorMessage("관리자 계정 정보를 확인해 주세요.");
    }
  };

  return (
    <Layout bg="bg.layer-basement">
      <LayoutContent
        as="main"
        density="low"
        display="flex"
        alignItems="center"
        py="x8"
      >
        <Box
          width="full"
          bg="bg.layer-default"
          borderRadius="r3"
          boxShadow="s1"
          p={{ base: "x5", md: "x8" }}
        >
          <VStack gap="x6">
            <RouteHeading
              title="관리자 로그인"
              description="승인된 ESSE SION 운영 계정으로 로그인해 주세요."
            />

            {state.status === "unavailable" ? (
              <Callout
                tone="informative"
                title="관리자 인증 API 연결 대기"
                description="관리자 인증 서비스를 사용할 수 없어 접근을 허용하지 않습니다."
              />
            ) : state.status === "error" ? (
              <Callout
                tone="critical"
                title="세션을 확인하지 못했습니다"
                description="잠시 후 다시 시도해 주세요."
                onClick={retryBootstrap}
              />
            ) : (
              <Box as="form" onSubmit={handleSubmit}>
                <VStack gap="x4">
                  {errorMessage !== undefined && (
                    <Callout
                      role="alert"
                      tone="critical"
                      title="로그인할 수 없습니다"
                      description={errorMessage}
                    />
                  )}
                  <TextField
                    type="email"
                    name="email"
                    autoComplete="username"
                    label="이메일"
                    value={email}
                    required
                    disabled={state.status === "loading"}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                  />
                  <TextField
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    label="비밀번호"
                    value={password}
                    required
                    disabled={state.status === "loading"}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                  />
                  <ActionButton
                    type="submit"
                    size="large"
                    loading={state.status === "loading"}
                  >
                    로그인
                  </ActionButton>
                </VStack>
              </Box>
            )}
          </VStack>
        </Box>
      </LayoutContent>
    </Layout>
  );
}
