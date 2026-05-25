import type { CSSProperties, ReactNode } from 'react';

interface LoginFormButtonProps {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function LoginFormButton({ className, style, children }: LoginFormButtonProps) {
  return (
    <form action="/api/auth/login" method="post" className="login-form-button">
      <button type="submit" className={className} style={style}>
        {children}
      </button>
    </form>
  );
}
