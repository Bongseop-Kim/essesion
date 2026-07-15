import { useState } from "react";
import { RouterProvider } from "react-router";

import { AppProviders } from "./app/providers/app-providers";
import { createAdminBrowserRouter } from "./app/router/router";
import type { AdminSessionAdapter } from "./shared/session/admin-session";
import { apiAdminSessionAdapter } from "./shared/session/api-admin-session-adapter";

export type AdminAppProps = {
  sessionAdapter?: AdminSessionAdapter;
};

export function AdminApp({
  sessionAdapter = apiAdminSessionAdapter,
}: AdminAppProps) {
  const [router] = useState(createAdminBrowserRouter);
  return (
    <AppProviders sessionAdapter={sessionAdapter}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
