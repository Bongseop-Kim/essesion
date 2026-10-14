import {
  ActionButton,
  Box,
  ContentPlaceholder,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import { designErrorMessage } from "@/features/design/model/errors";
import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import { useStartDesignFromExample } from "@/features/design/model/use-example-start";
import { templatePath } from "@/features/design/ui/template-picker";
import {
  svgColors,
  TemplateDetailShots,
  TemplateSwatches,
  templateLayout,
} from "@/features/design/ui/template-shots";
import { colorPath } from "@/pages/design/color";
import { designExamplesQueryOptions } from "@/shared/lib/live-queries";
import { ContentLayout } from "@/shared/ui/content-layout";

const crumbs = (name?: string) => [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: name ?? "템플릿" },
];

/**
 * 템플릿 상세 — 고르기 전에 큰 화면으로 한 번 더 본다. 단건 API 없이 목록 조회(공개·캐시)에서
 * 꺼내 쓴다. 시작을 누를 때만 세션이 생기고(무료), 바로 색 선택으로 간다.
 * 실사 사진은 템플릿 데이터(`photo_*_url`)에 있으면 그 자리에 들어간다.
 */
export function DesignTemplatePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { requireAuth } = useAuthGuard();
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const startExample = useStartDesignFromExample();
  const template = examplesQuery.data?.find((t) => t.id === id);

  const start = async () => {
    if (!template || !requireAuth({ path: templatePath(id) })) return;
    try {
      const started = await startExample.mutateAsync(template.id);
      navigate(colorPath(started.id));
    } catch (error) {
      snackbar(designErrorMessage(error, "템플릿을 불러오지 못했습니다."));
    }
  };

  if (examplesQuery.isPending) {
    return (
      <ContentLayout
        breadcrumbs={crumbs()}
        sidebar={
          <VStack alignItems="stretch" gap="x3" aria-busy>
            <Skeleton preset="title" />
            <Skeleton preset="line" />
          </VStack>
        }
      >
        <Box width="full" style={{ aspectRatio: "4 / 5" }}>
          <Skeleton width="full" height="full" radius="r4" />
        </Box>
      </ContentLayout>
    );
  }

  if (!template) {
    return (
      <ContentLayout breadcrumbs={crumbs()}>
        <ContentPlaceholder
          title={
            examplesQuery.isError
              ? "템플릿을 불러오지 못했어요"
              : "템플릿을 찾을 수 없어요"
          }
          description={
            examplesQuery.isError
              ? "잠시 뒤 다시 시도해 주세요."
              : "내려갔거나 주소가 바뀐 템플릿이에요."
          }
          action={
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={() =>
                examplesQuery.isError
                  ? void examplesQuery.refetch()
                  : navigate("/design")
              }
            >
              {examplesQuery.isError ? "다시 시도" : "템플릿 목록으로"}
            </ActionButton>
          }
        />
      </ContentLayout>
    );
  }

  return (
    <>
      <title>{`${template.name} 템플릿 | 영선산업`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <ContentLayout
        breadcrumbs={crumbs(template.name)}
        sidebar={
          <VStack alignItems="start" gap="x4">
            <VStack alignItems="start" gap="x2">
              <Text as="h1" textStyle="title1">
                {template.name}
              </Text>
              {template.caption ? (
                <Text textStyle="body" color="fg.neutral-muted">
                  {template.caption}
                </Text>
              ) : null}
            </VStack>
            <TemplateSwatches colors={svgColors(template.preview_svg)} />
            <Text textStyle="caption" color="fg.neutral-muted">
              고르면 색을 바꾸고 로고를 넣을 수 있어요.
            </Text>
          </VStack>
        }
        actionBar={
          <ActionButton
            variant="brandSolid"
            size="large"
            className="w-full"
            loading={startExample.isPending}
            onClick={() => void start()}
          >
            이 템플릿으로 시작
          </ActionButton>
        }
      >
        <TemplateDetailShots
          shot={{
            imageSrc: svgToDataUri(template.preview_svg),
            alt: template.name,
            tileScale: svgTileScale(template.preview_svg),
            surface: "none",
          }}
          layout={templateLayout(template)}
        />
      </ContentLayout>
    </>
  );
}
