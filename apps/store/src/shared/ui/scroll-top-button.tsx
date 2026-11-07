import { ActionButton, Box, Icon } from "@essesion/shared";
import { ArrowUpIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

export function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
}

/** 정보 탭이 길어 화면 1.5개 이상 내려가면 맨 위로 버튼을 띄운다. 모바일은 하단 actionBar(76px) 위에 둔다. */
export function ScrollTopButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 1.5);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  if (!visible) return null;
  return (
    <Box
      position="fixed"
      right="x4"
      bottom={{
        base: "calc(76px + var(--spacing-x4) + env(safe-area-inset-bottom, 0px))",
        lg: "x6",
      }}
      zIndex={30}
      borderRadius="full"
      boxShadow="s2"
    >
      <ActionButton
        variant="neutralOutline"
        size="xsmall"
        iconOnly
        aria-label="맨 위로"
        className="size-11"
        onClick={scrollToTop}
      >
        <Icon svg={<ArrowUpIcon />} size={20} />
      </ActionButton>
    </Box>
  );
}
