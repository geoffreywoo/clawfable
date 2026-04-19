'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckoutButton, LoginButton, PortalButton } from '@/app/components/site-actions';
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
  const [viewer, setViewer] = useState<Viewer | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadViewer().then((resolvedViewer) => {
      if (active) {
        setViewer(resolvedViewer);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  if (viewer === undefined) {
    return (
      <button className={className} disabled>
        Loading...
      </button>
    );
  }

  if (!viewer) {
    return (
      <LoginButton className={className}>
        {planId === 'free'
          ? 'Start free'
          : `Log in for ${planId === 'pro' ? 'Pro' : 'Scale'}`}
      </LoginButton>
    );
  }

  if (planId === 'free') {
    return (
      <Link href={CONTROL_ROOM_PATH} className={className}>
        Open workspace
      </Link>
    );
  }

  if (viewer.billing.grandfathered) {
    return (
      <button className={className} disabled>
        Grandfathered access
      </button>
    );
  }

  if (viewer.billing.isPaid) {
    const isCurrentPlan = viewer.billing.plan === planId;
    return (
      <PortalButton className={className}>
        {isCurrentPlan ? 'Manage current plan' : 'Change in billing'}
      </PortalButton>
    );
  }

  return (
    <CheckoutButton className={className} plan={planId}>
      {planId === 'pro' ? 'Unlock Pro' : 'Unlock Scale'}
    </CheckoutButton>
  );
}
