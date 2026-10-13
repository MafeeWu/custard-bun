import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { getGlobalChatSettings } from "@/server/admin/chat-settings-service";
import { getUsageDashboard } from "@/server/admin/usage-queries";

const usagePageMocks = vi.hoisted(() => ({
  ChatSettingsForm: vi.fn(() => <div>settings form</div>),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({
  getDatabase: async () => ({ db: true }),
}));
vi.mock("@/server/admin/usage-queries", () => ({
  getUsageDashboard: vi.fn(),
}));
vi.mock("@/server/admin/chat-settings-service", () => ({
  getGlobalChatSettings: vi.fn(),
}));
vi.mock("@/components/admin/usage/chat-settings-form", () => ({
  ChatSettingsForm: usagePageMocks.ChatSettingsForm,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
  vi.mocked(getUsageDashboard).mockResolvedValue({
    userDay: { requests: 2, inputTokens: 100, outputTokens: 20 },
    instanceMonth: { requests: 8, inputTokens: 400, outputTokens: 80 },
    activeGenerations: 1,
    outcomes: { complete: 5, failed: 2, interrupted: 1 },
    failures: [{ category: "provider_unavailable", count: 2 }],
    automaticRetries: 3,
    estimatedUsageRows: 1,
    latencyMs: { p50: 120, p95: 450 },
    modelIds: ["model-a"],
    backgroundWork: { inputTokens: 0, outputTokens: 0, estimatedRows: 0 },
    userEmail: "private-user@example.com",
    userId: "user-private-sentinel",
    providerEndpoint: "https://provider-private.example/v1",
    providerKey: "private-provider-key",
    providerRequestId: "private-provider-request-id",
    conversationContent: "PRIVATE CONVERSATION SENTINEL",
  } as never);
  vi.mocked(getGlobalChatSettings).mockResolvedValue({
    revision: 3,
    userDailyRequestLimit: 100,
    userDailyTokenLimit: 10_000,
    instanceMonthlyRequestLimit: 1_000,
    instanceMonthlyTokenBudget: 100_000,
    maxConcurrentGenerations: 4,
  });
});

test("renders aggregate usage and settings without content or transcript links", async () => {
  const Page = (await import("./page")).default;
  render(await Page());

  expect(requireAdmin).toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { level: 1, name: "Usage and quotas" }),
  ).toBeVisible();
  expect(screen.getByText("2 requests")).toBeVisible();
  expect(screen.getByText("8 requests")).toBeVisible();
  const failureTable = screen.getByRole("table", {
    name: "Provider failures",
  });
  expect(within(failureTable).getByText("provider_unavailable")).toBeVisible();
  expect(screen.getByText("model-a")).toBeVisible();
  expect(
    screen.queryByText(/conversation|transcript|message content/i),
  ).not.toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(
    /private-user@example\.com|user-private-sentinel|PRIVATE CONVERSATION SENTINEL|provider-private|private-provider-key|private-provider-request-id/i,
  );
  expect(
    screen.queryByRole("link", { name: /transcript|conversation/i }),
  ).not.toBeInTheDocument();
  expect(usagePageMocks.ChatSettingsForm).toHaveBeenCalledWith(
    expect.objectContaining({
      settings: expect.objectContaining({ revision: 3 }),
    }),
    undefined,
  );
});

test("does not query usage when administrator authorization fails", async () => {
  vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
  const Page = (await import("./page")).default;

  await expect(Page()).rejects.toThrow("notFound");
  expect(getUsageDashboard).not.toHaveBeenCalled();
  expect(getGlobalChatSettings).not.toHaveBeenCalled();
});
