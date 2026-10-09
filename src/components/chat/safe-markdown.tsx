import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";

function safeHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  if (href.startsWith("/") && !href.startsWith("//")) {
    return href;
  }
  if (href.startsWith("#") || href.startsWith("mailto:")) {
    return href;
  }
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}

function SafeLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  const safe = safeHref(href);
  const protocol = safe
    ? new URL(safe, "https://local.invalid").protocol
    : undefined;
  const external = Boolean(
    safe &&
    !safe.startsWith("/") &&
    !safe.startsWith("#") &&
    (protocol === "http:" || protocol === "https:"),
  );

  return (
    <a
      {...props}
      {...(safe ? { href: safe } : {})}
      {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      {children}
    </a>
  );
}

export function SafeMarkdown({ children }: { children: ReactNode }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: SafeLink,
        img: () => null,
      }}
    >
      {String(children)}
    </ReactMarkdown>
  );
}
