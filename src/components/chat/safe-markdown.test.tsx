import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SafeMarkdown } from "./safe-markdown";

test.each(["HTTP://example.com", "hTtPs://example.com"])(
  "classifies mixed-case external link %s through its parsed protocol",
  (href) => {
    render(<SafeMarkdown>{`[External](${href})`}</SafeMarkdown>);
    const link = screen.getByRole("link", { name: "External" });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  },
);

test("renders the supported Markdown presentation", () => {
  render(
    <SafeMarkdown>{`A paragraph with *emphasis* and \`inline code\`.

- First
- Second

> A quoted thought

\`\`\`ts
const answer = 42;
\`\`\`

[Internal](/characters) and [External](https://example.com).`}</SafeMarkdown>,
  );

  expect(screen.getByText(/a paragraph with/i).closest("p")).toBeVisible();
  expect(screen.getByText("emphasis").tagName).toBe("EM");
  expect(screen.getByText("inline code").tagName).toBe("CODE");
  expect(screen.getByRole("list")).toHaveTextContent("First");
  expect(
    screen.getByText("A quoted thought").closest("blockquote"),
  ).toBeVisible();
  expect(screen.getByText("const answer = 42;").closest("pre")).toBeVisible();
  expect(screen.getByRole("link", { name: "Internal" })).toHaveAttribute(
    "href",
    "/characters",
  );
  const external = screen.getByRole("link", { name: "External" });
  expect(external).toHaveAttribute("href", "https://example.com");
  expect(external).toHaveAttribute("rel", "noopener noreferrer");
  expect(external).toHaveAttribute("target", "_blank");
});

test("does not render raw HTML, images, or navigable javascript links", () => {
  const { container } = render(
    <SafeMarkdown>{`<script>alert("unsafe")</script>

<strong>raw html</strong>

![tracking](https://example.com/tracking.png)

[Unsafe](javascript:alert("unsafe"))`}</SafeMarkdown>,
  );

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("strong")).toBeNull();
  expect(screen.getByText("Unsafe").closest("a")).not.toHaveAttribute("href");
});

test("code blocks remain horizontally scrollable with safe presentation classes", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8").replace(
    /@import[^;]+;/g,
    "",
  );
  document.head.append(style);
  try {
    render(
      <SafeMarkdown>{`
\`\`\`ts
const longLine = "${"x".repeat(160)}";
\`\`\`
`}</SafeMarkdown>,
    );

    const pre = screen.getByText(/const longLine/).closest("pre");
    expect(pre).toHaveClass("safe-markdown__pre");
    expect(getComputedStyle(pre!).overflowX).toBe("auto");
    expect(screen.getByText(/const longLine/).closest("code")).toHaveClass(
      "safe-markdown__code-block",
    );
  } finally {
    style.remove();
  }
});
