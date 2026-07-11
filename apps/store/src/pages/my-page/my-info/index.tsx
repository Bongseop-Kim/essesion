import {
  getMeOptions,
  getMeQueryKey,
  updateProfileMutation,
} from "@essesion/api-client/query";
import { zProfileUpdateRequest } from "@essesion/api-client/zod";
import {
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  HStack,
  List,
  ListItem,
  Skeleton,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { z } from "zod";

import { PhoneVerifyModal } from "@/features/my-page";
import { useZodForm } from "@/shared/lib/form";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

const profileSchema = zProfileUpdateRequest.extend({
  name: z.string().trim().min(1, "이름을 입력해 주세요."),
  birth: z
    .union([z.literal(""), z.iso.date(), z.null()])
    .optional()
    .transform((value) => value || null),
});

export function MyInfoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const meQuery = useQuery(getMeOptions());
  const updateProfile = useMutation(updateProfileMutation());
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const form = useZodForm(profileSchema, {
    defaultValues: { name: "", birth: null },
  });

  useEffect(() => {
    if (meQuery.data) {
      form.reset({
        name: meQuery.data.name,
        birth: meQuery.data.birth,
      });
    }
  }, [form, meQuery.data]);

  const save = form.handleSubmit(async (values) => {
    try {
      const me = await updateProfile.mutateAsync({
        body: { name: values.name, birth: values.birth || null },
      });
      useSession.getState().setUser(me);
      await queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
      form.reset({ name: me.name, birth: me.birth });
      snackbar("내 정보를 저장했습니다.");
    } catch {
      snackbar("내 정보를 저장하지 못했습니다.");
    }
  });

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "내 정보" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x1">
          <Text as="h1" textStyle="title1">
            내 정보
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            계정의 기본 정보와 인증된 연락처를 관리하세요.
          </Text>
        </VStack>

        {meQuery.isPending ? (
          <VStack gap="x4" alignItems="stretch">
            <Skeleton width="100%" height={64} />
            <Skeleton width="100%" height={64} />
            <Skeleton width="100%" height={96} />
            <Skeleton width="100%" height={64} />
          </VStack>
        ) : meQuery.isError || !meQuery.data ? (
          <ContentPlaceholder
            title="내 정보를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => void meQuery.refetch()}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : (
          <>
            <form onSubmit={save}>
              <VStack gap="x4" alignItems="stretch">
                <TextField
                  label="이름"
                  autoComplete="name"
                  errorMessage={form.formState.errors.name?.message}
                  {...form.register("name")}
                />
                <TextField
                  type="date"
                  label="생년월일"
                  errorMessage={form.formState.errors.birth?.message}
                  {...form.register("birth")}
                />
                <Box>
                  <HStack justify="space-between" gap="x4" align="flex-start">
                    <VStack gap="x1">
                      <HStack gap="x2" wrap>
                        <Text textStyle="label">휴대폰</Text>
                        <Badge
                          tone={
                            meQuery.data.phone_verified ? "positive" : "neutral"
                          }
                        >
                          {meQuery.data.phone_verified ? "인증 완료" : "미인증"}
                        </Badge>
                      </HStack>
                      <Text textStyle="body" color="fg.neutral-muted">
                        {meQuery.data.phone ?? "등록된 휴대폰 번호가 없습니다."}
                      </Text>
                    </VStack>
                    <ActionButton
                      type="button"
                      size="small"
                      variant="neutralOutline"
                      onClick={() => setPhoneModalOpen(true)}
                    >
                      {meQuery.data.phone ? "변경" : "인증"}
                    </ActionButton>
                  </HStack>
                </Box>
                <TextField
                  label="이메일"
                  value={meQuery.data.email ?? ""}
                  readOnly
                  description="소셜 계정에서 제공된 이메일로, 여기서는 변경할 수 없습니다."
                />
                <Box
                  as={ActionButton}
                  type="submit"
                  width="full"
                  loading={updateProfile.isPending}
                >
                  저장
                </Box>
              </VStack>
            </form>
            <Divider />
            <List>
              <ListItem
                title={
                  <Text as="span" textStyle="body" color="fg.critical">
                    회원 탈퇴
                  </Text>
                }
                description="계정과 개인정보 삭제 절차를 확인합니다."
                onClick={() => navigate("/my-page/my-info/leave")}
              />
            </List>
          </>
        )}
      </VStack>

      <PhoneVerifyModal
        open={phoneModalOpen}
        currentPhone={meQuery.data?.phone}
        onOpenChange={setPhoneModalOpen}
      />
    </ContentLayout>
  );
}
