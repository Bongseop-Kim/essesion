import {
  type DesignPreviewMode,
  SegmentedControl,
  SegmentedControlItem,
} from "@essesion/shared";

export type ViewToggleProps = {
  mode: DesignPreviewMode;
  onModeChange: (mode: DesignPreviewMode) => void;
};

/** 캔버스 우상단 뷰 세그먼트 — 넥타이 적용 모습 / 이어붙인 타일. */
export function ViewToggle({ mode, onModeChange }: ViewToggleProps) {
  return (
    <SegmentedControl
      value={mode}
      onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
      aria-label="미리보기 방식"
      className="shadow-s1"
    >
      <SegmentedControlItem value="tie">넥타이</SegmentedControlItem>
      <SegmentedControlItem value="repeat">타일</SegmentedControlItem>
    </SegmentedControl>
  );
}
