import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

type DescribedControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  className?: string;
  id?: string;
};

function joinDescribedBy(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ") || undefined;
}

function decorateControl(
  child: ReactNode,
  describedBy: string | undefined,
  invalid: boolean,
) {
  if (!isValidElement<DescribedControlProps>(child)) {
    return child;
  }

  return cloneElement(child as ReactElement<DescribedControlProps>, {
    "aria-describedby": joinDescribedBy(
      child.props["aria-describedby"],
      describedBy,
    ),
    "aria-invalid": invalid || child.props["aria-invalid"] || undefined,
    className: cx("ui-field__control", child.props.className),
  });
}

export function Field({ children, error, hint, htmlFor, label }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = joinDescribedBy(hintId, errorId);
  const control = decorateControl(
    Children.only(children),
    describedBy,
    Boolean(error),
  );

  return (
    <div className={cx("ui-field", error && "ui-field--error")}>
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {control}
      {hint ? (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, type = "text", ...props },
  ref,
) {
  return (
    <input
      {...props}
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cx("ui-input", className)}
      type={type}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid = false, rows = 5, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        aria-invalid={invalid || props["aria-invalid"] || undefined}
        className={cx("ui-textarea", className)}
        rows={rows}
      />
    );
  },
);

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: ReactNode;
  description?: ReactNode;
}

export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  function CheckboxField({ className, description, label, ...props }, ref) {
    return (
      <label className="ui-checkbox-field">
        <input
          {...props}
          ref={ref}
          className={cx("ui-checkbox-field__control", className)}
          type="checkbox"
        />
        <span className="ui-checkbox-field__copy">
          <span className="ui-checkbox-field__label">{label}</span>
          {description ? (
            <span className="ui-checkbox-field__description">
              {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  },
);
