'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * A password <input> with a show/hide toggle icon inside the field,
 * right-aligned. Each instance owns its own visibility state, so
 * multiple password fields on the same form (e.g. Password + Confirm
 * Password) toggle independently. `type` is controlled internally and
 * cannot be overridden by a caller.
 */
interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  showLabel?: string;
  hideLabel?: string;
}

export function PasswordInput({
  className = '',
  showLabel = 'Afficher le mot de passe',
  hideLabel = 'Masquer le mot de passe',
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        // pr-10 makes room for the toggle icon without touching the
        // field's existing border/ring/color classes passed in via
        // `className` — the only addition needed to fit the icon inside.
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        tabIndex={0}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-r-lg"
      >
        {visible ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
      </button>
    </div>
  );
}
