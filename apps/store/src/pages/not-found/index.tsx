import { LayoutContent, ResultSection, Text } from "@essesion/shared";
import { useNavigate } from "react-router";

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <LayoutContent density="low" py="x12">
      <title>페이지를 찾을 수 없습니다 | ESSE SION</title>
      <meta name="robots" content="noindex" />
      <Text as="h1" textStyle="title1" className="sr-only">
        페이지를 찾을 수 없습니다
      </Text>
      <ResultSection
        title="페이지를 찾을 수 없습니다"
        description="주소가 잘못되었거나 페이지가 이동되었습니다."
        primaryActionProps={{
          children: "홈으로 이동",
          onClick: () => navigate("/"),
        }}
        secondaryActionProps={{
          children: "스토어 보기",
          onClick: () => navigate("/shop"),
        }}
      />
    </LayoutContent>
  );
}
