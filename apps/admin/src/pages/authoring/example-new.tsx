import {
  createAuthoringExampleMutation,
  listAuthoringExamplesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  HStack,
  snackbar,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { useAdminSession } from "../../shared/session/admin-session";
import { RouteHeading } from "../../shared/ui/route-heading";
import { AuthoringExampleForm } from "./example-studio";

export function FewShotExampleNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canEdit =
    state.status === "authenticated" && state.session.role === "admin";
  const mutation = useMutation({
    ...createAuthoringExampleMutation(),
    onSuccess: async (value) => {
      snackbar("새 few-shot 시범을 비활성 상태로 저장했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAuthoringExamplesQueryKey(),
      });
      navigate(`/few-shot-examples/${value.id}`, { replace: true });
    },
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="새 시범 작성"
          description="intent와 Plan v3를 작성하고 실제 타일을 확인한 뒤 비활성 시범으로 저장합니다."
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate("/few-shot-examples")}
        >
          목록으로
        </ActionButton>
      </HStack>

      {canEdit ? (
        <AuthoringExampleForm
          submitLabel="비활성 시범 저장"
          submitting={mutation.isPending}
          submitError={mutation.isError ? mutation.error : undefined}
          onSubmit={(value) =>
            mutation.mutate({
              body: {
                retrieval_text: value.retrievalText,
                plan: value.plan,
                motif_ids: value.motifIds,
              },
            })
          }
        />
      ) : (
        <ContentPlaceholder
          title="시범 작성 권한이 없습니다"
          description="관리자 역할만 새 few-shot 시범을 작성할 수 있습니다."
          action={
            <ActionButton onClick={() => navigate("/few-shot-examples")}>
              목록으로 돌아가기
            </ActionButton>
          }
        />
      )}
    </VStack>
  );
}
