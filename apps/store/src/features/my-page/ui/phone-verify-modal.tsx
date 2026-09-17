import {
  getMeOptions,
  getMeQueryKey,
  sendPhoneVerificationMutation,
  verifyPhoneMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  HStack,
  Modal,
  normalizePhoneNumber,
  PhoneField,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  clearPendingVerification,
  readPendingVerification,
  savePendingVerification,
} from "@/features/my-page/model/pending-verification";
import { useSession } from "@/shared/store/session";

const PHONE_PATTERN = /^01\d{8,9}$/;

/** api 오류 본문 계약은 `{code, detail}` (docs/api-spec/domains.md §12). */
function errorBody(error: unknown) {
  const body = error as { code?: unknown; detail?: unknown } | null | undefined;
  return {
    code: typeof body?.code === "string" ? body.code : null,
    detail: typeof body?.detail === "string" ? body.detail : null,
  };
}

export function PhoneVerifyModal({
  open,
  currentPhone,
  onOpenChange,
  onVerified,
}: {
  open: boolean;
  currentPhone?: string | null;
  onOpenChange: (open: boolean) => void;
  onVerified?: () => void;
}) {
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const send = useMutation(sendPhoneVerificationMutation());
  const verify = useMutation(verifyPhoneMutation());

  // 열 때마다 서버가 아직 받아줄 인증번호가 있는지 복원한다. 기록이 없으면(다른 기기·
  // 시크릿 모드·저장소 차단) 그냥 처음 화면이 되고, 입력칸은 어차피 항상 열려 있다.
  useEffect(() => {
    if (!open) return;
    const pending = readPendingVerification(userId);
    setPhone(pending?.phone ?? currentPhone ?? "");
    setSent(pending !== null);
    setCooldown(pending?.cooldown ?? 0);
    setCode("");
  }, [currentPhone, open, userId]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const normalizedPhone = normalizePhoneNumber(phone);
  const canSend = PHONE_PATTERN.test(normalizedPhone) && cooldown === 0;
  // sent를 조건에 넣지 않는다 — 보관 기록이 없는 환경(시크릿 모드·저장소 차단·다른 기기)
  // 에서도 문자로 받은 번호를 바로 넣을 수 있어야 한다. 코드 유효성은 서버가 판정하지만
  // 번호 형식은 여기서 막는다(빈 번호로 눌러 invalid_phone을 받는 경로를 없앤다).
  const canVerify = PHONE_PATTERN.test(normalizedPhone) && /^\d{6}$/.test(code);

  const sendCode = async () => {
    if (!canSend) return;
    try {
      await send.mutateAsync({ body: { phone: normalizedPhone } });
      if (userId !== undefined)
        savePendingVerification(userId, normalizedPhone);
      setSent(true);
      setCode("");
      setCooldown(60);
      snackbar("인증번호를 발송했습니다.");
    } catch (error) {
      // detail은 프론트 노출 문자열이다(domains.md §12). 특히 "1분 후 재전송
      // 가능합니다"는 이미 보낸 코드가 살아 있다는 뜻이라, 일반 실패 문구로 덮으면
      // 사용자가 재전송만 반복하다 일일 한도까지 태운다.
      const { code: errorCode, detail } = errorBody(error);
      if (errorCode === "rate_limited") {
        // 서버가 60초 제한을 걸었다는 건 방금 보낸 코드가 살아 있다는 뜻이다(60초 < 만료
        // 5분). 보관 기록이 없는 환경에서 여기로 들어오므로, 안내와 "재전송" 라벨은
        // 스낵바가 사라진 뒤에도 남겨둔다.
        setSent(true);
        setCooldown(60);
      }
      snackbar(detail ?? "인증번호를 발송하지 못했습니다.");
    }
  };

  const verifyCode = async () => {
    if (!canVerify) return;
    try {
      await verify.mutateAsync({
        body: { phone: normalizedPhone, code },
      });
      clearPendingVerification();
      await queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
      const me = await queryClient.fetchQuery(getMeOptions());
      useSession.getState().setUser(me);
      snackbar("휴대폰 인증이 완료되었습니다.");
      onVerified?.();
      onOpenChange(false);
    } catch (error) {
      // 단순 오타(mismatch)는 같은 번호를 다시 넣으면 되므로 기록을 남긴다. 만료·없음·
      // 잠김은 그 레코드가 죽은 것이므로 버리고 발송 화면으로 되돌린다. code가 없는
      // 실패(네트워크 끊김)는 서버 판정이 아니므로 역시 남긴다.
      const { code: errorCode, detail } = errorBody(error);
      if (errorCode !== null && errorCode !== "verification_mismatch") {
        clearPendingVerification();
        setSent(false);
        // 죽은 코드가 입력칸에 남아 있으면 "인증 완료"가 계속 활성이라 같은 실패를
        // 반복하게 된다. cooldown은 서버의 재전송 창(발송 시각 기준)이라 건드리지 않는다.
        setCode("");
      }
      snackbar(detail ?? "인증번호가 올바르지 않거나 만료되었습니다.");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="휴대폰 인증"
      description="인증하지 않으면 주문·배송 진행 상태를 카카오톡으로 받을 수 없습니다. 알림을 받을 휴대폰 번호를 인증해 주세요."
      showCloseButton
      size="small"
      footer={
        <Box
          as={ActionButton}
          type="button"
          width="full"
          disabled={!canVerify}
          loading={verify.isPending}
          onClick={() => void verifyCode()}
        >
          인증 완료
        </Box>
      }
    >
      <VStack gap="x4" alignItems="stretch">
        {sent ? (
          <Callout
            tone="informative"
            title="이미 인증번호를 보냈습니다"
            description="문자로 받은 6자리를 입력해 주세요."
          />
        ) : null}
        <HStack gap="x2" align="flex-end">
          <Box flexGrow minWidth={0}>
            <PhoneField
              label="휴대폰 번호"
              value={phone}
              onValueChange={(value) => {
                setPhone(value);
                setSent(false);
                setCode("");
              }}
            />
          </Box>
          <ActionButton
            type="button"
            variant="neutralOutline"
            disabled={!canSend}
            loading={send.isPending}
            onClick={() => void sendCode()}
          >
            {cooldown > 0 ? `${cooldown}초` : sent ? "재전송" : "인증번호 발송"}
          </ActionButton>
        </HStack>
        <TextField
          label="인증번호"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="문자로 받은 6자리 숫자"
          value={code}
          onChange={(event) =>
            setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
          }
        />
        <Text textStyle="caption" color="fg.neutral-muted">
          인증번호는 5분 동안 유효하며, 재전송은 60초 후 가능합니다.
        </Text>
      </VStack>
    </Modal>
  );
}
