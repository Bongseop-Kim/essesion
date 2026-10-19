import { snackbar } from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import { designErrorMessage } from "@/features/design/model/errors";
import { useStartDesignFromExample } from "@/features/design/model/use-example-start";
import { TemplatePicker } from "@/features/design/ui/template-picker";
import { customizePath } from "@/pages/design/customize";
import { designExamplesQueryOptions } from "@/shared/lib/live-queries";

/**
 * `/design` 첫 화면 — 템플릿 고르기. 공개 조회라 비로그인에도 뜨고, 세션을 자동으로 열지 않는다.
 * 템플릿을 누를 때만 세션이 생기고(무료), 바로 색 선택으로 간다. 비로그인으로 눌렀으면
 * 로그인 뒤 이 화면으로 돌아오면서(`state.startTemplate`) 그 템플릿으로 이어서 시작한다.
 */
export function DesignTemplatesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requireAuth } = useAuthGuard();
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const startExample = useStartDesignFromExample();

  const start = async (exampleId: string) => {
    if (
      startExample.isPending ||
      !requireAuth({ path: "/design", state: { startTemplate: exampleId } })
    ) {
      return;
    }
    try {
      const started = await startExample.mutateAsync(exampleId);
      navigate(customizePath(started.id));
    } catch (error) {
      snackbar(designErrorMessage(error, "템플릿을 불러오지 못했습니다."));
    }
  };

  // 로그인 복귀 — state를 먼저 지워 뒤로 가기·StrictMode 재실행에 세션이 또 생기지 않게 한다.
  const resumed = useRef(false);
  const resumeId = (location.state as { startTemplate?: unknown } | null)
    ?.startTemplate;
  useEffect(() => {
    if (typeof resumeId !== "string" || resumed.current) return;
    resumed.current = true;
    navigate(location.pathname, { replace: true, state: null });
    void start(resumeId);
  });

  return (
    <>
      <title>디자인 템플릿 | 영선산업</title>
      <meta
        name="description"
        content="템플릿을 고르고 색과 로고를 넣어 나만의 넥타이를 만드세요."
      />
      <TemplatePicker
        templates={examplesQuery.data}
        loading={examplesQuery.isPending}
        failed={examplesQuery.isError}
        onRetry={() => void examplesQuery.refetch()}
        onSelect={(template) => void start(template.id)}
        startingId={startExample.isPending ? startExample.variables : undefined}
      />
    </>
  );
}
