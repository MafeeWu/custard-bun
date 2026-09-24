import { expect, test } from "@playwright/test";
import { createDatabase } from "../../src/server/db/client";
import { testDatabaseUrl } from "../../src/test/database-target";

test("spoofed forwarding identities cannot evade socket-bound login throttling", async ({
  request,
}) => {
  const database = createDatabase(testDatabaseUrl());
  try {
    await database.$client.query('delete from "rate_limit"');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await request.post("/api/auth/sign-in/email", {
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          "x-real-ip": `198.51.100.${i}`,
          "x-companion-client-ip": `198.51.100.${i}`,
        },
        data: {
          email: "rate-unknown@example.com",
          password: "correct horse battery staple",
        },
      });
      statuses.push(response.status());
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const result = await database.$client.query<{ key: string }>(
      'select key from "rate_limit"',
    );
    expect(result.rows.some(({ key }) => /127\.0\.0\.1/.test(key))).toBe(true);
    expect(result.rows.some(({ key }) => /198\.51/.test(key))).toBe(false);
  } finally {
    try {
      await database.$client.query('delete from "rate_limit"');
    } finally {
      await database.$client.end();
    }
  }
});
