import type { GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  ContentPlaceholder,
  Grid,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router";

import { latestFinalizedJobQueryOptions } from "@/features/design/model/queries";
import { colorPath } from "@/pages/design/color";
import { logoPath } from "@/pages/design/logo";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function resultPath(sessionId: string) {
  return `/design/sessions/${sessionId}/result`;
}

const CRUMBS = [
  { label: "홈", href: "/" },
  { label: "디자인", href: "/design" },
  { label: "결과" },
];

function jobFromState(state: unknown): GenerationJobOut | null {
  if (!state || typeof state !== "object" || !("job" in state)) return null;
  const job = (state as { job: unknown }).job;
  return job && typeof job === "object" && "id" in job
    ? (job as GenerationJobOut)
    : null;
}

/**
 * 결과 — 실사 이미지 두 장(넥타이·원단)과 다음 할 일 넷. 방금 만든 완성본은 라우트
 * state로 받고, 새로고침이면 이 세션의 최신 완성본 한 건을 서버에서 찾는다.
 */
export function DesignResultPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const authenticated = useSession((state) => state.status === "authenticated");
  const fromState = jobFromState(location.state);
  const jobsQuery = useQuery(
    latestFinalizedJobQueryOptions({
      sessionId: id,
      authenticated: authenticated && fromState === null,
    }),
  );
  const job = fromState ?? jobsQuery.data?.[0] ?? null;

  if (!job && jobsQuery.isPending && fromState === null) {
    return (
      <ContentLayout breadcrumbs={CRUMBS}>
        <Grid columns={{ base: 1, md: 2 }} gap="x3" aria-busy>
          <Skeleton width="full" radius="r4" style={{ aspectRatio: "4 / 5" }} />
          <Skeleton width="full" radius="r4" style={{ aspectRatio: "4 / 5" }} />
        </Grid>
      </ContentLayout>
    );
  }

  if (!job) {
    return (
      <ContentLayout breadcrumbs={CRUMBS}>
        <ContentPlaceholder
          title="아직 만든 결과가 없어요"
          description="로고를 올리고 생성을 누르면 여기서 볼 수 있어요."
          action={
            <ActionButton
              variant="neutralWeak"
              size="small"
              onClick={() => navigate(logoPath(id))}
            >
              로고 올리기
            </ActionButton>
          }
        />
      </ContentLayout>
    );
  }

  return (
    <>
      <title>디자인 결과 | 영선산업</title>
      <meta name="robots" content="noindex, nofollow" />
      <ContentLayout
        breadcrumbs={CRUMBS}
        sidebar={
          <VStack alignItems="stretch" gap="x5">
            <VStack alignItems="start" gap="x1">
              <Text as="h1" textStyle="title1">
                이렇게 만들어져요
              </Text>
              <Text textStyle="body" color="fg.neutral-muted">
                마음에 들면 주문으로, 아니면 템플릿·색·로고 중 하나만 다시
                고르세요.
              </Text>
              <Text textStyle="caption" color="fg.neutral-muted">
                화면 색과 원단 색은 다를 수 있어요.
              </Text>
            </VStack>
            <VStack alignItems="stretch" gap="x2">
              <ActionButton
                variant="neutralWeak"
                onClick={() => navigate("/design")}
              >
                템플릿 다시 고르기
              </ActionButton>
              <ActionButton
                variant="neutralWeak"
                onClick={() => navigate(colorPath(id))}
              >
                색 다시 고르기
              </ActionButton>
              <ActionButton
                variant="neutralWeak"
                onClick={() => navigate(logoPath(id))}
              >
                로고 다시 올리기
              </ActionButton>
            </VStack>
          </VStack>
        }
        actionBar={
          <ActionButton
            variant="brandSolid"
            size="large"
            className="w-full"
            onClick={() =>
              navigate("/custom-order", { state: { designJobs: [job] } })
            }
          >
            이 디자인으로 주문하기
          </ActionButton>
        }
      >
        <Grid columns={{ base: 1, md: 2 }} gap="x3">
          <ImageFrame
            ratio={4 / 5}
            src={job.tie_url ?? job.result_url ?? undefined}
            alt="넥타이 실사 이미지"
            borderRadius="r4"
            fit="cover"
          />
          <ImageFrame
            ratio={4 / 5}
            src={job.fabric_url ?? undefined}
            alt="원단 실사 이미지"
            borderRadius="r4"
            fit="cover"
          />
        </Grid>
      </ContentLayout>
    </>
  );
}
