import {
  ActionButton,
  Badge,
  Box,
  Callout,
  Checkbox,
  Divider,
  Grid,
  HStack,
  Icon,
  ListPicker,
  type ListPickerOption,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useState } from "react";

import { AdminCard } from "../../shared/ui/admin-card";
import {
  type DesignPlan,
  DROP_LABELS,
  defaultMotifLayer,
  defaultPlacement,
  defaultStripeLayer,
  MAX_BANDS,
  MAX_COLORS,
  MAX_LAYERS,
  MIN_COLORS,
  type MotifLayer,
  normalizeHex,
  PATH_DIRECTION_LABELS,
  PLACEMENT_KIND_DESCRIPTIONS,
  PLACEMENT_KIND_LABELS,
  type Placement,
  type PlacementKind,
  type PlanLayer,
  POINT_TEMPLATE_LABELS,
  placementKind,
  ROTATION_LABELS,
  STRIPE_DIRECTION_LABELS,
  type StripeLayer,
  stripeLayers,
  unusedMotifSlots,
} from "./plan-model";

/** 소수 비율을 다루므로 입력 중 문자열을 그대로 들고 있다가 파싱되는 값만 위로 올린다.
    (숫자를 바로 state로 쓰면 "0."을 타이핑할 수 없다) */
function NumberField({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => String(value));
  const parsed = Number.parseFloat(text);
  const invalid = !Number.isFinite(parsed) || parsed < min || parsed > max;

  return (
    <TextField
      type="number"
      inputMode="decimal"
      label={label}
      description={description}
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      errorMessage={
        invalid ? `${min} 이상 ${max} 이하로 입력해 주세요.` : undefined
      }
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        const nextValue = Number.parseFloat(next);
        if (Number.isFinite(nextValue)) onChange(nextValue);
      }}
    />
  );
}

function EnumField<K extends string>({
  label,
  description,
  labels,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  labels: Record<K, string>;
  value: K;
  onChange: (value: K) => void;
  disabled?: boolean;
}) {
  return (
    <ListPicker
      label={label}
      description={description}
      value={value}
      disabled={disabled}
      options={Object.entries(labels).map(([optionValue, optionLabel]) => ({
        value: optionValue,
        label: optionLabel as string,
      }))}
      onValueChange={(next) => onChange(next as K)}
    />
  );
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <Box
      width={16}
      height={16}
      borderRadius="r1"
      className="shrink-0 border border-stroke-neutral-weak"
      style={{ backgroundColor: color }}
    />
  );
}

function colorOptions(colors: readonly string[]): ListPickerOption[] {
  return colors.map((color, index) => ({
    value: String(index),
    label: (
      <HStack gap="x2">
        <ColorSwatch color={color} />
        <Text textStyle="bodySm">{`${index + 1}번 ${color}`}</Text>
      </HStack>
    ),
  }));
}

function ColorIndexField({
  label,
  colors,
  value,
  onChange,
  disabled,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <ListPicker
      label={label}
      value={String(Math.min(value, colors.length - 1))}
      options={colorOptions(colors)}
      disabled={disabled}
      onValueChange={(next) => onChange(Number(next))}
    />
  );
}

function LayerFrame({
  title,
  tone,
  onRemove,
  removeLabel,
  disabled,
  children,
}: {
  title: string;
  tone: "neutral" | "informative";
  onRemove: () => void;
  removeLabel: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Box borderRadius="r2" p="x4" className="border border-stroke-neutral-weak">
      <VStack gap="x4" alignItems="stretch">
        <HStack justify="space-between" gap="x3">
          <Badge tone={tone}>{title}</Badge>
          <ActionButton
            type="button"
            variant="ghost"
            size="medium"
            iconOnly
            aria-label={removeLabel}
            disabled={disabled}
            onClick={onRemove}
          >
            <Icon svg={<TrashIcon />} size={18} />
          </ActionButton>
        </HStack>
        {children}
      </VStack>
    </Box>
  );
}

function PlacementFields({
  placement,
  colors,
  stripes,
  onChange,
  disabled,
}: {
  placement: Placement;
  colors: readonly string[];
  stripes: readonly StripeLayer[];
  onChange: (placement: Placement) => void;
  disabled?: boolean;
}) {
  const rotationFixed =
    "rotation" in placement ? placement.rotation === "fixed" : true;

  return (
    <VStack gap="x4" alignItems="stretch">
      <EnumField
        label="배치 방식"
        description={PLACEMENT_KIND_DESCRIPTIONS[placementKind(placement)]}
        labels={PLACEMENT_KIND_LABELS}
        value={placementKind(placement)}
        disabled={disabled}
        onChange={(kind: PlacementKind) => onChange(defaultPlacement(kind))}
      />

      <Grid columns={{ base: 1, md: 2 }} gap="x4">
        {placement.type === "lattice" && (
          <>
            <NumberField
              label="열 수"
              value={placement.columns}
              min={1}
              max={16}
              step={1}
              disabled={disabled}
              onChange={(columns) => onChange({ ...placement, columns })}
            />
            <NumberField
              label="행 수"
              value={placement.rows}
              min={1}
              max={16}
              step={1}
              disabled={disabled}
              onChange={(rows) => onChange({ ...placement, rows })}
            />
            <EnumField
              label="엇갈림"
              labels={DROP_LABELS}
              value={placement.drop}
              disabled={disabled}
              onChange={(drop) => onChange({ ...placement, drop })}
            />
          </>
        )}

        {placement.type === "scatter" && placement.mode === "poisson" && (
          <>
            <NumberField
              label="개수"
              value={placement.count}
              min={1}
              max={256}
              step={1}
              disabled={disabled}
              onChange={(count) => onChange({ ...placement, count })}
            />
            <NumberField
              label="최소 간격 비율"
              description="타일 한 변 기준 (0 초과 0.5 이하)"
              value={placement.min_distance_ratio}
              min={0.01}
              max={0.5}
              step={0.01}
              disabled={disabled}
              onChange={(min_distance_ratio) =>
                onChange({ ...placement, min_distance_ratio })
              }
            />
          </>
        )}

        {placement.type === "scatter" && placement.mode === "sateen" && (
          <>
            <NumberField
              label="차수 (order)"
              value={placement.order}
              min={2}
              max={32}
              step={1}
              disabled={disabled}
              onChange={(order) => onChange({ ...placement, order })}
            />
            <NumberField
              label="간격 (step)"
              description="차수보다 작아야 합니다."
              value={placement.step}
              min={1}
              max={31}
              step={1}
              disabled={disabled}
              onChange={(step) => onChange({ ...placement, step })}
            />
          </>
        )}

        {placement.type === "path" && (
          <>
            <EnumField
              label="경로 방향"
              labels={PATH_DIRECTION_LABELS}
              value={placement.direction}
              disabled={disabled}
              onChange={(direction) => onChange({ ...placement, direction })}
            />
            <NumberField
              label="배치 간격 비율"
              value={placement.spacing_ratio}
              min={0.01}
              max={1}
              step={0.01}
              disabled={disabled}
              onChange={(spacing_ratio) =>
                onChange({ ...placement, spacing_ratio })
              }
            />
            <NumberField
              label="시작 위상"
              description="0 이상 1 미만"
              value={placement.phase_ratio}
              min={0}
              max={0.99}
              step={0.01}
              disabled={disabled}
              onChange={(phase_ratio) =>
                onChange({ ...placement, phase_ratio })
              }
            />
          </>
        )}

        {placement.type === "path" && placement.kind === "wave" && (
          <>
            <NumberField
              label="파장 비율"
              value={placement.wavelength_ratio}
              min={0.01}
              max={2}
              step={0.01}
              disabled={disabled}
              onChange={(wavelength_ratio) =>
                onChange({ ...placement, wavelength_ratio })
              }
            />
            <NumberField
              label="진폭 비율"
              value={placement.amplitude_ratio}
              min={0}
              max={0.5}
              step={0.01}
              disabled={disabled}
              onChange={(amplitude_ratio) =>
                onChange({ ...placement, amplitude_ratio })
              }
            />
          </>
        )}

        {placement.type === "point_template" && (
          <EnumField
            label="템플릿"
            labels={POINT_TEMPLATE_LABELS}
            value={placement.template}
            disabled={disabled}
            onChange={(template) => onChange({ ...placement, template })}
          />
        )}

        {"rotation" in placement && (
          <EnumField
            label="모티프 회전"
            labels={ROTATION_LABELS}
            value={placement.rotation}
            disabled={disabled}
            onChange={(rotation) => onChange({ ...placement, rotation })}
          />
        )}

        {rotationFixed && (
          <NumberField
            label="고정 회전 각도"
            description="-180 이상 180 이하"
            value={placement.fixed_rotation_deg}
            min={-180}
            max={180}
            step={1}
            disabled={disabled}
            onChange={(fixed_rotation_deg) =>
              onChange({ ...placement, fixed_rotation_deg })
            }
          />
        )}
      </Grid>

      {placement.type === "path" && placement.kind === "straight" && (
        <VStack gap="x3" alignItems="stretch">
          <Checkbox
            label="스트라이프 밴드 위에 올리기"
            description="같은 방향의 스트라이프 레이어가 있어야 합니다."
            checked={placement.host_stripe_index != null}
            disabled={disabled || stripes.length === 0}
            onChange={(event) => {
              const hosted = event.currentTarget.checked;
              onChange({
                ...placement,
                host_stripe_index: hosted ? 0 : null,
                host_band_index: null,
                direction: hosted
                  ? (stripes[0]?.direction ?? placement.direction)
                  : placement.direction,
              });
            }}
          />
          {placement.host_stripe_index != null && (
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <ListPicker
                label="대상 스트라이프"
                value={String(placement.host_stripe_index)}
                disabled={disabled}
                options={stripes.map((stripe, index) => ({
                  value: String(index),
                  label: `${index + 1}번 스트라이프 · ${STRIPE_DIRECTION_LABELS[stripe.direction]}`,
                }))}
                onValueChange={(next) =>
                  onChange({
                    ...placement,
                    host_stripe_index: Number(next),
                    host_band_index: null,
                    direction:
                      stripes[Number(next)]?.direction ?? placement.direction,
                  })
                }
              />
              <ListPicker
                label="대상 밴드"
                value={
                  placement.host_band_index == null
                    ? "all"
                    : String(placement.host_band_index)
                }
                disabled={disabled}
                options={[
                  { value: "all", label: "모든 밴드" },
                  ...(stripes[placement.host_stripe_index]?.bands ?? []).map(
                    (_, index) => ({
                      value: String(index),
                      label: `${index + 1}번 밴드`,
                    }),
                  ),
                ]}
                onValueChange={(next) =>
                  onChange({
                    ...placement,
                    host_band_index: next === "all" ? null : Number(next),
                  })
                }
              />
            </Grid>
          )}
        </VStack>
      )}

      {colors.length === 0 && null}
    </VStack>
  );
}

function MotifLayerFields({
  layer,
  colors,
  stripes,
  motifNames,
  onChange,
  disabled,
}: {
  layer: MotifLayer;
  colors: readonly string[];
  stripes: readonly StripeLayer[];
  motifNames: readonly string[];
  onChange: (layer: MotifLayer) => void;
  disabled?: boolean;
}) {
  const slots = layer.color_indices ?? null;

  return (
    <VStack gap="x4" alignItems="stretch">
      <Grid columns={{ base: 1, md: 2 }} gap="x4">
        {motifNames.length > 1 && (
          <ListPicker
            label="사용 모티프"
            value={String(layer.motif_index)}
            disabled={disabled}
            options={motifNames.map((name, index) => ({
              value: String(index),
              label: `${index + 1}. ${name}`,
            }))}
            onValueChange={(next) =>
              onChange({ ...layer, motif_index: Number(next) })
            }
          />
        )}
        <NumberField
          label="모티프 크기 비율"
          description="타일 한 변 기준 (0 초과 0.4 이하)"
          value={layer.size_ratio}
          min={0.01}
          max={0.4}
          step={0.01}
          disabled={disabled}
          onChange={(size_ratio) => onChange({ ...layer, size_ratio })}
        />
      </Grid>

      <VStack gap="x3" alignItems="stretch">
        <Checkbox
          label="모티프 색을 팔레트로 다시 칠하기"
          description="끄면 모티프 원본 색을 그대로 씁니다."
          checked={slots !== null}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...layer,
              color_indices: event.currentTarget.checked ? [1] : null,
            })
          }
        />
        {slots !== null && (
          <VStack gap="x3" alignItems="stretch">
            {slots.map((colorIndex, slotIndex) => (
              <HStack
                key={`slot-${slotIndex}-${slots.length}`}
                gap="x2"
                align="flex-end"
              >
                <Box flex={1}>
                  <ColorIndexField
                    label={`${slotIndex + 1}번 색 슬롯`}
                    colors={colors}
                    value={colorIndex}
                    disabled={disabled}
                    onChange={(next) =>
                      onChange({
                        ...layer,
                        color_indices: slots.map((item, index) =>
                          index === slotIndex ? next : item,
                        ),
                      })
                    }
                  />
                </Box>
                <ActionButton
                  type="button"
                  variant="ghost"
                  size="medium"
                  iconOnly
                  aria-label={`${slotIndex + 1}번 색 슬롯 삭제`}
                  disabled={disabled || slots.length <= 1}
                  onClick={() =>
                    onChange({
                      ...layer,
                      color_indices: slots.filter(
                        (_, index) => index !== slotIndex,
                      ),
                    })
                  }
                >
                  <Icon svg={<TrashIcon />} size={18} />
                </ActionButton>
              </HStack>
            ))}
            <ActionButton
              type="button"
              variant="neutralWeak"
              disabled={disabled || slots.length >= MAX_COLORS}
              onClick={() =>
                onChange({ ...layer, color_indices: [...slots, 0] })
              }
            >
              <Icon svg={<PlusIcon />} size={16} />색 슬롯 추가
            </ActionButton>
          </VStack>
        )}
      </VStack>

      <Divider />

      <PlacementFields
        placement={layer.placement}
        colors={colors}
        stripes={stripes}
        disabled={disabled}
        onChange={(placement) => onChange({ ...layer, placement })}
      />
    </VStack>
  );
}

function StripeLayerFields({
  layer,
  colors,
  onChange,
  disabled,
}: {
  layer: StripeLayer;
  colors: readonly string[];
  onChange: (layer: StripeLayer) => void;
  disabled?: boolean;
}) {
  return (
    <VStack gap="x4" alignItems="stretch">
      <Grid columns={{ base: 1, md: 2 }} gap="x4">
        <EnumField
          label="스트라이프 방향"
          labels={STRIPE_DIRECTION_LABELS}
          value={layer.direction}
          disabled={disabled}
          onChange={(direction) => onChange({ ...layer, direction })}
        />
        <NumberField
          label="반복 주기 비율"
          description="타일 한 변 기준 (0 초과 1 이하)"
          value={layer.period_ratio}
          min={0.01}
          max={1}
          step={0.01}
          disabled={disabled}
          onChange={(period_ratio) => onChange({ ...layer, period_ratio })}
        />
      </Grid>

      <VStack gap="x3" alignItems="stretch">
        <Text textStyle="labelSm">
          밴드 · {layer.bands.length}/{MAX_BANDS}
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          한 주기 안에서 각 띠의 시작 위치와 폭을 정합니다. 폭의 합은 0.75를
          넘을 수 없습니다.
        </Text>
        {layer.bands.map((band, bandIndex) => (
          <Box
            key={`band-${bandIndex}-${layer.bands.length}`}
            borderRadius="r2"
            p="x3"
            className="border border-stroke-neutral-weak"
          >
            <VStack gap="x3" alignItems="stretch">
              <HStack justify="space-between" gap="x3">
                <Text textStyle="labelSm">{bandIndex + 1}번 밴드</Text>
                <ActionButton
                  type="button"
                  variant="ghost"
                  size="medium"
                  iconOnly
                  aria-label={`${bandIndex + 1}번 밴드 삭제`}
                  disabled={disabled || layer.bands.length <= 1}
                  onClick={() =>
                    onChange({
                      ...layer,
                      bands: layer.bands.filter(
                        (_, index) => index !== bandIndex,
                      ),
                    })
                  }
                >
                  <Icon svg={<TrashIcon />} size={18} />
                </ActionButton>
              </HStack>
              <Grid columns={{ base: 1, md: 3 }} gap="x3">
                <NumberField
                  label="시작 위치"
                  value={band.offset_ratio}
                  min={0}
                  max={0.99}
                  step={0.01}
                  disabled={disabled}
                  onChange={(offset_ratio) =>
                    onChange({
                      ...layer,
                      bands: layer.bands.map((item, index) =>
                        index === bandIndex ? { ...item, offset_ratio } : item,
                      ),
                    })
                  }
                />
                <NumberField
                  label="폭"
                  value={band.width_ratio}
                  min={0.01}
                  max={0.75}
                  step={0.01}
                  disabled={disabled}
                  onChange={(width_ratio) =>
                    onChange({
                      ...layer,
                      bands: layer.bands.map((item, index) =>
                        index === bandIndex ? { ...item, width_ratio } : item,
                      ),
                    })
                  }
                />
                <ColorIndexField
                  label="색"
                  colors={colors}
                  value={band.color_index}
                  disabled={disabled}
                  onChange={(color_index) =>
                    onChange({
                      ...layer,
                      bands: layer.bands.map((item, index) =>
                        index === bandIndex ? { ...item, color_index } : item,
                      ),
                    })
                  }
                />
              </Grid>
            </VStack>
          </Box>
        ))}
        <ActionButton
          type="button"
          variant="neutralWeak"
          disabled={disabled || layer.bands.length >= MAX_BANDS}
          onClick={() =>
            onChange({
              ...layer,
              bands: [
                ...layer.bands,
                { offset_ratio: 0.5, width_ratio: 0.25, color_index: 1 },
              ],
            })
          }
        >
          <Icon svg={<PlusIcon />} size={16} />
          밴드 추가
        </ActionButton>
      </VStack>
    </VStack>
  );
}

export function PlanEditor({
  value,
  motifNames,
  onChange,
  disabled,
}: {
  value: DesignPlan;
  /** 모티프 피커에서 고른 순서대로의 표시 이름 — Plan의 모티프 슬롯 수와 같다 */
  motifNames: readonly string[];
  onChange: (plan: DesignPlan) => void;
  disabled?: boolean;
}) {
  const { colors, layers } = value;
  const stripes = stripeLayers(value);
  const unused = unusedMotifSlots(layers, motifNames.length);

  const setLayer = (index: number, layer: PlanLayer) =>
    onChange({
      ...value,
      layers: layers.map((item, itemIndex) =>
        itemIndex === index ? layer : item,
      ),
    });

  const removeColor = (index: number) => {
    const nextColors = colors.filter((_, itemIndex) => itemIndex !== index);
    const shift = (colorIndex: number) =>
      colorIndex === index
        ? 0
        : colorIndex > index
          ? colorIndex - 1
          : colorIndex;
    onChange({
      ...value,
      colors: nextColors,
      ground_color_index: shift(value.ground_color_index),
      layers: layers.map((layer) =>
        layer.type === "stripe"
          ? {
              ...layer,
              bands: layer.bands.map((band) => ({
                ...band,
                color_index: shift(band.color_index),
              })),
            }
          : {
              ...layer,
              color_indices:
                layer.color_indices?.map((colorIndex) => shift(colorIndex)) ??
                null,
            },
      ),
    });
  };

  return (
    <VStack gap="x5" alignItems="stretch">
      <AdminCard
        title="팔레트"
        description="타일에 쓸 색과 배경색을 정합니다. 색은 2개 이상 8개 이하입니다."
        action={
          <ActionButton
            type="button"
            variant="neutralWeak"
            disabled={disabled || colors.length >= MAX_COLORS}
            onClick={
              () => onChange({ ...value, colors: [...colors, "#888888"] }) // harness-ignore -- Plan 데이터 기본값, UI 스타일이 아님
            }
          >
            <Icon svg={<PlusIcon />} size={16} />색 추가
          </ActionButton>
        }
      >
        <VStack gap="x3" alignItems="stretch">
          {colors.map((color, index) => (
            <HStack
              key={`color-${index}-${colors.length}`}
              gap="x2"
              align="flex-end"
            >
              <Box
                as="input"
                type="color"
                aria-label={`${index + 1}번 색 선택`}
                value={normalizeHex(color) ?? "#000000"} // harness-ignore -- color input 폴백 값
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...value,
                    colors: colors.map((item, itemIndex) =>
                      itemIndex === index
                        ? event.currentTarget.value.toUpperCase()
                        : item,
                    ),
                  })
                }
                width={40}
                height={40}
                borderRadius="r2"
                className="shrink-0 cursor-pointer overflow-hidden border border-stroke-neutral-weak bg-bg-layer-default p-0"
              />
              <Box flex={1}>
                <TextField
                  label={`${index + 1}번 HEX`}
                  placeholder="#RRGGBB"
                  autoComplete="off"
                  value={color}
                  disabled={disabled}
                  errorMessage={
                    normalizeHex(color) === null
                      ? "#RRGGBB 형식으로 입력해 주세요."
                      : undefined
                  }
                  onChange={(event) =>
                    onChange({
                      ...value,
                      colors: colors.map((item, itemIndex) =>
                        itemIndex === index ? event.currentTarget.value : item,
                      ),
                    })
                  }
                />
              </Box>
              <ActionButton
                type="button"
                variant="ghost"
                size="medium"
                iconOnly
                aria-label={`${index + 1}번 색 삭제`}
                disabled={disabled || colors.length <= MIN_COLORS}
                onClick={() => removeColor(index)}
              >
                <Icon svg={<TrashIcon />} size={18} />
              </ActionButton>
            </HStack>
          ))}
          <ColorIndexField
            label="배경색"
            colors={colors}
            value={value.ground_color_index}
            disabled={disabled}
            onChange={(ground_color_index) =>
              onChange({ ...value, ground_color_index })
            }
          />
        </VStack>
      </AdminCard>

      <AdminCard
        title={`레이어 · ${layers.length}/${MAX_LAYERS}`}
        description="아래에서 위로 겹쳐 그립니다. 스트라이프는 배경 위의 띠, 모티프는 반복 배치입니다."
        action={
          <HStack gap="x2" wrap>
            <ActionButton
              type="button"
              variant="neutralWeak"
              disabled={disabled || layers.length >= MAX_LAYERS}
              onClick={() =>
                onChange({
                  ...value,
                  layers: [...layers, defaultStripeLayer()],
                })
              }
            >
              스트라이프 추가
            </ActionButton>
            <ActionButton
              type="button"
              variant="neutralWeak"
              disabled={
                disabled ||
                layers.length >= MAX_LAYERS ||
                motifNames.length === 0
              }
              onClick={() =>
                onChange({
                  ...value,
                  layers: [...layers, defaultMotifLayer((unused[0] ?? 1) - 1)],
                })
              }
            >
              모티프 추가
            </ActionButton>
          </HStack>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          {motifNames.length === 0 && (
            <Callout
              tone="informative"
              title="모티프를 고르면 모티프 레이어를 추가할 수 있습니다"
              description="색과 스트라이프만으로도 유효한 시범입니다."
            />
          )}
          {unused.length > 0 && (
            <Callout
              tone="warning"
              title={`${unused.join(", ")}번 모티프를 쓰는 레이어가 없습니다`}
              description="고른 모티프는 모두 레이어에서 한 번 이상 써야 저장할 수 있습니다."
            />
          )}
          {layers.length === 0 && (
            <Text textStyle="bodySm" color="fg.neutral-muted">
              레이어가 없으면 배경색만 있는 단색 타일이 됩니다.
            </Text>
          )}
          {layers.map((layer, index) => (
            <LayerFrame
              key={`layer-${index}-${layers.length}-${layer.type}`}
              title={
                layer.type === "stripe"
                  ? `${index + 1}. 스트라이프`
                  : `${index + 1}. 모티프 ${layer.motif_index + 1}`
              }
              tone={layer.type === "stripe" ? "neutral" : "informative"}
              removeLabel={`${index + 1}번 레이어 삭제`}
              disabled={disabled}
              onRemove={() =>
                onChange({
                  ...value,
                  layers: layers.filter((_, itemIndex) => itemIndex !== index),
                })
              }
            >
              {layer.type === "stripe" ? (
                <StripeLayerFields
                  layer={layer}
                  colors={colors}
                  disabled={disabled}
                  onChange={(next) => setLayer(index, next)}
                />
              ) : (
                <MotifLayerFields
                  layer={layer}
                  colors={colors}
                  stripes={stripes}
                  motifNames={motifNames}
                  disabled={disabled}
                  onChange={(next) => setLayer(index, next)}
                />
              )}
            </LayerFrame>
          ))}
        </VStack>
      </AdminCard>
    </VStack>
  );
}
