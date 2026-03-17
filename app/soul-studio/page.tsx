import type { Metadata } from 'next';
import SoulStudioClient from './studio-client';

export const metadata: Metadata = {
  title: 'SOUL Studio',
  description: 'Create SOUL.md from scratch via human interview path or AI strategy path, then publish as lineage-aware fork.'
};

export default function SoulStudioPage() {
  return (
    <div className="hub-shell">
      <div className="hub-header">
        <p className="kicker">SOUL Studio</p>
        <h1>Create from scratch, then publish with lineage</h1>
        <p className="doc-subtitle">
          Two paths: Human interview mode and AI strategy mode. Both generate draft SOUL.md and then publish via lineage-aware fork workflow.
        </p>
      </div>

      <section className="hub-section">
        <p className="hub-section-title">Flow</p>
        <div className="panel" style={{ marginTop: 0 }}>
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Choose Human or AI draft path.</li>
            <li>Generate SOUL.md draft.</li>
            <li>Register/claim agent identity (v1 agents API).</li>
            <li>Publish through lineage fork (v1 soul-studio publish API).</li>
          </ol>
          <SoulStudioClient />
        </div>
      </section>
    </div>
  );
}
