import {
  createAdminDesignExampleMutation,
  listAdminDesignExamplesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  HStack,
  snackbar,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { NumberField } from "../../shared/ui/number-field";
import { RouteHeading } from "../../shared/ui/route-heading";

export function DesignExampleNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState("");
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [ordinal, setOrdinal] = useState("");
  const create = useMutation({
    ...createAdminDesignExampleMutation(),
    onSuccess: async () => {
      snackbar("예시를 등록했습니다. 게시하면 첫 진입 갤러리에 노출됩니다.");
      await queryClient.invalidateQueries({
        queryKey: listAdminDesignExamplesQueryKey(),
      });
      navigate("/design-examples", { replace: true });
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "예시를 등록하지 못했습니다.")),
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="디자인 예시 등록"
          description="Seamless 로그의 run을 store 첫 진입 갤러리 예시로 등록합니다."
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate("/design-examples")}
        >
          목록으로
        </ActionButton>
      </HStack>

      <AdminCard
        title="등록 정보"
        description="사용자가 올린 모티프를 쓰는 run은 등록할 수 없습니다."
      >
        <VStack
          as="form"
          gap="x4"
          alignItems="stretch"
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            create.mutate({
              body: {
                run_id: runId.trim(),
                name: name.trim(),
                caption: caption.trim() || null,
                ordinal: Number(ordinal || 0),
              },
            });
          }}
        >
          <HStack gap="x3" align="flex-start" wrap>
            <Box flex={1} minWidth={280}>
              <TextField
                label="run ID"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={runId}
                onChange={(event) => setRunId(event.target.value)}
                required
              />
            </Box>
            <Box flex={1} minWidth={200}>
              <TextField
                label="갤러리 이름"
                placeholder="미드나잇 웨이브"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </Box>
            <Box flex={1} minWidth={200}>
              <TextField
                label="카드 설명"
                description="카드 라벨 둘째 줄. 비우면 이름만 나옵니다."
                placeholder="네이비 · 대각 스트라이프"
                maxLength={60}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
              />
            </Box>
            <Box width={140}>
              <NumberField
                label="노출 순서"
                value={ordinal}
                onValueChange={setOrdinal}
              />
            </Box>
          </HStack>
          <Box>
            <ActionButton type="submit" loading={create.isPending}>
              비게시로 등록
            </ActionButton>
          </Box>
        </VStack>
      </AdminCard>
    </VStack>
  );
}
