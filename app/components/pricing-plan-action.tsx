'use client';

import { useState } from 'react';
import { reportActionError, requestLoginUrl } from '@/app/components/site-actions';
import { CONTROL_ROOM_PATH } from '@/lib/app-routes';
import type { BillingSummary } from '@/lib/types';

interface Viewer {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

let cachedViewer: Viewer | null | undefined;
let viewerPromise: Promise<Viewer | null> | null = null;

async function loadViewer(): Promise<Viewer | null> {
  if (cachedViewer !== undefined) {
    return cachedViewer;
  }

  if (!viewerPromise) {
    viewerPromise = fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          cachedViewer = null;
          return null;
        }
        const viewer = await res.json() as Viewer;
        cachedViewer = viewer;
        return viewer;
      })
      .catch(() => {
        cachedViewer = null;
        return null;
      });
  }

  return viewerPromise;
}

interface PricingPlanActionProps {
  planId: 'free' | 'pro' | 'scale';
  className: string;
}

export function PricingPlanAction({ planId, className }: PricingPlanActionProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const viewer = await loadViewer();
      if (!viewer) {
        window.location.href = await requestLoginUrl();
        return;
      }

      if (planId === 'free') {
        window.location.href = CONTROL_ROOM_PATH;
        return;
      }

      if (viewer.billing.grandfathered) {
        window.location.href = CONTROL_ROOM_PATH;
        return;
      }

      const endpoint = viewer.billing.isPaid
        ? '/api/billing/portal'
        : '/api/billing/checkout';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: endpoint.endsWith('/checkout') ? { 'Content-Type': 'application/json' } : undefined,
        body: endpoint.endsWith('/checkout') ? JSON.stringify({ plan: planId }) : undefined,
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to open billing');
      }
      window.location.href = data.url;
    } catch (error) {
      reportActionError(error, planId === 'free' ? 'Failed to start login' : 'Failed to open billing');
      setLoading(false);
    }
  };

  const label = planId === 'free'
    ? 'Start free'
    : planId === 'pro'
      ? 'Unlock Pro'
      : 'Unlock Scale';

  return (
    <button className={className} onClick={handleClick} disabled={loading}>
      {loading ? 'Loading...' : label}
    </button>
  );
}
