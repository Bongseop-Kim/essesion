import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { AuthProvider } from "@/app/providers/auth-provider";
import { router } from "@/app/router";
import "@/shared/lib/api-client"; // 생성 client 설정·인터셉터 (SDK 호출 전 1회 실행)
import { initAnalytics } from "@/shared/lib/analytics";
import { initObservability } from "@/shared/lib/observability";
import { initProductAnalytics } from "@/shared/lib/product-analytics";
import { queryClient } from "@/shared/lib/query-client";
import "./index.css";

initObservability();
initAnalytics();
initProductAnalytics();
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </QueryClientProvider>,
);
