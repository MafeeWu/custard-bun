import { type ImgHTMLAttributes } from "react";
import { cx } from "./cx";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "children"
> {
  name: string;
  size?: AvatarSize;
  fallback?: string;
}

const sizeClassNames: Record<AvatarSize, string> = {
  sm: "ui-avatar--sm",
  md: "ui-avatar--md",
  lg: "ui-avatar--lg",
};

function initialLetters(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({
  alt,
  className,
  fallback,
  name,
  size = "md",
  src,
  ...props
}: AvatarProps) {
  const label = alt ?? `${name} avatar`;

  return (
    <span className={cx("ui-avatar", sizeClassNames[size], className)}>
      {src ? (
        <img {...props} alt={label} className="ui-avatar__image" src={src} />
      ) : (
        <span aria-label={label} className="ui-avatar__fallback" role="img">
          {fallback ?? initialLetters(name)}
        </span>
      )}
    </span>
  );
}
