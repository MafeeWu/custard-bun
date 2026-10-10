import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { rateLimit } from "../../src/server/db/auth-schema";
import { characterVersion } from "../../src/server/db/character-schema";
import {
  bootstrapAdmin,
  cleanupAdminTestData,
  createAdminTestDatabase,
} from "./support/admin";
import {
  fakeModelRequests,
  registerAndSignIn,
  resetFakeModel,
  sendChatMessage,
  startCharacterConversation,
} from "./support/chat";
import { e2eEnvironment } from "./support/environment";

async function expectBrowseOnly(page: Page) {
  await expect(page.locator('a[href^="/app/conversations/"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /chat|start.*conversation|version/i }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /version/i })).toHaveCount(0);
}

test("anonymous visitors can browse all five deployed seed cards and details without chat or version selection", async ({
  page,
}) => {
  const seeds = [
    ["calm-listener", "Calm Listener"],
    ["energetic-friend", "Energetic Friend"],
    ["rational-companion", "Rational Companion"],
    ["creative-storyteller", "Creative Storyteller"],
    ["action-coach", "Gentle Action Coach"],
  ];
  await page.goto("/characters");
  for (const [slug, name] of seeds) {
    const card = page.locator(`a[href="/characters/${slug}"]`);
    await expect(
      card.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await expectBrowseOnly(page);
  for (const [slug, name] of seeds) {
    const response = await page.goto(`/characters/${slug}`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    await expectBrowseOnly(page);
  }
});

test("an administrator drafts, previews, publishes, selects defaults, archives, restores and audits a unique character", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const database = createAdminTestDatabase(e2eEnvironment.TEST_DATABASE_URL!);
  const token = randomUUID();
  const email = `character-admin-${token}@example.com`;
  const userEmail = `character-user-${token}@example.com`;
  const slug = `e2e-${token}`;
  const v1Name = `E2E v1 ${token}`;
  const v2Name = `E2E v2 ${token}`;
  const v1Instruction = `Pinned v1 instruction ${token}`;
  const v2Instruction = `Pinned v2 instruction ${token}`;
  const anonymous = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const userContext = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const publicPage = await anonymous.newPage();
  const userPage = await userContext.newPage();
  try {
    await resetFakeModel();
    await database.delete(rateLimit);
    await bootstrapAdmin(page, email, "correct horse battery staple", database);
    await page.goto("/admin/characters/new");
    await expect(
      page.getByRole("heading", { name: "Create official character" }),
    ).toBeVisible();
    const fields: Record<string, string> = {
      Slug: slug,
      "Display name": `E2E draft ${token}`,
      "Avatar path": "/characters/calm-listener.svg",
      "Short description": "An isolated browser acceptance character.",
      "Long description":
        "A patient test companion who explores ideas without replacing human relationships.",
      "Personality principles": `${v1Instruction}\nRespect the user's choices.`,
      "Speaking style": "Warm, concrete language.",
      "Response rhythm": "One concise reflection and a question.",
      "Relationship boundaries":
        "Never claim to be human.\nEncourage real-world support.",
      "Opening message": "What would you like to explore today?",
      "Example user 1": "I want to try something new.",
      "Example assistant 1": "What small experiment feels comfortable?",
      Temperature: "0.6",
      "Top P": "0.9",
      "Max output tokens": "512",
      "Safety additions":
        "Encourage urgent local help when someone is in immediate danger.",
    };
    for (const [label, value] of Object.entries(fields)) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page
      .getByRole("button", { name: "Create draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/characters\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", {
        name: `Edit E2E draft ${token}`,
        exact: true,
      }),
    ).toBeVisible();
    const editorUrl = page.url();
    const characterId = new URL(editorUrl).pathname.split("/").at(-1)!;
    await page.getByLabel("Display name", { exact: true }).fill(v1Name);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Saved draft revision 2.",
    );

    await page.getByRole("link", { name: "Preview persisted draft" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: v1Name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: v1Name, exact: true }),
    ).toBeVisible();
    const structured = page.getByRole("region", {
      name: "Structured character package",
    });
    await expect(structured).toContainText(
      "What small experiment feels comfortable?",
    );
    await expect(structured).toContainText("temperature: 0.6");
    await expect(structured).toContainText("topP: 0.9");
    await expect(structured).toContainText("maxOutputTokens: 512");
    await expect(structured).toContainText(fields["Safety additions"]);
    await publicPage.goto("/characters");
    await expect(
      publicPage.locator(`a[href="/characters/${slug}"]`),
    ).toHaveCount(0);

    await page.goto(editorUrl);
    await page
      .getByRole("button", { name: "Publish draft", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Published version 1.",
    );
    const [v1] = await database
      .select()
      .from(characterVersion)
      .where(eq(characterVersion.characterId, characterId));
    expect(v1).toMatchObject({ displayName: v1Name, versionNumber: 1 });
    await publicPage.goto("/characters");
    await expect(
      publicPage.locator(`a[href="/characters/${slug}"]`),
    ).toHaveCount(0);
    expect((await publicPage.goto(`/characters/${slug}`))?.status()).toBe(404);

    await page
      .getByRole("button", { name: "Set version 1 as default" })
      .click();
    await expect(
      page
        .getByRole("listitem")
        .filter({
          has: page.getByRole("heading", { name: "Version 1", exact: true }),
        })
        .getByText("Current default", { exact: true }),
    ).toBeVisible();
    await publicPage.goto("/characters");
    await expect(
      publicPage.locator(`a[href="/characters/${slug}"]`),
    ).toContainText(v1Name);
    await publicPage.goto(`/characters/${slug}`);
    await expect(
      publicPage.getByRole("heading", { level: 1, name: v1Name, exact: true }),
    ).toBeVisible();

    await registerAndSignIn(userPage, {
      email: userEmail,
      name: "Pinned version user",
    });
    await startCharacterConversation(userPage, slug);
    const v1ConversationUrl = userPage.url();
    await expect(
      userPage.getByText("What would you like to explore today?", {
        exact: true,
      }),
    ).toBeVisible();
    await sendChatMessage(userPage, "Use the pinned v1 prompt [stream]");
    await expect(
      userPage.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    let promptRequests = (await fakeModelRequests()).filter(
      (request) => request.body.stream !== false,
    );
    expect(JSON.stringify(promptRequests.at(-1)?.body)).toContain(
      v1Instruction,
    );

    await page.getByLabel("Display name", { exact: true }).fill(v2Name);
    await page
      .getByLabel("Personality principles", { exact: true })
      .fill(`${v2Instruction}\nRespect the user's choices.`);
    await page
      .getByLabel("Opening message", { exact: true })
      .fill("A different opening for version two.");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Saved draft/ }),
    ).toContainText(/Saved draft revision/);
    await page
      .getByRole("button", { name: "Publish draft", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /Published version/ }),
    ).toContainText("Published version 2.");
    await publicPage.goto(`/characters/${slug}`);
    await expect(
      publicPage.getByRole("heading", { level: 1, name: v1Name, exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("A different opening for version two."),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Set version 2 as default" })
      .click();
    await expect(
      page
        .getByRole("listitem")
        .filter({
          has: page.getByRole("heading", { name: "Version 2", exact: true }),
        })
        .getByText("Current default", { exact: true }),
    ).toBeVisible();
    await publicPage.goto(`/characters/${slug}`);
    await expect(
      publicPage.getByRole("heading", { level: 1, name: v2Name, exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("A different opening for version two.", {
        exact: false,
      }),
    ).toBeVisible();
    await expectBrowseOnly(publicPage);

    await userPage.reload();
    await expect(
      userPage.getByRole("heading", { level: 1, name: v1Name, exact: true }),
    ).toBeVisible();
    await expect(
      userPage.getByText("What would you like to explore today?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(userPage.getByRole("note")).toContainText(
      "keeps the character version it started with",
    );
    await sendChatMessage(userPage, "Existing chat remains v1 [stream]");
    await expect(
      userPage.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    promptRequests = (await fakeModelRequests()).filter(
      (request) => request.body.stream !== false,
    );
    expect(JSON.stringify(promptRequests.at(-1)?.body)).toContain(
      v1Instruction,
    );
    expect(JSON.stringify(promptRequests.at(-1)?.body)).not.toContain(
      v2Instruction,
    );

    await userPage
      .getByRole("button", { name: "Conversation actions", exact: true })
      .click();
    await userPage
      .getByText("Archive this conversation and start over.")
      .click();
    await userPage
      .getByRole("button", { name: "Start over", exact: true })
      .click();
    await userPage.waitForURL((url) => url.href !== v1ConversationUrl);
    const v2ConversationUrl = userPage.url();
    await expect(
      userPage.getByRole("heading", { level: 1, name: v2Name, exact: true }),
    ).toBeVisible();
    await expect(
      userPage.getByText("A different opening for version two.", {
        exact: true,
      }),
    ).toBeVisible();
    await sendChatMessage(userPage, "New chat uses v2 [stream]");
    await expect(
      userPage.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    promptRequests = (await fakeModelRequests()).filter(
      (request) => request.body.stream !== false,
    );
    expect(JSON.stringify(promptRequests.at(-1)?.body)).toContain(
      v2Instruction,
    );
    expect(JSON.stringify(promptRequests.at(-1)?.body)).not.toContain(
      v1Instruction,
    );
    await userPage.goto(v1ConversationUrl);
    await expect(
      userPage.getByText("This archived conversation is read-only.", {
        exact: true,
      }),
    ).toBeVisible();
    await userPage.goto(v2ConversationUrl);

    await page
      .getByRole("button", { name: "Archive character", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Restore character", exact: true }),
    ).toBeVisible();
    expect((await publicPage.goto(`/characters/${slug}`))?.status()).toBe(404);
    await publicPage.goto("/characters");
    await expect(
      publicPage.locator(`a[href="/characters/${slug}"]`),
    ).toHaveCount(0);

    await userPage.reload();
    await sendChatMessage(userPage, "Archived character remains usable [stream]");
    await expect(
      userPage.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    await userPage
      .getByRole("button", { name: "Conversation actions", exact: true })
      .click();
    await userPage
      .getByText("Archive this conversation and start over.")
      .click();
    await userPage
      .getByRole("button", { name: "Start over", exact: true })
      .click();
    await expect(
      userPage.getByText("This chat is read-only.", { exact: true }),
    ).toBeVisible();
    await expect(userPage).toHaveURL(v2ConversationUrl);

    await page
      .getByRole("button", { name: "Restore character", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Archive character", exact: true }),
    ).toBeVisible();
    expect((await publicPage.goto(`/characters/${slug}`))?.status()).toBe(200);
    await expect(
      publicPage.getByRole("heading", { level: 1, name: v2Name, exact: true }),
    ).toBeVisible();
    expect(
      await database
        .select()
        .from(characterVersion)
        .where(eq(characterVersion.id, v1.id)),
    ).toEqual([v1]);

    await page.goto("/admin/audit");
    const rows = page
      .getByRole("row")
      .filter({ hasText: `character:${characterId}` })
      .filter({ hasText: email });
    for (const [action, count] of [
      ["character.create", 1],
      ["character.draft.save", 2],
      ["character.version.publish", 2],
      ["character.default.change", 2],
      ["character.archive", 1],
      ["character.restore", 1],
    ] as const) {
      await expect(
        rows.filter({
          has: page.getByRole("cell", { name: action, exact: true }),
        }),
      ).toHaveCount(count);
    }
    await expect(rows).toHaveCount(9);
    await expect(page.getByRole("table")).not.toContainText(
      fields["Long description"],
    );
    await expect(page.getByRole("table")).not.toContainText(
      fields["Example assistant 1"],
    );
  } finally {
    await anonymous.close();
    await userContext.close();
    try {
      await cleanupAdminTestData(database, [email, userEmail], [slug]);
    } finally {
      await database.$client.end();
    }
  }
});
