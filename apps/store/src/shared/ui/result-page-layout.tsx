import { LayoutContent } from "@essesion/shared";
import type { ReactNode } from "react";

export function ResultPageLayout({ children }: { children: ReactNode }) {
  return (
    <LayoutContent
      density="low"
      display="flex"
      flexDirection="column"
      justifyContent="center"
      py={{ base: "x6", md: "x10" }}
    >
      {children}
    </LayoutContent>
  );
}
