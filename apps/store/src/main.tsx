import { createRoot } from "react-dom/client";

import { StoreApp } from "./app";
import "./index.css";

// 5단계에서 재작성 — 기존 라우트 기준, api-client만 사용 (supabase-js 금지)
createRoot(document.getElementById("root")!).render(<StoreApp />);
