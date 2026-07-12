import { Layout, LayoutContent, ResultSection } from "@essesion/shared";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const description = isRouteErrorResponse(error)
    ? `요청을 처리하지 못했습니다. (${error.status})`
    : "예상하지 못한 오류가 발생했습니다.";

  return (
    <Layout bg="bg.layer-basement">
      <LayoutContent as="main" density="low" py="x12">
        <ResultSection
          title="관리자 화면을 열 수 없습니다"
          description={description}
          primaryActionProps={{
            children: "대시보드로 이동",
            onClick: () => navigate("/"),
          }}
          secondaryActionProps={{
            children: "새로고침",
            onClick: () => window.location.reload(),
          }}
        />
      </LayoutContent>
    </Layout>
  );
}
