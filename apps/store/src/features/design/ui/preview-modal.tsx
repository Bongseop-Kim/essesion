import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  Icon,
  ResponsiveModal,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowPathIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type DesignPreviewMode,
  type DesignPreviewTransform,
  TieCanvas,
} from "./tie-canvas";

type Point = { x: number; y: number };

export type PreviewModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc?: string | null;
  alt?: string;
  mode: DesignPreviewMode;
  onModeChange: (mode: DesignPreviewMode) => void;
  actions?: ReactNode;
};

const INITIAL_TRANSFORM: DesignPreviewTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function PreviewModal({
  open,
  onOpenChange,
  imageSrc,
  alt,
  mode,
  onModeChange,
  actions,
}: PreviewModalProps) {
  const [transform, setTransform] =
    useState<DesignPreviewTransform>(INITIAL_TRANSFORM);
  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);

  useEffect(() => {
    setTransform(INITIAL_TRANSFORM);
    pointers.current.clear();
    pinchStart.current = null;
  }, [imageSrc, mode, open]);

  const setScale = (nextScale: number) => {
    setTransform((current) => {
      const scale = clamp(nextScale, 1, 4);
      return scale === 1 ? INITIAL_TRANSFORM : { ...current, scale };
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size === 2) {
      pinchStart.current = {
        distance: pointerDistance(pointers.current),
        scale: transform.scale,
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    event.stopPropagation();
    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);

    if (pointers.current.size === 2) {
      const start = pinchStart.current;
      if (!start || start.distance === 0) return;
      setScale(
        start.scale * (pointerDistance(pointers.current) / start.distance),
      );
      return;
    }

    const clientWidth = event.currentTarget.clientWidth;
    setTransform((value) => {
      if (value.scale <= 1) return value;
      const maxOffset = (clientWidth * (value.scale - 1)) / 2;
      return {
        ...value,
        offsetX: clamp(
          value.offsetX + current.x - previous.x,
          -maxOffset,
          maxOffset,
        ),
        offsetY: clamp(
          value.offsetY + current.y - previous.y,
          -maxOffset,
          maxOffset,
        ),
      };
    });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="디자인 미리보기"
      description="두 손가락으로 확대하고 한 손가락으로 이동할 수 있어요."
      size="medium"
      showCloseButton
      footer={actions}
    >
      <VStack gap="x4" alignItems="stretch">
        <SegmentedControl
          value={mode}
          onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
          aria-label="미리보기 방식"
          className="w-full"
        >
          <SegmentedControlItem value="repeat">반복</SegmentedControlItem>
          <SegmentedControlItem value="tie">넥타이</SegmentedControlItem>
        </SegmentedControl>

        {imageSrc ? (
          <Box
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            style={{ touchAction: "none", userSelect: "none" }}
          >
            <TieCanvas
              imageSrc={imageSrc}
              mode={mode}
              alt={alt}
              transform={transform}
            />
          </Box>
        ) : (
          <ContentPlaceholder
            icon={<Icon svg={<PhotoIcon />} size={32} />}
            title="미리 볼 후보가 없어요"
            description="후보를 선택한 뒤 다시 열어 주세요."
          />
        )}

        {imageSrc ? (
          <HStack justify="space-between" gap="x3">
            <Text textStyle="caption" color="fg.neutral-muted">
              {Math.round(transform.scale * 100)}%
            </Text>
            <HStack gap="x1">
              <ActionButton
                type="button"
                variant="neutralWeak"
                size="small"
                iconOnly
                aria-label="축소"
                disabled={transform.scale <= 1}
                onClick={() => setScale(transform.scale - 0.5)}
              >
                <Icon svg={<MagnifyingGlassMinusIcon />} size={18} />
              </ActionButton>
              <ActionButton
                type="button"
                variant="neutralWeak"
                size="small"
                iconOnly
                aria-label="확대"
                disabled={transform.scale >= 4}
                onClick={() => setScale(transform.scale + 0.5)}
              >
                <Icon svg={<MagnifyingGlassPlusIcon />} size={18} />
              </ActionButton>
              <ActionButton
                type="button"
                variant="ghost"
                size="small"
                iconOnly
                aria-label="확대 초기화"
                disabled={transform.scale === 1}
                onClick={() => setTransform(INITIAL_TRANSFORM)}
              >
                <Icon svg={<ArrowPathIcon />} size={18} />
              </ActionButton>
            </HStack>
          </HStack>
        ) : null}
      </VStack>
    </ResponsiveModal>
  );
}

function pointerDistance(points: Map<number, Point>) {
  const [first, second] = Array.from(points.values());
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
