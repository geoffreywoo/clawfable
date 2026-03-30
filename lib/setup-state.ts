export const SETUP_STEPS = ['oauth', 'soul', 'analyze', 'preview', 'ready'] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_BANNER_CONTENT: Record<Exclude<SetupStep, 'ready'>, { title: string; desc: string }> = {
  oauth: {
    title: 'CONNECT X API',
    desc: 'This agent needs X API credentials before setup can continue.',
  },
  soul: {
    title: 'DEFINE VOICE',
    desc: 'Create or generate a SOUL.md profile so the agent has a clear personality contract.',
  },
  analyze: {
    title: 'RUN ANALYSIS',
    desc: 'Analyze the account before preview so generation can use engagement and audience signals.',
  },
  preview: {
    title: 'APPROVE PREVIEW',
    desc: 'Review the preview batch and approve at least one tweet before autopilot can be armed.',
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
