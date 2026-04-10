export const MARKETING_PLANS = [
  {
    id: 'free' as const,
    name: 'Free',
    price: '$0',
    cadence: '/month',
    label: 'PROVE THE PRODUCT',
    headline: 'Train one agent and keep judgment in the loop.',
    features: [
      '1 agent',
      'Full setup wizard and voice contract',
      'Manual compose, queue review, and manual posting',
      'Learning visibility and decision explanations',
      'Nothing posts during setup',
    ],
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    price: '$29',
    cadence: '/month',
    label: 'AUTOMATION LAYER',
    headline: 'Let the queue run itself once the voice is calibrated.',
    features: [
      'Up to 5 agents',
      'Autopilot queue execution',
      'Auto-replies and proactive engagement',
      'Full self-learning loop from operator and live signals',
      'Best for a serious personal brand or small operator fleet',
    ],
    recommended: true,
  },
  {
    id: 'scale' as const,
    name: 'Scale',
    price: '$99',
    cadence: '/month',
    label: 'FLEET CONTROL',
    headline: 'Run a larger voice fleet with room to experiment.',
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
    a: 'No. Setup is review-first. You connect X, define the voice contract, analyze what already works, and approve the first batch before any automation is armed.',
  },
  {
    q: 'Do I need to pay to see whether the product works?',
    a: 'No. The free tier is designed to prove value first: you can train one agent, inspect the learning surfaces, and manually run the workflow before paying for automation.',
  },
  {
    q: 'Is pricing usage-based?',
    a: 'No. Clawfable is sold as a subscription by account capability and fleet size, not by tweet volume.',
  },
  {
    q: 'Can I cancel or change plans later?',
    a: 'Yes. Paid plans are managed through Stripe and can be changed or canceled from the billing portal.',
  },
] as const;
