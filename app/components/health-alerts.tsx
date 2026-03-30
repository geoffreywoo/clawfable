'use client';

import { useState, useEffect } from 'react';

interface HealthAlert {
  level: 'error' | 'warning';
  message: string;
  cta?: { label: string; tab: string };
}

interface HealthAlertsProps {
  agentId: string;
  onNavigateTab?: (tab: string) => void;
}

export function HealthAlerts({ agentId, onNavigateTab }: HealthAlertsProps) {
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const dismissKey = `health-dismiss:${agentId}`;
    const stored = localStorage.getItem(dismissKey);
    if (stored) {
      const { message, ts } = JSON.parse(stored);
      // Expire after 24h
      if (Date.now() - ts < 24 * 60 * 60 * 1000) {
        setDismissed(message);
      } else {
        localStorage.removeItem(dismissKey);
      }
    }

    fetch(`/api/agents/${agentId}/metrics`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.health && Array.isArray(data.health)) {
          setAlerts(data.health);
        }
      })
      .catch(() => {});
  }, [agentId]);

  // Show highest-severity alert that isn't dismissed
  const active = alerts
    .filter((a) => a.message !== dismissed)
    .sort((a, b) => (a.level === 'error' ? -1 : 1) - (b.level === 'error' ? -1 : 1))[0];

  if (!active) return null;

  const isError = active.level === 'error';

  const handleDismiss = () => {
    const dismissKey = `health-dismiss:${agentId}`;
    localStorage.setItem(dismissKey, JSON.stringify({ message: active.message, ts: Date.now() }));
    setDismissed(active.message);
  };

  return (
    <div
      className={`health-alert ${isError ? 'error' : 'warning'}`}
      role="alert"
    >
      <div className="health-alert-content">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" style={{ flexShrink: 0 }}>
          {isError ? (
            <>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="11" y1="5" x2="5" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M8 2L14 14H2L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <line x1="8" y1="7" x2="8" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="12" r="0.5" fill="currentColor" />
            </>
          )}
        </svg>
        <span className="health-alert-message">{active.message}</span>
      </div>
      <div className="health-alert-actions">
        {active.cta && onNavigateTab && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => onNavigateTab(active.cta!.tab)}
          >
            {active.cta.label}
          </button>
        )}
        <button
          className="health-alert-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss alert"
        >
          <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
            <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
