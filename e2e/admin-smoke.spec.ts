import { expect, type Page, type Response, test } from "@playwright/test";

const adminBaseUrl = "http://localhost:3001";
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@local";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin-local-password";

function isApiResponse(response: Response, method: string, pathname: string) {
  return (
    response.request().method() === method &&
    new URL(response.url()).pathname === pathname
  );
}

async function restoreSeedOrderToPending(page: Page) {
  const rollbackButton = page.getByRole("button", {
    name: "대기중 상태로 롤백",
  });
  if (!(await rollbackButton.isVisible())) return;

  await rollbackButton.click();
  await page.getByLabel("변경 사유 (필수)").fill("E2E 재시도 전 상태 복구");
  // 롤백은 destructive → "검토"로 확인 다이얼로그를 연 뒤 다이얼로그에서 실행
  await page
    .getByRole("button", { name: "대기중 상태로 롤백 검토", exact: true })
    .click();
  const [statusResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return (
        response.request().method() === "POST" &&
        pathname.startsWith("/admin/orders/") &&
        pathname.endsWith("/status")
      );
    }),
    page
      .getByRole("alertdialog")
      .getByRole("button", { name: "대기중 상태로 롤백", exact: true })
      .click(),
  ]);
  expect(statusResponse.status()).toBe(200);
  await expect(page.getByText("대기중", { exact: true }).first()).toBeVisible();
}

test("seed 관리자가 보호 목록·상세의 상태 변경을 실행하고 로그아웃한다", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page).toHaveURL(`${adminBaseUrl}/login`);
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();

  await page.getByLabel("이메일").fill(adminEmail);
  await page.getByLabel("비밀번호").fill(adminPassword);

  const loginResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/auth/admin/login"),
  );
  const dashboardResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "GET", "/admin/dashboard/summary"),
  );
  await page.getByRole("button", { name: "로그인", exact: true }).click();

  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  await expect(page).toHaveURL(`${adminBaseUrl}/`);
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  expect((await dashboardResponsePromise).status()).toBe(200);

  const refreshResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/auth/admin/refresh"),
  );
  const ordersResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "GET", "/admin/orders"),
  );
  await page.goto("/orders");

  expect((await refreshResponsePromise).status()).toBe(200);
  expect((await ordersResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(`${adminBaseUrl}/orders`);
  await expect(page.getByRole("heading", { name: "주문 관리" })).toBeVisible();

  const detailResponsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return (
      response.request().method() === "GET" &&
      pathname.startsWith("/admin/orders/")
    );
  });
  await page.getByRole("link", { name: "E2E-ADMIN-001" }).click();
  expect((await detailResponsePromise).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "주문 E2E-ADMIN-001" }),
  ).toBeVisible();

  await restoreSeedOrderToPending(page);
  await page.getByRole("button", { name: "진행중 상태로 진행" }).click();
  const [statusResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return (
        response.request().method() === "POST" &&
        pathname.startsWith("/admin/orders/") &&
        pathname.endsWith("/status")
      );
    }),
    page
      .getByRole("button", { name: "진행중 상태로 진행 적용", exact: true })
      .click(),
  ]);
  expect(statusResponse.status()).toBe(200);
  await expect(page.getByText("진행중", { exact: true }).first()).toBeVisible();
  await restoreSeedOrderToPending(page);

  const logoutResponsePromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/auth/admin/logout"),
  );
  await page
    .getByRole("button", { name: "로그아웃", exact: true })
    .first()
    .click();

  expect((await logoutResponsePromise).status()).toBe(204);
  await expect(page).toHaveURL(`${adminBaseUrl}/login`);
  await expect(
    page.getByRole("heading", { name: "관리자 로그인" }),
  ).toBeVisible();

  const rejectedRefreshPromise = page.waitForResponse((response) =>
    isApiResponse(response, "POST", "/auth/admin/refresh"),
  );
  await page.goto("/orders");

  expect((await rejectedRefreshPromise).status()).toBe(401);
  await expect(page).toHaveURL(`${adminBaseUrl}/login`);
});
