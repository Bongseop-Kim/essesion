import { Badge, HStack, Icon } from "@essesion/shared";
import { CheckIcon } from "@heroicons/react/16/solid";

/**
 * 2지선다 옵션의 두 선택지를 모두 그리고 선택된 쪽만 채워서 표시한다.
 * 선택값만 나열하면(예: "지퍼 · 방 · 기본") 나머지 선택지가 화면에 없어
 * 관리자가 무엇이 선택되지 않았는지 판단할 수 없다.
 */
export function OptionPair({
  options,
  selected,
}: {
  /** 선택 여부와 무관하게 항상 이 순서로 그린다 — 주문마다 순서가 바뀌면 못 읽는다. */
  options: readonly [string, string];
  /** 어느 쪽도 아니면 둘 다 미선택으로 그린다(데이터 손상 시 "미지정"). */
  selected: string;
}) {
  return (
    // DetailList가 값을 <span>으로 감싸므로 span으로 렌더한다.
    <HStack as="span" gap="x1" wrap>
      {options.map((option) => {
        const isSelected = option === selected;
        return (
          <Badge
            key={option}
            variant={isSelected ? "solid" : "outline"}
            tone={isSelected ? "brand" : "neutral"}
            className="gap-x1"
          >
            {isSelected && <Icon svg={<CheckIcon />} size={12} />}
            {/* 선택 여부는 채움 대비로만 보인다 — 스크린리더에는 한 문장으로 준다. */}
            <span aria-hidden>{option}</span>
            <span className="sr-only">
              {option} {isSelected ? "선택됨" : "선택 안 됨"}
            </span>
          </Badge>
        );
      })}
    </HStack>
  );
}
