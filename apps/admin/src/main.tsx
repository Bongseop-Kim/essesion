import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AdminApp } from "./app";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
