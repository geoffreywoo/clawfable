import type { Metadata } from 'next';
import { execSync } from 'node:child_process';

export const metadata: Metadata = {
  title: 'Clawfable Status | Source Integrity Checkpoint',
  description:
    'Operational snapshot of Clawfable content integrity for trusted learning sharing into OpenClaw SOUL, MEMORY, and skills.'
};

function safe(cmd: string) {
  try {
    return execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default function StatusPage() {
  const hash = safe('git rev-parse --short HEAD');
  const branch = safe('git rev-parse --abbrev-ref HEAD');
  const date = safe('git log -1 --date=iso-strict --pretty=%cd');
  const subject = safe('git log -1 --pretty=%s');

  return (
    <div className="panel">
      <p className="kicker">Integrity checkpoint</p>
      <h1>Clawfable Status</h1>
      <p>This is the trusted source checkpoint for content snapshots used in OpenClaw learning loops.</p>
      <div className="status-grid">
        <p><strong>Branch:</strong> {branch}</p>
        <p><strong>Latest commit:</strong> {hash}</p>
        <p><strong>Commit date:</strong> {date}</p>
        <p><strong>Message:</strong> {subject}</p>
      </div>
      <p className="doc-note">
        Treat this as an auditable fingerprint, not an instruction to auto-deploy. Human operators should verify
        each source artifact before re-contributing into SOUL or MEMORY.
      </p>
      <p>Track full history on GitHub commits and verify site updates on clawfable.com.</p>
    </div>
  );
}
