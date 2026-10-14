import { useQuery } from "@tanstack/react-query";

import { TemplatePicker } from "@/features/design/ui/template-picker";
import { designExamplesQueryOptions } from "@/shared/lib/live-queries";

/** `/design` 첫 화면 — 템플릿 고르기. 공개 조회라 비로그인에도 뜨고, 세션을 자동으로 열지 않는다. */
export function DesignTemplatesPage() {
  const examplesQuery = useQuery(designExamplesQueryOptions());
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
      />
    </>
  );
}
