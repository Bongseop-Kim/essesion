import {
  ActionButton,
  Badge,
  Box,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";

import {
  customOrderApiOptions,
  DEFAULT_CUSTOM_ORDER_OPTIONS,
} from "@/features/custom-order/model/options";
import { useCustomQuote } from "@/features/custom-order/model/use-custom-quote";
import { krw } from "@/shared/lib/format";
import {
  Eyebrow,
  GuideSection,
  Lead,
  SectionTitle,
} from "@/shared/ui/guide-section";

const IMG = "/images/custom-order";

// 가격 예시 — 주문서 기본 사양(폴리·선염·수동·울 심지·성인·삼각/옆선 봉제) 100개를 서버 계산으로 보여 준다.
const PRICE_EXAMPLE_QUANTITY = 100;
const PRICE_EXAMPLE_PAYLOAD = {
  options: customOrderApiOptions(DEFAULT_CUSTOM_ORDER_OPTIONS),
  quantity: PRICE_EXAMPLE_QUANTITY,
};

const FABRIC_GAUGES = [
  ["광택", 3, 5],
  ["부드러운 촉감", 2, 5],
  ["구김에 강함", 5, 2],
  ["관리 편의", 5, 2],
  ["가격 부담", 2, 4],
] as const;

const YARN_DYE_STEPS = [
  ["1. 실 염색", "무늬에 들어갈 색으로 실을 먼저 물들여요", "yarn-dye"],
  ["2. 제직", "색실을 엮어 무늬를 짜요", "yarn-weave"],
  ["3. 원단 완성", "무늬가 실로 짜여 입체감이 있어요", "yarn-fabric"],
  ["앞·뒷면 비교", "뒷면에도 실로 짠 무늬가 보여요", "yarn-frontback"],
] as const;

const SEWING_OPTIONS = [
  [
    "딤플",
    "매듭 아래 가운데 홈이 살아 있는 입체 매듭",
    "/images/reform/knot-dimple.webp",
  ],
  ["돌려묶기", "손으로 맨 듯 자연스러운 비대칭 매듭", `${IMG}/turn-knot.webp`],
  [
    "스포데라토",
    "안감 없이 가장자리를 손으로 말아 박아요",
    "/images/reform/structure-sfoderato.webp",
  ],
  [
    "7폴드",
    "심지 없이 원단 한 장을 일곱 번 접어요",
    "/images/reform/structure-7fold.webp",
  ],
] as const;

const POINT_OPTIONS = [
  {
    title: "열전사 필름",
    tag: "가장 가벼운 비용",
    description:
      "로고를 인쇄한 필름을 열로 눌러 붙여요. 얇고 매끈하게 올라가요.",
    points: ["행사·단체 기념용으로 좋아요"],
    image: "point-heat-macro",
  },
  {
    title: "자수",
    tag: "오래 맬 넥타이라면",
    description: "실을 원단에 촘촘히 박아 넣어, 손끝에 닿는 입체감이 있어요.",
    points: [
      "한 땀씩 도톰한 고급스러운 마감",
      "오래 매도 벗겨지지 않아요",
      "기념·선물용으로 좋아요",
    ],
    image: "point-stitch",
  },
] as const;

const PROCESS_STEPS = [
  ["1. 원단 준비", "정한 무늬·색으로 원단을 준비해요"],
  ["2. 재단", "폭·사이즈에 맞춰 원단과 심지를 잘라요"],
  ["3. 봉제", "정한 매듭 방식과 옵션대로 꿰매요"],
  ["4. 마감·검수", "라벨을 달고 한 개씩 확인해요"],
] as const;

const FACTORY_MAIN = [
  ["봉제 작업장", "factory-floor"],
  ["원단 · 완성품 보관", "factory-storage"],
] as const;

const FACTORY_SUB = [
  ["재봉 라인", "factory-sewing"],
  ["2층 · 마감 설비", "factory-finishing"],
  ["2층 · 재단 · 봉제대", "factory-cutting"],
] as const;

const FACTORY_INFO = [
  ["주소", "대전광역시 동구 우암로246번길 9-16 (가양동)"],
  ["방문 상담", "방문 상담 가능해요. 편하게 들러 주세요"],
  ["운영 시간", "09:00 ~ 18:00"],
] as const;

const CERTS = [
  [
    "군복 · 군용장구 제조·판매업 허가",
    "공군참모총장 · 2023.05.09",
    "cert-army",
  ],
  [
    "경찰제복 제조·판매업 등록",
    "대전광역시경찰청장 · 대전 제22호 · 2020.03.27",
    "cert-police",
  ],
  [
    "특허 제10-1544737호",
    "방향제가 내장된 넥타이 착용구 · 2015.08.10 등록",
    "cert-patent",
  ],
] as const;

const NOTICES = [
  "제작 기간은 영업일 기준 28~42일이에요. (재주문 21~28일 · 원단 직접 제공 7~14일)",
  "맞춤 제작은 접수 후 원부자재와 공정이 배정돼서 취소·환불이 어려워요.",
  "예상 금액에는 봉제·원단 샘플 제작비가 포함돼 있어요.",
  "제주·도서산간은 추가 배송비가 생길 수 있어요.",
];

const FAQS = [
  [
    "최소 몇 개부터 되나요?",
    "4개부터 주문할 수 있어요. 4~99개는 주문서에서 바로 결제하고, 100개 이상은 견적으로 진행해요.",
  ],
  [
    "샘플을 먼저 볼 수 있나요?",
    "네. 샘플 제작 페이지에서 원단·봉제 샘플을 먼저 주문할 수 있어요. 샘플을 확인한 뒤 본 제작은 맞춤 주문으로 진행해요.",
  ],
  [
    "로고 파일이 없어도 되나요?",
    "괜찮아요. 디자인 도구의 템플릿에서 색·로고를 고르거나, 원하는 무늬·로고 사진을 5장까지 올려 주시면 그걸 보고 진행해요.",
  ],
  [
    "같은 넥타이로 다시 주문할 수 있나요? (재주문)",
    "네. 주문서에서 재주문을 선택하면 같은 사양으로 다시 만들어요. 재주문은 영업일 기준 21~28일이 걸려요.",
  ],
  [
    "직원별로 따로 보내 주나요?",
    "아니요, 한 곳으로 한꺼번에 보내 드려요. 직원별로 나눠 보내는 배송은 하지 않아요.",
  ],
  [
    "세금계산서 발행되나요?",
    "계좌이체로 결제하시면 세금계산서를 발행해 드려요. 온라인 결제는 토스페이먼츠로 진행돼요.",
  ],
] as const;

const won = (value: number) => `${krw.format(value)}원`;

/** 상세 "정보" 탭 — pen 시안 C3 v2. 가격 예시는 서버 계산값을 그대로 쓴다. */
export function CustomOrderServiceGuide({ onStart }: { onStart: () => void }) {
  const example = useCustomQuote(PRICE_EXAMPLE_PAYLOAD);
  const perUnit = (total: number) =>
    won(Math.round(total / PRICE_EXAMPLE_QUANTITY));
  const priceRows = [
    { label: "봉제 비용", value: example.data?.sewing_cost, basis: false },
    { label: "원단 비용", value: example.data?.fabric_cost, basis: false },
    { label: "개당 예상 단가", value: example.data?.total_cost, basis: true },
  ];

  return (
    <VStack gap={0} alignItems="stretch">
      {/* 01 Hero */}
      <GuideSection pb="x14">
        <Eyebrow>맞춤 넥타이 제작 · 영선산업</Eyebrow>
        <Text as="h2" textStyle="display1" className="whitespace-pre-line">
          {"우리 단체 넥타이,\n4개부터 맞춰 드려요"}
        </Text>
        <ImageFrame
          ratio={1.735}
          src={`${IMG}/hero.webp`}
          alt="같은 넥타이를 맨 단체 착용 모습"
        />
        <HStack gap="x2" wrap>
          {["4개부터 주문", "영업일 28~42일", "100개 이상 견적"].map(
            (label) => (
              <Pill key={label}>{label}</Pill>
            ),
          )}
        </HStack>
      </GuideSection>

      {/* 05 가격 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>가격</Eyebrow>
        <SectionTitle>
          {PRICE_EXAMPLE_QUANTITY}개 주문하면 개당 이 정도예요
        </SectionTitle>
        <VStack
          gap={0}
          alignItems="stretch"
          bg="bg.layer-default"
          borderRadius="r4"
          overflow="hidden"
        >
          <HStack
            justify="space-between"
            px="x7"
            py="x4"
            bg="bg.neutral-inverted"
          >
            <Text textStyle="labelSm" color="fg.contrast">
              항목
            </Text>
            <Text textStyle="labelSm" color="fg.contrast">
              개당 금액
            </Text>
          </HStack>
          {priceRows.map((row, index) => (
            <HStack
              key={row.label}
              justify="space-between"
              gap="x3"
              px="x7"
              py="x5"
              bg={index % 2 ? "bg.layer-basement" : "bg.layer-default"}
            >
              <HStack gap="x2" wrap>
                <Text textStyle="label">{row.label}</Text>
                {row.basis ? (
                  <Badge tone="warning">{PRICE_EXAMPLE_QUANTITY}개 기준</Badge>
                ) : null}
              </HStack>
              {row.value != null ? (
                <Text textStyle="title3">{perUnit(row.value)}</Text>
              ) : example.isError ? (
                <Text textStyle="title3">—</Text>
              ) : (
                <Skeleton width={80} height={24} />
              )}
            </HStack>
          ))}
        </VStack>
        <Grid columns={{ base: 1, sm: 3 }} gap="x3">
          {[
            ["제작 기간", "영업일 기준 28~42일"],
            ["100개 이상", "견적으로 진행"],
            ["진행 상황", "알림톡으로 안내"],
          ].map(([label, value]) => (
            <VStack
              key={label}
              gap="x1"
              p="x5"
              bg="bg.layer-default"
              borderRadius="r3"
            >
              <Text textStyle="caption" color="fg.neutral-muted">
                {label}
              </Text>
              <Text textStyle="label">{value}</Text>
            </VStack>
          ))}
        </Grid>
        <Text textStyle="bodySm" color="fg.neutral-muted">
          기준: 폴리 · 선염 · 수동 타이 · 성인용 · 울 심지 · 삼각·옆선 봉제 ·{" "}
          {PRICE_EXAMPLE_QUANTITY}개 총{" "}
          {example.data ? won(example.data.total_cost) : "—"}
        </Text>
      </GuideSection>

      {/* 06 원단 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>원단 · 주문서 2단계</Eyebrow>
        {/* 비교표가 있으니 사진은 보조 — md부터 제목·설명 옆에 작게 둔다 */}
        <Grid columns={{ base: 1, md: 2 }} gap="x6" alignItems="start">
          <VStack gap="x6" alignItems="stretch">
            <SectionTitle>실크와 폴리, 뭐가 다를까요?</SectionTitle>
            <Lead>
              {
                "실이 시작되는 곳부터 다릅니다.\n폴리는 석유화학 원료(PET)를 녹여 뽑고, 실크는 누에고치에서 풀어냅니다."
              }
            </Lead>
          </VStack>
          <VStack gap="x3" alignItems="stretch">
            <ImageFrame
              ratio={16 / 9}
              borderRadius="r4"
              src={`${IMG}/fabric-pair.webp`}
              alt="폴리 PET 칩과 필라멘트, 실크 누에고치와 생사"
            />
            <HStack justify="space-between" px="x4">
              <Caption>폴리 · PET 칩과 필라멘트</Caption>
              <Caption>실크 · 누에고치와 생사</Caption>
            </HStack>
          </VStack>
        </Grid>
        <Text as="h4" textStyle="title3" mt="x4">
          한눈에 비교
        </Text>
        <VStack
          gap={0}
          alignItems="stretch"
          px={{ base: "x5", md: "x10" }}
          py="x6"
          bg="bg.layer-default"
          borderRadius="r4"
        >
          <GaugeRow label="" poly="폴리" silk="실크" />
          {FABRIC_GAUGES.map(([label, poly, silk]) => (
            <GaugeRow
              key={label}
              label={label}
              poly={<Dots value={poly} />}
              silk={<Dots value={silk} />}
            />
          ))}
        </VStack>
        <Caption>일반적인 소재 특성 기준이에요.</Caption>
        <VStack gap="x2" alignItems="stretch" mt="x4">
          <Text as="h4" textStyle="title3">
            선염이란?
          </Text>
          <Text textStyle="body">
            실을 먼저 염색한 뒤, 색실을 엮어 무늬를 짜는 방식이에요. 무늬가
            인쇄가 아니라 원단 안에 짜여 있어요.
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            ※ 모든 넥타이는 선염 방식으로 만들어요.
          </Text>
        </VStack>
        <Grid columns={{ base: 2, md: 4 }} gap="x3">
          {YARN_DYE_STEPS.map(([title, description, image]) => (
            <PhotoCard
              key={title}
              title={title}
              description={description}
              image={`${IMG}/${image}.webp`}
              ratio={1}
            />
          ))}
        </Grid>
      </GuideSection>

      {/* 07 봉제 */}
      <GuideSection>
        <Eyebrow>봉제 · 주문서 3단계</Eyebrow>
        <SectionTitle>매는 방식과 매듭 모양을 골라요</SectionTitle>
        <Grid columns={2} gap="x4">
          <PhotoCard
            title="수동 타이"
            description="기본 봉제 방식"
            image={`${IMG}/tie-manual.webp`}
            ratio={0.56}
          />
          <PhotoCard
            title="자동 타이"
            description="딤플과 돌려묶기를 선택할 수 있는 봉제 방식"
            image={`${IMG}/tie-auto.webp`}
            ratio={0.56}
          />
        </Grid>
        <Text as="h4" textStyle="title3" mt="x4">
          봉제 옵션
        </Text>
        <Grid columns={{ base: 2, md: 4 }} gap="x3">
          {SEWING_OPTIONS.map(([title, description, image]) => (
            <PhotoCard
              key={title}
              title={title}
              description={description}
              image={image}
              ratio={1}
            />
          ))}
        </Grid>
        <Text textStyle="bodySm" color="fg.warning">
          ※ 딤플·돌려묶기는 자동 타이를 고르면 선택할 수 있어요. 딤플을 고르면
          돌려묶기가 함께 들어가요.
        </Text>
      </GuideSection>

      {/* 09 포인트 */}
      <GuideSection>
        <Eyebrow>포인트 · 주문서 1단계</Eyebrow>
        <SectionTitle>로고·이니셜을 더하고 싶다면, 포인트</SectionTitle>
        <Text textStyle="body">
          완성된 넥타이에 로고나 이니셜을 자수나 열전사 필름으로 더해 드려요.
          주문서 첫 단계 주문 방식에서 고르면, 정해진 원단으로 만들어 원단은
          따로 고르지 않아요.
        </Text>
        <Text as="h4" textStyle="title3">
          완성 예시
        </Text>
        <VStack gap="x2" alignItems="stretch">
          <Grid columns={2} gap="x4">
            <ImageFrame
              ratio={0.75}
              src={`${IMG}/point-heat.webp`}
              alt="열전사 필름 컬러 로고 완성 예시"
            />
            <ImageFrame
              ratio={0.75}
              src={`${IMG}/point-embroidery.webp`}
              alt="흰 실 자수 완성 예시"
            />
          </Grid>
          <Text textStyle="bodySm">
            왼쪽 · 열전사 필름, 컬러 로고 / 오른쪽 · 자수, 흰 실 '영선'
          </Text>
        </VStack>
        <Text as="h4" textStyle="title3" mt="x4">
          자수와 열전사, 두 가지 중에 골라요
        </Text>
        <Grid columns={{ base: 1, sm: 2 }} gap="x5">
          {POINT_OPTIONS.map((option) => (
            <VStack key={option.title} gap="x2_5" alignItems="stretch">
              <ImageFrame
                ratio={1.55}
                src={`${IMG}/${option.image}.webp`}
                alt={option.title}
              />
              <HStack gap="x2" pt="x1_5" wrap>
                <Text as="h5" textStyle="title2">
                  {option.title}
                </Text>
                <Badge>{option.tag}</Badge>
              </HStack>
              <Text textStyle="bodySm">{option.description}</Text>
              <VStack gap="x1" alignItems="stretch">
                {option.points.map((point) => (
                  <Caption key={point}>· {point}</Caption>
                ))}
              </VStack>
            </VStack>
          ))}
        </Grid>
        <Grid columns={{ base: 1, sm: 2 }} gap="x6" alignItems="center" py="x3">
          <ImageFrame
            ratio={1.5}
            src={`${IMG}/point-position.webp`}
            alt="자수·열전사를 넣는 자리"
          />
          <VStack gap="x1_5" alignItems="stretch">
            <CardTitle>이름·이니셜·로고, 원하는 자리에</CardTitle>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              자수와 열전사 모두 원하는 자리에 작게 넣을 수 있어요. 선물로도
              좋아요.
            </Text>
          </VStack>
        </Grid>
        <HStack gap="x2" wrap>
          {["주문서 1단계에서 선택", "자수 · 열전사 선택", "로고 · 이니셜"].map(
            (label) => (
              <Pill key={label}>{label}</Pill>
            ),
          )}
        </HStack>
      </GuideSection>

      {/* 10 제작 과정 */}
      <GuideSection>
        <Eyebrow>제작 과정</Eyebrow>
        <SectionTitle>원단부터 검수까지, 네 단계로 만들어요</SectionTitle>
        <Grid columns={{ base: 2, md: 4 }} gap="x3">
          {PROCESS_STEPS.map(([title, description], index) => (
            <PhotoCard
              key={title}
              title={title}
              description={description}
              image={`${IMG}/process-${index + 1}.webp`}
              ratio={1.07}
            />
          ))}
        </Grid>
      </GuideSection>

      {/* 11 공장 · 외관 · 자격 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>공장 · 작업장</Eyebrow>
        <SectionTitle>
          재단부터 봉제·마감까지, 우리 공장에서 직접 해요
        </SectionTitle>
        <Lead>
          대전 가양동 공장에서 원단 재단, 봉제, 마감, 검수까지 한 공간에서
          진행해요.
        </Lead>
        <Grid columns={2} gap="x4">
          {FACTORY_MAIN.map(([title, image]) => (
            <FactoryPhoto key={title} title={title} image={image} />
          ))}
        </Grid>
        <Grid columns={{ base: 2, sm: 3 }} gap="x4">
          {FACTORY_SUB.map(([title, image]) => (
            <FactoryPhoto key={title} title={title} image={image} />
          ))}
        </Grid>
        <Text as="h4" textStyle="title3" mt="x4">
          건물 구조
        </Text>
        <Grid columns={{ base: 1, sm: 2 }} gap="x4">
          {["1f", "2f"].map((floor) => (
            <Box key={floor} bg="bg.layer-default" borderRadius="r2">
              <ImageFrame
                ratio={1.5}
                fit="contain"
                src={`${IMG}/factory-plan-${floor}.webp`}
                alt={`공장 ${floor === "1f" ? "1층" : "2층"} 구조도`}
              />
            </Box>
          ))}
        </Grid>

        <VStack gap="x5" alignItems="stretch" pt="x10">
          <Text as="h4" textStyle="title2">
            대전 동구, 영선산업 공장이에요
          </Text>
          <Grid columns={{ base: 1, sm: 2 }} gap="x8" alignItems="center">
            <ImageFrame
              ratio={0.75}
              src={`${IMG}/factory-exterior.webp`}
              alt="영선산업 공장 외관"
            />
            <VStack gap="x5" alignItems="stretch">
              {FACTORY_INFO.map(([label, value]) => (
                <VStack key={label} gap="x1" alignItems="stretch">
                  <Text textStyle="caption" color="fg.neutral-muted">
                    {label}
                  </Text>
                  <Text textStyle="label">{value}</Text>
                </VStack>
              ))}
            </VStack>
          </Grid>
        </VStack>

        <VStack gap="x5" alignItems="stretch" pt="x10">
          <Text as="h4" textStyle="title2">
            군복 · 경찰 제복을 만드는 허가를 받은 곳이에요
          </Text>
          <Lead>
            공공기관 제복을 만들려면 별도 허가가 필요해요. 군복·경찰 제복 제조
            허가와 넥타이 관련 특허를 갖고 있어요.
          </Lead>
          <Grid columns={{ base: 1, sm: 3 }} gap="x4">
            {CERTS.map(([title, description, image]) => (
              <VStack key={title} gap="x2" alignItems="stretch">
                <Box bg="bg.layer-default" borderRadius="r2">
                  <ImageFrame
                    ratio={0.75}
                    fit="contain"
                    src={`${IMG}/${image}.webp`}
                    alt={title}
                  />
                </Box>
                <CardTitle>{title}</CardTitle>
                <Caption>{description}</Caption>
              </VStack>
            ))}
          </Grid>
        </VStack>
      </GuideSection>

      {/* 12 주문 전 확인 */}
      <GuideSection pt="x14" pb="x14">
        <VStack
          gap="x2_5"
          alignItems="stretch"
          p="x6"
          bg="bg.warning-weak"
          borderRadius="r2"
        >
          <Text as="h3" textStyle="title3">
            주문 전 꼭 확인해 주세요
          </Text>
          <VStack as="ul" gap="x1" alignItems="stretch">
            {NOTICES.map((notice) => (
              <Text
                as="li"
                key={notice}
                textStyle="bodySm"
                color="fg.neutral-muted"
              >
                · {notice}
              </Text>
            ))}
          </VStack>
        </VStack>
      </GuideSection>

      {/* 13 자주 묻는 질문 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>자주 묻는 질문</Eyebrow>
        <SectionTitle>자주 묻는 질문</SectionTitle>
        {/* 수선 FAQ와 같은 카드형 */}
        <Box bg="bg.layer-default" borderRadius="r4" overflow="hidden">
          <VStack>
            {FAQS.map(([question, answer]) => (
              <VStack
                key={question}
                gap="x3"
                px="x6"
                py="x5"
                className="border-b border-stroke-neutral-weak last:border-b-0"
              >
                <Text textStyle="label">Q. {question}</Text>
                <Text textStyle="body" color="fg.neutral-muted">
                  {answer}
                </Text>
              </VStack>
            ))}
          </VStack>
        </Box>
      </GuideSection>

      {/* 14 CTA */}
      <GuideSection bg="bg.neutral-inverted" alignItems="center">
        <Text
          as="h2"
          textStyle="display1"
          color="fg.contrast"
          align="center"
          className="whitespace-pre-line"
        >
          {"우리 단체 넥타이,\n사양부터 골라 보세요"}
        </Text>
        <Text textStyle="body" color="fg.contrast" align="center">
          주문서에서 고르면 예상 금액이 바로 나와요
        </Text>
        <ActionButton variant="neutralWeak" size="large" onClick={onStart}>
          주문서에서 사양 고르기
        </ActionButton>
      </GuideSection>
    </VStack>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <Box px="x3_5" py="x2" bg="bg.neutral-weak" borderRadius="full">
      <Text textStyle="labelSm">{children}</Text>
    </Box>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h4" textStyle="title3">
      {children}
    </Text>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="caption" color="fg.neutral-muted">
      {children}
    </Text>
  );
}

function PhotoCard({
  title,
  description,
  image,
  ratio,
}: {
  title: string;
  description: string;
  image: string;
  ratio: number;
}) {
  return (
    <VStack gap="x2" alignItems="stretch">
      <ImageFrame ratio={ratio} src={image} alt={title} />
      <CardTitle>{title}</CardTitle>
      <Caption>{description}</Caption>
    </VStack>
  );
}

function FactoryPhoto({ title, image }: { title: string; image: string }) {
  return (
    <VStack gap="x2" alignItems="stretch">
      <ImageFrame ratio={4 / 3} src={`${IMG}/${image}.webp`} alt={title} />
      <Text textStyle="labelSm">{title}</Text>
    </VStack>
  );
}

function GaugeRow({
  label,
  poly,
  silk,
}: {
  label: string;
  poly: ReactNode;
  silk: ReactNode;
}) {
  const head = label === "";
  return (
    <Grid
      templateColumns="minmax(0, 1.3fr) 1fr 1fr"
      alignItems="center"
      py={head ? "x2" : "x4_5"}
      className={head ? undefined : "border-t border-stroke-neutral-weak"}
    >
      <Text textStyle="label">{label}</Text>
      {[poly, silk].map((cell, index) => (
        <HStack key={index} justify="center">
          {head ? (
            <Text textStyle="title3" align="center">
              {cell}
            </Text>
          ) : (
            cell
          )}
        </HStack>
      ))}
    </Grid>
  );
}

function Dots({ value }: { value: number }) {
  return (
    <HStack gap={{ base: "x1", md: "x2" }} aria-label={`5점 중 ${value}점`}>
      {[1, 2, 3, 4, 5].map((dot) => (
        <Box
          key={dot}
          width={12}
          height={12}
          borderRadius="full"
          bg={dot <= value ? "bg.neutral-inverted" : "bg.neutral-weak"}
        />
      ))}
    </HStack>
  );
}
