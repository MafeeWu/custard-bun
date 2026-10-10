import { act, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DataExportPanel } from "./data-export-panel";
import { getDataExportStatusAction } from "@/app/account/exports/actions";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/app/account/exports/actions", () => ({
  requestDataExportAction: vi.fn(),
  retryDataExportAction: vi.fn(),
  getDataExportStatusAction: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
test("request controls explain ZIP privacy and 24-hour retention", () => {
  render(<DataExportPanel exports={[]} />);
  expect(
    screen.getByRole("button", { name: "Request data export" }),
  ).toBeVisible();
  expect(screen.getByText(/24 hours/)).toBeVisible();
  expect(screen.getByText(/ZIP/)).toBeVisible();
});
test("pending/running disable duplicate requests; completed download and failed retry compose", () => {
  render(
    <DataExportPanel
      exports={[
        {
          id: "pending",
          status: "pending",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: null,
          expiresAt: null,
        },
        {
          id: "complete",
          status: "complete",
          createdAt: "2026-10-10T08:00:00Z",
          completedAt: "2026-10-10T08:00:00Z",
          expiresAt: "2026-10-11T08:00:00Z",
        },
        {
          id: "failed",
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
  expect(screen.getByRole("link", { name: "Download ZIP" })).toHaveAttribute(
    "href",
    "/account/exports/complete/download",
  );
  expect(screen.getByRole("button", { name: "Retry export" })).toBeDisabled();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByText("Expired")).toBeVisible();
});

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
