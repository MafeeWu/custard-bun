# Clear Daylight Interface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the functional-prototype presentation with a complete white-label Clear Daylight design system across public, authentication, user, chat, memory, account, and administration surfaces without changing product behavior.

**Architecture:** Keep Server Components and existing domain flows authoritative. Add one semantic token and accent-derivation layer, project-owned UI primitives, isolated Motion client leaves, and four reusable shells; migrate one surface family at a time so legacy selectors can be removed safely after their last consumer moves.

**Tech Stack:** Next.js 16, React 19, TypeScript 7/6 compatibility setup, Tailwind CSS 4, native CSS custom properties, `geist@1.7.2`, `motion@14.1.0`, `@phosphor-icons/react@2.1.10`, Vitest, Testing Library, Playwright, and `@axe-core/playwright@4.13.0`.

**Spec:** `docs/superpowers/specs/2026-10-13-clear-daylight-interface-redesign.md`

## Global Constraints

- Preserve every existing route slug, API contract, server action, form field name/order, autocomplete value, legal/privacy/deletion copy, and authorization boundary.
- Keep runtime `branding.name`, `description`, `logoPath`, `faviconPath`, and `primaryColor` authoritative.
- Use the configured primary color as the only brand accent; all hover, active, soft, border, focus, and contrast values derive deterministically from it.
- Default to the Clear Daylight light theme and follow `prefers-color-scheme` for one coherent dark theme; do not add a manual theme toggle.
- Use self-hosted Geist fonts from a pinned package; add no hosted font, remote image, analytics, or telemetry dependency.
- Use one Phosphor icon family and import icons individually; do not draw SVG paths by hand.
- Use Motion only in isolated client-leaf components; no page becomes client-rendered solely for animation.
- Do not use scroll hijacking, continuous pointer tracking, infinite decorative animation, WebGL, or backdrop blur on scrolling chat surfaces.
- Every animation above a simple opacity change must have an explicit reduced-motion fallback.
- Use the documented shape hierarchy: surfaces/cards/dialogs 16px, inputs 12px, buttons 10px, circular avatars, 16px directional chat bubbles.
- Support 320px through large desktop widths, `100dvh`, safe-area insets, 200% zoom, long brand/character names, and long configured descriptions.
- Keep the administration UI dense and restrained; do not apply marketing-page hero or decorative patterns to admin pages.
- Keep private content and identifiers out of class names, motion keys, screenshots, static assets, analytics, and error details.
- Do not remove a legacy CSS selector until all of its consumers have migrated and their focused tests pass.
- Use TDD for each task: observe the named focused failure, implement the smallest complete surface, rerun focused tests, then commit.
- Every implementation commit includes:

  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## Review Focus

1. **Extreme white-label accent colors:** pure white, near-black, highly saturated, and low-saturation accents must always produce WCAG-AA button text and visible focus in both themes. Task 1 owns the parameterized contrast tests.
2. **Long and narrow content:** 320px viewports, 200% zoom, long product names, long character names, and long CTA labels must not overflow, hide actions, or cover chat content. Tasks 3, 4, 5, 8, and 12 own component and browser tests.
3. **Theme and motion preferences before hydration:** system dark mode and reduced motion must apply without a client flash, hydration mismatch, or spatial animation. Tasks 1, 2, and 12 own CSS/media and browser assertions.
4. **Overlay keyboard behavior:** mobile navigation, history, conversation actions, and destructive dialogs must trap or manage focus appropriately, close on Escape, and restore focus to the trigger. Tasks 3 and 8 own keyboard tests.
5. **Privacy in visual artifacts:** committed snapshots and failure screenshots must use deterministic non-sensitive fixtures and reject provider keys, endpoints, emails, user IDs, conversation content sentinels, or raw errors. Task 12 owns the recursive sentinel scan.

---

### Task 1: Add fonts, semantic tokens, and safe accent derivation

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Create: `src/app/theme.css`
- Create: `src/server/branding/accent-theme.ts`
- Create: `src/server/branding/accent-theme.test.ts`
- Create: `src/test/theme-contract.test.ts`

**Interfaces:**

- Consumes: `branding.primaryColor` from `getPublicConfig()`.
- Produces:

  ```ts
  export type BrandThemeVariable =
    | "--color-accent"
    | "--color-accent-hover"
    | "--color-accent-active"
    | "--color-accent-soft"
    | "--color-accent-border"
    | "--color-accent-contrast"
    | "--color-focus";

  export type BrandThemeVariables = Record<BrandThemeVariable, string>;

  export function createBrandThemeVariables(
    primaryColor: string,
  ): BrandThemeVariables;

  export function contrastRatio(foreground: string, background: string): number;
  ```

- Later tasks consume semantic CSS variables from `theme.css` and the Geist CSS variables added to `<html>`.

- [ ] **Step 1: Pin UI dependencies and write the accent tests**

  Add exact dependencies:

  ```json
  {
    "dependencies": {
      "@phosphor-icons/react": "2.1.10",
      "geist": "1.7.2",
      "motion": "14.1.0"
    },
    "devDependencies": {
      "@axe-core/playwright": "4.13.0"
    }
  }
  ```

  Add parameterized tests:

  ```ts
  test.each(["#FFFFFF", "#000000", "#F59E0B", "#1757D5", "#7F8C8D"])(
    "derives readable accent variables from %s",
    (accent) => {
      const theme = createBrandThemeVariables(accent);
      expect(theme["--color-accent"]).toBe(accent.toUpperCase());
      expect(
        contrastRatio(
          theme["--color-accent-contrast"],
          theme["--color-accent"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(theme["--color-focus"]).not.toBe(theme["--color-accent-soft"]);
    },
  );

  test.each(["orange", "#FFF", "#GG0000", "rgb(1 2 3)"])(
    "rejects unsupported primary color %s",
    (accent) => {
      expect(() => createBrandThemeVariables(accent)).toThrow(
        "Brand primary color must be a six-digit hex color",
      );
    },
  );
  ```

- [ ] **Step 2: Add the CSS contract test**

  Read `theme.css` as text and assert:

  ```ts
  for (const token of [
    "--color-canvas",
    "--color-surface",
    "--color-border",
    "--color-text",
    "--color-text-muted",
    "--color-success",
    "--color-warning",
    "--color-danger",
  ]) {
    expect(css).toContain(token);
  }
  expect(css).toContain("@media (prefers-color-scheme: dark)");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toContain("font-family: Inter");
  ```

- [ ] **Step 3: Run the focused tests and observe the missing modules**

  Run:

  ```bash
  pnpm install
  pnpm exec vitest run \
    src/server/branding/accent-theme.test.ts \
    src/test/theme-contract.test.ts
  ```

  Expected: FAIL because `accent-theme.ts` and `theme.css` do not exist.

- [ ] **Step 4: Implement strict hex color math**

  Implement:

  ```ts
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;

  export function createBrandThemeVariables(
    primaryColor: string,
  ): BrandThemeVariables {
    if (!HEX_COLOR.test(primaryColor)) {
      throw new Error("Brand primary color must be a six-digit hex color");
    }
    const accent = primaryColor.toUpperCase();
    const darkText = "#0B1220";
    const lightText = "#FFFFFF";
    const contrast =
      contrastRatio(darkText, accent) >= contrastRatio(lightText, accent)
        ? darkText
        : lightText;
    return {
      "--color-accent": accent,
      "--color-accent-hover": mixHex(accent, contrast, 0.12),
      "--color-accent-active": mixHex(accent, contrast, 0.2),
      "--color-accent-soft": mixHex(accent, "#FFFFFF", 0.86),
      "--color-accent-border": mixHex(accent, "#FFFFFF", 0.62),
      "--color-accent-contrast": contrast,
      "--color-focus":
        contrastRatio(accent, "#FFFFFF") >= 3 ? accent : mixHex(accent, "#0B1220", 0.28),
    };
  }
  ```

  Keep `mixHex`, sRGB linearization, luminance, and contrast calculation in the
  same focused module. Do not add a color dependency.

- [ ] **Step 5: Create the light/dark token sheet**

  `theme.css` defines cool-neutral canvas, surface, border, text, state, shadow,
  spacing, radius, and typography tokens. The dark media query changes semantic
  values only. The reduced-motion query sets shared transition durations to
  `0.01ms` and disables smooth scrolling.

  `globals.css` imports `theme.css`, resets box sizing/body margin, uses
  `min-height: 100dvh`, and keeps only legacy selectors not yet migrated.

- [ ] **Step 6: Wire Geist and runtime accent variables**

  In `layout.tsx`:

  ```tsx
  import { GeistSans } from "geist/font/sans";
  import { GeistMono } from "geist/font/mono";
  import { createBrandThemeVariables } from "@/server/branding/accent-theme";

  const variables = createBrandThemeVariables(branding.primaryColor);

  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      lang="en"
      style={variables as CSSProperties}
    >
      <body>{children}</body>
    </html>
  );
  ```

  Do not add client-side theme detection.

- [ ] **Step 7: Run focused verification**

  ```bash
  pnpm exec vitest run \
    src/server/branding/accent-theme.test.ts \
    src/test/theme-contract.test.ts \
    src/test/deployment-config.test.ts
  pnpm typecheck
  pnpm exec prettier --check \
    src/app/layout.tsx \
    src/app/globals.css \
    src/app/theme.css \
    src/server/branding/accent-theme.ts \
    src/server/branding/accent-theme.test.ts \
    src/test/theme-contract.test.ts
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add package.json pnpm-lock.yaml src/app/layout.tsx src/app/globals.css src/app/theme.css src/server/branding src/test/theme-contract.test.ts
  git commit -m "feat(ui): add clear daylight theme foundations" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Verify pure white, black, and amber accents produce readable
foregrounds and that theme selection is CSS-driven before hydration.

### Task 2: Build typed UI primitives and shared motion presets

**Files:**

- Create: `src/components/ui/cx.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/field.tsx`
- Create: `src/components/ui/surface.tsx`
- Create: `src/components/ui/avatar.tsx`
- Create: `src/components/ui/icon-button.tsx`
- Create: `src/components/ui/status-notice.tsx`
- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/ui/page-header.tsx`
- Create: `src/components/ui/motion-presets.ts`
- Create: `src/components/ui/motion-reveal.tsx`
- Create: `src/components/ui/ui-primitives.test.tsx`
- Create: `src/components/ui/motion-presets.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: semantic tokens from Task 1.
- Produces:

  ```ts
  export type ButtonTone = "primary" | "secondary" | "quiet" | "danger";
  export type ButtonSize = "sm" | "md" | "lg";

  export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: ButtonTone;
    size?: ButtonSize;
    pending?: boolean;
  }

  export interface FieldProps {
    label: string;
    htmlFor: string;
    hint?: string;
    error?: string;
    children: React.ReactNode;
  }

  export type NoticeTone = "info" | "success" | "warning" | "danger";

  export const motionPresets: {
    riseIn: Variants;
    staggerChildren: Variants;
    messageEnter: Variants;
    statusTransition: Variants;
    cardHover: MotionProps;
  };
  ```

- [ ] **Step 1: Write primitive behavior tests**

  Cover:

  ```tsx
  render(<Button pending>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");

  render(
    <Field htmlFor="email" label="Email" error="Enter a valid email">
      <input id="email" />
    </Field>,
  );
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "aria-describedby",
    expect.stringContaining("error"),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email");
  ```

  Also assert:

  - `IconButton` throws in development or requires a nonempty `label`;
  - danger buttons do not use the brand accent class;
  - `EmptyState` has a heading and optional action;
  - `Skeleton` is `aria-hidden`;
  - `PageHeader` renders one heading at the requested level;
  - CTA labels retain `white-space: nowrap`.

- [ ] **Step 2: Write motion-preset tests**

  Assert every preset uses only opacity/transform and that reduced variants
  contain no spatial transform:

  ```ts
  expect(motionPresets.riseIn.visible).toMatchObject({ opacity: 1, y: 0 });
  expect(reducedMotionPresets.riseIn.hidden).toEqual({ opacity: 0 });
  expect(JSON.stringify(reducedMotionPresets)).not.toMatch(/"x"|"y"|"scale"/);
  ```

- [ ] **Step 3: Run the focused tests**

  ```bash
  pnpm exec vitest run \
    src/components/ui/ui-primitives.test.tsx \
    src/components/ui/motion-presets.test.ts
  ```

  Expected: FAIL because the UI modules do not exist.

- [ ] **Step 4: Implement class composition and primitives**

  `cx()` accepts strings, false, null, and undefined and joins truthy values.
  Components use semantic class names such as `ui-button`,
  `ui-button--primary`, and `ui-field__error`; they do not accept arbitrary
  color props.

  `Button` preserves its visible label while pending and adds a visually hidden
  pending announcement. `LinkButton` lives in `button.tsx` and accepts a Next
  `href` plus tone/size.

- [ ] **Step 5: Implement motion as a client leaf**

  `motion-reveal.tsx` begins with `"use client"`, calls
  `useReducedMotion()`, and selects either `motionPresets` or
  `reducedMotionPresets`. It receives only:

  ```ts
  interface MotionRevealProps {
    preset: "riseIn" | "staggerChildren" | "messageEnter" | "statusTransition";
    as?: "div" | "section" | "li";
    children: React.ReactNode;
    className?: string;
  }
  ```

  Do not pass private content into animation keys.

- [ ] **Step 6: Add primitive styles**

  Use the fixed radius hierarchy, visible focus rings, 44px default touch
  targets, one-line desktop CTA labels, disabled/pending states, and light/dark
  semantic tokens. Skeleton shimmer runs only when reduced motion is not
  requested.

- [ ] **Step 7: Run verification**

  ```bash
  pnpm exec vitest run src/components/ui
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/ui src/app/globals.css
  git commit -m "feat(ui): add accessible interface primitives" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm primitives cannot bypass semantic color/motion
contracts and pending buttons retain accessible names and stable width.

### Task 3: Add accessible overlays and shared application shells

**Files:**

- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/drawer.tsx`
- Create: `src/components/ui/disclosure.tsx`
- Create: `src/components/ui/overlay.test.tsx`
- Create: `src/components/layout/public-shell.tsx`
- Create: `src/components/layout/auth-shell.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/components/layout/admin-shell.tsx`
- Create: `src/components/layout/focused-chat-shell.tsx`
- Create: `src/components/layout/site-header.tsx`
- Create: `src/components/layout/mobile-navigation.tsx`
- Create: `src/components/layout/layout-shells.test.tsx`
- Create: `src/app/app/layout.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/layout.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Task 2 buttons, icon buttons, surfaces, and motion presets.
- Produces:

  ```ts
  export interface DialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    description?: string;
    children: React.ReactNode;
    initialFocusRef?: React.RefObject<HTMLElement | null>;
  }

  export interface DrawerProps extends DialogProps {
    side?: "left" | "right" | "bottom";
  }

  export interface ShellNavigationItem {
    href: string;
    label: string;
    icon: Icon;
  }
  ```

- [ ] **Step 1: Write overlay keyboard tests**

  With `userEvent`:

  ```tsx
  await user.click(screen.getByRole("button", { name: "Open history" }));
  expect(screen.getByRole("dialog", { name: "Conversation history" })).toBeVisible();
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open history" })).toHaveFocus();
  ```

  Add Tab/Shift+Tab containment, backdrop close, cancel prevention during
  pending destructive action, and reduced-motion tests.

- [ ] **Step 2: Write shell tests**

  Assert:

  - Public Shell has named primary navigation and one-line desktop items;
  - Auth Shell places the form landmark before decorative content in DOM order
    on mobile;
  - App Shell exposes Conversations, Memories, and Account links;
  - Admin Shell preserves Characters, Users, Usage, Memory operations, and
    Audit labels and hrefs;
  - Focused Chat Shell omits the permanent app sidebar;
  - a 60-character brand name remains text-wrappable without hiding the mobile
    navigation button.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run \
    src/components/ui/overlay.test.tsx \
    src/components/layout/layout-shells.test.tsx \
    src/app/admin/layout.test.tsx
  ```

  Expected: FAIL because shells and overlays do not exist.

- [ ] **Step 4: Implement native-dialog overlays**

  Use `<dialog>` with `showModal()`, `close()`, the `cancel` event, trigger
  focus capture, initial focus, focus restoration, and cleanup on unmount.
  Drawer is a styled dialog variant. Disclosure is for nonmodal inline panels
  only.

  Do not apply `role="menu"` to panels containing forms or mixed links; use
  dialog/disclosure semantics that match their content.

- [ ] **Step 5: Implement shells**

  Shells accept children and typed navigation items. `MobileNavigation` is the
  only client leaf for shell navigation. Use individual Phosphor icons such as
  `Chats`, `Brain`, `UserCircle`, `Users`, `ChartBar`, and `ShieldCheck`.

- [ ] **Step 6: Wire app and admin layouts**

  `src/app/app/layout.tsx` wraps authenticated product pages in `AppShell`.
  `admin/layout.tsx` keeps `requireAdmin()` before rendering and passes the
  existing links to `AdminShell`. Do not move authorization into a client
  component.

- [ ] **Step 7: Add responsive shell styles**

  Use grid layouts, `min-height: 100dvh`, safe-area padding, desktop side
  navigation for admin, and mobile drawers below 768px. Add no `h-screen`.

- [ ] **Step 8: Verify**

  ```bash
  pnpm exec vitest run \
    src/components/ui/overlay.test.tsx \
    src/components/layout/layout-shells.test.tsx \
    src/app/admin/layout.test.tsx
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/ui src/components/layout src/app/app/layout.tsx src/app/admin/layout.tsx src/app/admin/layout.test.tsx src/app/globals.css
  git commit -m "feat(ui): add responsive product shells" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Exercise Escape, focus containment/restoration, mobile
navigation, and long brand labels before approving.

### Task 4: Redesign the public homepage

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`
- Create: `src/components/home/home-hero.tsx`
- Create: `src/components/home/character-stage.tsx`
- Create: `src/components/home/home-sections.tsx`
- Create: `src/components/home/home-motion.tsx`
- Create: `src/components/home/home-components.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: `PublicShell`, Task 2 primitives/motion, `getPublicConfig()`,
  `listPublicCharacters(database)`, and `getDatabase()`.
- Produces a homepage that uses at most three real public character summaries:

  ```ts
  interface HomeHeroProps {
    branding: PublicConfig["branding"];
    registrationOpen: boolean;
    characters: readonly PublicCharacterSummary[];
  }
  ```

- [ ] **Step 1: Extend the page test with real hierarchy contracts**

  Mock three character summaries and assert:

  ```tsx
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    /conversations/i,
  );
  expect(screen.getAllByRole("img")).toHaveLength(4); // brand plus characters
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
  expect(screen.getByRole("link", { name: "Browse characters" })).toHaveAttribute(
    "href",
    "/characters",
  );
  ```

  Add a closed-registration assertion that the primary action points to sign
  in, and an empty-character assertion that renders a deliberate visual
  fallback without fake portraits.

- [ ] **Step 2: Add component tests for long copy**

  Render a 60-character product name and 240-character description. Assert the
  complete text remains in the DOM, CTA labels are unchanged, and no decorative
  element receives the description as an animation key or class name.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run \
    src/app/page.test.tsx \
    src/components/home/home-components.test.tsx
  ```

  Expected: FAIL because the homepage components and character query are
  missing.

- [ ] **Step 4: Implement the asymmetric hero**

  Server-render copy and actions. Use real character avatar paths in the right
  composition. `HomeMotion` animates structural wrappers only and receives no
  private or user-generated content.

  Static public copy:

  - headline: `Conversations with character. Continuity you control.`
  - privacy section: `Your deployment, your conversations`
  - continuity section: `Characters that stay consistent`

  Do not add invented testimonials, logos, usage statistics, or model claims.

- [ ] **Step 5: Implement the remaining sections**

  Use one character-preview composition, one privacy/self-hosting section, one
  continuity/memory-control section, and one final CTA. Ensure the final CTA
  intent differs from the hero secondary action.

- [ ] **Step 6: Style responsive and reduced-motion states**

  Desktop uses the approved split composition. Mobile renders text first,
  character stage second, and keeps the primary CTA visible without requiring
  a viewport-height hero. Do not use `h-screen`.

- [ ] **Step 7: Verify**

  ```bash
  pnpm exec vitest run src/app/page.test.tsx src/components/home
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/page.tsx src/app/page.test.tsx src/components/home src/app/globals.css
  git commit -m "feat(ui): redesign the public homepage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Check 320px, long branding, empty character data, and that
only repository-owned character images render.

### Task 5: Redesign character catalog and profile surfaces

**Files:**

- Modify: `src/app/characters/page.tsx`
- Modify: `src/app/characters/page.test.tsx`
- Modify: `src/app/characters/[slug]/page.tsx`
- Modify: `src/app/characters/[slug]/page.test.tsx`
- Modify: `src/components/characters/character-card.tsx`
- Modify: `src/components/characters/character-card.test.tsx`
- Modify: `src/components/characters/character-profile.tsx`
- Modify: `src/components/characters/character-profile.test.tsx`
- Create: `src/components/characters/character-grid-motion.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Public Shell, Avatar, Button/LinkButton, Surface, EmptyState,
  PageHeader, MotionReveal.
- Produces:

  ```ts
  export interface CharacterCardProps {
    character: PublicCharacterSummary;
    emphasis?: "featured" | "standard";
    index?: number;
  }
  ```

- [ ] **Step 1: Write catalog semantic tests**

  Assert:

  - the page heading and catalog description remain;
  - zero characters renders `No official characters are available right now`
    inside an `EmptyState`;
  - the first stable item receives `featured` and later items `standard`;
  - every character remains one accessible link;
  - opening-message preview remains visible text, not title/tooltip-only.

- [ ] **Step 2: Write card/profile tests**

  Add long display-name and long opening-message fixtures. Assert:

  ```tsx
  expect(screen.getByRole("link", { name: /Calm Listener/ })).toHaveAttribute(
    "href",
    "/characters/calm-listener",
  );
  expect(screen.getByRole("img", { name: "Calm Listener avatar" })).toHaveAttribute(
    "width",
    "160",
  );
  ```

  Profile tests retain personality, speaking style, response rhythm,
  relationship boundaries, and the exact start/continue/sign-in action.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run \
    src/app/characters/page.test.tsx \
    'src/app/characters/[slug]/page.test.tsx' \
    src/components/characters
  ```

  Expected: FAIL on new structure and props.

- [ ] **Step 4: Implement the catalog**

  Use a CSS Grid with a featured first card only when the list has at least
  three entries. All data order remains query-owned. `CharacterGridMotion`
  handles stagger and reduces to opacity-only.

- [ ] **Step 5: Implement the profile composition**

  Use a portrait-led two-column header, a distinct opening-message treatment,
  and structured detail sections. Keep the primary conversation action close to
  identity content and preserve sign-in return URL encoding.

- [ ] **Step 6: Add hover, focus, mobile, and dark styles**

  Hover uses small translate/portrait scale only on hover-capable devices.
  Focus is always visible. Mobile uses one column and does not truncate the
  character name or primary action.

- [ ] **Step 7: Verify**

  ```bash
  pnpm exec vitest run \
    src/app/characters \
    src/components/characters
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/characters src/components/characters src/app/globals.css
  git commit -m "feat(ui): redesign character discovery" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Verify long names/opening copy, empty catalogs, keyboard focus,
and no hover-only information.

### Task 6: Redesign authentication and account-entry forms

**Files:**

- Modify: `src/app/auth/sign-in/page.tsx`
- Modify: `src/app/auth/sign-up/page.tsx`
- Modify: `src/app/auth/forgot-password/page.tsx`
- Modify: `src/app/auth/reset-password/page.tsx`
- Modify: `src/app/auth/verify-email/page.tsx`
- Modify: `src/app/auth/sign-up/page.test.tsx`
- Modify: `src/app/auth/reset-password/page.test.tsx`
- Modify: `src/app/auth/verify-email/page.test.tsx`
- Modify: `src/components/auth/sign-in-form.tsx`
- Modify: `src/components/auth/sign-up-form.tsx`
- Modify: `src/components/auth/forgot-password-form.tsx`
- Modify: `src/components/auth/reset-password-form.tsx`
- Modify: `src/components/auth/sign-out-button.tsx`
- Modify: `src/components/auth/sign-in-form.test.tsx`
- Modify: `src/components/auth/sign-up-form.test.tsx`
- Modify: `src/components/auth/forgot-password-form.test.tsx`
- Modify: `src/components/auth/reset-password-form.test.tsx`
- Modify: `src/components/auth/sign-out-button.test.tsx`
- Modify: `src/components/auth/rate-limit-forms.test.tsx`
- Create: `src/components/auth/auth-form-layout.tsx`
- Create: `src/components/auth/auth-form-layout.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Auth Shell, Field/Input, Button, StatusNotice, LinkButton.
- Produces:

  ```ts
  interface AuthFormLayoutProps {
    title: string;
    description: string;
    children: React.ReactNode;
    alternateAction?: React.ReactNode;
    legalLinks: PublicConfig["links"];
  }
  ```

- [ ] **Step 1: Lock form contracts with tests**

  For sign-up, assert exact DOM order:

  ```ts
  const controls = screen.getByRole("form", { name: "Create account" })
    .querySelectorAll("input, button");
  expect([...controls].map((element) => element.getAttribute("name") ?? element.textContent))
    .toEqual(["name", "email", "password", "Create account"]);
  ```

  Assert existing `autocomplete`, min/max password length, callback URL,
  registration-closed copy, generic error copy, and status roles remain.

- [ ] **Step 2: Add visual-state tests**

  Assert Field links errors through `aria-describedby`, pending buttons keep
  names and width classes, legal links remain present, and the form is the first
  main content landmark in DOM order.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run src/app/auth src/components/auth
  ```

  Expected: FAIL because pages/forms do not use Auth Shell and primitives.

- [ ] **Step 4: Implement Auth Form Layout**

  Use one component for heading, description, form area, alternate action, and
  legal/support links. The decorative panel uses the configured logo and
  repository-owned character imagery only. Keep the form first in DOM order and
  reposition with CSS Grid on desktop.

- [ ] **Step 5: Migrate forms without changing behavior**

  Replace raw labels/inputs/buttons with Field and Button while preserving every
  name, id, order, autocomplete value, constraint, submit handler, callback,
  message, and error fallback.

- [ ] **Step 6: Add responsive form styles**

  Desktop uses a split shell; mobile is one column with the form first. Inputs
  and placeholders pass contrast in both themes. Pending text does not resize
  the submit button.

- [ ] **Step 7: Verify**

  ```bash
  pnpm exec vitest run src/app/auth src/components/auth
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/auth src/components/auth src/app/globals.css
  git commit -m "feat(ui): redesign authentication surfaces" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Compare field order, names, autocomplete, status/error copy,
and callback behavior before and after migration.

### Task 7: Redesign the signed-in application home

**Files:**

- Modify: `src/app/app/page.tsx`
- Modify: `src/app/app/page.test.tsx`
- Create: `src/components/app/conversation-card.tsx`
- Create: `src/components/app/conversation-card.test.tsx`
- Create: `src/components/app/application-empty-state.tsx`
- Modify: `src/components/auth/sign-out-button.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: App Shell from Task 3 and Task 2 primitives.
- Produces:

  ```ts
  interface ConversationCardProps {
    id: string;
    character: {
      displayName: string;
      avatarPath: string;
    };
  }
  ```

- [ ] **Step 1: Write application-home tests**

  Cover:

  - display name preferred over email;
  - active conversations render as accessible continuation links;
  - zero conversations renders a composed empty state with one Browse
    characters action;
  - Memories and Account navigation come from App Shell, not duplicate page
    actions;
  - sign-out remains available in the account area.

- [ ] **Step 2: Add long-content tests**

  Render a 60-character user name and character name. Assert complete text is
  present and the link accessible name remains `Continue with <name>`.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run src/app/app/page.test.tsx src/components/app
  ```

  Expected: FAIL because application components do not exist.

- [ ] **Step 4: Implement conversation presentation**

  Use continuation rows/cards with explicit avatar dimensions, last-action
  wording, and a directional icon. Avoid placing each small action in its own
  elevated card.

- [ ] **Step 5: Implement the empty state**

  Use configured branding and a real Browse characters action. Do not invent
  sample conversations or expose email when a name exists.

- [ ] **Step 6: Verify**

  ```bash
  pnpm exec vitest run src/app/app/page.test.tsx src/components/app
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/app/app/page.tsx src/app/app/page.test.tsx src/components/app src/components/auth/sign-out-button.tsx src/app/globals.css
  git commit -m "feat(ui): redesign the application home" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Test empty data, long names, and ensure account navigation is
not duplicated or made more prominent than conversations.

### Task 8: Redesign account, export, deletion, and goodbye surfaces

**Files:**

- Modify: `src/app/account/page.tsx`
- Modify: `src/app/account/page.test.tsx`
- Modify: `src/app/goodbye/page.tsx`
- Modify: `src/components/account/data-export-panel.tsx`
- Modify: `src/components/account/data-export-panel.test.tsx`
- Modify: `src/components/account/delete-account-form.tsx`
- Modify: `src/components/account/delete-account-form.test.tsx`
- Create: `src/components/account/account-section.tsx`
- Create: `src/components/account/export-status.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: App Shell, Surface, StatusNotice, Button, Dialog, PageHeader.
- Produces:

  ```ts
  type ExportVisualState =
    | { kind: "idle" }
    | { kind: "queued" }
    | { kind: "processing" }
    | { kind: "ready"; expiresAt: Date; downloadHref: string }
    | { kind: "expired" }
    | { kind: "failed"; message: string };
  ```

- [ ] **Step 1: Preserve privacy workflow tests**

  Extend existing tests to assert exact export/deletion copy, action names,
  confirmation requirements, and status roles. Confirm no user ID, export ID,
  archive path, or deletion token appears in rendered copy.

- [ ] **Step 2: Add export-state tests**

  Render every `ExportVisualState` and assert queued/processing/ready/expired/
  failed status, one download action only when ready, and expiry remains
  visible.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run \
    src/app/account \
    src/components/account \
    src/app/goodbye
  ```

  Expected: FAIL on new section/status components.

- [ ] **Step 4: Implement account sections**

  Group ordinary account actions, private export, and deletion into separate
  semantic sections. Danger actions use danger tokens and a dialog; they do not
  share the primary action row with export or profile actions.

- [ ] **Step 5: Implement export status**

  Use an ordered status presentation without animated progress percentages.
  Keep existing polling/actions authoritative. Reduced motion removes status
  transitions.

- [ ] **Step 6: Redesign confirmation and goodbye pages**

  Preserve token handling and exact privacy semantics. Confirmation puts the
  destructive consequence before the submit action. Goodbye provides only
  public-safe navigation.

- [ ] **Step 7: Verify**

  ```bash
  pnpm exec vitest run src/app/account src/components/account src/app/goodbye
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/app/account src/app/goodbye src/components/account src/app/globals.css
  git commit -m "feat(ui): redesign account privacy surfaces" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm visual hierarchy never weakens export expiry or
deletion consequences and rendered output contains no private identifiers.

### Task 9: Redesign focused chat, history, actions, and composer

**Files:**

- Modify: `src/components/chat/chat-screen.tsx`
- Modify: `src/components/chat/chat-screen.test.tsx`
- Modify: `src/components/chat/chat-composer.tsx`
- Modify: `src/components/chat/chat-composer.test.tsx`
- Modify: `src/components/chat/chat-message.tsx`
- Modify: `src/components/chat/chat-timeline.tsx`
- Modify: `src/components/chat/conversation-history.tsx`
- Modify: `src/components/chat/safe-markdown.tsx`
- Modify: `src/components/chat/safe-markdown.test.tsx`
- Create: `src/components/chat/chat-header.tsx`
- Create: `src/components/chat/chat-actions.tsx`
- Create: `src/components/chat/chat-message-motion.tsx`
- Create: `src/components/chat/chat-layout.test.tsx`
- Modify: `src/app/app/conversations/[id]/page.tsx`
- Modify: `src/app/app/conversations/[id]/page.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Focused Chat Shell, Drawer, Dialog, Button, IconButton, Avatar,
  StatusNotice, MotionReveal.
- Produces:

  ```ts
  interface ChatHeaderProps {
    character: UserConversationDetail["character"];
    state: "available" | "replying" | "archived";
    memoryHref: string;
    history: ArchivedConversationSummary[];
    actions: React.ReactNode;
  }
  ```

- [ ] **Step 1: Lock behavior before visual changes**

  Keep all existing chat-screen/composer tests. Add assertions that:

  - Manage memory targets the current character;
  - deletion copy remains exact;
  - archived chat is read-only;
  - version notice exposes no model configuration;
  - pending, streaming, complete, failed, interrupted, recovery, stop, and retry
    behavior remains.

- [ ] **Step 2: Write overlay and composer layout tests**

  Test:

  ```tsx
  await user.click(screen.getByRole("button", { name: "Open conversation history" }));
  expect(screen.getByRole("dialog", { name: "Conversation history" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Open conversation history" })).toHaveFocus();
  ```

  Add:

  - conversation actions open a separate dialog/drawer;
  - danger actions are visually separated;
  - textarea has bounded `max-height`;
  - composer has safe-area padding and `position: sticky`;
  - latest message receives bottom scroll padding at least equal to composer
    height;
  - a 320px CSS contract contains no fixed-width control.

- [ ] **Step 3: Write message and Markdown tests**

  Assert assistant/user/status classes are semantic, code blocks remain
  horizontally scrollable, links remain safe, and motion keys use stable
  message IDs rather than content.

- [ ] **Step 4: Run focused tests**

  ```bash
  pnpm exec vitest run \
    src/components/chat \
    'src/app/app/conversations/[id]/page.test.tsx'
  ```

  Expected: FAIL because new header/actions/layout components do not exist.

- [ ] **Step 5: Implement focused header and overlays**

  Replace `<details>` history/actions with accessible Drawer/Dialog components.
  Keep character identity, presence, memory, history, and actions. Use
  individual Phosphor icons with visible labels or accessible names.

- [ ] **Step 6: Implement timeline and message motion**

  Animate only newly inserted structural message wrappers. Reduced motion uses
  opacity-only. Do not reanimate the full transcript after server refresh.
  Preserve safe Markdown and every status/error message.

- [ ] **Step 7: Implement the composer layout**

  Preserve fetch, abort, recovery, retry, and refresh code. Change presentation
  only:

  - auto-grow visually within a CSS max height;
  - maintain the existing textarea value/state;
  - show Send/Stop as stable-width actions;
  - keep inline transport/provider errors;
  - reserve safe-area and timeline bottom spacing;
  - do not cover the latest message when the mobile keyboard is open.

- [ ] **Step 8: Add responsive/dark/reduced-motion styles**

  Use no backdrop blur on the scrolling surface. Keep bubbles within a readable
  width and use the documented 16px directional radius. Ensure long code and
  URLs wrap or scroll without page overflow.

- [ ] **Step 9: Verify**

  ```bash
  pnpm exec vitest run \
    src/components/chat \
    'src/app/app/conversations/[id]/page.test.tsx'
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 10: Commit**

  ```bash
  git add src/components/chat 'src/app/app/conversations/[id]' src/app/globals.css
  git commit -m "feat(ui): redesign the focused chat experience" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Test all stream terminal states, focus restoration, 320px
composer behavior, mobile keyboard spacing, and motion keys that contain no
message content.

### Task 10: Redesign memory and relationship controls

**Files:**

- Modify: `src/app/app/memories/page.tsx`
- Modify: `src/app/app/memories/page.test.tsx`
- Modify: `src/app/app/memories/[characterId]/page.tsx`
- Modify: `src/app/app/memories/[characterId]/page.test.tsx`
- Modify: `src/components/memory/relationship-memory-screen.tsx`
- Modify: `src/components/memory/relationship-memory-screen.test.tsx`
- Modify: `src/components/memory/memory-relationship-overview.tsx`
- Modify: `src/components/memory/memory-controls-form.tsx`
- Modify: `src/components/memory/memory-item-form.tsx`
- Modify: `src/components/memory/relationship-summary-form.tsx`
- Modify: `src/components/memory/forget-character-form.tsx`
- Modify: `src/components/memory/memory-styles.test.tsx`
- Create: `src/components/memory/memory-item-list.tsx`
- Create: `src/components/memory/memory-status.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: App Shell, Surface, Field/Textarea, Button, StatusNotice, Dialog,
  EmptyState.
- Produces:

  ```ts
  interface MemoryStatusProps {
    recordingEnabled: boolean;
    recallEnabled: boolean;
    activeItems: number;
    summaryPresent: boolean;
  }
  ```

- [ ] **Step 1: Preserve memory behavior tests**

  Keep exact actions, form names, revisions, confirmation text, retry behavior,
  sensitivity/provenance visibility, and forget semantics. Assert no change to
  action payloads.

- [ ] **Step 2: Replace style-string tests with semantic contracts**

  Update `memory-styles.test.tsx` to assert:

  - textarea width 100%, minimum height, and vertical resize;
  - long memory content uses `overflow-wrap: anywhere`;
  - focus-visible outline uses `--color-focus`;
  - forms remain grid layouts;
  - danger section uses semantic danger tokens;
  - 320px CSS contains no fixed minimum width.

- [ ] **Step 3: Add state tests**

  Cover zero items, summary absent/present, recording off, recall off, pending
  edit, failed retry, and forget confirmation dialog.

- [ ] **Step 4: Run focused tests**

  ```bash
  pnpm exec vitest run src/app/app/memories src/components/memory
  ```

  Expected: FAIL on new status/list semantics.

- [ ] **Step 5: Implement relationship overview and controls**

  Use a compact relationship header and separate recording/recall controls.
  Keep controls explicit checkboxes or switches with visible text; do not use
  color-only status.

- [ ] **Step 6: Implement memory item list**

  Use structured rows/surfaces with content, status/provenance metadata already
  exposed by the current product, and contextual edit/delete actions. Long
  content wraps. Do not expose internal IDs.

- [ ] **Step 7: Implement forget danger section**

  Keep it visually and semantically separate. Use Dialog confirmation and exact
  existing consequences. Disable pending actions correctly.

- [ ] **Step 8: Verify**

  ```bash
  pnpm exec vitest run src/app/app/memories src/components/memory
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add src/app/app/memories src/components/memory src/app/globals.css
  git commit -m "feat(ui): redesign memory management" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Compare action payloads and destructive copy, then test long
content, empty state, disabled controls, and 320px wrapping.

### Task 11: Redesign administration without weakening privacy boundaries

**Files:**

- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/page.test.tsx`
- Modify: `src/app/admin/characters/page.tsx`
- Modify: `src/app/admin/characters/page.test.tsx`
- Modify: `src/app/admin/characters/new/page.tsx`
- Modify: `src/app/admin/characters/[id]/page.tsx`
- Modify: `src/app/admin/characters/[id]/preview/page.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/users/page.test.tsx`
- Modify: `src/app/admin/usage/page.tsx`
- Modify: `src/app/admin/usage/page.test.tsx`
- Modify: `src/app/admin/memory/page.tsx`
- Modify: `src/app/admin/memory/page.test.tsx`
- Modify: `src/app/admin/memory/controls.tsx`
- Modify: `src/app/admin/audit/page.tsx`
- Modify: `src/app/admin/audit/page.test.tsx`
- Modify: `src/components/admin/characters/character-editor.tsx`
- Modify: `src/components/admin/characters/character-editor.test.tsx`
- Modify: `src/components/admin/characters/character-editor-submit.test.tsx`
- Modify: `src/components/admin/characters/character-preview.tsx`
- Modify: `src/components/admin/characters/character-preview.test.tsx`
- Modify: `src/components/admin/characters/version-history.tsx`
- Modify: `src/components/admin/characters/version-history.test.tsx`
- Modify: `src/components/admin/usage/chat-settings-form.tsx`
- Modify: `src/components/admin/usage/chat-settings-form.test.tsx`
- Modify: `src/components/admin/users/user-quota-form.tsx`
- Modify: `src/components/admin/users/user-status-form.tsx`
- Modify: `src/components/admin/users/user-status-form.test.tsx`
- Create: `src/components/admin/admin-page-header.tsx`
- Create: `src/components/admin/admin-section.tsx`
- Create: `src/components/admin/admin-data-list.tsx`
- Create: `src/components/admin/admin-components.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Admin Shell, UI primitives, existing admin query/action contracts.
- Produces:

  ```ts
  interface AdminDataColumn<Row> {
    key: string;
    header: string;
    cell(row: Row): React.ReactNode;
    priority: "primary" | "secondary" | "detail";
  }
  ```

  `AdminDataList` renders a semantic table when columns fit and a labeled
  definition-list/card representation below the mobile breakpoint. It never
  accepts a free-form accessor string for private fields.

- [ ] **Step 1: Lock aggregate-only and authorization tests**

  Preserve every existing `requireAdmin` call and query result. Add assertions
  that usage/memory pages do not render email, user ID, conversation content,
  memory content, provider endpoint, key, or request ID sentinels.

- [ ] **Step 2: Add admin navigation and data-layout tests**

  Assert all existing labels/hrefs remain. Test:

  - desktop side navigation;
  - mobile navigation button;
  - table headers and row labels;
  - mobile definition-list representation;
  - empty states;
  - long character names and status labels;
  - forms keep exact field names and submit actions.

- [ ] **Step 3: Run focused tests**

  ```bash
  pnpm exec vitest run src/app/admin src/components/admin
  ```

  Expected: FAIL because admin components and responsive data presentation do
  not exist.

- [ ] **Step 4: Implement admin foundations**

  Use compact PageHeader variants, section surfaces, data lists, sticky action
  bars only for long character forms, and semantic state notices. Do not add
  hero copy, decorative motion, or oversized headings.

- [ ] **Step 5: Migrate character administration**

  Preserve editor field order, immutable/version rules, preview, publication
  actions, and validation. Use Field primitives and explicit action hierarchy.

- [ ] **Step 6: Migrate users, usage, memory operations, and audit**

  Keep aggregate-only data and existing actions. On mobile, reprioritize columns
  through `priority`; do not hide required labels or expose additional fields.

- [ ] **Step 7: Add minimal admin motion**

  Limit motion to navigation drawer and status transitions. Reduced motion
  removes both transforms. Do not animate data-row sorting or values.

- [ ] **Step 8: Verify**

  ```bash
  pnpm exec vitest run src/app/admin src/components/admin
  pnpm typecheck
  pnpm lint -- --quiet
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add src/app/admin src/components/admin src/app/globals.css
  git commit -m "feat(ui): redesign administration surfaces" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm authorization remains server-side, mobile
reprioritization does not reveal hidden/private fields, and aggregate pages
remain content-free.

### Task 12: Add visual, accessibility, responsive, and privacy release gates

**Files:**

- Modify: `package.json`
- Modify: `playwright.config.ts`
- Create: `playwright.visual.config.ts`
- Create: `tests/e2e/visual-redesign.spec.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/support/visual-fixtures.ts`
- Create: `tests/e2e/support/visual-privacy.ts`
- Create: `src/test/ui-preflight.test.ts`
- Modify: `tests/e2e/landing.spec.ts`
- Modify: `tests/e2e/characters.spec.ts`
- Modify: `tests/e2e/chat.spec.ts`
- Modify: `tests/e2e/memory.spec.ts`
- Modify: `tests/e2e/administration.spec.ts`
- Modify: `tests/e2e/account-lifecycle.spec.ts`
- Modify: `tests/release/privacy-scan.ts`
- Modify: `tests/release/compose-gate.ts`
- Modify: `src/test/deployment-config.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-13-clear-daylight-interface-redesign.md`
- Modify: `docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md`
- Create: `tests/e2e/visual-redesign.spec.ts-snapshots/` through Playwright

**Interfaces:**

- Consumes: every redesigned surface and existing E2E harness.
- Produces:

  ```ts
  export const visualPrivacySentinels: readonly string[];

  export async function assertVisualEvidenceIsPrivate(
    root: string,
  ): Promise<{ files: number }>;
  ```

  Package scripts:

  ```json
  {
    "test:e2e:visual": "playwright test --config playwright.visual.config.ts tests/e2e/visual-redesign.spec.ts",
    "test:e2e:a11y": "playwright test --config playwright.visual.config.ts tests/e2e/accessibility.spec.ts"
  }
  ```

- [ ] **Step 1: Add the static preflight test**

  Scan tracked UI source and assert:

  - no `h-screen`;
  - no `window.addEventListener("scroll"`;
  - no remote font or image URLs;
  - no `framer-motion` import;
  - no inline SVG `<path>` in application components;
  - no new direct legacy colors outside `theme.css` and accent-theme tests;
  - every file importing `motion/react` begins with `"use client"`;
  - only one icon package is imported.

  Explicitly allow character content to contain punctuation from configured
  copy; do not scan user/domain strings for design-style punctuation rules.

- [ ] **Step 2: Create the visual Playwright configuration**

  Reuse the existing app, worker, and fake-model web servers. Define projects:

  ```ts
  projects: [
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        reducedMotion: "no-preference",
      },
    },
    {
      name: "desktop-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        reducedMotion: "no-preference",
      },
    },
    {
      name: "mobile-light-reduced",
      use: {
        ...devices["iPhone 13"],
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
  ];
  ```

  Limit this configuration to visual/accessibility specs so existing stateful
  E2E tests do not run three times.

- [ ] **Step 3: Write visual flows before accepting snapshots**

  Cover deterministic fixtures for:

  - homepage;
  - character catalog;
  - character profile;
  - sign-up;
  - application empty and active-conversation home;
  - active and archived chat;
  - memory relationship screen;
  - account export/deletion;
  - users, usage, memory operations, and audit administration.

  For each page:

  ```ts
  await expect(page.locator("main")).toHaveScreenshot("home.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  ```

  Assert `document.documentElement.scrollWidth <= window.innerWidth` and primary
  actions have nonzero visible bounding boxes.

- [ ] **Step 4: Add long-content and zoom browser tests**

  Use a fixture brand name of 60 characters and character name of 80
  characters. Set viewport width to 320px and separately emulate 200% zoom
  through browser context/device scale plus CSS viewport checks. Assert:

  - no horizontal overflow;
  - navigation action remains visible;
  - CTA text is one line on desktop;
  - chat latest message is above the composer;
  - dialogs fit inside the visual viewport.

- [ ] **Step 5: Add keyboard and axe tests**

  For representative pages:

  ```ts
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast"]) // run explicit contrast checks below
    .analyze();
  expect(results.violations).toEqual([]);
  ```

  Do not permanently disable color contrast. Run a second scan with
  `color-contrast` enabled after fonts/styles settle, and assert zero
  violations. Add keyboard flows for mobile nav, history, actions, dialog close,
  and trigger focus restoration.

- [ ] **Step 6: Test reduced motion and theme before hydration**

  Disable JavaScript for one light and one dark public-page request and inspect
  computed CSS media results through screenshots. With JavaScript enabled and
  reduced motion, assert animated elements have no nonidentity transform after
  first paint and no hydration error appears in console.

- [ ] **Step 7: Add visual privacy scanning**

  `visual-fixtures.ts` injects runtime-only sentinels for provider key,
  endpoint, email, user ID, private message, memory content, export ID, and raw
  error. `visual-privacy.ts` recursively scans committed snapshots and
  `test-results/ui-evidence`.

  Fail if:

  ```ts
  forbidden.some((sentinel) => bytes.includes(Buffer.from(sentinel)))
  ```

  Extend `privacy-scan.ts` with a required `ui-snapshots` surface generated by
  `compose-gate.ts`. The evidence must include at least one light, dark, mobile,
  and error-state image.

- [ ] **Step 8: Update behavior E2E selectors**

  Prefer roles, labels, and stable product text. Do not add `data-testid` when a
  semantic selector exists. Preserve every existing chat, memory, account, and
  administration behavior assertion.

- [ ] **Step 9: Update deployment/source contracts**

  Assert Docker build context includes pinned font/motion/icon packages and no
  remote asset requirement. Confirm production image still contains all local
  static assets.

- [ ] **Step 10: Update documentation and completion status**

  README documents:

  - Clear Daylight light/dark behavior;
  - white-label accent contrast behavior;
  - local fonts and icons;
  - reduced-motion support;
  - screenshot and accessibility commands.

  Only after all gates pass, change the redesign spec status to
  `Implemented` and roadmap Phase 6 status to `Complete`.

- [ ] **Step 11: Run the focused UI gate**

  ```bash
  pnpm exec vitest run \
    src/test/ui-preflight.test.ts \
    src/server/branding/accent-theme.test.ts \
    src/components/ui \
    src/components/layout \
    src/components/home \
    src/components/characters \
    src/components/auth \
    src/components/app \
    src/components/account \
    src/components/chat \
    src/components/memory \
    src/components/admin
  pnpm test:e2e:visual
  pnpm test:e2e:a11y
  ```

- [ ] **Step 12: Run the full release gate**

  ```bash
  corepack pnpm install --frozen-lockfile
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm build
  pnpm test:e2e
  pnpm release:database-gate
  pnpm release:compose-gate
  pnpm release:privacy-scan
  ```

  If Phase 5 scripts have not yet been implemented on the execution branch,
  run the current equivalents directly:

  ```bash
  pnpm exec tsx tests/release/database-gate.ts
  pnpm exec tsx tests/release/compose-gate.ts
  pnpm exec tsx tests/release/privacy-scan-cli.ts
  ```

- [ ] **Step 13: Request final code review**

  Review all five Review Focus items and the full branch diff. Fix every
  confirmed Critical, High, or Important issue, rerun the smallest affected
  gate, then rerun Step 12.

- [ ] **Step 14: Commit**

  ```bash
  git add package.json playwright.config.ts playwright.visual.config.ts tests/e2e tests/release src/test/ui-preflight.test.ts src/test/deployment-config.test.ts README.md docs/superpowers/specs/2026-10-13-clear-daylight-interface-redesign.md docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md
  git commit -m "test(ui): verify clear daylight redesign" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Treat screenshots as privacy-sensitive release artifacts.
Verify light/dark/mobile/reduced-motion, 320px/zoom, keyboard overlays, accent
extremes, and sentinel-free evidence before completion.

## Plan Completion Checklist

- [ ] Every design-spec section maps to at least one task.
- [ ] Accent derivation is deterministic and contrast-tested for extreme colors.
- [ ] Theme and reduced-motion preferences apply before hydration.
- [ ] Fonts, icons, and imagery are local and pinned.
- [ ] Public, Auth, App, Focused Chat, and Admin shells are implemented.
- [ ] All scoped pages use semantic tokens and shared primitives.
- [ ] Form names/order and product workflows are unchanged.
- [ ] Overlay focus, Escape, and trigger restoration are tested.
- [ ] Chat stream, retry, stop, recovery, and archived behavior remain green.
- [ ] Memory, export, deletion, and admin privacy boundaries remain green.
- [ ] Loading, empty, error, pending, disabled, success, and destructive states are covered.
- [ ] 320px, long content, 200% zoom, light, dark, reduced motion, and keyboard-only flows pass.
- [ ] Visual artifacts contain no privacy sentinels.
- [ ] Full tests, typecheck, lint, build, E2E, database, Compose, and privacy gates pass.
- [ ] Final whole-branch review has no unresolved Critical, High, or Important findings.
