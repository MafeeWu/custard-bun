# Clear Daylight Interface Redesign

**Date:** 2026-10-13  
**Status:** Proposed design, pending written-spec approval  
**Scope:** Public pages, authentication, user application, chat, memory, account, and administration  
**Design reference:** Project-installed `design-taste-frontend` skill

## 1. Purpose

Custard Bun has complete Phase 1–4 product flows, but its presentation remains
close to a functional prototype. Most pages rely on one global stylesheet,
minimal layout composition, browser-default form behavior, and a dark-only
surface. The redesign must make the application feel intentional, calm, and
trustworthy without changing its privacy model, routes, workflows, or
self-hosted white-label contract.

The approved direction is **Clear Daylight**:

- a bright, high-readability default;
- a coordinated system-driven dark theme;
- restrained neutrals with one deployer-owned accent color;
- expressive but purposeful motion;
- strong character presentation without generic AI gradients;
- a focused chat experience;
- denser, quieter administration surfaces.

This is a visual overhaul on top of existing content and information
architecture. Existing behavior remains authoritative.

## 2. Intended Outcome

The redesign succeeds when:

1. a first-time visitor understands the product, its privacy posture, and the
   role of characters before creating an account;
2. authentication forms are visually clear and remain fully accessible;
3. character browsing feels like choosing a distinct presence rather than
   scanning generic feature cards;
4. the chat interface supports long, low-distraction sessions on desktop and
   mobile;
5. memory, account, and destructive privacy actions remain explicit and
   trustworthy;
6. administrators can work efficiently without receiving a marketing-page
   treatment;
7. a deployer can change the logo, name, description, and primary color without
   editing product code;
8. light and dark themes remain coherent when the accent color changes;
9. animation improves hierarchy and feedback without increasing cognitive load
   or breaking reduced-motion preferences;
10. all existing product and privacy behavior remains covered by automated
    tests.

## 3. Current-State Audit

### 3.1 Brand tokens

Current runtime branding provides:

- product name;
- product description;
- logo path;
- favicon path;
- primary color.

The default primary color is amber. The redesign preserves this white-label
contract. It does not add hard-coded Custard Bun identity to reusable product
components.

### 3.2 Typography and color

The current site:

- declares Inter without self-hosting it;
- falls back to system sans-serif fonts;
- uses a dark navy page background everywhere;
- uses the runtime primary color for buttons and links;
- uses many direct color values in one global stylesheet;
- has no semantic light/dark token layer.

### 3.3 Layout and navigation

The current public homepage contains the brand, one paragraph, and two actions.
It does not provide a persistent product navigation or enough visual hierarchy
to communicate the experience.

The character catalog has useful content but presents each character as a
uniform card. Authentication pages expose correct fields and flows but lack an
intentional form layout. The application home, memory pages, account pages, and
administration pages each assemble their own navigation and action groupings.

The chat screen already has the correct product direction:

- character identity is visible;
- recent conversation remains central;
- history and destructive actions are secondary;
- the composer stays near the current conversation.

The redesign preserves this focused-chat architecture.

### 3.4 Motion and states

The existing site is largely static. Loading, empty, error, pending, archived,
disabled, and destructive states exist behaviorally, but their visual treatment
is inconsistent.

### 3.5 Existing strengths to preserve

- Runtime branding and primary-color configuration.
- Current URL structure and route slugs.
- Character-owned imagery and copy.
- Authentication field names, order, autocomplete values, and behavior.
- Privacy, legal, consent, deletion, export, and memory copy.
- Chat timeline semantics and safe Markdown rendering.
- Keyboard-operable native form and disclosure behavior until an accessible
  replacement is proven.
- Server Component boundaries for noninteractive pages.
- Existing test selectors and accessible labels where they express product
  behavior.

### 3.6 Patterns to retire

- Dark-only styling.
- Direct colors scattered through page-specific selectors.
- Browser-default form composition.
- One-off button styles and inconsistent action hierarchy.
- Uniform cards for every type of content.
- Missing application and administration shell structure.
- Text-only action menus where an icon plus label improves scanning.
- Desktop layouts that merely stretch mobile markup.
- Global Inter declaration without a shipped font.
- Generic AI presentation patterns, especially purple gradients and excessive
  glass effects.

### 3.7 Existing dial reading

The current interface is approximately:

- `DESIGN_VARIANCE: 2`
- `MOTION_INTENSITY: 1`
- `VISUAL_DENSITY: 4`

The approved redesign target is:

- `DESIGN_VARIANCE: 6`
- `MOTION_INTENSITY: 7`
- `VISUAL_DENSITY: 4`

Motion intensity is deliberately higher than the original Clear Daylight
concept, following the user's preference for a more expressive experience.

## 4. Design Principles

### 4.1 Clear before decorative

Hierarchy, spacing, typography, and state communication take priority over
effects. Decoration must reinforce character or focus, not fill empty space.

### 4.2 Character, not chatbot

Character identity appears through portrait treatment, copy rhythm, presence
state, and selected accent details. The interface does not imitate a generic
customer-support widget.

### 4.3 Private and trustworthy

Privacy-sensitive actions use plain language, stable layout, and explicit
confirmation. No animation makes deletion, export, memory, or account state
feel casual.

### 4.4 White-label by construction

The configured primary color is the only brand accent. Product components use
semantic tokens derived from that color instead of fixed brand-specific
classes.

### 4.5 Expressive motion with a reason

Animation may communicate:

- entry hierarchy;
- navigation or drawer continuity;
- character-card depth;
- message arrival;
- generation progress;
- success, warning, or failure state changes.

Animation must not:

- loop indefinitely for decoration;
- follow the pointer continuously;
- hijack scrolling;
- delay form submission or navigation;
- hide a completed state behind a transition;
- run when reduced motion is requested.

## 5. Technical Foundation

### 5.1 Owned design system

The project keeps Tailwind CSS v4 and native CSS as its styling foundation. It
does not adopt a full component system such as Radix Themes, Material, Carbon,
or shadcn/ui.

The redesign adds:

- semantic CSS custom properties;
- reusable project-owned primitives;
- `motion` for isolated interactive animation;
- one Phosphor React icon package;
- a self-hosted Geist Sans and Geist Mono font setup through `next/font/local`.

Font files and their open-source license must be shipped with the repository or
installed from a pinned package that is copied into the production build. The
application must not depend on Google Fonts or another hosted font service at
runtime or build time.

### 5.2 Server and client boundaries

Server Components continue to render:

- public page structure;
- character data;
- application data;
- memory and account summaries;
- administration data;
- noninteractive shells and page headers.

Client Components are limited to:

- existing forms and chat state;
- theme-aware motion that cannot be expressed in CSS;
- drawers, dialogs, and menus;
- animated status transitions;
- interactive mobile navigation.

Motion code must live in focused client-leaf components. A page must not become
a Client Component solely to animate its children.

### 5.3 No behavioral rewrites

The redesign does not replace:

- Better Auth;
- current server actions;
- chat streaming;
- memory operations;
- privacy/export/delete workflows;
- administration authorization;
- configuration loading.

Visual primitives receive existing actions, state, labels, and messages through
typed props.

## 6. Theme and Token Model

### 6.1 Theme strategy

The default visual direction is light. The page follows the operating-system
preference through `prefers-color-scheme`.

There is no manual theme toggle in this phase. A page renders one coherent theme
at a time; individual sections do not invert independently.

The root document declares `color-scheme: light dark`. Theme values are
available before hydration, so there is no flash caused by client-side theme
detection.

### 6.2 Semantic color tokens

At minimum, define:

- `--color-canvas`
- `--color-canvas-subtle`
- `--color-surface`
- `--color-surface-raised`
- `--color-surface-selected`
- `--color-border`
- `--color-border-strong`
- `--color-text`
- `--color-text-muted`
- `--color-text-subtle`
- `--color-accent`
- `--color-accent-hover`
- `--color-accent-active`
- `--color-accent-contrast`
- `--color-focus`
- `--color-success`
- `--color-warning`
- `--color-danger`
- `--color-danger-surface`
- `--color-shadow`

Neutral colors use one cool family across the application. Warm and cool gray
families must not be mixed.

The configured primary color becomes `--color-accent`. Derived hover, active,
surface, border, and contrast values must be produced by a deterministic color
utility rather than unrelated hand-picked values.

The utility must:

- validate the configured color;
- calculate a readable foreground;
- produce light and dark theme variants;
- meet WCAG AA for normal button text;
- reject or safely normalize unsupported values through the existing strict
  configuration boundary.

### 6.3 Typography tokens

Use self-hosted Geist Sans for interface and display text and Geist Mono only
for code, identifiers, and operational values.

Define semantic sizes rather than styling headings ad hoc:

- display;
- page title;
- section title;
- card title;
- body;
- body small;
- label;
- helper;
- code.

Display headings use tighter tracking. Body copy retains comfortable line
height and a maximum readable measure. The redesign does not introduce a serif
font.

### 6.4 Shape system

Use one documented shape hierarchy:

- page or feature surfaces: 16px;
- cards and dialogs: 16px;
- inputs and textareas: 12px;
- buttons: 10px;
- avatars: circular unless the character asset itself requires a framed square;
- chat bubbles: 16px with one directional corner variation;
- pills: only for real status, filters, or compact metadata.

Pills are not used as decorative labels.

### 6.5 Spacing and elevation

Spacing uses a consistent 4px-derived scale. Page shells cap at 1400px. Reading
and form surfaces use narrower measures.

Elevation communicates hierarchy:

- ordinary groups prefer spacing and borders;
- raised surfaces use one cool-tinted shadow family;
- dialogs and drawers use the strongest elevation;
- cards do not receive shadows solely to appear “designed.”

## 7. Shared Component Architecture

### 7.1 Foundations

Create foundations for:

- token generation and runtime accent variables;
- typography;
- focus treatment;
- motion variants;
- responsive containers;
- visually hidden content;
- high-contrast state colors.

### 7.2 Primitives

Create project-owned, typed primitives:

- `Button`
- `LinkButton`
- `IconButton`
- `Field`
- `Input`
- `Textarea`
- `CheckboxField`
- `Surface`
- `Avatar`
- `StatusNotice`
- `EmptyState`
- `Skeleton`
- `PageHeader`
- `SectionHeader`
- `Dialog`
- `Drawer`
- `Menu`

Primitives must support:

- size and emphasis variants;
- pending and disabled states;
- accessible names;
- keyboard focus;
- light and dark themes;
- reduced motion;
- stable server-rendered markup where possible.

They must not accept arbitrary color names, arbitrary motion objects, or
unbounded class-name recipes that bypass the token system.

### 7.3 Shells

Create four shells:

1. **Public Shell** for homepage and character pages.
2. **Auth Shell** for sign-in, sign-up, password recovery, reset, and email
   verification.
3. **App Shell** for conversation list, memory, and account pages.
4. **Admin Shell** for character, user, usage, memory operations, and audit
   administration.

Chat uses a focused variant of the App Shell rather than the full application
navigation.

### 7.4 Domain components

Domain logic remains in the current directories:

- `components/auth`
- `components/characters`
- `components/chat`
- `components/memory`
- `components/account`
- `components/admin`

The redesign may extract presentation from large domain components, but it must
not move business logic into generic primitives.

## 8. Page Designs

### 8.1 Public navigation

The Public Shell provides:

- brand mark and configured product name;
- Characters navigation;
- Sign in for anonymous users;
- Continue or Conversations for authenticated users when session-aware
  rendering is already available without weakening caching or privacy;
- one mobile navigation control.

Desktop navigation stays on one line and remains no taller than 80px.

### 8.2 Homepage

The homepage uses an asymmetric two-column hero.

Left:

- configured product name or a concise product headline;
- configured description or a polished derivative;
- one primary account/conversation action;
- one secondary character-browsing action.

Right:

- real official character assets;
- layered portrait composition or a real product conversation preview;
- no invented customer logos;
- no fake dashboard screenshot;
- no purple mesh gradient.

Below the hero:

1. a character preview with mixed card emphasis rather than three equal feature
   cards;
2. one privacy/self-hosting value section;
3. one explanation of continuity, character consistency, and memory controls;
4. one final CTA with a distinct intent.

Marketing copy may be polished, but legal, privacy, consent, account-deletion,
and product-state copy is not rewritten in this phase.

### 8.3 Character catalog

The catalog:

- uses a responsive grid with larger feature treatment for the first item only
  when data order is stable;
- prioritizes portrait, name, short description, and opening voice;
- truncates preview copy without hiding it from the detail page;
- provides an intentional empty state;
- keeps each card a single accessible link;
- avoids hover-only information.

Desktop supports three or four columns depending on width. Mobile uses one
column with compact horizontal or stacked cards according to content length.

### 8.4 Character detail

The detail page presents:

- a large real portrait;
- display name and short description;
- personality and communication style;
- opening message;
- example messages;
- current availability;
- one primary start/continue action.

The character identity remains more prominent than implementation details.

### 8.5 Authentication

The Auth Shell uses a desktop split layout:

- contextual brand/character panel;
- narrow form panel with explicit heading and helper text.

Mobile collapses to one column and puts the form first.

Authentication preserves:

- field names;
- field order;
- autocomplete attributes;
- password constraints;
- callback behavior;
- rate-limit behavior;
- status and error messages;
- privacy, terms, and support links.

Errors appear inline near the form. Pending state changes button content without
changing button width.

### 8.6 Application home

The application home includes:

- a compact welcome header;
- active conversations as continuation rows or cards;
- a strong empty state leading to the character catalog;
- navigation to memories and account;
- sign-out in a secondary account menu.

The layout must not expose email as prominent display copy when a display name
is available.

### 8.7 Focused chat

The chat screen remains conversation-first.

Header:

- character avatar, name, and semantic presence state;
- compact memory action;
- history drawer;
- actions menu;
- no permanent wide sidebar.

Timeline:

- constrained readable width;
- clear assistant/user distinction;
- character avatar appears only where it improves scanning;
- safe Markdown styles for paragraphs, lists, links, blockquotes, and code;
- explicit interrupted, failed, pending, and retry states;
- archived conversations clearly read-only.

Composer:

- remains visible near the viewport bottom;
- respects safe-area insets;
- grows within a bounded height;
- exposes sending and stop states;
- never covers the latest message;
- remains usable at 320px width and with the mobile keyboard open.

Drawers and menus:

- use accessible focus management;
- close on Escape;
- restore focus to the trigger;
- keep destructive actions separated from ordinary actions.

### 8.8 Memory

Memory pages use:

- a relationship overview;
- a clear recording/recall control section;
- structured memory item rows;
- visible source/sensitivity/status metadata only where the current product
  already exposes it;
- explicit save, deactivate, and delete states;
- a separated danger section for forgetting a character.

Long memory content wraps safely. Controls remain usable without motion.

### 8.9 Account and privacy

Account surfaces group:

- profile/session actions;
- private data export;
- deletion initiation and confirmation;
- legal/support links.

Export progress and expiry use a visible state timeline or status panel.
Deletion remains the strongest danger treatment and never shares a primary
action row with ordinary settings.

### 8.10 Administration

The installed design-taste skill explicitly excludes dashboards and dense data
tables. Its visual anti-pattern guidance applies to public surfaces, but the
Admin Shell uses product-administration patterns instead of marketing layouts.

The Admin Shell provides:

- desktop side navigation;
- mobile drawer navigation;
- compact page headers;
- high-density forms and data lists;
- sticky action bars only when they prevent lost work;
- consistent status and destructive treatments;
- preserved aggregate-only privacy boundaries.

Administration does not add decorative hero sections, oversized typography, or
character animation.

## 9. Motion System

### 9.1 Shared variants

Define a small typed set:

- `fadeIn`
- `riseIn`
- `staggerChildren`
- `drawerSlide`
- `dialogScale`
- `messageEnter`
- `statusTransition`
- `cardHover`

Domain components select from this set rather than creating arbitrary springs.

### 9.2 Timing

Use:

- 120–180ms for button, menu, and focus feedback;
- 180–260ms for cards and status changes;
- 240–360ms for page sections, drawers, and dialogs;
- short stagger intervals for hero and character-grid entry.

No core action waits for an animation to finish before executing.

### 9.3 Character cards

Pointer-capable devices may use:

- a small upward translation;
- a slight portrait scale;
- a tinted shadow change;
- copy emphasis.

Touch devices receive pressed-state feedback without hover assumptions.

### 9.4 Reduced motion

When `prefers-reduced-motion: reduce` is active:

- transforms are removed;
- stagger is removed;
- drawers and dialogs use immediate or short opacity transitions;
- message entry does not move spatially;
- loading states avoid shimmer motion.

## 10. Responsive Behavior

Standard breakpoints remain:

- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

Requirements:

- use CSS Grid instead of percentage flex calculations;
- use `min-height: 100dvh`, not `100vh`, for full-height shells;
- respect `env(safe-area-inset-*)`;
- avoid horizontal scroll at 320px;
- keep primary actions on one line at desktop;
- collapse public and admin navigation deliberately;
- test long product names and long character names;
- test configured descriptions longer than the default;
- ensure all menus and dialogs fit within the visual viewport.

## 11. States and Error Handling

Each primary surface defines:

- loading;
- empty;
- error;
- pending;
- disabled;
- success;
- destructive confirmation where relevant.

Rules:

- skeletons match eventual content structure;
- errors remain contextual and use existing privacy-safe messages;
- transient success may use a status notice, not a content-obscuring toast;
- form validation remains inline;
- failed chat messages remain attached to the relevant attempt;
- database or worker readiness failures never render secret configuration;
- no visual fallback presents a failed operation as successful.

## 12. Accessibility

The redesign must:

- preserve semantic heading order;
- maintain one visible `h1` per page;
- use landmarks and named navigation;
- meet WCAG AA contrast for text, controls, placeholders, and focus rings;
- provide 44px target size for primary touch actions where layout permits;
- expose icon-button names;
- support complete keyboard operation;
- avoid color-only state communication;
- retain meaningful image alt text and decorative empty alt text;
- keep focus visible in both themes;
- preserve native controls until custom behavior is equally accessible;
- validate dialogs, drawers, and menus for focus trapping and restoration;
- support zoom to 200% without loss of actions.

## 13. Privacy and Security Constraints

The redesign must not:

- expose user, message, memory, export, or archive identifiers in markup unless
  the current feature requires them;
- add third-party analytics, hosted fonts, remote images, or telemetry;
- render model provider configuration;
- weaken server authorization through client-only hiding;
- include private content in motion keys, CSS class names, URLs, or analytics;
- move sensitive error details into visible status components;
- cache authenticated page content publicly.

All imagery remains repository-owned or deployer-provided.

## 14. Testing Strategy

### 14.1 Foundation tests

Test:

- runtime accent derivation;
- readable accent foreground selection;
- light and dark semantic tokens;
- invalid color handling;
- primitive variants;
- focus-visible behavior;
- reduced-motion variants;
- icon-button accessible names.

### 14.2 Component tests

Preserve existing tests and add coverage for:

- Public, Auth, App, focused Chat, and Admin shells;
- mobile navigation;
- drawers, dialogs, and menus;
- loading, empty, error, pending, disabled, success, and destructive states;
- long labels and configured brand copy;
- theme-independent accessible names;
- chat composer sizing and stop/send states.

Tests should assert semantics and state contracts rather than exact decorative
class strings.

### 14.3 Browser acceptance

Add Playwright acceptance at desktop and mobile sizes for:

- homepage;
- character catalog;
- character detail;
- sign-up and sign-in;
- application home;
- active and archived chat;
- memory controls and item management;
- account export and deletion surfaces;
- representative administration pages.

Run each representative surface in:

- light theme;
- dark theme;
- reduced motion;
- keyboard-only navigation.

### 14.4 Visual regression

Capture stable screenshots for the principal surfaces. Mask dynamic timestamps
and deterministic user-specific values. Use screenshots to detect layout,
theme, and overflow regressions, not to replace semantic assertions.

### 14.5 Existing gates

The redesign must continue to pass:

- Node 24 unit and integration tests;
- TypeScript checks;
- lint;
- production build;
- release database gate;
- production Compose gate;
- privacy scan;
- memory browser acceptance.

The privacy scan must include any new rendered static assets and error-state
screenshots.

## 15. Performance

Requirements:

- keep public and data pages server-rendered;
- isolate Motion to small client leaves;
- avoid loading the icon library wholesale;
- serve font files locally with `font-display: swap`;
- size character images explicitly;
- prevent layout shift in skeleton and final states;
- avoid backdrop blur on scrolling chat surfaces;
- lazy-load below-fold imagery;
- do not animate layout properties continuously;
- maintain plausible Core Web Vitals targets:
  - LCP under 2.5 seconds;
  - INP under 200ms;
  - CLS under 0.1.

## 16. Migration Strategy

Implementation should proceed from foundations outward:

1. dependencies, fonts, semantic tokens, and accent derivation;
2. primitives and shell components;
3. public homepage and character surfaces;
4. authentication;
5. application home and account;
6. chat;
7. memory;
8. administration;
9. browser, accessibility, privacy, and visual release gates.

Do not rewrite all global CSS in one unreviewable commit. Introduce semantic
foundations first, migrate one surface family at a time, and remove legacy
selectors only after their consumers are migrated.

## 17. Non-Goals

This phase does not:

- change routes or API contracts;
- change authentication behavior;
- redesign character content or generate new character art;
- add user-selectable themes;
- add a hosted design asset service;
- add analytics;
- change memory, export, deletion, quota, or administration semantics;
- redesign email templates;
- localize product copy;
- introduce a full third-party design system;
- add scroll-jacking, WebGL, or decorative 3D.

## 18. Acceptance Criteria

The redesign is complete only when:

1. every scoped route uses the approved token system and appropriate shell;
2. no migrated component depends on direct legacy dark-theme colors;
3. the configured primary color remains the sole brand accent;
4. light and system-driven dark themes are complete;
5. homepage, characters, auth, app, chat, memory, account, and admin are
   responsive at 320px through large desktop widths;
6. expressive motion is present on public and conversational surfaces;
7. reduced-motion behavior is complete;
8. loading, empty, error, pending, disabled, success, and destructive states
   are represented;
9. keyboard navigation and focus restoration work;
10. contrast passes WCAG AA;
11. existing behavioral and privacy tests remain green;
12. new browser and visual acceptance passes;
13. production build and Compose release gates pass;
14. no hosted font, image, analytics, or telemetry dependency is introduced;
15. the final interface no longer resembles the current functional prototype
    while preserving its information architecture and behavior.
