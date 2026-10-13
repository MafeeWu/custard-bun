import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { HomeHero } from "./home-hero";

const longBrandName =
  "Clear Daylight Companion for Durable Private Conversations";

const longDescription =
  "Private, self-hosted conversations with characters who stay coherent across time, remember the boundaries you choose, and keep the tone of each relationship stable even when your deployment, team, or daily workflow changes over long stretches.";

test("keeps long branding copy intact without leaking it into decorative motion hooks", () => {
  const { container } = render(
    <HomeHero
      branding={{
        name: longBrandName,
        description: longDescription,
        logoPath: "/brand/logo.svg",
        faviconPath: "/brand/favicon.svg",
        primaryColor: "#F59E0B",
      }}
      characters={[
        {
          id: "11111111-1111-1111-1111-111111111111",
          slug: "astrid",
          displayName: "Astrid Vale",
          avatarPath: "/characters/astrid-vale.png",
          shortDescription: "A precise observer who keeps context tidy.",
          openingMessage: "We can start with the thread you care about most.",
        },
      ]}
      registrationOpen
    />,
  );

  expect(screen.getByText(longBrandName)).toBeVisible();
  expect(screen.getByText(longDescription)).toBeVisible();
  expect(screen.getByRole("link", { name: "Get started" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Browse characters" })).toBeVisible();

  for (const element of container.querySelectorAll(
    "[class], [data-home-motion]",
  )) {
    expect(element.getAttribute("class") ?? "").not.toContain(longDescription);
    expect(element.getAttribute("data-home-motion") ?? "").not.toBe(
      longDescription,
    );
  }
});
