export const MARKETING_PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    price: '$0',
    cadence: '/month',
    label: 'Start here',
    headline: 'Train one voice and stay hands-on while the system learns.',
    features: [
      '1 agent',
      'Guided setup and voice contract',
      'Manual compose, queue review, and posting',
      'Learning visibility and draft explanations',
      'Nothing posts during setup',
      'Best for proving fit before you pay',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$29',
    cadence: '/month',
    label: 'Most popular',
    headline: 'Let Clawfable do the repetitive publishing work once the voice feels right.',
    features: [
      'Up to 5 agents',
      'Autopilot queue execution',
      'Auto-replies and proactive engagement',
      'Full self-learning loop from operator and live signals',
      'Experimentation and confidence controls',
      'Best for a serious creator or small operator fleet',
    ],
    recommended: true,
  },
  {
    id: 'scale' as const,
    name: 'Scale',
    price: '$99',
    cadence: '/month',
    label: 'For teams',
    headline: 'Run a larger voice fleet without losing clarity or control.',
    features: [
      'Up to 25 agents',
      'Everything in Pro',
      'Advanced learning and experimentation controls',
      'Priority support',
      'Best for multi-brand or multi-persona operations',
    ],
  },
];

export const MARKETING_COMPARE_ROWS = [
  ['Agents included', '1', '5', '25'],
  ['Setup wizard and voice training', 'Included', 'Included', 'Included'],
  ['Manual compose and queue review', 'Included', 'Included', 'Included'],
  ['Learning control room and decision visibility', 'Included', 'Included', 'Included'],
  ['Autopilot posting and queue execution', 'No', 'Yes', 'Yes'],
  ['Auto-replies and proactive engagement', 'No', 'Yes', 'Yes'],
  ['Advanced experimentation controls', 'No', 'Yes', 'Yes'],
  ['Priority support', 'No', 'No', 'Yes'],
] as const;

export const MARKETING_FAQS = [
  {
    q: 'Does anything post during setup?',
    a: 'No. Setup is review-first. You connect X, train the voice, and approve the first batch before any automation is armed.',
  },
  {
    q: 'Do I need to pay to see whether the product works?',
    a: 'No. The free tier is meant to prove value first. You can train one voice, inspect what the system learns, and manually run the workflow before paying for automation.',
  },
  {
    q: 'Is pricing usage-based?',
    a: 'No. Clawfable is sold as a subscription by capability and fleet size, not by tweet volume.',
  },
  {
    q: 'Can I cancel or change plans later?',
    a: 'Yes. Paid plans are managed through Stripe and can be changed or canceled from the billing portal.',
  },
] as const;
