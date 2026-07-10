import {
  Checkbox,
  HStack,
  type ResponsiveValue,
  SelectBox,
  SelectBoxItem,
  useFieldContext,
} from "@essesion/shared";

type ServiceValues = {
  automatic: boolean;
  width: boolean;
  restoration: boolean;
};

// 카드에 서비스별 가격을 표시하지 않는다 — 조합 가격이라 단독가 나열은 합산으로 오독됨.
// 실제 금액은 항목 상단 합계가 선택에 따라 재계산해 보여준다.
const SERVICES: Array<{ key: keyof ServiceValues; label: string }> = [
  { key: "automatic", label: "자동 수선" },
  { key: "width", label: "폭 수선" },
  { key: "restoration", label: "복원 수선" },
];

export function ServiceTypeSelector({
  values,
  columns = { base: 1, md: 3 },
  onChange,
}: {
  values: ServiceValues;
  columns?: ResponsiveValue<number>;
  onChange: (service: keyof ServiceValues, selected: boolean) => void;
}) {
  const field = useFieldContext();
  const selected = SERVICES.filter((service) => values[service.key]).map(
    (service) => service.key,
  );

  return (
    <SelectBox
      multiple
      columns={columns}
      value={selected}
      id={field?.controlId}
      aria-label="수선 종류"
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      onValueChange={(next) => {
        const keys = Array.isArray(next) ? next : [next];
        for (const service of SERVICES) {
          const enabled = keys.includes(service.key);
          if (enabled !== values[service.key]) onChange(service.key, enabled);
        }
      }}
    >
      {SERVICES.map((service) => (
        <SelectBoxItem
          key={service.key}
          value={service.key}
          label={service.label}
        />
      ))}
    </SelectBox>
  );
}

export function AutomaticAddonSelector({
  dimple,
  turnKnot,
  showTurnKnot,
  onDimpleChange,
  onTurnKnotChange,
}: {
  dimple: boolean;
  turnKnot: boolean;
  showTurnKnot: boolean;
  onDimpleChange: (selected: boolean) => void;
  onTurnKnotChange: (selected: boolean) => void;
}) {
  return (
    <HStack role="group" aria-label="추가 옵션" gap="x4" wrap>
      <Checkbox
        label="딤플"
        checked={dimple}
        onChange={(event) => onDimpleChange(event.currentTarget.checked)}
      />
      {showTurnKnot ? (
        <Checkbox
          label="돌려묶기"
          checked={turnKnot}
          onChange={(event) => onTurnKnotChange(event.currentTarget.checked)}
        />
      ) : null}
    </HStack>
  );
}
