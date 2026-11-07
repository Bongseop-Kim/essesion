import type { OrderReferenceImageIn } from "@essesion/api-client";
import {
  Box,
  cn,
  Flex,
  Float,
  Grid,
  Icon,
  ImageFrame,
  REFERENCE_PART_LABELS,
  Text,
  VStack,
} from "@essesion/shared";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useEffect, useId, useMemo } from "react";

export type ReferencePart = NonNullable<OrderReferenceImageIn["part"]>;
export type ReferenceSlotFiles = Partial<Record<ReferencePart, File>>;

/**
 * 주문서 참고 이미지 칸 — 칸마다 1장. 빈 칸은 그 부위 넥타이 실루엣을 옅게 깔아 무엇을 올릴지
 * 보여 준다(디자인 도구 미리보기와 같은 마스크). 디자인 도구의 "바로 주문하기"가 네 칸을 채운다.
 */
export const REFERENCE_SLOTS = [
  {
    part: "full",
    label: REFERENCE_PART_LABELS.full,
    silhouette: "/images/tie-mask.png",
  },
  {
    part: "blade",
    label: REFERENCE_PART_LABELS.blade,
    silhouette: "/images/tie-flat-mask.png",
  },
  {
    part: "knot",
    label: REFERENCE_PART_LABELS.knot,
    silhouette: "/images/tie-knot-closeup-mask.png",
  },
  {
    part: "tail",
    label: REFERENCE_PART_LABELS.tail,
    silhouette: "/images/tie-tail-mask.png",
  },
] as const satisfies readonly {
  part: ReferencePart;
  label: string;
  silhouette: string;
}[];

export function ReferenceSlots({
  files,
  accept,
  onPick,
  onRemove,
}: {
  files: ReferenceSlotFiles;
  accept: string;
  /** 칸에 파일을 고른다 — 로그인 확인 등은 호출하는 쪽에서. */
  onPick: (part: ReferencePart, file: File) => void;
  onRemove: (part: ReferencePart) => void;
}) {
  return (
    <Grid columns={{ base: 2, sm: 4 }} gap="x3">
      {REFERENCE_SLOTS.map((slot) => (
        <Slot
          key={slot.part}
          label={slot.label}
          silhouette={slot.silhouette}
          file={files[slot.part]}
          accept={accept}
          onPick={(file) => onPick(slot.part, file)}
          onRemove={() => onRemove(slot.part)}
        />
      ))}
    </Grid>
  );
}

function Slot({
  label,
  silhouette,
  file,
  accept,
  onPick,
  onRemove,
}: {
  label: string;
  silhouette: string;
  file: File | undefined;
  accept: string;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  return (
    <VStack gap="x1_5" alignItems="stretch">
      <Box position="relative" style={{ aspectRatio: "4 / 5" }}>
        {url ? (
          <>
            <Box position="absolute" inset={0}>
              <ImageFrame
                fill
                borderRadius="r2"
                stroke
                src={url}
                alt={`${label} 참고 이미지`}
              />
            </Box>
            <Float
              placement="top-end"
              style={{ transform: "translate(30%, -30%)" }}
            >
              <Flex
                as="button"
                type="button"
                aria-label={`${label} 참고 이미지 삭제`}
                onClick={onRemove}
                align="center"
                justify="center"
                width={24}
                height={24}
                borderRadius="full"
                bg="bg.brand-solid"
                boxShadow="s1"
                className="text-fg-contrast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
              >
                <Icon svg={<XMarkIcon />} size={14} />
              </Flex>
            </Float>
          </>
        ) : (
          <>
            <input
              id={inputId}
              type="file"
              accept={accept}
              aria-label={`${label} 참고 이미지 추가`}
              className="peer sr-only"
              onChange={(event) => {
                const picked = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (picked) onPick(picked);
              }}
            />
            <Flex
              as="label"
              htmlFor={inputId}
              position="absolute"
              inset={0}
              direction="column"
              align="center"
              justify="center"
              gap="x1"
              borderRadius="r2"
              overflow="hidden"
              className={cn(
                "cursor-pointer border border-dashed border-stroke-neutral bg-bg-layer-default text-fg-neutral-subtle",
                "transition-colors duration-(--duration-fast) ease-standard hover:bg-bg-layer-basement",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring",
              )}
            >
              {/* 부위 실루엣 — 장식이라 읽지 않는다 */}
              <Box
                aria-hidden
                position="absolute"
                inset="x3"
                bg="bg.neutral-weak"
                style={{
                  maskImage: `url(${silhouette})`,
                  maskSize: "contain",
                  maskPosition: "center",
                  maskRepeat: "no-repeat",
                  WebkitMaskImage: `url(${silhouette})`,
                  WebkitMaskSize: "contain",
                  WebkitMaskPosition: "center",
                  WebkitMaskRepeat: "no-repeat",
                }}
              />
              <Box position="relative">
                <Icon svg={<PlusIcon />} size={24} />
              </Box>
            </Flex>
          </>
        )}
      </Box>
      <Text textStyle="labelSm" align="center">
        {label}
      </Text>
    </VStack>
  );
}
