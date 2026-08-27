export const SETUP_STEPS = ['oauth', 'soul', 'analyze', 'preview', 'ready'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_BANNER_CONTENT: Record<Exclude<SetupStep, 'ready'>, { title: string; desc: string }> = {
  oauth: {
    title: 'CONNECT ACCOUNT',
    desc: 'Connect X so Clawfable can analyze the account and draft safely. Nothing posts during setup.',
  },
  soul: {
    title: 'DEFINE VOICE CONTRACT',
    desc: 'Create the voice contract so the agent knows how to sound, what to talk about, and what to avoid.',
  },
  analyze: {
    title: 'LEARN THE ACCOUNT',
    desc: 'Analyze the account before preview so the first batch is grounded in real engagement and audience signals.',
  },
  preview: {
    title: 'APPROVE FIRST BATCH',
    desc: 'Review the first batch and approve at least one tweet before the queue and automation can go live.',
  },
};

export function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && SETUP_STEPS.includes(value as SetupStep);
}

export function normalizeSetupStep(value: string | null | undefined): SetupStep {
  return isSetupStep(value) ? value : 'ready';
}

export function isSetupIncomplete(value: string | null | undefined): boolean {
  return normalizeSetupStep(value) !== 'ready';
}

export function getPostAnalysisStep(value: string | null | undefined): SetupStep {
  return normalizeSetupStep(value) === 'analyze' ? 'preview' : normalizeSetupStep(value);
}
