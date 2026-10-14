import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  ContentPlaceholder,
  Grid,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  DESIGN_PHOTO_ACCEPT,
  DESIGN_SVG_ACCEPT,
  readDesignMotifSvg,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import { previewPhotoMotif } from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { designSessionQueryOptions } from "@/features/design/model/queries";
import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import { useFinalizeFlow } from "@/features/design/model/use-design-output";
import { usePlaceLogo } from "@/features/design/model/use-steps";
import {
  sessionLayout,
  TemplateDetailShots,
} from "@/features/design/ui/template-shots";
import { colorPath } from "@/pages/design/color";
import { resultPath } from "@/pages/design/result";
import {
  designExamplesQueryOptions,
  tokenBalanceQueryOptions,
} from "@/shared/lib/live-queries";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function logoPath(sessionId: string) {
  return `/design/sessions/${sessionId}/logo`;
}

const CRUMBS = [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: "로고 올리기" },
];

type Logo = {
  id: string;
  name: string;
  /** 원본 미리보기(objectURL) — 화면에는 항상 올린 그대로를 보여준다 */
  sourceUrl: string;
  /** 서버가 정리한 SVG — 통과 표시. 없으면 확인 중이거나 미통과 */
  svg: string | null;
};

/**
 * 로고 올리기 — 사진이면 배경을 지우고 벡터로 바꾸고, SVG면 그대로 쓴다. 썸네일은 올린 원본을
 * 그대로 두고 통과/미통과만 알린다(정리본으로 바꿔 보이면 잘못 올라간 것처럼 보인다).
 * "생성"은 로고를 템플릿 슬롯에 넣고(무료) 바로 실사화(토큰)까지 돌려 결과 화면으로 간다.
 */
export function DesignLogoPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const authenticated = useSession((state) => state.status === "authenticated");
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId: id, authenticated }),
  );
  const balanceQuery = useQuery(tokenBalanceQueryOptions(authenticated));
  const place = usePlaceLogo();
  const finalize = useFinalizeFlow({
    sessionId: id,
    onDone: (job) => navigate(resultPath(id), { state: { job } }),
  });
  const examplesQuery = useQuery(designExamplesQueryOptions());
  const [logo, setLogo] = useState<Logo | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const session = sessionQuery.data;
  const svg = session?.preview_svg ?? null;
  const busy = preparing || placing || finalize.loading;
  const cost = balanceQuery.data?.finalize_cost ?? null;

  const addFile = async (file: File) => {
    const sourceUrl = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, "") || "로고";
    setLogo({ id: sourceUrl, name, sourceUrl, svg: null });
    setError(null);
    setPreparing(true);
    try {
      const isSvg =
        file.type === "image/svg+xml" ||
        file.name.toLocaleLowerCase().endsWith(".svg");
      const nextSvg = isSvg
        ? await readDesignMotifSvg(file)
        : (await previewPhotoMotif({ uploadId: await uploadDesignPhoto(file) }))
            .svg;
      setLogo((current) =>
        current?.id === sourceUrl ? { ...current, svg: nextSvg } : current,
      );
    } catch (cause) {
      setError(
        `미통과 · ${designErrorMessage(cause, "로고를 읽지 못했습니다.")}`,
      );
    } finally {
      setPreparing(false);
    }
  };

  const generate = async () => {
    if (!session || !logo?.svg || busy) return;
    setPlacing(true);
    try {
      await place.mutateAsync({
        sessionId: session.id,
        name: logo.name,
        svg: logo.svg,
      });
    } catch (cause) {
      snackbar(designErrorMessage(cause, "로고를 넣지 못했습니다."));
      setPlacing(false);
      return;
    }
    setPlacing(false);
    finalize.submit({ productionMethod: "print", weave: "twill-45", dpi: 300 });
  };

  if (sessionQuery.isPending) {
    return (
      <ContentLayout
        breadcrumbs={CRUMBS}
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

  if (!session || !svg) {
    return (
      <ContentLayout breadcrumbs={CRUMBS}>
        <ContentPlaceholder
          title="디자인을 불러오지 못했어요"
          description="템플릿을 다시 골라 주세요."
          action={
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={() => navigate("/design")}
            >
              템플릿 목록으로
            </ActionButton>
          }
        />
      </ContentLayout>
    );
  }

  return (
    <>
      <title>로고 올리기 | 영선산업</title>
      <meta name="robots" content="noindex, nofollow" />
      <ContentLayout
        breadcrumbs={CRUMBS}
        sidebarFirst
        sidebar={
          <VStack alignItems="stretch" gap="x5">
            <VStack alignItems="start" gap="x1">
              <Text textStyle="caption" color="fg.neutral-muted">
                2 / 2 단계
              </Text>
              <Text as="h1" textStyle="title1">
                로고 올리기
              </Text>
              <Text textStyle="body" color="fg.neutral-muted">
                배경이 없는 로고 파일 하나를 올려 주세요. 생성을 누르면 무늬
                자리에 넣고 실사 이미지 2장을 만들어요
                {cost !== null ? ` · ${cost}토큰` : ""}.
              </Text>
            </VStack>
            <AttachmentDisplayField
              label="로고 파일"
              description="투명 배경(PNG·SVG)이나 한 가지 색 배경만 돼요. 사진·그라데이션 배경은 미통과예요."
              errorMessage={error}
              items={
                logo
                  ? [{ id: logo.id, alt: logo.name, src: logo.sourceUrl }]
                  : []
              }
              max={1}
              accept={`${DESIGN_PHOTO_ACCEPT},${DESIGN_SVG_ACCEPT}`}
              addLabel="로고 선택"
              onAddFiles={(files) => files[0] && void addFile(files[0])}
              onRemove={() => {
                setLogo(null);
                setError(null);
              }}
            />
            {preparing ? (
              <Text
                textStyle="caption"
                color="fg.neutral-muted"
                aria-live="polite"
              >
                배경을 확인하고 있어요 · 10초쯤 걸려요
              </Text>
            ) : logo?.svg ? (
              <Text textStyle="caption" color="fg.positive" aria-live="polite">
                통과 · 배경 없는 로고로 확인했어요
              </Text>
            ) : null}
          </VStack>
        }
        actionBar={
          <Grid templateColumns="minmax(0, 1fr) minmax(0, 2fr)" gap="x2">
            <ActionButton
              variant="neutralOutline"
              size="large"
              onClick={() => navigate(colorPath(id))}
            >
              이전
            </ActionButton>
            <ActionButton
              variant="brandSolid"
              size="large"
              loading={placing || finalize.loading}
              disabled={!logo?.svg || busy}
              onClick={() => void generate()}
            >
              생성
            </ActionButton>
          </Grid>
        }
      >
        <TemplateDetailShots
          shot={{
            imageSrc: svgToDataUri(svg),
            alt: "현재 디자인 미리보기",
            tileScale: svgTileScale(svg),
            surface: "none",
          }}
          layout={sessionLayout(
            session,
            examplesQuery.data?.find((t) => t.id === session.example_id),
          )}
        />
      </ContentLayout>
    </>
  );
}
