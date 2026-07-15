import { ResultSection } from "@essesion/shared";
import { useNavigate } from "react-router";

import { RouteHeading } from "../shared/ui/route-heading";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <>
      <RouteHeading title="페이지를 찾을 수 없습니다" />
      <ResultSection
        size="medium"
        title="요청한 관리자 페이지가 없습니다"
        description="주소를 확인하거나 대시보드로 돌아가 주세요."
        primaryActionProps={{
          children: "대시보드로 이동",
          onClick: () => navigate("/"),
        }}
      />
    </>
  );
}
