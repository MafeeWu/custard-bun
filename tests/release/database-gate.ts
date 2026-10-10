import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { testDatabaseUrl } from "../../src/test/database-target";

export const fixturePath = "tests/release/fixtures/phase3.sql";

export async function migrationHashes(pool: Pool) {
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  const applied = (
    await pool.query(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    )
  ).rows;
  assert.equal(applied.length, journal.entries.length);
  for (let index = 0; index < applied.length; index++) {
    const entry = journal.entries[index];
    const hash = createHash("sha256")
      .update(await readFile(`drizzle/${entry.tag}.sql`))
      .digest("hex");
    assert.equal(
      applied[index].hash,
      hash,
      `Migration hash mismatch: ${entry.tag}`,
    );
    assert.equal(Number(applied[index].created_at), entry.when);
  }
  return applied.length;
}

export async function catalogDigest(pool: Pool) {
  const queries = [
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`,
    `SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' ORDER BY c.relname, con.conname`,
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    `SELECT p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' ORDER BY p.proname`,
    `SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`,
  ];
  const rows = [];
  for (const query of queries) rows.push((await pool.query(query)).rows);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export async function verifyPhase3Upgrade(pool: Pool) {
  assert.equal(
    (
      await pool.query(
        "SELECT content FROM conversation_messages WHERE id='phase3-user-message'",
      )
    ).rows[0].content,
    "Phase 3 fixture: jasmine tea before memory rollout",
  );
  const attempt = (
    await pool.query(
      "SELECT status, content, extraction_memory_epoch FROM generation_attempts WHERE id='phase3-attempt'",
    )
  ).rows[0];
  assert.equal(attempt.status, "complete");
  assert.equal(attempt.content, "Phase 3 fixture reply");
  assert.equal(attempt.extraction_memory_epoch, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM memory_extraction_runs WHERE generation_attempt_id='phase3-attempt'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM memory_items WHERE user_id='phase3-user'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT input_tokens FROM usage_ledger WHERE id='phase3-usage'",
      )
    ).rows[0].input_tokens,
    "20",
  );
}

export function deploy(databaseUrl: string) {
  const result = spawnSync("pnpm", ["db:deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });
  assert.equal(result.status, 0, "db:deploy failed");
}

async function main() {
  const url = new URL(testDatabaseUrl());
  url.pathname = "/postgres";
  const admin = new Pool({ connectionString: url.href });
  const created: string[] = [];
  const pools: Pool[] = [];
  try {
    const catalogs = [];
    for (const mode of ["fresh", "upgrade"]) {
      const name = `task12_${mode}_${process.pid}_test`;
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
      url.pathname = `/${name}`;
      const pool = new Pool({ connectionString: url.href });
      pools.push(pool);
      if (mode === "upgrade") {
        await pool.query(await readFile(fixturePath, "utf8"));
        await pool.query("SET search_path TO public");
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
            )
          ).rows[0].n,
          7,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT to_regclass('public.memory_items') AS table",
            )
          ).rows[0].table,
          null,
        );
      }
      deploy(url.href);
      const before = await catalogDigest(pool);
      await pool.query(
        "UPDATE chat_settings SET user_daily_request_limit=123, revision=revision+1, updated_at=now() WHERE id='global'",
      );
      const seedQuery =
        "SELECT to_jsonb(s) - 'deployment_defaults_updated_at' AS settings FROM chat_settings s";
      const seed = (await pool.query(seedQuery)).rows;
      deploy(url.href);
      assert.deepEqual((await pool.query(seedQuery)).rows, seed);
      assert.equal(await catalogDigest(pool), before);
      const migrations = await migrationHashes(pool);
      if (mode === "upgrade") await verifyPhase3Upgrade(pool);
      catalogs.push(before);
      console.log(
        JSON.stringify({
          gate: mode,
          migrations,
          catalog: before,
          idempotent: true,
          noRetroactiveExtraction: true,
        }),
      );
    }
    assert.equal(catalogs[0], catalogs[1], "Fresh and upgrade catalogs differ");
  } finally {
    await Promise.all(pools.map((pool) => pool.end()));
    for (const name of created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}

if (process.argv[1]?.endsWith("database-gate.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
