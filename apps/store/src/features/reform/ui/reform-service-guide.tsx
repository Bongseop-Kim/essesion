import type { ReformPricingOut } from "@essesion/api-client";
import {
  ActionButton,
  AspectRatio,
  Badge,
  Box,
  cn,
  Float,
  Grid,
  HStack,
  ImageFrame,
  recommendedTieLengthCm,
  ScrollFog,
  Text,
  VStack,
} from "@essesion/shared";
import { type ReactNode, useEffect, useRef } from "react";

import { Link } from "react-router";

import { krw } from "@/shared/lib/format";
import {
  Eyebrow,
  GuideSection,
  Lead,
  SectionTitle,
  SubTitle,
  type SurfaceColor,
} from "@/shared/ui/guide-section";

const IMG = "/images/reform";

// 안내표의 권장 길이는 admin·주문 상세와 같은 환산식(recommendedTieLengthCm)으로 계산한다.
const HEIGHT_GUIDE = [150, 155, 160, 165, 170, 175, 180, 185, 190].map(
  (height) => ({ height, length: recommendedTieLengthCm(height) }),
);

const CONCERNS = [
  {
    title: "폭이 넓어서 안 매게 돼요",
    description:
      "예전엔 9cm 넘는 넥타이가 흔했는데, 요즘 슬림한 정장에 매면 넥타이만 묵직해 보여요.",
    image: "concern-wide",
  },
  {
    title: "교복 넥타이, 자동으로 바꾸고 싶어요",
    description:
      "교복이나 유니폼 넥타이를 자동으로 바꿔 주는 곳, 막상 찾아보면 거의 없어요.",
    image: "concern-school",
  },
  {
    title: "매는 게 번거로워요",
    description:
      "솔직히 넥타이 맬 때마다 좀 답답하잖아요. 그래서 매듭째 걸어 두기도 하고요.",
    image: "concern-knotted",
  },
  {
    title: "잘못 빨아서 모양이 틀어졌어요",
    description:
      "세탁하고 나니 넥타이가 비틀리고 끝이 헤져서, 꺼내 매기 민망해졌어요.",
    image: "concern-washed",
  },
] as const;

const RECOMMENDED = [
  ["결혼식·상견례를 앞두고", "아버지가 아끼던 넥타이를 다시 매고 싶은 분"],
  ["교복·유니폼 넥타이를", "매일 매야 하는 학생과 직장인"],
  ["폭 넓은 명품 넥타이가", "유행이 지나 서랍에만 있는 분"],
  ["매듭 매는 게 서툴러서", "넥타이 자리를 피하게 되는 분"],
] as const;

const TAGS = [
  "#아버지넥타이",
  "#혼주넥타이",
  "#교복넥타이",
  "#유니폼넥타이",
  "#명품넥타이수선",
];

const REVIEWS = [
  {
    quote: "“아버지가 아끼던 넥타이를 폭만 줄였는데 새 것 같아요”",
    image: "review-1",
  },
  {
    quote:
      "“아이 키에 맞춰 자동으로 바꿔 주셔서, 아침마다 넥타이 매 줄 일이 없어졌어요”",
    image: "review-2",
  },
] as const;

const STRUCTURES = [
  {
    title: "일반 넥타이",
    cue: "꼭짓점까지 심지가 들어 있어요",
    description:
      "삼각 꼭짓점 끝까지 심지가 들어 있고, 우라(안감)가 심지를 감싸 마감해요.",
    image: "structure-standard",
  },
  {
    title: "7폴드",
    cue: "원단이 여러 겹 접혀 있어요",
    description: "심지 없이 원단 한 장을 일곱 번 접어 형태와 무게를 잡아요.",
    image: "structure-7fold",
  },
  {
    title: "스포데라토",
    cue: "대검 끝에 심지를 두지 않아요",
    description: "심지를 줄여 넥타이가 가볍고, 손봉제로 자연스럽게 마감해요.",
    image: "structure-sfoderato",
  },
] as const;

const AUTO_POINTS = [
  {
    title: "원단 그대로,\n구조만 바꿔요",
    description: "쓰던 넥타이 원단을 그대로 써서 무늬가 살아 있어요",
    video: "point-fabric.mp4",
    poster: "point-fabric",
    label: "넥타이 원단 작업 영상",
  },
  {
    title: "해 주는 곳이 드문 이유,\n전용 몰드",
    description:
      "자동 넥타이에는 전용 몰드가 들어가는데, 이걸 갖춘 곳이 거의 없어요. 저희는 직접 개발해서 딤플까지 자연스럽게 잡혀요.",
    video: "reform-vertical.mp4",
    poster: "point-mold",
    label: "자동 넥타이 몰드 작업 영상",
  },
  {
    title: "지퍼와 끈 중에\n골라요",
    description: "주문할 때 편한 방식으로 고르시면 돼요",
    video: "point-mechanism.mp4",
    poster: "point-mechanism",
    label: "자동 넥타이 봉제 영상",
  },
] as const;

const MECHANISMS = [
  {
    title: "지퍼 방식",
    description: "슬라이더를 올려 길이를 맞추고, 내리면 고정돼요.",
    badge: "딤플 · 돌려묶기 추가 가능",
    image: "mechanism-zipper",
  },
  {
    title: "끈 방식",
    description: "원터치 버튼을 누른 채 길이를 맞추고, 손을 떼면 고정돼요.",
    badge: "돌려묶기 추가 가능",
    image: "mechanism-string",
  },
] as const;

const KNOTS = [
  { title: "기본", description: "매끈하고 단정한 매듭", image: "knot-basic" },
  {
    title: "딤플",
    description: "매듭 아래 보조개 같은 주름",
    image: "knot-dimple",
  },
  {
    title: "돌려묶기",
    description: "손으로 묶은 것처럼 자연스러운 매듭",
    image: "knot-turn",
  },
] as const;

const WIDTH_POINTS = [
  {
    title: "원하는 폭을\n적어 주세요",
    description: "주문할 때 희망 폭을 적어 주시면 그대로 맞춰요",
  },
  {
    title: "완전히 뜯어서\n다시 봉제해요",
    description:
      "처음부터 다시 지어서 두께도 무늬도 자연스러워요. 이 과정은 손으로만 할 수 있어요.",
  },
  {
    title: "브랜드마다 다른 봉제,\n경험으로 맞춰요",
    description:
      "넥타이는 브랜드마다 봉제 방식이 조금씩 달라요. 30년 넥타이를 만들어 온 경험으로 원래 방식에 맞춰 다시 지어요.",
  },
] as const;

const WIDTH_STEPS = [
  { title: "치수대로 다시 재단", image: "width-cut" },
  { title: "손으로 다시 봉제", image: "width-sew" },
  { title: "다림질로 잡은 모양", image: "width-press" },
] as const;

const WORKSHOP_STEPS = [
  {
    title: "받아서 확인",
    description:
      "도착하면 넥타이 상태부터 사진으로 남겨요. 주문하신 내용과 치수를 한 번 더 맞춰 보고 시작해요.",
    image: "workshop-check",
  },
  {
    title: "재단",
    description:
      "자를 대고 치수대로 잘라요. 실크는 조금만 삐뚤어져도 티가 나서 천천히 해요.",
    image: "workshop-cut",
  },
  {
    title: "손 봉제",
    description:
      "넥타이 봉제는 기계로 한 번에 끝낼 수 없어서 손이 꼭 들어가요. 얇고 미끄러운 원단이라 시접을 일정하게 잡는 데 신경을 많이 써요.",
    image: "workshop-sew",
  },
  {
    title: "다림질·마무리",
    description:
      "다림질로 모양을 잡고, 완성된 모습을 사진으로 남긴 뒤 보내 주신 포장 그대로 담아 돌려보내요.",
    image: "workshop-press",
  },
] as const;

const HOW_STEPS = [
  {
    title: "사진 올리기",
    description: "수선할 넥타이마다 사진을 올려요",
    image: "how-upload",
  },
  {
    title: "수선 고르기",
    description: "수선 종류와 착용자 키·희망 폭을 입력해요",
    image: "how-options",
  },
  {
    title: "결제 후 보내기",
    description: "결제하고 넥타이를 택배로 보내 주세요",
    image: "how-ship",
  },
] as const;

const NOTICES = [
  "자동 넥타이로 바꾸면 원래대로 되돌릴 수 없어요. 원단을 잘라 다시 짓는 작업이에요.",
  "폭 수선과 원상태 복원은 넥타이 상태에 따라 다시 손볼 수 있는지가 달라요. 필요하면 따로 말씀드릴게요.",
  "원단이 찢어졌거나 얼룩이 남은 경우는 복구할 수 없고, 세탁도 하지 않아요.",
  "작업 전에 요청하신 내용과 치수를 한 번 더 확인하고 시작해요. 그래도 저희 실수로 손상됐다면 수선비를 돌려드리고, 소비자분쟁해결기준에 따라 배상해요.",
  "넥타이를 보내시기 전에는 전액 취소돼요.",
];

const FAQS = [
  [
    "얼마나 걸려요?",
    "넥타이가 도착하면 영업일 기준 평균 2~4일 안에 작업을 마쳐요. 택배로 오가는 기간은 따로 걸려요.",
  ],
  [
    "자동으로 바꾸면 길이는 어떻게 맞춰요?",
    "주문할 때 착용하실 분 키를 적어 주시면 권장 길이에 맞춰요. 체형이나 매는 위치에 따라 상담하고 조정할 수도 있어요.",
  ],
  [
    "여러 개 한꺼번에 맡겨도 되나요?",
    "네. 넥타이마다 사진을 올리고, 같은 요청은 한 번에 적용해서 접수하시면 돼요.",
  ],
  [
    "7폴드나 스포데라토 넥타이도 되나요?",
    "네, 폭 수선·자동 넥타이 변환·원상태 복원 모두 가능하고 가격도 같아요. 구조가 달라서 그 구조에 맞춰 뜯고 다시 지어요.",
  ],
  [
    "마음에 안 들면 되돌릴 수 있나요?",
    "자동 넥타이로 바꾼 건 되돌릴 수 없어요. 폭 수선과 원상태 복원은 넥타이 상태에 따라 다시 손볼 수 있는 경우도 있어서, 먼저 문의해 주세요.",
  ],
  [
    "세탁이나 얼룩 제거도 되나요?",
    "세탁과 얼룩 제거는 하지 않아요. 다만 잘못 세탁해서 틀어진 넥타이는 원상태 복원으로 처음 상태에 가깝게 되돌릴 수 있어요. 원단이 찢어진 경우는 어려워요.",
  ],
] as const;

const AUTO_ID = "reform-guide-automatic";
const WIDTH_ID = "reform-guide-width";
const RESTORE_ID = "reform-guide-restoration";

const won = (value: number) => `${krw.format(value)}원`;

/** 상세 "정보" 탭 — pen 시안 R-B v8. 가격은 하드코딩하지 않고 수선 요금 설정을 그대로 쓴다. */
export function ReformServiceGuide({
  pricing,
  onStart,
}: {
  pricing: ReformPricingOut;
  onStart: () => void;
}) {
  const services = [
    {
      id: AUTO_ID,
      title: "자동 넥타이 변환",
      description: "매듭을 고정해 두고\n목에 끼워 길이만 맞춰요",
      price: pricing.automatic_cost,
      image: "service-auto",
    },
    {
      id: WIDTH_ID,
      title: "폭 수선",
      description: "다 뜯어서 원하는 폭으로\n다시 만들어요",
      price: pricing.width_cost,
      image: "service-width",
    },
    {
      id: RESTORE_ID,
      title: "원상태 복원",
      description: "헤지고 틀어진 넥타이를\n처음 샀을 때처럼",
      price: pricing.restoration_cost,
      image: "service-restore",
    },
  ];
  const bundles = [
    { label: "폭 + 복원", price: pricing.width_restoration_cost },
    { label: "자동 + 폭 또는 복원", price: pricing.automatic_combined_cost },
  ];
  const fromPrice = Math.min(
    pricing.automatic_cost,
    pricing.width_cost,
    pricing.restoration_cost,
  );

  return (
    <VStack gap={0} alignItems="stretch">
      {/* 01 Hero */}
      <GuideSection pt="x16" pb="x14">
        <Eyebrow>넥타이 수선 · 영선산업 수선실</Eyebrow>
        <Text as="h2" textStyle="display1" className="whitespace-pre-line">
          {"서랍 속 넥타이,\n버리지 말고 보내 주세요"}
        </Text>
        <Lead>
          {
            "폭 줄임, 자동 넥타이 변환, 원상태 복원까지.\n30년 동안 넥타이를 만들어 온 영선산업이 직접 고쳐요. 사진 한 장이면 접수돼요."
          }
        </Lead>
        <ReformVideo
          src={`${IMG}/reform.mp4`}
          poster={`${IMG}/hero-poster.webp`}
          ratio={4 / 3}
          label="넥타이 수선 작업 영상"
        />
        <Grid columns={3} gap="x2" py="x5">
          {[
            ["수선 비용", `${won(fromPrice)}부터`],
            ["작업 기간", "평균 2~4일"],
            ["접수 방법", "전국 택배"],
          ].map(([label, value]) => (
            <VStack key={label} gap="x1" alignItems="center">
              <Text textStyle="caption" color="fg.neutral-muted">
                {label}
              </Text>
              <Text textStyle="title3" align="center">
                {value}
              </Text>
            </VStack>
          ))}
        </Grid>
        <Text textStyle="captionSm" color="fg.neutral-muted" align="center">
          작업 기간은 넥타이가 도착한 뒤 영업일 기준이에요. 택배로 오가는 기간은
          따로 걸려요.
        </Text>
      </GuideSection>

      {/* 02 공감 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>버리기 전에</Eyebrow>
        <SectionTitle>{"이런 넥타이,\n하나쯤 있으시죠"}</SectionTitle>
        <Grid columns={{ base: 1, sm: 2 }} gap="x4">
          {CONCERNS.map((concern) => (
            <Card key={concern.title} bg="bg.layer-default">
              <ImageFrame
                ratio={5 / 3}
                borderRadius={0}
                src={`${IMG}/${concern.image}.webp`}
                alt=""
              />
              <CardText title={concern.title}>{concern.description}</CardText>
            </Card>
          ))}
        </Grid>
        <Text textStyle="title3" align="center">
          버리기 전에 한 번 보내 보세요. 고칠 수 있는지 먼저 봐 드릴게요.
        </Text>
      </GuideSection>

      {/* 02-1 이런 분께 */}
      <GuideSection>
        <Eyebrow>이런 분께</Eyebrow>
        <SectionTitle>
          {"버리긴 아깝고,\n그냥 매기엔 아쉬운 넥타이가 있다면"}
        </SectionTitle>
        <VStack
          gap={0}
          alignItems="stretch"
          borderRadius="r4"
          overflow="hidden"
        >
          {RECOMMENDED.map(([context, who], index) => (
            <HStack
              key={who}
              gap="x4"
              px="x6"
              py="x5"
              bg={index % 2 ? "bg.layer-basement" : "bg.layer-default"}
            >
              <NumberDot>✓</NumberDot>
              <VStack gap="x0_5">
                <Text textStyle="bodySm" color="fg.neutral-muted">
                  {context}
                </Text>
                <Text textStyle="title3">{who}</Text>
              </VStack>
            </HStack>
          ))}
        </VStack>
        <HStack gap="x2" wrap>
          {TAGS.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </HStack>
      </GuideSection>

      {/* 02-2 리뷰 하이라이트 */}
      <GuideSection>
        <Eyebrow>실제 후기</Eyebrow>
        <SectionTitle>맡겨 본 분들이 먼저 말해요</SectionTitle>
        <HStack gap="x2">
          <Text textStyle="body">★★★★★</Text>
          <Text textStyle="label">5.0</Text>
        </HStack>
        <Grid columns={{ base: 1, sm: 2 }} gap="x4">
          {REVIEWS.map((review) => (
            <VStack key={review.image} gap="x3" alignItems="stretch">
              <ImageFrame
                ratio={0.825}
                borderRadius="r4"
                src={`${IMG}/${review.image}.webp`}
                alt="고객 후기 사진"
              />
              <Text textStyle="captionSm">★★★★★</Text>
              <Text textStyle="title3">{review.quote}</Text>
            </VStack>
          ))}
        </Grid>
      </GuideSection>

      {/* 03 서비스 */}
      <GuideSection bg="bg.neutral-weak" pb="x10">
        <Eyebrow>서비스</Eyebrow>
        <SectionTitle>어떤 수선이 필요하세요?</SectionTitle>
        <Grid columns={{ base: 1, md: 3 }} gap="x3">
          {services.map((service) => (
            <Card key={service.id} bg="bg.layer-default">
              <ImageFrame
                ratio={0.79}
                borderRadius={0}
                src={`${IMG}/${service.image}.webp`}
                alt=""
              />
              <CardText title={service.title}>{service.description}</CardText>
              <HStack justify="space-between" px="x5" pt="x1">
                <Text textStyle="title3">{won(service.price)}</Text>
                <Text
                  as="a"
                  href={`#${service.id}`}
                  textStyle="caption"
                  color="fg.neutral-muted"
                >
                  자세히 ↓
                </Text>
              </HStack>
            </Card>
          ))}
        </Grid>
        <HStack
          gap="x6"
          px="x5"
          py="x4"
          justify="center"
          wrap
          bg="bg.layer-default"
          borderRadius="r3"
        >
          <Text textStyle="bodySm" color="fg.neutral-muted">
            같이 맡기시면
          </Text>
          {bundles.map((bundle) => (
            <Text key={bundle.label} textStyle="labelSm">
              {bundle.label} {won(bundle.price)}
            </Text>
          ))}
        </HStack>
      </GuideSection>

      {/* 03-1 넥타이 구조 */}
      <GuideSection bg="bg.neutral-weak" pt="x10">
        <Eyebrow>넥타이 구조</Eyebrow>
        <SectionTitle>
          {"7폴드, 스포데라토도\n똑같이 맡기시면 돼요"}
        </SectionTitle>
        <Lead>
          {
            "넥타이 뒷면을 펼쳐 보면 구조를 알 수 있어요.\n어떤 구조든 폭 수선, 자동 넥타이 변환, 원상태 복원 모두 가능하고 가격도 같아요."
          }
        </Lead>
        <Grid columns={{ base: 1, md: 3 }} gap="x3">
          {STRUCTURES.map((structure) => (
            <Card key={structure.title} bg="bg.layer-default">
              <ImageFrame
                ratio={0.79}
                borderRadius={0}
                src={`${IMG}/${structure.image}.webp`}
                alt={`${structure.title} 뒷면`}
              />
              <CardText title={structure.title}>
                <Badge tone="warning">{structure.cue}</Badge>
                {"\n"}
                {structure.description}
              </CardText>
            </Card>
          ))}
        </Grid>
        <HStack gap="x2" justify="center" wrap>
          {["폭 수선 ✓", "자동 넥타이 변환 ✓", "원상태 복원 ✓"].map((label) => (
            <Box
              key={label}
              px="x3_5"
              py="x2"
              bg="bg.layer-default"
              borderRadius="full"
            >
              <Text textStyle="labelSm">{label}</Text>
            </Box>
          ))}
        </HStack>
        <Text textStyle="caption" color="fg.neutral-muted" align="center">
          구조를 잘 모르시겠다면 뒷면 사진을 함께 올려 주세요. 저희가 보고 알려
          드릴게요.
        </Text>
      </GuideSection>

      {/* 04 자동 넥타이 변환 */}
      <GuideSection id={AUTO_ID}>
        <Eyebrow>자동 넥타이 변환 · {won(pricing.automatic_cost)}</Eyebrow>
        <SectionTitle>{"매듭은 저희가\n묶어 둘게요"}</SectionTitle>
        <Lead>
          {
            "키에 맞게 넥타이를 재단하고, 직접 개발한 몰드에 매듭을 고정해요.\n원단은 그대로라 무늬도 그대로 남아요. 겉으로 봐선 자동 넥타이인지 잘 모르실 거예요."
          }
        </Lead>
        <Grid columns={{ base: 1, sm: 3 }} gap="x5">
          {AUTO_POINTS.map((point, index) => (
            <VStack key={point.title} gap="x3_5" alignItems="stretch">
              <ReformVideo
                src={`${IMG}/${point.video}`}
                poster={`${IMG}/${point.poster}.webp`}
                ratio={9 / 16}
                label={point.label}
                lazy
              />
              <PointText index={index} title={point.title}>
                {point.description}
              </PointText>
            </VStack>
          ))}
        </Grid>

        <SubTitle>지퍼로 할까요, 끈으로 할까요?</SubTitle>
        <Grid columns={{ base: 1, sm: 2 }} gap="x4">
          {MECHANISMS.map((mechanism) => (
            <Card key={mechanism.title} bg="bg.neutral-weak">
              <ImageFrame
                ratio={1.57}
                borderRadius={0}
                src={`${IMG}/${mechanism.image}.webp`}
                alt={mechanism.title}
              />
              <CardText title={mechanism.title}>
                {mechanism.description}
              </CardText>
              <Box px="x5">
                <Badge variant="outline">{mechanism.badge}</Badge>
              </Box>
            </Card>
          ))}
        </Grid>

        <SubTitle>매듭 모양도 골라 주세요</SubTitle>
        <Grid columns={{ base: 1, sm: 3 }} gap="x3">
          {KNOTS.map((knot) => (
            // 모바일은 사진 왼쪽·설명 오른쪽 한 줄씩 — 3열이면 사진이 너무 작다
            <Grid
              key={knot.title}
              columns={{ base: 2, sm: 1 }}
              gap={{ base: "x4", sm: "x2" }}
              alignItems="center"
            >
              <ImageFrame
                ratio={1.06}
                borderRadius="r3"
                src={`${IMG}/${knot.image}.webp`}
                alt={`${knot.title} 매듭`}
              />
              <VStack gap="x1" alignItems="stretch">
                <Text as="h4" textStyle="title3">
                  {knot.title}
                </Text>
                <Text textStyle="caption" color="fg.neutral-muted">
                  {knot.description}
                </Text>
              </VStack>
            </Grid>
          ))}
        </Grid>

        <SubTitle>키만 알려 주세요</SubTitle>
        <Text textStyle="bodySm" color="fg.neutral-muted">
          주문할 때 착용하실 분 키를 적어 주시면, 끝이 벨트 버클에 닿는 길이로
          맞춰 드려요.
        </Text>
        <LengthTable />
        <Text textStyle="caption" color="fg.neutral-muted">
          체형과 매는 위치에 따라 실제 완성 길이는 상담 후 조정될 수 있어요.
        </Text>
        <Box px="x4" py="x3_5" bg="bg.warning-weak" borderRadius="r2">
          <Text textStyle="labelSm" color="fg.warning">
            한 번 자동으로 바꾸면 원래대로 되돌릴 수 없어요. 원단을 잘라서 다시
            짓는 작업이라서요.
          </Text>
        </Box>

        <VStack gap="x2_5" alignItems="stretch">
          <Text as="h4" textStyle="title3">
            실제 작업 사례
          </Text>
          <BeforeAfter
            before="auto-before"
            after="auto-after"
            afterLabel="수선 후"
          />
          <PhotoRow images={["auto-detail-1", "review-2", "auto-detail-3"]} />
        </VStack>
      </GuideSection>

      {/* 05 폭 수선 */}
      <GuideSection id={WIDTH_ID} bg="bg.neutral-weak">
        <Eyebrow>폭 수선 · {won(pricing.width_cost)}</Eyebrow>
        <SectionTitle>{"폭만 줄였는데\n요즘 넥타이가 됐어요"}</SectionTitle>
        <Lead>
          {
            "넓은 폭이 부담스러웠던 넥타이, 원하시는 폭으로 줄여 드려요.\n주문할 때 희망 폭을 적어 주시면 그대로 맞춰요."
          }
        </Lead>
        <Grid columns={{ base: 1, sm: 2 }} gap="x3">
          {[
            [
              "지금 넥타이 폭",
              "예전 넥타이는 9cm를 넘는 게 많아서, 요즘 정장에 매면 가슴이 꽉 차 보여요",
            ],
            ["원하시는 폭", "적어 주신 폭 그대로 맞춰 다시 지어요"],
          ].map(([title, description]) => (
            <VStack
              key={title}
              gap="x1_5"
              p="x6"
              bg="bg.layer-default"
              borderRadius="r3"
            >
              <Text as="h4" textStyle="title2">
                {title}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {description}
              </Text>
            </VStack>
          ))}
        </Grid>
        <Grid columns={{ base: 1, md: 3 }} gap="x3">
          {WIDTH_POINTS.map((point, index) => (
            <Box
              key={point.title}
              p="x5"
              bg="bg.layer-default"
              borderRadius="r3"
            >
              <PointText index={index} title={point.title}>
                {point.description}
              </PointText>
            </Box>
          ))}
        </Grid>
        <VStack
          gap="x5"
          alignItems="stretch"
          p={{ base: "x6", md: "x8" }}
          bg="bg.layer-default"
          borderRadius="r4"
        >
          <Text as="h4" textStyle="title2" className="whitespace-pre-line">
            {"폭 수선은\n처음부터 다시 짓는 일이에요"}
          </Text>
          <Text
            textStyle="body"
            color="fg.neutral-muted"
            className="whitespace-pre-line"
          >
            {
              "넥타이를 완전히 뜯어서 원하는 폭으로 다시 재단하고, 처음 만들 때처럼 손으로 다시 봉제해요.\n그래야 두께와 무늬 흐름이 원래 넥타이처럼 자연스러워요."
            }
          </Text>
          <Grid columns={3} gap="x5">
            {WIDTH_STEPS.map((step) => (
              <VStack key={step.title} gap="x2_5" alignItems="center">
                <Box
                  width="full"
                  maxWidth={160}
                  borderRadius="full"
                  overflow="hidden"
                >
                  <ImageFrame
                    ratio={1}
                    borderRadius={0}
                    src={`${IMG}/${step.image}.webp`}
                    alt=""
                  />
                </Box>
                <Text textStyle="labelSm" align="center">
                  {step.title}
                </Text>
              </VStack>
            ))}
          </Grid>
        </VStack>
      </GuideSection>

      {/* 06 원상태 복원 */}
      <GuideSection id={RESTORE_ID}>
        <Eyebrow>원상태 복원 · {won(pricing.restoration_cost)}</Eyebrow>
        <SectionTitle>
          {"잘못 빨아서 틀어진 넥타이,\n처음 샀을 때처럼"}
        </SectionTitle>
        <Lead>
          {
            "헤지고 틀어진 넥타이, 잘못 세탁해서 모양이 무너진 넥타이를 처음 구매했을 때 상태로 되돌려 드려요.\n넥타이를 만드는 방식 그대로 다시 지어서 모양을 잡아요."
          }
        </Lead>
        <BeforeAfter
          before="restore-before"
          after="restore-after"
          afterLabel="복원 후"
        />
        <HStack gap="x2" wrap>
          {[
            "헤진 가장자리",
            "비틀리고 틀어진 모양",
            "잘못된 세탁으로 무너진 형태",
          ].map((label) => (
            <Box
              key={label}
              px="x3_5"
              py="x2"
              bg="bg.neutral-weak"
              borderRadius="full"
            >
              <Text textStyle="caption">{label}</Text>
            </Box>
          ))}
        </HStack>
        <Text as="h4" textStyle="title3">
          실제 작업 사례
        </Text>
        <VStack gap="x1_5" alignItems="stretch">
          <PhotoRow
            images={["restore-case-1", "restore-case-2", "restore-case-3"]}
          />
          <PhotoRow
            images={["restore-case-4", "service-restore", "restore-case-5"]}
          />
          <PhotoRow
            images={["restore-case-6", "restore-case-7", "restore-case-8"]}
          />
        </VStack>
        <Text
          textStyle="bodySm"
          color="fg.neutral-muted"
          className="whitespace-pre-line"
        >
          {
            "원단이 찢어졌거나 얼룩이 남은 경우는 되돌릴 수 없어요. 세탁도 하지 않고요.\n사진을 보내 주시면 가능한지 먼저 말씀드릴게요."
          }
        </Text>
      </GuideSection>

      {/* 08 수선실 */}
      <GuideSection>
        <Eyebrow>수선실</Eyebrow>
        <SectionTitle>
          {"넥타이를 만들던 사람이\n넥타이를 고칩니다"}
        </SectionTitle>
        <Lead>
          {
            "영선산업은 30년 동안 손으로 넥타이를 만들어 왔어요. 수선을 시작한 지는 5년쯤 됐고, 해마다 잊지 않고 넥타이를 보내 주시는 분들이 있어요.\n넥타이는 봉제 과정과 구조가 독특해서, 직접 만들어 본 곳이어야 제대로 뜯고 다시 지을 수 있어요. 만드는 법을 아니까 고칠 수 있는 것과 없는 것도 솔직하게 말씀드려요."
          }
        </Lead>
        <Grid columns={{ base: 1, sm: 2 }} gap="x4">
          {WORKSHOP_STEPS.map((step, index) => (
            <VStack key={step.title} gap="x2_5" alignItems="stretch">
              <ImageFrame
                ratio={0.775}
                borderRadius="r3"
                src={`${IMG}/${step.image}.webp`}
                alt={`${step.title} 작업 사진`}
              />
              <HStack gap="x2_5">
                <Text textStyle="labelSm" color="fg.neutral-muted">
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text as="h4" textStyle="title3">
                  {step.title}
                </Text>
              </HStack>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {step.description}
              </Text>
            </VStack>
          ))}
        </Grid>
      </GuideSection>

      {/* 09 이용 방법 */}
      <GuideSection>
        <Eyebrow>이용 방법</Eyebrow>
        <SectionTitle>{"사진 찍어 올리면\n접수 끝"}</SectionTitle>
        <Lead>여러 개 맡기실 때는 같은 요청을 한 번에 적용할 수 있어요.</Lead>
        <Grid columns={{ base: 1, sm: 3 }} gap="x3">
          {HOW_STEPS.map((step, index) => (
            <VStack key={step.title} gap="x3" alignItems="stretch">
              <ImageFrame
                // 주문 화면 캡처 원본 비율(600×1372) — 위아래가 잘려 보이지 않게 크롭하지 않는다
                ratio={600 / 1372}
                borderRadius="r3"
                stroke
                src={`${IMG}/${step.image}.webp`}
                alt={`${step.title} 화면`}
              />
              <HStack gap="x2">
                <NumberDot small>{index + 1}</NumberDot>
                <Text as="h4" textStyle="title3">
                  {step.title}
                </Text>
              </HStack>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {step.description}
              </Text>
            </VStack>
          ))}
        </Grid>
        <Grid
          columns={{ base: 1, sm: 3 }}
          gap="x6"
          alignItems="center"
          p="x6"
          bg="bg.neutral-weak"
          borderRadius="r4"
        >
          <ImageFrame
            ratio={3 / 4}
            borderRadius="r3"
            src={`${IMG}/packing.webp`}
            alt="선물 상자에 다시 담은 수선 넥타이"
          />
          <VStack gap="x2_5" gridColumn={{ base: "auto", sm: "span 2" }}>
            <Text as="h4" textStyle="title3">
              보내 주신 포장 그대로 돌려드려요
            </Text>
            <Text
              textStyle="body"
              color="fg.neutral-muted"
              className="whitespace-pre-line"
            >
              {
                "선물 상자나 케이스에 담긴 넥타이라면, 그 상태 그대로 보내 주세요.\n수선을 마치면 같은 상자에 다시 담아서 보내 드려요."
              }
            </Text>
          </VStack>
        </Grid>
      </GuideSection>

      {/* 10 가격 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>가격</Eyebrow>
        <SectionTitle>넥타이 1개 기준 가격</SectionTitle>
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
              수선
            </Text>
            <Text textStyle="labelSm" color="fg.contrast">
              가격
            </Text>
          </HStack>
          {[
            ...services.map((service) => ({
              label: service.title,
              price: service.price,
              bundle: false,
            })),
            ...bundles.map((bundle) => ({ ...bundle, bundle: true })),
          ].map((row, index) => (
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
                {row.bundle ? <Badge tone="warning">함께 맡기면</Badge> : null}
              </HStack>
              <Text textStyle="title3">{won(row.price)}</Text>
            </HStack>
          ))}
        </VStack>
        <Grid columns={{ base: 1, sm: 3 }} gap="x3">
          {[
            ["보내실 때", "택배비 고객 부담"],
            ["돌려드릴 때", `반환 배송비 ${won(pricing.shipping_cost)}`],
            ["작업 기간 (택배 기간 제외)", "영업일 기준 평균 2~4일"],
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
      </GuideSection>

      {/* 11 맡기기 전 확인 */}
      <GuideSection pt="x14" pb="x14">
        <VStack
          gap="x3_5"
          alignItems="stretch"
          p="x7"
          bg="bg.warning-weak"
          borderRadius="r4"
        >
          <Text as="h3" textStyle="title3">
            맡기시기 전에 꼭 읽어 주세요
          </Text>
          <VStack as="ul" gap="x3_5" alignItems="stretch">
            {NOTICES.map((notice) => (
              <HStack as="li" key={notice} gap="x2_5" align="flex-start">
                <Text textStyle="label" color="fg.warning" aria-hidden>
                  ·
                </Text>
                <Text textStyle="body" color="fg.neutral-muted">
                  {notice}
                </Text>
              </HStack>
            ))}
          </VStack>
          <Text
            as={Link}
            to="/refund-policy"
            textStyle="labelSm"
            color="fg.neutral-muted"
          >
            자세한 기준은 환불정책에서 확인할 수 있어요 →
          </Text>
        </VStack>
      </GuideSection>

      {/* 12 자주 묻는 질문 */}
      <GuideSection bg="bg.neutral-weak">
        <Eyebrow>자주 묻는 질문</Eyebrow>
        <SectionTitle>자주 묻는 질문</SectionTitle>
        {/* 항상 펼친 목록 — 마지막 항목 구분선은 카드 바닥과 겹치므로 지운다 */}
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

      {/* 13 CTA */}
      <GuideSection bg="bg.neutral-inverted" alignItems="center">
        <Text
          as="h2"
          textStyle="display1"
          color="fg.contrast"
          align="center"
          className="whitespace-pre-line"
        >
          {"버리기 전에,\n한 번 보내 보세요"}
        </Text>
        <Text textStyle="body" color="fg.contrast" align="center">
          고칠 수 있는지부터 봐 드릴게요. 사진 한 장이면 접수돼요.
        </Text>
        <ActionButton variant="neutralWeak" size="large" onClick={onStart}>
          사진 올리고 수선 접수하기
        </ActionButton>
        <Text textStyle="caption" color="fg.contrast" align="center">
          넥타이를 보내시기 전까지는 언제든 취소할 수 있어요.
        </Text>
      </GuideSection>
    </VStack>
  );
}

function Card({ bg, children }: { bg: SurfaceColor; children: ReactNode }) {
  return (
    <VStack
      gap="x3"
      alignItems="stretch"
      pb="x5"
      bg={bg}
      borderRadius="r4"
      overflow="hidden"
    >
      {children}
    </VStack>
  );
}

function CardText({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack gap="x1_5" px="x5" pt="x1">
      <Text as="h4" textStyle="title3">
        {title}
      </Text>
      <Text
        textStyle="bodySm"
        color="fg.neutral-muted"
        className="whitespace-pre-line"
      >
        {children}
      </Text>
    </VStack>
  );
}

function PointText({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack gap="x1_5">
      <Text textStyle="captionSm" color="fg.neutral-muted">
        POINT {index + 1}
      </Text>
      <Text as="h4" textStyle="title3" className="whitespace-pre-line">
        {title}
      </Text>
      <Text textStyle="caption" color="fg.neutral-muted">
        {children}
      </Text>
    </VStack>
  );
}

function NumberDot({
  small = false,
  children,
}: {
  small?: boolean;
  children: ReactNode;
}) {
  const size = small ? 24 : 28;
  return (
    <HStack
      justify="center"
      flexShrink={0}
      width={size}
      height={size}
      borderRadius="full"
      bg="bg.neutral-inverted"
      aria-hidden
    >
      <Text textStyle="captionSm" color="fg.contrast">
        {children}
      </Text>
    </HStack>
  );
}

function BeforeAfter({
  before,
  after,
  afterLabel,
}: {
  before: string;
  after: string;
  afterLabel: string;
}) {
  return (
    <Grid columns={2} gap="x1_5">
      {[
        { image: before, label: "수선 전", corner: "rounded-l-r3" },
        { image: after, label: afterLabel, corner: "rounded-r-r3" },
      ].map((side) => (
        <Box key={side.image} overflow="hidden" className={side.corner}>
          <ImageFrame
            ratio={3 / 4}
            borderRadius={0}
            src={`${IMG}/${side.image}.webp`}
            alt={side.label}
          >
            <Float placement="top-start" offsetX="x3_5" offsetY="x3_5">
              <Badge variant="solid">{side.label}</Badge>
            </Float>
          </ImageFrame>
        </Box>
      ))}
    </Grid>
  );
}

function PhotoRow({ images }: { images: readonly string[] }) {
  return (
    <Grid columns={3} gap="x1_5">
      {images.map((image) => (
        <ImageFrame
          key={image}
          ratio={0.765}
          src={`${IMG}/${image}.webp`}
          alt="실제 작업 사례"
        />
      ))}
    </Grid>
  );
}

/** 키→권장 길이 가로표 — 모바일에서는 가로 스크롤(ScrollFog). */
function LengthTable() {
  const rows = [
    { label: "키 (cm)", key: "height", bg: "bg.neutral-weak" },
    { label: "권장 길이 (cm)", key: "length", bg: "bg.layer-default" },
  ] as const;
  return (
    <ScrollFog>
      <VStack
        gap={0}
        alignItems="stretch"
        minWidth={560}
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r3"
        overflow="hidden"
      >
        {rows.map((row) => (
          <Grid
            key={row.key}
            templateColumns="110px repeat(9, minmax(0, 1fr))"
            alignItems="center"
            px="x4"
            py="x3_5"
            bg={row.bg}
          >
            <Text textStyle="caption" color="fg.neutral-muted">
              {row.label}
            </Text>
            {HEIGHT_GUIDE.map((guide) => (
              <Text
                key={guide.height}
                textStyle={row.key === "length" ? "labelSm" : "bodySm"}
                align="center"
              >
                {guide[row.key]}
              </Text>
            ))}
          </Grid>
        ))}
      </VStack>
    </ScrollFog>
  );
}

function ReformVideo({
  src,
  poster,
  ratio,
  label,
  lazy = false,
}: {
  src: string;
  poster?: string;
  ratio: number;
  label: string;
  /** 첫 화면 밖 영상 — 화면에 들어올 때만 받아서 재생한다 (autoPlay는 preload를 무시하고 즉시 받는다). */
  lazy?: boolean;
}) {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!lazy || reducedMotion || !video) return;
    // play()는 자동재생 정책으로 거부될 수 있다 — 포스터가 남으므로 무시한다.
    if (typeof IntersectionObserver === "undefined") {
      // 관찰할 수 없는 환경 — 지연 없이 바로 재생한다 (StickySectionNav와 같은 폴백).
      video.play().catch(() => {});
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) video.play().catch(() => {});
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [lazy, reducedMotion]);
  return (
    <AspectRatio
      ratio={ratio}
      className="overflow-hidden rounded-r4 bg-bg-neutral-weak"
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        aria-label={label}
        autoPlay={!reducedMotion && !lazy}
        loop={!reducedMotion}
        muted
        playsInline
        controls={reducedMotion}
        preload={lazy ? "none" : "metadata"}
        className={cn(
          "absolute inset-0 size-full object-cover",
          !reducedMotion && "pointer-events-none",
        )}
      />
    </AspectRatio>
  );
}
