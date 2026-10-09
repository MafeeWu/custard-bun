import { expect, type Page } from "@playwright/test";
import { clearMailbox, waitForActionUrl } from "../helpers/mailbox";

export const fakeModelBaseUrl = "http://127.0.0.1:3102";

export interface FakeModelRequest {
  id: string;
  receivedAt: string;
  body: {
    model?: unknown;
    messages?: Array<{ role?: unknown; content?: unknown }>;
  };
}

export async function resetFakeModel(): Promise<void> {
  const response = await fetch(`${fakeModelBaseUrl}/__e2e__/reset`, {
    method: "POST",
  });
  expect(response.status).toBe(204);
}

export async function fakeModelRequests(): Promise<FakeModelRequest[]> {
  const response = await fetch(`${fakeModelBaseUrl}/__e2e__/requests`);
  expect(response.status).toBe(200);
  return response.json() as Promise<FakeModelRequest[]>;
}

export async function setFakeModelControl(input: {
  missingUsage: boolean;
}): Promise<void> {
  const response = await fetch(`${fakeModelBaseUrl}/__e2e__/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(response.status).toBe(204);
}

export async function registerAndSignIn(
  page: Page,
  input: {
    email: string;
    name?: string;
    password?: string;
    clearMail?: boolean;
  },
): Promise<void> {
  const password = input.password ?? "correct horse battery staple";
  if (input.clearMail !== false) {
    await clearMailbox();
  }
  await page.goto("/auth/sign-up");
  await page.getByLabel("Name", { exact: true }).fill(input.name ?? "E2E user");
  await page.getByLabel("Email", { exact: true }).fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
  await page.goto(await waitForActionUrl(input.email, "Verify your"));
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

export async function startCharacterConversation(
  page: Page,
  slug: string,
): Promise<string> {
  await page.goto(`/characters/${slug}`);
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/conversations\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

export async function sendChatMessage(
  page: Page,
  content: string,
): Promise<void> {
  await page.getByLabel("Message", { exact: true }).fill(content);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}
