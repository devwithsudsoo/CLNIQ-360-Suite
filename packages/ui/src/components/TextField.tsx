import { useId, type InputHTMLAttributes } from "react";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string };

export const TextField = ({ label, hint, error, id, ...rest }: TextFieldProps) => {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="clniq-field">
      <label className="clniq-field__label" htmlFor={inputId}>{label}</label>
      <input id={inputId} className="clniq-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {hint && <span id={`${inputId}-hint`} className="clniq-field__hint">{hint}</span>}
      {error && <span id={`${inputId}-error`} className="clniq-field__error" role="alert">{error}</span>}
    </div>
  );
};
