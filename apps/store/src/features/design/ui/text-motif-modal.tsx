import type { UserMotifOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  Callout,
  Field,
  HStack,
  ImageFrame,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useEffect, useId, useRef, useState } from "react";

import { importDesignMotifSvg } from "@/features/design/api/attachments";
import { previewTextMotif } from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { svgToDataUri } from "@/features/design/model/svg-preview";

type FontId = "nanum-gothic" | "nanum-myeongjo";
type FontWeight = 400 | 700;

const PREVIEW_DEBOUNCE_MS = 400;

export type TextMotifModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (motif: UserMotifOut) => void;
};

/** 짧은 글자를 path 모티프로 — 입력·옵션이 바뀌면 미리보기를 자동 갱신하고, CTA는 저장 하나뿐이다. */
export function TextMotifModal({
  open,
  onOpenChange,
  onCreated,
}: TextMotifModalProps) {
  const formId = useId();
  const [text, setText] = useState("");
  const [fontId, setFontId] = useState<FontId>("nanum-gothic");
  const [fontWeight, setFontWeight] = useState<FontWeight>(400);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [resultSvg, setResultSvg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    requestSequence.current += 1;
    setBusy(false);
    setSaving(false);
    setText("");
    setFontId("nanum-gothic");
    setFontWeight(400);
    setLetterSpacing(0);
    setResultSvg(null);
    setWarnings([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestSequence.current += 1;
    const trimmed = text.trim();
    if (!trimmed) {
      setBusy(false);
      setResultSvg(null);
      setWarnings([]);
      setError(null);
      return;
    }
    const sequence = requestSequence.current;
    setBusy(true);
    setError(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const preview = await previewTextMotif({
            text: trimmed,
            fontId,
            fontWeight,
            letterSpacing,
          });
          if (!openRef.current || sequence !== requestSequence.current) return;
          setResultSvg(preview.svg);
          setWarnings(preview.warnings);
        } catch (cause) {
          if (!openRef.current || sequence !== requestSequence.current) return;
          setResultSvg(null);
          setWarnings([]);
          setError(
            designErrorMessage(cause, "텍스트 모티프를 만들지 못했습니다."),
          );
        } finally {
          if (sequence === requestSequence.current) setBusy(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, text, fontId, fontWeight, letterSpacing]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;
    if (!nextOpen) {
      openRef.current = false;
      requestSequence.current += 1;
      setBusy(false);
    }
    onOpenChange(nextOpen);
  };

  const save = async () => {
    const name = text.trim().slice(0, 100);
    if (!resultSvg || !name || busy || saving) return;
    const sequence = ++requestSequence.current;
    setSaving(true);
    setError(null);
    try {
      const motif = await importDesignMotifSvg(name, resultSvg);
      if (!openRef.current || sequence !== requestSequence.current) return;
      onCreated(motif);
      openRef.current = false;
      requestSequence.current += 1;
      setSaving(false);
      onOpenChange(false);
    } catch (cause) {
      if (!openRef.current || sequence !== requestSequence.current) return;
      setError(designErrorMessage(cause, "모티프를 저장하지 못했습니다."));
    } finally {
      if (sequence === requestSequence.current) setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={changeOpen}
      title="텍스트 모티프"
      description="짧은 글자·이니셜을 모티프로 만들어요."
      size="medium"
      showCloseButton={!saving}
      closeOnEscape={!saving}
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={saving}
            onClick={() => changeOpen(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="submit"
            form={formId}
            width="full"
            loading={saving}
            disabled={!resultSvg || busy}
          >
            내 모티프에 저장
          </Box>
        </HStack>
      }
    >
      <Box
        as="form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={saving} className="contents">
          <VStack gap="x4" alignItems="stretch">
            <TextField
              label="짧은 글자"
              description="한글·영문·숫자와 공백, 최대 20자"
              maxLength={20}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
            />
            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="label">글꼴</Text>
              <SelectBox
                value={fontId}
                onValueChange={(value) => setFontId(value as FontId)}
                columns={2}
                aria-label="글꼴"
              >
                <SelectBoxItem value="nanum-gothic" label="나눔고딕" />
                <SelectBoxItem value="nanum-myeongjo" label="나눔명조" />
              </SelectBox>
            </VStack>
            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="label">굵기</Text>
              <SelectBox
                value={String(fontWeight)}
                onValueChange={(value) =>
                  setFontWeight(Number(value) as FontWeight)
                }
                columns={2}
                aria-label="글자 굵기"
              >
                <SelectBoxItem value="400" label="보통" />
                <SelectBoxItem value="700" label="굵게" />
              </SelectBox>
            </VStack>
            <Field label="자간" description={`${letterSpacing.toFixed(2)}em`}>
              <input
                type="range"
                min="-0.2"
                max="1"
                step="0.05"
                value={letterSpacing}
                aria-label="자간"
                onChange={(event) =>
                  setLetterSpacing(Number(event.currentTarget.value))
                }
                className="w-full accent-bg-brand-solid"
              />
            </Field>

            {resultSvg || busy ? (
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="label">미리보기</Text>
                <Box maxWidth={240}>
                  {resultSvg ? (
                    <ImageFrame
                      ratio={1}
                      src={svgToDataUri(resultSvg)}
                      alt="저장할 SVG 모티프 미리보기"
                      fit="contain"
                      stroke
                    />
                  ) : (
                    <Skeleton width={240} height={240} radius="r2" />
                  )}
                </Box>
              </VStack>
            ) : null}

            {warnings.length > 0 ? (
              <Callout
                tone="warning"
                title="미리보기 안내"
                description={warnings.join(" ")}
              />
            ) : null}
            {error ? (
              <Callout
                tone="critical"
                title="모티프를 만들지 못했습니다"
                description={error}
              />
            ) : null}
          </VStack>
        </fieldset>
      </Box>
    </ResponsiveModal>
  );
}
