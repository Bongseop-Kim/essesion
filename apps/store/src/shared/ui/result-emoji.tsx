import { Box, Text } from "@essesion/shared";
import { domAnimation, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";

export function ResultEmoji({ emoji }: { emoji: string }) {
  const reducedMotion = useReducedMotion();

  return (
    <Box
      width={88}
      height={88}
      display="flex"
      alignItems="center"
      justifyContent="center"
      aria-hidden
    >
      <LazyMotion features={domAnimation} strict>
        <m.span
          style={{ display: "inline-flex" }}
          initial={
            reducedMotion ? false : { opacity: 0, scale: 0.65, rotate: -8 }
          }
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 240, damping: 18, mass: 0.8 }
          }
        >
          <m.span
            style={{ display: "inline-flex" }}
            animate={
              reducedMotion
                ? undefined
                : {
                    scale: [1, 1.05, 0.99, 1],
                    rotate: [0, -2, 1, 0],
                  }
            }
            transition={
              reducedMotion
                ? undefined
                : {
                    duration: 0.75,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                    repeatDelay: 3.25,
                    delay: 0.6,
                  }
            }
          >
            <Text textStyle="display1" className="result-emoji">
              {emoji}
            </Text>
          </m.span>
        </m.span>
      </LazyMotion>
    </Box>
  );
}
