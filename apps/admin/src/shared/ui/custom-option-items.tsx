import type { DetailItem } from "./detail-list";
import { OptionPair } from "./option-pair";

/**
 * 주문 제작·샘플·견적의 제작 사양(`options`)을 관리자용 행으로 바꾼다.
 * 고른 값만 나열하지 않고 선택지를 모두 그려 고른 쪽만 채운다(OptionPair) — 무엇을 안 골랐는지가
 * 작업 지시에 필요하다. 값 해석은 스토어가 보내는 형태를 따른다
 * (apps/store/src/features/custom-order/model/options.ts customOrderApiOptions,
 * apps/store/src/features/sample-order/model/options.ts sampleOrderApiOptions).
 *
 * 없는 것과 안 고른 것을 구별한다: 키가 `options`에 없으면 그 행·선택지를 만들지 않는다
 * (샘플 주문에는 봉제 옵션이 없다). 선택지에 없는 값은 선택지를 그리지 않고 글자로 보여 준다.
 */

type Choices = readonly (readonly [value: string, label: string])[];

const FABRIC: Choices = [
  ["POLY", "폴리"],
  ["SILK", "실크"],
];
const DESIGN: Choices = [
  ["PRINTING", "날염"],
  ["YARN_DYED", "선염"],
];
const POINT: Choices = [
  ["", "없음"],
  ["EMBROIDERY", "자수"],
  ["HEAT_TRANSFER", "열전사 필름"],
];
const TIE: Choices = [
  ["", "수동 타이"],
  ["AUTO", "자동 타이"],
];
const INTERLINING: Choices = [
  ["", "폴리"],
  ["WOOL", "울"],
];
const SIZE: Choices = [
  ["ADULT", "성인용"],
  ["CHILD", "아동용"],
];
const YES_NO = (no: string, yes: string): Choices => [
  ["false", no],
  ["true", yes],
];

// 라벨 표기는 스토어 주문서를 따른다.
const FINISHING = [
  ["triangle_stitch", "삼각 봉제"],
  ["side_stitch", "옆선 봉제"],
  ["bar_tack", "바택"],
  ["fold7", "7폴드"],
  ["spoderato", "스포데라토"],
  ["brand_label", "브랜드 라벨"],
  ["care_label", "케어 라벨"],
] as const;
const LABEL_KEYS: ReadonlySet<string> = new Set(["brand_label", "care_label"]);
const AUTO_ONLY = [
  ["dimple", "딤플"],
  ["turn_knot", "돌려묶기"],
] as const;

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "reorder",
  "fabric_provided",
  "point",
  "fabric_type",
  "design_type",
  "tie_type",
  "interlining",
  "size_type",
  "tie_width",
  ...FINISHING.map(([key]) => key),
  ...AUTO_ONLY.map(([key]) => key),
]);
const TECHNICAL_KEYS: ReadonlySet<string> = new Set([
  "object_key",
  "image_id",
  "upload_id",
]);
// 예전 견적이 쓰던 키·값 — 표 밖의 글자 행으로 보여 줄 때만 쓴다.
const LEGACY_LABELS: Record<string, string> = { fabric: "원단", width: "규격" };
const LEGACY_VALUES: Record<string, string> = {
  silk: "실크",
  standard: "기본",
};

function plainText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "string") return LEGACY_VALUES[value] ?? value;
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return String(value);
  }
}

const flag = (value: unknown) =>
  typeof value === "boolean" ? String(value) : value;

/** 값이 선택지 안에 있으면 선택지 전체를, 없으면 값을 글자로. */
function choice(choices: Choices, value: unknown, emptyText?: string) {
  const empty = value === null || value === undefined || value === "";
  if (empty && emptyText !== undefined) return emptyText;
  const key = empty ? "" : String(value);
  const match = choices.find(([candidate]) => candidate === key);
  if (!match) return plainText(value) ?? "미지정";
  return (
    <OptionPair
      options={choices.map(([, label]) => label)}
      selected={match[1]}
    />
  );
}

export function customOptionItems(options: unknown): DetailItem[] {
  if (typeof options !== "object" || options === null) return [];
  const data = options as Record<string, unknown>;
  const has = (key: string) => key in data;
  const selected = (key: string) => data[key] === true;
  // 포인트 주문은 정해진 넥타이 위에 자수·필름만 올린다 — 원단은 고르지 않고, 고를 수 있는 건
  // 타이 방식·라벨뿐이다. 나머지는 값이 실제로 골라져 있을 때만 보여 준다(예전 주문은 받았다).
  const point = data.point === "EMBROIDERY" || data.point === "HEAT_TRANSFER";
  const autoTie = data.tie_type === "AUTO";
  const items: DetailItem[] = [];

  if (has("reorder")) {
    items.push({
      label: "주문 구분",
      value: choice(YES_NO("신규", "재주문"), flag(data.reorder)),
    });
  }
  if (has("fabric_provided") && !point) {
    items.push({
      label: "원단 제공",
      value: choice(
        YES_NO("당사 원단", "고객 제공"),
        flag(data.fabric_provided),
      ),
    });
  }
  if (has("point")) {
    items.push({ label: "포인트", value: choice(POINT, data.point) });
  }
  if (has("fabric_type") && !point) {
    items.push({
      label: "원단",
      value: choice(FABRIC, data.fabric_type, "해당 없음"),
    });
  }
  if (has("design_type") && !point) {
    items.push({
      label: "디자인 방식",
      value: choice(DESIGN, data.design_type, "해당 없음"),
    });
  }
  if (has("tie_type")) {
    items.push({
      label: "타이 방식",
      // 스토어는 수동을 빈 값으로 보낸다. 예전 데이터의 MANUAL도 수동이다.
      value: choice(TIE, data.tie_type === "MANUAL" ? "" : data.tie_type),
    });
  }
  if (has("interlining") && !(point && data.interlining !== "WOOL")) {
    items.push({
      label: "심지",
      value: choice(
        INTERLINING,
        data.interlining === "POLY" ? "" : data.interlining,
      ),
    });
  }
  if (has("size_type") && !(point && data.size_type == null)) {
    items.push({
      label: "사이즈",
      value: choice(SIZE, data.size_type, "미입력"),
    });
  }
  if (has("tie_width") && !(point && data.tie_width == null)) {
    items.push({
      label: "타이 폭",
      value:
        typeof data.tie_width === "number" ? `${data.tie_width}cm` : "미입력",
    });
  }

  const finishing = FINISHING.filter(
    ([key]) => has(key) && (!point || LABEL_KEYS.has(key) || selected(key)),
  );
  if (finishing.length > 0) {
    items.push({
      label: "봉제·마감",
      value: (
        <OptionPair
          options={finishing.map(([, label]) => label)}
          selected={finishing
            .filter(([key]) => selected(key))
            .map(([, label]) => label)}
        />
      ),
    });
  }

  // 수동 타이에는 없는 옵션이라 평소엔 숨긴다. 고른 값이 있으면(예전 데이터) 숨기지 않는다.
  const autoOnly = AUTO_ONLY.filter(([key]) => has(key));
  const autoChosen = autoOnly.filter(([key]) => selected(key));
  if (autoOnly.length > 0 && ((autoTie && !point) || autoChosen.length > 0)) {
    items.push({
      label: "[자동] 옵션",
      value: (
        <OptionPair
          options={autoOnly.map(([, label]) => label)}
          selected={autoChosen.map(([, label]) => label)}
        />
      ),
    });
  }

  // 표에 없는 키는 버리지 않고 글자 행으로 붙인다.
  for (const [key, value] of Object.entries(data)) {
    if (KNOWN_KEYS.has(key) || TECHNICAL_KEYS.has(key)) continue;
    const text = plainText(value);
    if (text !== null) {
      items.push({
        label: LEGACY_LABELS[key] ?? key.replaceAll("_", " "),
        value: text,
      });
    }
  }
  return items;
}
