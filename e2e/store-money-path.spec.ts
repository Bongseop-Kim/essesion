import { expect, type Page, test } from "@playwright/test";

const storeBaseUrl = "http://localhost:3000";
const apiBaseUrl = "http://localhost:8000";
const customerEmail = process.env.E2E_CUSTOMER_EMAIL ?? "customer@local";
const customerPassword =
  process.env.E2E_CUSTOMER_PASSWORD ?? "customer-local-password";

async function login(page: Page) {
  await page.goto("/login");
  const heading = page.getByRole("heading", { name: "로그인" });
  for (let index = 0; index < 5; index += 1) await heading.click();
  await page.getByLabel("이메일").fill(customerEmail);
  await page.getByLabel("비밀번호").fill(customerPassword);
  await page
    .locator("#main-content")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(page).toHaveURL(`${storeBaseUrl}/`);
}

async function authenticatedSetup(page: Page) {
  const refresh = await page.request.post(`${apiBaseUrl}/auth/refresh`);
  expect(refresh.status()).toBe(200);
  const { access_token: accessToken } = (await refresh.json()) as {
    access_token: string;
  };
  const headers = { Authorization: `Bearer ${accessToken}` };

  const clearCart = await page.request.put(`${apiBaseUrl}/cart`, {
    headers,
    data: { items: [] },
  });
  expect(clearCart.status()).toBe(200);

  const addresses = await page.request.get(`${apiBaseUrl}/users/me/addresses`, {
    headers,
  });
  expect(addresses.status()).toBe(200);
  if (((await addresses.json()) as unknown[]).length === 0) {
    const address = await page.request.put(`${apiBaseUrl}/users/me/addresses`, {
      headers,
      data: {
        recipient_name: "E2E 고객",
        recipient_phone: "01012345678",
        postal_code: "04524",
        address: "서울시 중구 테스트로 1",
        address_detail: "E2E",
        is_default: true,
        delivery_memo: null,
        delivery_request: null,
      },
    });
    expect(address.status()).toBe(200);
  }
  return headers;
}

test("로그인부터 장바구니·주문·결제 확인까지 한 번만 처리한다", async ({
  page,
}) => {
  await login(page);
  const headers = await authenticatedSetup(page);

  const products = await page.request.get(`${apiBaseUrl}/products`);
  expect(products.status()).toBe(200);
  const product = (
    (await products.json()) as Array<{ id: number; code: string }>
  ).find((item) => item.code === "3F-SEED-001");
  expect(product).toBeDefined();

  await page.goto(`/shop/${product?.id}`);
  await page.getByRole("radio", { name: /일반/ }).check({ force: true });
  await page.getByRole("button", { name: "구매하기" }).click();
  await expect(page.getByRole("heading", { name: "장바구니" })).toBeVisible();

  await page.getByRole("button", { name: /주문하기/ }).click();
  await expect(page.getByRole("heading", { name: "주문서" })).toBeVisible();
  await expect(page.getByText("테스트 결제 수단")).toBeVisible();

  const createOrder = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/orders",
  );
  await page.getByRole("button", { name: /결제하기/ }).click();
  expect((await createOrder).status()).toBe(201);

  await expect(
    page.getByText("결제가 완료되었습니다", { exact: true }),
  ).toBeVisible();
  const query = new URL(page.url()).searchParams;
  const confirmBody = {
    payment_key: query.get("paymentKey"),
    payment_group_id: query.get("orderId"),
    amount: Number(query.get("amount")),
  };

  const replay = await page.request.post(`${apiBaseUrl}/payments/confirm`, {
    headers,
    data: confirmBody,
  });
  expect(replay.status()).toBe(200);

  const cart = await page.request.get(`${apiBaseUrl}/cart`, { headers });
  expect(await cart.json()).toEqual([]);
});
