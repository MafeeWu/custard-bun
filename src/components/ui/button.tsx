import Link from "next/link";
import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ReactNode,
  forwardRef,
} from "react";
import { cx } from "./cx";

export type ButtonTone = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
  pending?: boolean;
}

export interface LinkButtonProps extends Omit<
  ComponentPropsWithoutRef<typeof Link>,
  "className"
> {
  tone?: ButtonTone;
  size?: ButtonSize;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

const toneClassNames: Record<ButtonTone, string> = {
  primary: "ui-button--primary",
  secondary: "ui-button--secondary",
  quiet: "ui-button--quiet",
  danger: "ui-button--danger",
};

const sizeClassNames: Record<ButtonSize, string> = {
  sm: "ui-button--sm",
  md: "ui-button--md",
  lg: "ui-button--lg",
};

function buttonClassName(
  tone: ButtonTone,
  size: ButtonSize,
  className?: string,
) {
  return cx("ui-button", toneClassNames[tone], sizeClassNames[size], className);
}

function PendingAnnouncement() {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      Pending
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled = false,
      pending = false,
      size = "md",
      tone = "primary",
      type,
      ...props
    },
    ref,
  ) {
    const busy = disabled || pending;

    return (
      <>
        <button
          {...props}
          ref={ref}
          aria-busy={pending || undefined}
          className={buttonClassName(tone, size, className)}
          disabled={busy}
          type={type}
        >
          <span className="ui-button__label">{children}</span>
        </button>
        {pending ? <PendingAnnouncement /> : null}
      </>
    );
  },
);

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  function LinkButton(
    {
      children,
      className,
      disabled = false,
      onClick,
      pending = false,
      size = "md",
      tone = "primary",
      ...props
    },
    ref,
  ) {
    const busy = disabled || pending;

    return (
      <>
        <Link
          {...props}
          ref={ref}
          aria-busy={pending || undefined}
          aria-disabled={busy || undefined}
          className={cx(
            buttonClassName(tone, size, className),
            "ui-link-button",
            busy && "ui-link-button--disabled",
          )}
          onClick={(event) => {
            if (busy) {
              event.preventDefault();
              return;
            }

            onClick?.(event);
          }}
          tabIndex={busy ? -1 : props.tabIndex}
        >
          <span className="ui-button__label">{children}</span>
        </Link>
        {pending ? <PendingAnnouncement /> : null}
      </>
    );
  },
);
