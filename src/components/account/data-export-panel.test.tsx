import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DataExportPanel } from "./data-export-panel";
import { ExportStatus, type ExportVisualState } from "./export-status";
import { getDataExportStatusAction } from "@/app/account/exports/actions";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/account/exports/actions", () => ({
  requestDataExportAction: vi.fn(),
  retryDataExportAction: vi.fn(),
  getDataExportStatusAction: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
test("request controls explain ZIP privacy, 24-hour retention, and the idle export state", () => {
  render(<DataExportPanel exports={[]} />);
  expect(
    screen.getByRole("button", { name: "Request data export" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Request a private ZIP containing JSON copies of your account, conversations, memories, summaries, settings, and usage. Only you can download it. Downloads expire 24 hours after completion.",
    ),
  ).toBeVisible();
  expect(screen.getByText("No export requested")).toBeVisible();
});

test("queued/running disable duplicate requests while only ready exports expose a download action and visible expiry", () => {
  render(
    <DataExportPanel
      exports={[
        {
          id: "private-pending-export-id",
          status: "pending",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: null,
          expiresAt: null,
        },
        {
          id: "private-ready-export-id",
          status: "complete",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: "2026-10-10T08:00:00Z",
          expiresAt: "2026-10-11T08:00:00Z",
        },
        {
          id: "private-failed-export-id",
          status: "failed",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: null,
          expiresAt: null,
        },
        {
          id: "expired",
          status: "expired",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: null,
          expiresAt: null,
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Request data export" }),
  ).toBeDisabled();
  expect(screen.getByText("Queued")).toBeVisible();
  expect(screen.getByText("Ready")).toBeVisible();
  expect(screen.getByText("Failed")).toBeVisible();
  expect(screen.getByRole("link", { name: "Download ZIP" })).toHaveAttribute(
    "href",
    "/account/exports/private-ready-export-id/download",
  );
  expect(screen.getByRole("button", { name: "Retry export" })).toBeDisabled();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByText("Expired")).toBeVisible();
  expect(screen.getByText(/Expires/)).toBeVisible();
  expect(screen.queryByText("private-ready-export-id")).not.toBeInTheDocument();
  expect(
    screen.queryByText("/account/exports/private-ready-export-id/download"),
  ).not.toBeInTheDocument();
});

test.each<{
  expectedLabel: string;
  expectedRole: "status" | "alert";
  state: ExportVisualState;
}>([
  {
    expectedLabel: "No export requested",
    expectedRole: "status",
    state: { kind: "idle" },
  },
  {
    expectedLabel: "Queued",
    expectedRole: "status",
    state: { kind: "queued" },
  },
  {
    expectedLabel: "Processing",
    expectedRole: "status",
    state: { kind: "processing" },
  },
  {
    expectedLabel: "Ready",
    expectedRole: "status",
    state: {
      kind: "ready",
      expiresAt: new Date("2026-10-11T08:00:00Z"),
      downloadHref: "/account/exports/private-ready-export-id/download",
    },
  },
  {
    expectedLabel: "Expired",
    expectedRole: "alert",
    state: { kind: "expired" },
  },
  {
    expectedLabel: "Failed",
    expectedRole: "alert",
    state: { kind: "failed", message: "Data export is unavailable." },
  },
])(
  "renders the %s export visual state",
  ({ expectedLabel, expectedRole, state }) => {
    render(
      <ol>
        <ExportStatus requestedAt="2026-10-10T08:00:00Z" state={state} />
      </ol>,
    );

    expect(screen.getByText(expectedLabel)).toBeVisible();
    expect(screen.getByRole(expectedRole)).toBeVisible();

    if (state.kind === "ready") {
      expect(
        screen.getByRole("link", { name: "Download ZIP" }),
      ).toHaveAttribute("href", state.downloadHref);
      expect(screen.getByText(/Expires/)).toBeVisible();
    } else {
      expect(
        screen.queryByRole("link", { name: "Download ZIP" }),
      ).not.toBeInTheDocument();
    }

    if (state.kind === "failed") {
      expect(screen.getByText("Data export is unavailable.")).toBeVisible();
    }
  },
);

test("pending exports poll privately, refresh on completion, and stop polling after completion", async () => {
  vi.useFakeTimers();
  refresh.mockClear();
  const pending = {
    id: "pending",
    status: "pending" as const,
    createdAt: "2026-10-10T08:00:00Z",
    completedAt: null,
    expiresAt: null,
  };
  vi.mocked(getDataExportStatusAction).mockResolvedValue({
    ...pending,
    status: "complete",
  });
  const { unmount } = render(<DataExportPanel exports={[pending]} />);
  try {
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getDataExportStatusAction).toHaveBeenCalledWith("pending");
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

test("temporary unavailable polling results do not abandon a pending export", async () => {
  vi.useFakeTimers();
  refresh.mockClear();
  vi.mocked(getDataExportStatusAction).mockClear().mockResolvedValue(null);
  const { unmount } = render(
    <DataExportPanel
      exports={[
        {
          id: "pending",
          status: "pending",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: null,
          expiresAt: null,
        },
      ]}
    />,
  );
  try {
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(getDataExportStatusAction).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
