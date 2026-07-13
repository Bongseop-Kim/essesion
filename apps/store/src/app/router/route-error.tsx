import { Layout, LayoutContent, ResultSection, Text } from "@essesion/shared";
import { useEffect } from "react";
import { useNavigate, useRouteError } from "react-router";

import { routeErrorDescription } from "@/app/router/error-description";
import { captureRouteError } from "@/shared/lib/observability";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  useEffect(() => {
    captureRouteError(error);
  }, [error]);

  return (
    <Layout>
      <LayoutContent as="main" density="low" py="x12">
        <title>화면을 열 수 없습니다 | ESSE SION</title>
        <meta name="robots" content="noindex" />
        <Text as="h1" textStyle="title1" className="sr-only">
          화면을 열 수 없습니다
        </Text>
        <ResultSection
          title="화면을 열 수 없습니다"
          description={routeErrorDescription(error)}
          primaryActionProps={{
            children: "다시 시도",
            onClick: () => window.location.reload(),
          }}
          secondaryActionProps={{
            children: "홈으로 이동",
            onClick: () => navigate("/"),
          }}
        />
      </LayoutContent>
    </Layout>
  );
}
