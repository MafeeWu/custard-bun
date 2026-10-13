import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { type ButtonSize, type ButtonTone } from "./button";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  label: string;
  icon?: ReactNode;
  children?: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
}

const toneClassNames: Record<ButtonTone, string> = {
  primary: "ui-button--primary",
  secondary: "ui-button--secondary",
  quiet: "ui-button--quiet",
  danger: "ui-button--danger",
};

const sizeClassNames: Record<ButtonSize, string> = {
  sm: "ui-icon-button--sm",
  md: "ui-icon-button--md",
  lg: "ui-icon-button--lg",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      children,
      className,
      icon,
      label,
      size = "md",
      tone = "secondary",
      type = "button",
      ...props
    },
    ref,
  ) {
    if (!label.trim()) {
      throw new Error("IconButton requires a non-empty label.");
    }

    return (
      <button
        {...props}
        ref={ref}
        aria-label={label}
        className={cx(
          "ui-icon-button",
          toneClassNames[tone],
          sizeClassNames[size],
          className,
        )}
        type={type}
      >
        <span aria-hidden="true" className="ui-icon-button__icon">
          {icon ?? children}
        </span>
      </button>
    );
  },
);
