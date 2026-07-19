import { describe, expect, it } from 'vitest';
import { semanticIdeaSimilarity } from '@/lib/tweet-features';

describe('semantic idea similarity', () => {
  it('detects a finance premise repeated with different surface wording', () => {
    const first = 'finance guys love assets they can mark every day. industrial assets make them emotionally unstable: resale value depends on qualification, maintenance history and whether the next buyer can actually run the thing.';
    const reskin = 'finance loves a clean comparable until qualification history, maintenance quality and customer approvals determine what the asset is worth. put three industrial lenders in a room and ask them to mark the same used production line.';

    expect(semanticIdeaSimilarity(
      { content: first, topic: 'finance' },
      { content: reskin, topic: 'finance' },
    )).toBeGreaterThanOrEqual(0.52);
  });

  it('detects a rejected graphite premise after synonym substitution', () => {
    const rejected = 'battery nationalism keeps pointing at the mine while spherical purified graphite is stuck doing purification, morphology control, coating and cell qualification. congrats on owning dirt. the anode still has standards.';
    const reskin = 'battery independence apparently means digging up graphite and then discovering the cell maker cares about particle shape, purity, coating and qualification. mining guys meet process engineering and immediately ask for an extension.';

    expect(semanticIdeaSimilarity(
      { content: rejected, topic: 'graphite battery materials' },
      { content: reskin, topic: 'graphite battery materials' },
    )).toBeGreaterThanOrEqual(0.48);
  });

  it('does not conflate unrelated hard-tech mechanisms', () => {
    const graphite = 'spherical graphite needs purification, morphology control, coating and cell qualification.';
    const fusion = 'fusion tritium breeding blankets fail when neutron damage shortens first-wall component life.';

    expect(semanticIdeaSimilarity({ content: graphite }, { content: fusion })).toBe(0);
  });
});
