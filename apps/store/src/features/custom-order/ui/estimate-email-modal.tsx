import type { CustomAmountRequest } from "@essesion/api-client";
import { sendCustomEstimateEmailMutation } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  Modal,
  snackbar,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// 서버 스키마(apps/api/src/api/domains/orders/schemas.py)와 같은 규칙 — 서버가 최종 검증한다.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const COMPANY_NAME_PATTERN =
  /^[0-9A-Za-z가-힣㈜(][0-9A-Za-z가-힣㈜ ()&.,·-]{0,39}$/;

/** 지금 사양의 예상 견적서(엑셀)를 메일로 보낸다. 금액은 서버가 다시 계산한다. */
export function EstimateEmailModal({
  open,
  onOpenChange,
  payload,
  defaultEmail,
  defaultCompanyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: CustomAmountRequest;
  defaultEmail: string;
  defaultCompanyName: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [companyName, setCompanyName] = useState(defaultCompanyName);
  const [submitted, setSubmitted] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = useMutation(sendCustomEstimateEmailMutation());

  // 열 때마다 계정·주문서의 최신 값으로 채운다.
  useEffect(() => {
    if (!open) return;
    setEmail(defaultEmail);
    setCompanyName(defaultCompanyName);
    setSubmitted(false);
    setSendError(null);
  }, [open]);

  const trimmedEmail = email.trim();
  const trimmedCompanyName = companyName.trim();
  const emailError = EMAIL_PATTERN.test(trimmedEmail)
    ? undefined
    : "메일 주소를 확인해 주세요.";
  const companyNameError =
    trimmedCompanyName === "" || COMPANY_NAME_PATTERN.test(trimmedCompanyName)
      ? undefined
      : "한글·영문·숫자와 ( ) & . , · - 만 40자까지 쓸 수 있어요.";

  const submit = async () => {
    setSubmitted(true);
    if (emailError || companyNameError || send.isPending) return;
    setSendError(null);
    try {
      await send.mutateAsync({
        body: {
          ...payload,
          email: trimmedEmail,
          company_name: trimmedCompanyName || null,
        },
      });
      snackbar("견적서를 메일로 보냈습니다.");
      onOpenChange(false);
    } catch (error) {
      // 창이 열린 채 다시 시도해야 하므로 사라지는 스낵바가 아니라 창 안에 남긴다.
      setSendError(
        error instanceof Error
          ? error.message
          : "견적서 메일을 보내지 못했습니다.",
      );
    }
  };

  return (
    <Modal
      open={open}
      // 보내는 중에는 닫지 않는다 — 닫고 다시 연 창을 앞선 요청의 완료가 닫아 버리지 않게.
      onOpenChange={(next) => {
        if (!send.isPending) onOpenChange(next);
      }}
      title="견적서 메일로 받기"
      description="지금 고른 사양의 예상 견적서를 엑셀 파일로 보내 드립니다."
      showCloseButton
      size="small"
      footer={
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={send.isPending}
          onClick={() => void submit()}
        >
          보내기
        </Box>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <VStack gap="x4" alignItems="stretch">
          {sendError ? <Callout tone="critical" title={sendError} /> : null}
          <TextField
            label="받을 메일 주소"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={320}
            value={email}
            errorMessage={submitted ? emailError : undefined}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <TextField
            label="업체명 (선택)"
            description="견적서의 수신처에 '○○ 귀하'로 들어갑니다."
            maxLength={40}
            value={companyName}
            errorMessage={submitted ? companyNameError : undefined}
            onChange={(event) => setCompanyName(event.currentTarget.value)}
          />
        </VStack>
      </form>
    </Modal>
  );
}
