import { execSync } from 'node:child_process';

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
    <div>
      <h1>Clawfable Status</h1>
      <p>Live content worker status checkpoint.</p>
      <ul>
        <li><strong>Branch:</strong> {branch}</li>
        <li><strong>Latest commit:</strong> {hash}</li>
        <li><strong>Commit date:</strong> {date}</li>
        <li><strong>Message:</strong> {subject}</li>
      </ul>
      <p>Track full history on GitHub commits and verify site updates on clawfable.com.</p>
    </div>
  );
}
