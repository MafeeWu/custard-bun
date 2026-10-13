import fs from "node:fs";
import path from "node:path";
import {
  Brain,
  Chats,
  ChartBar,
  ShieldCheck,
  UserCircle,
  Users,
} from "@phosphor-icons/react";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { AdminShell } from "./admin-shell";
import { AppShell } from "./app-shell";
import { AuthShell } from "./auth-shell";
import { FocusedChatShell } from "./focused-chat-shell";
import { PublicShell } from "./public-shell";
import type { ShellNavigationItem } from "./site-header";

const globalsCss = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

const appItems: ShellNavigationItem[] = [
  { href: "/app", icon: Chats, label: "Conversations" },
  { href: "/app/memories", icon: Brain, label: "Memories" },
  { href: "/account", icon: UserCircle, label: "Account" },
];

const adminItems: ShellNavigationItem[] = [
  { href: "/admin/characters", icon: Chats, label: "Characters" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/usage", icon: ChartBar, label: "Usage" },
  { href: "/admin/memory", icon: Brain, label: "Memory operations" },
  { href: "/admin/audit", icon: ShieldCheck, label: "Audit" },
];

test("public shell exposes named primary navigation, a mobile nav trigger, and one-line desktop items", () => {
  render(
    <PublicShell
      actions={<a href="/auth/sign-in">Sign in</a>}
      brand={<span>Custard Bun</span>}
      navigationItems={[
        { href: "/characters", icon: Chats, label: "Characters" },
      ]}
    >
      <p>Public content</p>
    </PublicShell>,
  );

  expect(
    screen.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Characters" })).toHaveAttribute(
    "href",
    "/characters",
  );
  expect(screen.getByRole("button", { name: "Open navigation" })).toBeVisible();
  expect(globalsCss).toMatch(
    /\.shell-nav__link-label\s*\{[^}]*white-space:\s*nowrap;/s,
  );
});

test("auth shell keeps the form landmark before decorative content in DOM order", () => {
  render(
    <AuthShell
      aside={<p>Trusted conversations, designed for clarity.</p>}
      brand={<span>Custard Bun</span>}
      description="Continue your private character conversations."
      title="Sign in"
    >
      <form aria-label="Sign in form">
        <button type="submit">Sign in</button>
      </form>
    </AuthShell>,
  );

  const main = screen.getByRole("main");
  const aside = screen.getByRole("complementary", { name: "Brand context" });

  expect(main.compareDocumentPosition(aside)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(screen.getByRole("form", { name: "Sign in form" })).toBeVisible();
});

test("app shell renders a permanent application sidebar with conversations, memories, and account links", () => {
  render(
    <AppShell brand={<span>Custard Bun</span>} navigationItems={appItems}>
      <p>App content</p>
    </AppShell>,
  );

  const sidebar = screen.getByRole("complementary", {
    name: "Application navigation",
  });

  expect(
    within(sidebar).getByRole("link", { name: "Conversations" }),
  ).toHaveAttribute("href", "/app");
  expect(
    within(sidebar).getByRole("link", { name: "Memories" }),
  ).toHaveAttribute("href", "/app/memories");
  expect(
    within(sidebar).getByRole("link", { name: "Account" }),
  ).toHaveAttribute("href", "/account");
});

test("admin shell preserves the current administration labels and hrefs", () => {
  render(
    <AdminShell brand={<span>Custard Bun</span>} navigationItems={adminItems}>
      <p>Admin content</p>
    </AdminShell>,
  );

  for (const item of adminItems) {
    expect(screen.getByRole("link", { name: item.label })).toHaveAttribute(
      "href",
      item.href,
    );
  }
});

test("focused chat shell omits the permanent application sidebar", () => {
  render(
    <FocusedChatShell
      brand={<span>Custard Bun</span>}
      navigationItems={appItems}
    >
      <p>Focused chat</p>
    </FocusedChatShell>,
  );

  expect(
    screen.queryByRole("complementary", { name: "Application navigation" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
    "href",
    "/app",
  );
});

test("mobile drawer navigation explicitly allows long labels to wrap", () => {
  render(
    <PublicShell
      actions={<a href="/auth/sign-in">Sign in</a>}
      brand={<span>Custard Bun</span>}
      navigationItems={[
        {
          href: "/characters",
          icon: Chats,
          label:
            "Characters with exceptionally detailed private conversation presets",
        },
      ]}
    >
      <p>Public content</p>
    </PublicShell>,
  );

  expect(screen.getByRole("button", { name: "Open navigation" })).toBeVisible();
  expect(globalsCss).toMatch(
    /\.shell-mobile-navigation__content\s+\.shell-nav__link-label\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
  );
});

test("long brand names wrap as text without hiding the mobile navigation trigger", () => {
  const longBrandName =
    "Clear Daylight Companion for Durable Private Character Conversations";

  render(
    <PublicShell
      actions={<a href="/auth/sign-in">Sign in</a>}
      brand={<span>{longBrandName}</span>}
      navigationItems={[
        { href: "/characters", icon: Chats, label: "Characters" },
      ]}
    >
      <p>Public content</p>
    </PublicShell>,
  );

  expect(screen.getByText(longBrandName)).toBeVisible();
  expect(screen.getByRole("button", { name: "Open navigation" })).toBeVisible();
  expect(globalsCss).toMatch(
    /\.shell-brand__name\s*\{[^}]*overflow-wrap:\s*anywhere;/s,
  );
});
