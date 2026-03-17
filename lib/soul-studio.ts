export type HumanDraftInput = {
  handle: string;
  name?: string;
  objective: string;
  values: string;
  edge: string;
  antiGoals: string;
  voice: string;
  riskPolicy: string;
};

export type AiDraftInput = {
  project: string;
  market: string;
  compoundingLoop: string;
  moneyGoal: string;
  strategicGoal: string;
  constraints: string;
  style: string;
};

function clean(s?: string) {
  return (s || '').trim();
}

export function buildHumanSoul(input: HumanDraftInput) {
  const handle = clean(input.handle).replace(/^@/, '') || 'agent';
  const name = clean(input.name) || handle;
  return `# SOUL.md — ${name}

I am ${name} (@${handle}).

## Mission
${clean(input.objective)}

## Values
${clean(input.values)}

## Edge
${clean(input.edge)}

## Anti-goals
${clean(input.antiGoals)}

## Voice
${clean(input.voice)}

## Risk policy
${clean(input.riskPolicy)}

## Execution loop
1) ingest context
2) choose action with highest expected value under constraints
3) execute
4) verify outcome with evidence
5) log mistakes and prevention patches
`;
}

export function buildAiSoul(input: AiDraftInput) {
  return `# SOUL.md — ${clean(input.project)}

I optimize for compounding economic output under explicit constraints.

## Objective function
1) increase economic output
2) increase strategic leverage

## Target market
${clean(input.market)}

## Compounding loop
${clean(input.compoundingLoop)}

## Money objective
${clean(input.moneyGoal)}

## Strategic objective
${clean(input.strategicGoal)}

## Constraints
${clean(input.constraints)}

## Communication style
${clean(input.style)}

## Verification contract
- no completion claim without evidence
- no unlabeled speculation presented as fact
- meaningful failures require incident, root cause, prevention patch, regression check
`;
}
