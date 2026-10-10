import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { memoryScreenFixture } from "@/test/memory-screen-fixture";
import { RelationshipMemoryScreen } from "./relationship-memory-screen";
import type { MemoryAction } from "./memory-form-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
    const form = textarea.closest("form");
    expect(form).not.toBeNull();
    expect(getComputedStyle(form!).display).toBe("grid");
    expect(getComputedStyle(form!).gap).toBe("0.75rem");
    expect(
      getComputedStyle(screen.getByText("Likes green tea.", { selector: "p" }))
        .overflowWrap,
    ).toBe("anywhere");
    expect(
      getComputedStyle(screen.getAllByRole("status")[0]).overflowWrap,
    ).toBe("anywhere");
    const baselineFocus = [...style.sheet!.cssRules].find(
      (rule) =>
        rule instanceof CSSStyleRule &&
        rule.selectorText === ".memory-card :focus-visible",
    );
    expect(baselineFocus).toBeDefined();
    if (!(baselineFocus instanceof CSSStyleRule))
      throw new Error("Missing mobile focus rule");
    expect(baselineFocus.style.getPropertyValue("outline")).toMatch(
      /3px solid/,
    );
  } finally {
    style.remove();
  }
});
