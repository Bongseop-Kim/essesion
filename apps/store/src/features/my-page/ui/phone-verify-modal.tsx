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
  ResponsiveModal,
  snackbar,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useSession } from "@/shared/store/session";

const PHONE_PATTERN = /^01\d{8,9}$/;

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
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const send = useMutation(sendPhoneVerificationMutation());
  const verify = useMutation(verifyPhoneMutation());

  useEffect(() => {
    if (open) setPhone(currentPhone ?? "");
  }, [currentPhone, open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const normalizedPhone = phone.replace(/\D/g, "");
  const canSend = PHONE_PATTERN.test(normalizedPhone) && cooldown === 0;
  const canVerify = sent && /^\d{6}$/.test(code);

  const sendCode = async () => {
    if (!canSend) return;
    try {
      await send.mutateAsync({ body: { phone: normalizedPhone } });
      setSent(true);
      setCode("");
      setCooldown(60);
      snackbar("인증번호를 발송했습니다.");
    } catch {
      snackbar("인증번호를 발송하지 못했습니다.");
    }
  };

  const verifyCode = async () => {
    if (!canVerify) return;
    try {
      await verify.mutateAsync({
        body: { phone: normalizedPhone, code },
      });
      await queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
      const me = await queryClient.fetchQuery(getMeOptions());
      useSession.getState().setUser(me);
      snackbar("휴대폰 인증이 완료되었습니다.");
      onVerified?.();
      onOpenChange(false);
    } catch {
      snackbar("인증번호가 올바르지 않거나 만료되었습니다.");
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="휴대폰 인증"
      description="알림을 받을 휴대폰 번호를 인증해 주세요."
      showCloseButton
      size="small"
      footer={
        sent ? (
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
        ) : undefined
      }
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack gap="x2" align="flex-end">
          <Box flexGrow minWidth={0}>
            <TextField
              label="휴대폰 번호"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01012345678"
              value={phone}
              onChange={(event) => {
                setPhone(event.currentTarget.value);
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
        {sent ? (
          <TextField
            label="인증번호"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6자리 숫자"
            value={code}
            onChange={(event) =>
              setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        ) : null}
        <Callout tone="neutral">
          인증번호는 5분 동안 유효하며, 재전송은 60초 후 가능합니다.
        </Callout>
      </VStack>
    </ResponsiveModal>
  );
}
