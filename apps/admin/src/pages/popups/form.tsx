import type { AdminPopupNoticeOut } from "@essesion/api-client";
import {
  createAdminPopupMutation,
  listAdminPopupsOptions,
  listAdminPopupsQueryKey,
  updateAdminPopupMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  ContentPlaceholder,
  Grid,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { getErrorMessage } from "../../shared/lib/format";
import { AdminCard } from "../../shared/ui/admin-card";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  draftFromPopup,
  EMPTY_DRAFT,
  MAX_OPERATION_ROWS,
  type PopupDraft,
  type PopupTemplate,
  requestFromDraft,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_LABELS,
  validateDraft,
} from "./popup-form-model";
import { discardPopupImageUpload, uploadPopupImage } from "./upload";

const TEMPLATES: readonly PopupTemplate[] = ["holiday", "operation", "event"];

type PopupFormProps = {
  initial: PopupDraft;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (draft: PopupDraft) => void;
  onCancel: () => void;
};

function PopupForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
}: PopupFormProps) {
  const [draft, setDraft] = useState<PopupDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const errors = attempted ? validateDraft(draft) : {};
  const patch = (changes: Partial<PopupDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const addImage = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setUploadError(undefined);
    setUploading(true);
    try {
      const result = await uploadPopupImage(file);
      setDraft((current) => {
        if (current.image?.staged)
          void discardPopupImageUpload(current.image.uploadId);
        return {
          ...current,
          image: {
            uploadId: result.uploadId,
            src: result.publicUrl,
            staged: true,
          },
        };
      });
    } catch (caught) {
      setUploadError(
        getErrorMessage(caught, "배너 이미지를 업로드하지 못했습니다."),
      );
    } finally {
      setUploading(false);
    }
  };
  const removeImage = () => {
    if (draft.image?.staged) void discardPopupImageUpload(draft.image.uploadId);
    patch({ image: null });
  };

  return (
    <VStack
      as="form"
      gap="x6"
      alignItems="stretch"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        setAttempted(true);
        if (Object.keys(validateDraft(draft)).length > 0) return;
        onSubmit(draft);
      }}
    >
      <AdminCard
        title="템플릿"
        description="화면 모양은 템플릿이 정합니다. 관리자는 빈칸만 채우면 됩니다."
      >
        <RadioGroup
          aria-label="템플릿"
          orientation="horizontal"
          value={draft.template}
          onValueChange={(value) => patch({ template: value as PopupTemplate })}
        >
          {TEMPLATES.map((template) => (
            <RadioGroupItem
              key={template}
              value={template}
              label={TEMPLATE_LABELS[template]}
              description={TEMPLATE_DESCRIPTIONS[template]}
            />
          ))}
        </RadioGroup>
      </AdminCard>

      <AdminCard
        title="내용"
        description="제목은 앞부분이 가늘게, 강조 제목이 굵게 이어집니다. 예: 「추석 연휴」 + 「배송 안내」."
      >
        <VStack gap="x4" alignItems="stretch">
          <Grid columns={{ base: 1, md: 2 }} gap="x3">
            <TextField
              label="제목"
              placeholder="추석 연휴"
              maxLength={60}
              required
              value={draft.title}
              errorMessage={errors.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
            <TextField
              label="강조 제목"
              description="비우면 제목만 굵게 나옵니다."
              placeholder="배송 안내"
              maxLength={60}
              value={draft.titleEmphasis}
              onChange={(event) => patch({ titleEmphasis: event.target.value })}
            />
          </Grid>
          <TextAreaField
            label="안내 문구"
            description="굵게 강조할 구절은 **로 감쌉니다. 예: 연휴 기간 **택배사 휴무**로 출고가 멈춥니다."
            rows={3}
            maxLength={500}
            value={draft.body}
            onChange={(event) => patch({ body: event.target.value })}
          />
          <TextField
            label={draft.template === "event" ? "링크" : "링크 (선택)"}
            description="/로 시작하는 스토어 경로 또는 https:// 주소. 있으면 확인 버튼이 「자세히 보기」로 바뀝니다."
            placeholder="/shop"
            maxLength={500}
            required={draft.template === "event"}
            value={draft.linkUrl}
            errorMessage={errors.linkUrl}
            onChange={(event) => patch({ linkUrl: event.target.value })}
          />
        </VStack>
      </AdminCard>

      {draft.template === "holiday" && (
        <AdminCard
          title="휴무 일정"
          description="네 날짜로 달력을 그립니다. 마감일은 검은 원, 휴무 기간은 회색 띠, 재개일은 테두리 원으로 표시됩니다."
        >
          <VStack gap="x4" alignItems="stretch">
            <Grid columns={{ base: 1, md: 2 }} gap="x3">
              <TextField
                type="date"
                label="연휴 전 출고 마감일 (KST)"
                required
                value={draft.cutoffOn}
                errorMessage={errors.cutoffOn}
                onChange={(event) => patch({ cutoffOn: event.target.value })}
              />
              <TextField
                type="time"
                label="마감 시각"
                required
                value={draft.cutoffTime}
                errorMessage={errors.cutoffTime}
                onChange={(event) => patch({ cutoffTime: event.target.value })}
              />
              <TextField
                type="date"
                label="휴무 시작일"
                required
                value={draft.closedFrom}
                errorMessage={errors.closedFrom}
                onChange={(event) => patch({ closedFrom: event.target.value })}
              />
              <TextField
                type="date"
                label="휴무 종료일"
                required
                value={draft.closedTo}
                errorMessage={errors.closedTo}
                onChange={(event) => patch({ closedTo: event.target.value })}
              />
              <TextField
                type="date"
                label="출고 재개일"
                required
                value={draft.resumeOn}
                errorMessage={errors.resumeOn}
                onChange={(event) => patch({ resumeOn: event.target.value })}
              />
            </Grid>
            <TextField
              label="하단 문구 (선택)"
              placeholder="수선·맞춤 제작 일정도 같은 기간 멈춥니다."
              maxLength={200}
              value={draft.holidayFootnote}
              onChange={(event) =>
                patch({ holidayFootnote: event.target.value })
              }
            />
          </VStack>
        </AdminCard>
      )}

      {draft.template === "operation" && (
        <AdminCard
          title="항목 표"
          description="왼쪽 라벨(20자), 오른쪽 값(80자). 최대 4행."
        >
          <VStack gap="x3" alignItems="stretch">
            {draft.rows.map((row, index) => (
              <HStack key={index} gap="x2" align="flex-start">
                <Box width={160} flexShrink={0}>
                  <TextField
                    aria-label={`${index + 1}행 라벨`}
                    placeholder="시행일"
                    maxLength={20}
                    value={row.label}
                    onChange={(event) =>
                      patch({
                        rows: draft.rows.map((item, i) =>
                          i === index
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </Box>
                <Box flex={1}>
                  <TextField
                    aria-label={`${index + 1}행 값`}
                    placeholder="2026년 10월 1일(목) 결제분부터"
                    maxLength={80}
                    value={row.value}
                    onChange={(event) =>
                      patch({
                        rows: draft.rows.map((item, i) =>
                          i === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </Box>
                <ActionButton
                  type="button"
                  variant="ghost"
                  disabled={draft.rows.length <= 1}
                  aria-label={`${index + 1}행 삭제`}
                  onClick={() =>
                    patch({ rows: draft.rows.filter((_, i) => i !== index) })
                  }
                >
                  삭제
                </ActionButton>
              </HStack>
            ))}
            {errors.rows ? (
              <Text textStyle="caption" color="fg.critical">
                {errors.rows}
              </Text>
            ) : null}
            <HStack gap="x3" justify="space-between" wrap>
              <ActionButton
                type="button"
                variant="neutralWeak"
                size="small"
                disabled={draft.rows.length >= MAX_OPERATION_ROWS}
                onClick={() =>
                  patch({ rows: [...draft.rows, { label: "", value: "" }] })
                }
              >
                행 추가
              </ActionButton>
            </HStack>
            <TextField
              label="하단 문구 (선택)"
              placeholder="제주·도서산간 추가 운임은 기존과 같습니다."
              maxLength={200}
              value={draft.operationFootnote}
              onChange={(event) =>
                patch({ operationFootnote: event.target.value })
              }
            />
          </VStack>
        </AdminCard>
      )}

      {draft.template === "event" && (
        <AdminCard
          title="배너 이미지"
          description="4:3 비율로 표시됩니다 (권장 1120×840). JPG·PNG·WebP, 10MB 이하."
        >
          <AttachmentDisplayField
            label="배너"
            errorMessage={errors.image ?? uploadError}
            items={
              draft.image === null
                ? []
                : [
                    {
                      id: draft.image.uploadId,
                      src: draft.image.src,
                      alt: "배너 이미지",
                    },
                  ]
            }
            previewable
            max={1}
            size={160}
            accept="image/jpeg,image/png,image/webp"
            addLabel={uploading ? "업로드 중…" : "배너 추가"}
            onAddFiles={uploading ? undefined : (files) => void addImage(files)}
            onRemove={removeImage}
          />
        </AdminCard>
      )}

      <AdminCard
        title="노출 기간 (KST)"
        description="활성 상태이면서 이 기간 안일 때만 보입니다. 종료일이 지나면 자동으로 사라집니다."
      >
        <Grid columns={{ base: 1, md: 2 }} gap="x3">
          <TextField
            type="date"
            label="노출 시작일"
            required
            value={draft.startsOn}
            errorMessage={errors.startsOn}
            onChange={(event) => patch({ startsOn: event.target.value })}
          />
          <TextField
            type="date"
            label="노출 종료일"
            required
            value={draft.endsOn}
            errorMessage={errors.endsOn}
            onChange={(event) => patch({ endsOn: event.target.value })}
          />
        </Grid>
      </AdminCard>

      <HStack gap="x2" justify="flex-end">
        <ActionButton type="button" variant="ghost" onClick={onCancel}>
          취소
        </ActionButton>
        <ActionButton type="submit" loading={submitting} disabled={uploading}>
          {submitLabel}
        </ActionButton>
      </HStack>
    </VStack>
  );
}

export function PopupNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    ...createAdminPopupMutation(),
    onSuccess: async () => {
      snackbar("팝업을 등록했습니다. 활성 스위치를 켜면 store에 노출됩니다.");
      await queryClient.invalidateQueries({
        queryKey: listAdminPopupsQueryKey(),
      });
      navigate("/popups", { replace: true });
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "팝업을 등록하지 못했습니다.")),
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="팝업 등록"
          description="등록 직후는 비활성입니다. 목록에서 활성 스위치를 켜야 store에 보입니다."
        />
        <ActionButton variant="ghost" onClick={() => navigate("/popups")}>
          목록으로
        </ActionButton>
      </HStack>
      <PopupForm
        initial={EMPTY_DRAFT}
        submitLabel="비활성으로 등록"
        submitting={create.isPending}
        onCancel={() => navigate("/popups")}
        onSubmit={(draft) => create.mutate({ body: requestFromDraft(draft) })}
      />
    </VStack>
  );
}

export function PopupEditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { popupId = "" } = useParams();
  const query = useQuery(listAdminPopupsOptions());
  const popup: AdminPopupNoticeOut | undefined = query.data?.find(
    (row) => row.id === popupId,
  );
  const update = useMutation({
    ...updateAdminPopupMutation(),
    onSuccess: async () => {
      snackbar("팝업을 수정했습니다.");
      await queryClient.invalidateQueries({
        queryKey: listAdminPopupsQueryKey(),
      });
      navigate("/popups", { replace: true });
    },
    onError: (error) =>
      snackbar(getErrorMessage(error, "팝업을 수정하지 못했습니다.")),
  });

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title="팝업 수정"
          description="저장하면 노출 중인 팝업에도 바로 반영됩니다."
        />
        <ActionButton variant="ghost" onClick={() => navigate("/popups")}>
          목록으로
        </ActionButton>
      </HStack>
      {query.isLoading ? (
        <Skeleton height={320} />
      ) : popup === undefined ? (
        <ContentPlaceholder
          title="팝업을 찾을 수 없습니다"
          description="삭제되었거나 주소가 잘못되었습니다."
          action={
            <ActionButton onClick={() => navigate("/popups")}>
              목록으로
            </ActionButton>
          }
        />
      ) : (
        <PopupForm
          key={popup.updated_at}
          initial={draftFromPopup(popup)}
          submitLabel="저장"
          submitting={update.isPending}
          onCancel={() => navigate("/popups")}
          onSubmit={(draft) =>
            update.mutate({
              path: { popup_id: popup.id },
              body: requestFromDraft(draft),
            })
          }
        />
      )}
    </VStack>
  );
}
