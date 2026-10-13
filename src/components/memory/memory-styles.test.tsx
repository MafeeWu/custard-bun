import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { memoryScreenFixture } from "@/test/memory-screen-fixture";
import { RelationshipMemoryScreen } from "./relationship-memory-screen";
import type { MemoryAction } from "./memory-form-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function cssRule(
  sheet: CSSStyleSheet,
  selector: string,
): CSSStyleRule | undefined {
  return [...sheet.cssRules].find(
    (rule) => rule instanceof CSSStyleRule && rule.selectorText === selector,
  ) as CSSStyleRule | undefined;
}

test("mobile memory forms retain spacing, wrapping, textarea sizing and visible focus rules", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8").replace(
    /@import[^;]+;/g,
    "",
  );
  document.head.append(style);
  const action: MemoryAction = async () => ({ status: "idle" });
  try {
    render(
      <RelationshipMemoryScreen
        view={memoryScreenFixture()}
        actions={{
          editMemory: action,
          deleteMemory: action,
          controls: action,
          summary: action,
          regenerate: action,
          forget: action,
          retry: action,
        }}
      />,
    );
    const textarea = screen.getByLabelText("Memory content");
    expect(getComputedStyle(textarea).width).toBe("100%");
    expect(getComputedStyle(textarea).minHeight).toBe("112px");
    expect(getComputedStyle(textarea).resize).toBe("vertical");
    for (const form of document.querySelectorAll(".memory-card form")) {
      expect(getComputedStyle(form).display).toBe("grid");
      expect(getComputedStyle(form).gap).toBe("0.75rem");
    }
    expect(
      getComputedStyle(screen.getByText("Likes green tea.", { selector: "p" }))
        .overflowWrap,
    ).toBe("anywhere");
    const memoryStatus = screen.getAllByRole("status")[0];
    expect(getComputedStyle(memoryStatus).overflowWrap).toBe("anywhere");

    const focusRule = cssRule(style.sheet!, ".memory-card :focus-visible");
    expect(focusRule?.style.getPropertyValue("outline")).toContain(
      "var(--color-focus)",
    );

    const dangerRule = cssRule(style.sheet!, ".memory-danger");
    expect(dangerRule?.style.getPropertyValue("border-color")).toBe(
      "var(--color-danger)",
    );
    expect(dangerRule?.style.getPropertyValue("background")).toContain(
      "var(--color-danger-surface)",
    );

    for (const card of document.querySelectorAll(".memory-card")) {
      expect(getComputedStyle(card).minWidth).toBe("0px");
    }
  } finally {
    style.remove();
  }
});
