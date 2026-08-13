import { useState } from "react";
import { RouterProvider } from "react-router";

import { AppProviders } from "./app/providers/app-providers";
import { createAdminBrowserRouter } from "./app/router/router";

export function AdminApp() {
  const [router] = useState(createAdminBrowserRouter);
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
