import { createRoot } from "react-dom/client";

import { StoreApp } from "@/app";
import "@/shared/lib/api-client"; // 생성 client 설정·인터셉터 (SDK 호출 전 1회 실행)
import { initAnalytics } from "@/shared/lib/analytics";
import { initObservability } from "@/shared/lib/observability";
import "./index.css";

initObservability();
initAnalytics();
createRoot(document.getElementById("root")!).render(<StoreApp />);
