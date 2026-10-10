// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { Database } from "../server/db/client";
import {
  releaseExtraction,
  waitForExtraction,
} from "../../tests/e2e/support/memory";

const wait = waitForExtraction as (
  database: Database,
  conversationId: string,
  options: {
    runId: string;
    executionId: string;
    jobId: string;
    timeoutMs: number;
  },
) => Promise<void>;
const options = {
  runId: "run",
  executionId: "execution",
  jobId: "job",
  timeoutMs: 30,
};

test.each([
  {
    status: "cancelled",
    response_at: null,
    settled_at: null,
    job_state: "active",
  },
  {
    status: "cancelled",
    response_at: new Date(),
    settled_at: new Date(),
    job_state: "active",
  },
])(
  "a cancelled run is not terminal evidence while its execution/job remains outstanding: %j",
  async (row) => {
    const database = {
      $client: { query: vi.fn().mockResolvedValue({ rows: [row] }) },
    } as unknown as Database;
    await expect(wait(database, "conversation", options)).rejects.toThrow();
  },
);

test("waits for the exact execution and worker job, not just any terminal conversation run", async () => {
  const query = vi.fn().mockResolvedValue({
    rows: [
      {
        status: "cancelled",
        response_at: new Date(),
        settled_at: new Date(),
        job_state: "completed",
      },
    ],
  });

  await wait(
    { $client: { query } } as unknown as Database,
    "conversation",
    options,
  );
  expect(query.mock.calls[0][1]).toEqual(["run", "execution", "job"]);
});

const held = {
  runId: "run",
  executionId: "execution",
  jobId: "job",
  requestId: "request",
  userId: "owner",
  characterId: "character",
  memoryEpoch: 0,
};

test("a missing held-response control fails before absence can be asserted", async () => {
  const query = vi.fn();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    await expect(
      releaseExtraction(
        { $client: { query } } as unknown as Database,
        "conversation",
        held,
        "late tea",
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = original;
  }
});

test("late application after terminal settlement fails the owner+character+current-epoch proof", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          status: "cancelled",
          response_at: new Date(),
          settled_at: new Date(),
          job_state: "completed",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        { status: "cancelled", claim_token: null, lease_expires_at: null },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ n: 1 }] });
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  try {
    await expect(
      releaseExtraction(
        { $client: { query } } as unknown as Database,
        "conversation",
        held,
        "late tea",
      ),
    ).rejects.toThrow();
    expect(query.mock.calls.at(-1)?.[1]).toEqual([
      "owner",
      "character",
      "%late tea%",
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toContain(
      "m.memory_epoch=s.memory_epoch",
    );
  } finally {
    globalThis.fetch = original;
  }
});
