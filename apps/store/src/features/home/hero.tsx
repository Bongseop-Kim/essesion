import {
  Box,
  Flex,
  Float,
  Grid,
  HStack,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { Scrim } from "./scrim";
import { Section } from "./section";

const AUTOPLAY_MS = 5000; // 캐로셀 표준 간격(Bootstrap 기본과 동일). 4~7초 권장 구간.

const HERO_BANNERS = [
  {
    tag: "AI",
    title: "쉽고 간편하게\n30초 만에 만들기",
    image: "/images/home/ai.png",
    alt: "AI 디자인 생성",
    href: "/design",
  },
  {
    tag: "CUSTOM",
    title: "행사와 단체를 위한\n주문 제작",
    image: "/images/home/custom.png",
    alt: "주문 제작",
    href: "/custom-order",
  },
  {
    tag: "STORE",
    title: "2026 봄\n실크 9종 입고",
    image: "/images/home/showcase.png",
    alt: "넥타이 스토어",
    href: "/shop",
  },
  {
    tag: "REPAIR",
    title: "수동 넥타이를\n자동 넥타이로",
    image: "/images/home/repair.png",
    alt: "넥타이 수선",
    href: "/reform",
  },
] as const;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function HeroCard({
  banner,
  eager,
  borderRadius = "r2",
}: {
  banner: (typeof HERO_BANNERS)[number];
  eager?: boolean;
  borderRadius?: "r2" | 0;
}) {
  return (
    <Box
      as={Link}
      to={banner.href}
      display="block"
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
    >
      <ImageFrame
        ratio={3 / 4}
        borderRadius={borderRadius}
        src={banner.image}
        alt={banner.alt}
        loading={eager ? "eager" : "lazy"}
      >
        <Scrim from="bottom" />
        <Float placement="bottom-start" offsetX="x5" offsetY="x5">
          <VStack gap="x1">
            <Text textStyle="captionSm" color="fg.contrast">
              {banner.tag}
            </Text>
            <Text
              as="h3"
              textStyle="title3"
              color="fg.contrast"
              style={{ whiteSpace: "pre-line" }}
            >
              {banner.title}
            </Text>
          </VStack>
        </Float>
      </ImageFrame>
    </Box>
  );
}

const SWIPE_THRESHOLD = 50; // px — 이 이상 끌면 슬라이드 이동

/** 모바일 — 자동 넘김 + 스와이프 캐로셀(포그 없음). 조작 중 정지, reduced-motion 시 자동재생 끔. */
function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const count = HERO_BANNERS.length;

  const startX = useRef(0);
  const dx = useRef(0);
  const active = useRef(false);
  const moved = useRef(false);

  useEffect(() => {
    if (!isMobile || paused || reduced) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [isMobile, paused, reduced, count]);

  const onPointerDown = (e: PointerEvent) => {
    startX.current = e.clientX;
    dx.current = 0;
    active.current = true;
    moved.current = false;
    setDragging(true);
    setPaused(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!active.current) return;
    dx.current = e.clientX - startX.current;
    if (Math.abs(dx.current) > 8) moved.current = true;
    setDragX(dx.current);
  };
  const onPointerEnd = () => {
    if (!active.current) return;
    active.current = false;
    const delta = dx.current;
    dx.current = 0;
    setDragging(false);
    setDragX(0);
    setPaused(false);
    if (delta <= -SWIPE_THRESHOLD) setIndex((i) => (i + 1) % count);
    else if (delta >= SWIPE_THRESHOLD) setIndex((i) => (i - 1 + count) % count);
  };

  return (
    <Box display={{ base: "block", md: "none" }}>
      {/* 모바일 full-bleed — 라운드 없이 꽉 채움 */}
      <Box
        overflow="hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e: MouseEvent) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{ touchAction: "pan-y" }}
      >
        <Flex
          className={
            dragging
              ? undefined
              : "transition-transform duration-(--duration-slow) ease-standard"
          }
          style={{
            transform: `translateX(calc(-${index * 100}% + ${dragX}px))`,
          }}
        >
          {HERO_BANNERS.map((banner, i) => (
            <Box key={banner.tag} flexShrink={0} width="full">
              <HeroCard banner={banner} eager={i === 0} borderRadius={0} />
            </Box>
          ))}
        </Flex>
      </Box>
      <HStack justify="center" gap="x1_5" pt="x3">
        {HERO_BANNERS.map((banner, i) => (
          <Box
            as="button"
            type="button"
            key={banner.tag}
            onClick={() => setIndex(i)}
            aria-label={`${i + 1}번 배너 보기`}
            aria-current={i === index ? "true" : undefined}
            width={i === index ? 20 : 8}
            height={8}
            borderRadius="full"
            bg={i === index ? "bg.brand-solid" : "bg.neutral-weak"}
            className="transition-all duration-(--duration-normal) ease-standard"
          />
        ))}
      </HStack>
    </Box>
  );
}

/** 히어로 — 모바일 자동 캐로셀 ↔ 데스크톱 4열 그리드. */
export function Hero() {
  return (
    <Section pt={{ base: 0, md: "x6" }} px={{ base: 0, md: "x6", lg: "x8" }}>
      <HeroCarousel />
      <Grid display={{ base: "none", md: "grid" }} columns={4} gap="x3">
        {HERO_BANNERS.map((banner, i) => (
          <HeroCard key={banner.tag} banner={banner} eager={i === 0} />
        ))}
      </Grid>
    </Section>
  );
}
