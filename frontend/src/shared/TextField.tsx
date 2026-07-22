import { type InputHTMLAttributes, forwardRef, useId } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, error, hint, className = '', id: externalId, ...rest }, ref) => {
    const autoId = useId();
    const id = externalId ?? autoId;
    const errorId = error ? `${id}-error` : undefined;
    const hintId = hint ? `${id}-hint` : undefined;

    const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={`field ${className}`}>
        <label htmlFor={id} className="field__label">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          className={`field__input ${error ? 'field__input--error' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {error && (
          <span id={errorId} className="field__error" role="alert">
            {error}
          </span>
        )}
        {hint && !error && (
          <span id={hintId} className="field__hint">
            {hint}
          </span>
        )}
      </div>
    );
  },
);

TextField.displayName = 'TextField';
