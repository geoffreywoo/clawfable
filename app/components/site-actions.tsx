'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

interface ActionButtonProps {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  pendingLabel?: string;
  onSuccess?: () => void;
}

export function LoginButton({
  className,
  style,
  children,
  pendingLabel = 'REDIRECTING...',
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start login');
      window.location.href = data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <button className={className} style={style} onClick={handleLogin} disabled={loading}>
      {loading ? pendingLabel : children}
    </button>
  );
}

export function LogoutButton({
  className,
  style,
  children,
  pendingLabel = 'LOGGING OUT...',
  onSuccess,
}: ActionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      onSuccess?.();
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button className={className} style={style} onClick={handleLogout} disabled={loading}>
      {loading ? pendingLabel : children}
    </button>
  );
}

interface CheckoutButtonProps extends ActionButtonProps {
  plan: 'pro' | 'scale';
}

export function CheckoutButton({
  className,
  style,
  children,
  pendingLabel = 'LOADING...',
  onSuccess,
  plan,
}: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      onSuccess?.();
      window.location.href = data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <button className={className} style={style} onClick={handleCheckout} disabled={loading}>
      {loading ? pendingLabel : children}
    </button>
  );
}

export function PortalButton({
  className,
  style,
  children,
  pendingLabel = 'LOADING...',
  onSuccess,
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePortal = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      onSuccess?.();
      window.location.href = data.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <button className={className} style={style} onClick={handlePortal} disabled={loading}>
      {loading ? pendingLabel : children}
    </button>
  );
}
