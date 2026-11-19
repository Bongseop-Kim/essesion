import { Skeleton, VStack } from "@essesion/shared";

import { AdminCard } from "./admin-card";
import { RouteHeading } from "./route-heading";

/** 상세·설정 화면 초기 로딩 — 제목은 그대로 두고(문서 제목·h1 포커스) 섹션 모양만 미리 그린다. */
export function PageSkeleton({
  title,
  sections,
}: {
  title: string;
  /** 카드 제목 — 데이터에서 오는 제목이라 미리 모르면 null */
  sections: readonly (string | null)[];
}) {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading title={title} />
      {sections.map((section, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 고정 길이 자리표시자
        <AdminCard key={index} title={section ?? undefined}>
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="60%" height={20} />
            <Skeleton width="100%" height={20} />
            <Skeleton width="80%" height={20} />
          </VStack>
        </AdminCard>
      ))}
    </VStack>
  );
}
