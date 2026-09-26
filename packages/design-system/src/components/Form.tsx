import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/utils";
import "./Form.css";

interface FieldProps {
  label?: string;
  /** Hide the label visually. It stays available to assistive technology. */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
  className?: string;
  id?: string;
}

function Field({ label, hideLabel, hint, error, children, className, id }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("sds-field", error && "sds-field--error", className)}>
      {label && (
        <label htmlFor={inputId} className={cx("sds-field__label", hideLabel && "sds-visually-hidden")}>
          {label}
        </label>
      )}
      {children({ inputId, describedBy })}
      {hint && !error && (
        <span id={hintId} className="sds-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="sds-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  icon?: IconName;
  loading?: boolean;
  /** A keyboard hint shown at the end of the field, for example "/". */
  shortcutHint?: string;
  trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hideLabel, hint, error, icon, loading, shortcutHint, trailing, className, disabled, ...rest },
  ref,
) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} className={className} id={rest.id}>
      {({ inputId, describedBy }) => (
        <div className={cx("sds-input", disabled && "sds-input--disabled", error && "sds-input--error")} data-force-state={(rest as Record<string, unknown>)["data-force-state"] as string | undefined}>
          {icon && <Icon name={icon} size="sm" className="sds-input__icon" />}
          <input
            ref={ref}
            id={inputId}
            className="sds-input__control"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            aria-busy={loading || undefined}
            disabled={disabled}
            {...rest}
          />
          {loading && <span className="sds-spinner" aria-hidden="true" />}
          {trailing}
          {shortcutHint && !loading && (
            <kbd className="sds-kbd" aria-hidden="true">
              {shortcutHint}
            </kbd>
          )}
        </div>
      )}
    </Field>
  );
});

export interface SearchInputProps extends Omit<TextInputProps, "icon" | "type"> {
  onClear?: () => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { onClear, value, label = "Search", hideLabel = true, ...rest },
  ref,
) {
  const hasValue = typeof value === "string" ? value.length > 0 : false;
  return (
    <TextInput
      ref={ref}
      type="search"
      icon="search"
      label={label}
      hideLabel={hideLabel}
      value={value}
      trailing={
        hasValue && onClear ? (
          <button type="button" className="sds-input__clear" aria-label="Clear search" onClick={onClear}>
            <Icon name="close" size="sm" />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, hint, error, options, placeholder, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} className={className} id={rest.id}>
      {({ inputId, describedBy }) => (
        <div className={cx("sds-select", rest.disabled && "sds-input--disabled", error && "sds-input--error")} data-force-state={(rest as Record<string, unknown>)["data-force-state"] as string | undefined}>
          <select
            ref={ref}
            id={inputId}
            className="sds-select__control"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            {...rest}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size="sm" className="sds-select__chevron" />
        </div>
      )}
    </Field>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: string;
  indeterminate?: boolean;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, error, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const id = useId();
  return (
    <div className={cx("sds-checkbox", rest.disabled && "sds-checkbox--disabled", className)}>
      <input
        ref={inner}
        id={rest.id ?? id}
        type="checkbox"
        className="sds-checkbox__control"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...rest}
      />
      <label htmlFor={rest.id ?? id} className="sds-checkbox__label">
        {label}
      </label>
      {error && (
        <span id={`${id}-error`} className="sds-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "value" | "onChange"> {
  label?: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** ISO date, YYYY-MM-DD. */
  value?: string;
  onChange?: (value: string) => void;
  min?: string;
  max?: string;
}

/** A simple date control. It uses the browser date input, so keyboard entry and the calendar come from the browser. */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { label, hideLabel, hint, error, value, onChange, className, disabled, ...rest },
  ref,
) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} className={className} id={rest.id}>
      {({ inputId, describedBy }) => (
        <div className={cx("sds-input", "sds-date", disabled && "sds-input--disabled", error && "sds-input--error")} data-force-state={(rest as Record<string, unknown>)["data-force-state"] as string | undefined}>
          <Icon name="calendar" size="sm" className="sds-input__icon" />
          <input
            ref={ref}
            id={inputId}
            type="date"
            className="sds-input__control sds-num"
            value={value ?? ""}
            onChange={(e) => onChange?.(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            {...rest}
          />
        </div>
      )}
    </Field>
  );
});
