/** Public subjects only. Captured account examples/evidence stay in private snapshots. */
export const ASTRA_EVALUATION_VERSION = 'astra-creative-1';
export const GEOFFREY_EVALUATION_SUBJECTS = [
  'AI inference economics', 'inference ASIC deployment', 'AI agents and company formation',
  'AI software pricing', 'AI model distribution', 'AI organizational change',
  'robotics deployment economics', 'robotics manufacturing', 'automated inspection',
  'nuclear fission deployment', 'fusion commercialization', 'electricity equipment',
  'critical mineral processing', 'advanced semiconductor packaging', 'industrial supply chains',
  'space launch economics', 'manufacturing process control', 'founder ownership',
  'startup capital allocation', 'venture portfolio construction', 'new company categories',
  'consumer product ambition', 'founder talent selection', 'company distribution strategy',
  'public and private market pricing', 'research commercialization', 'startup hiring',
  'technical founder culture', 'human performance', 'career risk',
] as const;

export interface SyntheticAuthorFixture {
  id: string;
  topic: string;
  tone: string;
  examples: [string, string, string];
}

/** Deliberately simulated calibration text; no example is labeled a real post or winner. */
export const SYNTHETIC_AUTHOR_FIXTURES: SyntheticAuthorFixture[] = [
  { id: 'teacher', topic: 'classroom feedback', tone: 'patient, concrete teacher', examples: ['I prefer a question that shows me where a student got stuck.', 'A shorter assignment can reveal more when the feedback is useful.', 'The lesson plan should leave room for an unexpected answer.'] },
  { id: 'ceramicist', topic: 'ceramics studio practice', tone: 'tactile, understated craftsperson', examples: ['I prefer a useful cup to a perfect photograph of one.', 'The glaze is only part of what makes a piece feel finished.', 'A quiet shape can carry quite a lot.'] },
  { id: 'gardener', topic: 'urban gardening', tone: 'practical, observant gardener', examples: ['I would rather grow one thing well than keep buying seedlings.', 'A garden plan needs space for the plants that surprise you.', 'The useful question is what this patch can support.'] },
  { id: 'librarian', topic: 'library discovery', tone: 'warm, thoughtful librarian', examples: ['I like a recommendation that gives the reader somewhere new to go.', 'A shelf can start a conversation without saying very much.', 'Finding the right book can begin with the wrong question.'] },
  { id: 'game-designer', topic: 'game playtesting', tone: 'playful but precise designer', examples: ['I would test the confusing choice before adding another mechanic.', 'The best rule might be the one players can forget while playing.', 'I care about the decision a turn gives you.'] },
  { id: 'cook', topic: 'home cooking', tone: 'plainspoken, economical home cook', examples: ['I want a recipe that tells me what to look for.', 'Dinner does not need a second garnish to count.', 'A useful technique should survive an ordinary kitchen.'] },
  { id: 'photographer', topic: 'street photography', tone: 'spare, visual photographer', examples: ['I would keep the frame that leaves a little unresolved.', 'Light can make an ordinary corner worth another look.', 'A photograph does not have to explain everyone in it.'] },
  { id: 'maintainer', topic: 'open source maintenance', tone: 'candid, technical maintainer', examples: ['I prefer a small patch that tells me why it exists.', 'The next maintainer deserves an example that actually runs.', 'A clear error message can save a surprisingly long conversation.'] },
  { id: 'historian', topic: 'local history', tone: 'curious, careful historian', examples: ['I want to know whose account is missing from the archive.', 'A date becomes useful when we know what it changed.', 'The small detail can be the reason to revisit the familiar story.'] },
  { id: 'editor', topic: 'essay editing', tone: 'direct, literary editor', examples: ['I would keep the sentence that makes the writer sound awake.', 'The introduction can end sooner than you think.', 'An unfinished question can earn its place if the essay actually asks it.'] },
];
