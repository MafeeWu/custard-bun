import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AuthShell } from "@/components/layout/auth-shell";
import { AuthBrandPanel, AuthFormLayout } from "./auth-form-layout";

test("keeps the form landmark before decorative auth content and preserves legal links", () => {
  render(
    <AuthShell
      aside={
        <AuthBrandPanel
          branding={{
            name: "Custard Bun",
            description:
              "Trusted private conversations with official characters.",
            logoPath: "/brand/logo.svg",
            faviconPath: "/brand/favicon.svg",
            primaryColor: "#F59E0B",
          }}
        />
      }
      brand={<span>Custard Bun</span>}
    >
      <AuthFormLayout
        alternateAction={<p>Already have an account? Sign in</p>}
        description="Start private conversations with persistent official characters."
        legalLinks={{
          privacyUrl: "https://example.com/privacy",
          termsUrl: "https://example.com/terms",
          supportUrl: "mailto:support@example.com",
        }}
        title="Create your account"
      >
        <form aria-label="Create account">
          <button type="submit">Create account</button>
        </form>
      </AuthFormLayout>
    </AuthShell>,
  );

  const main = screen.getByRole("main");
  const aside = screen.getByRole("complementary", { name: "Brand context" });

  expect(main.compareDocumentPosition(aside)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(
    screen.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  expect(screen.getByRole("form", { name: "Create account" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://example.com/privacy",
  );
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "https://example.com/terms",
  );
  expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
    "href",
    "mailto:support@example.com",
  );
});
