/** Opt-in for newly frozen contexts; absent/unknown markers retain old prompts. */
export const AUTHORED_VOICE_POLICY_VERSION = 'authored-voice-primary-1';

export function authoredVoiceInstruction(context: { authoredVoicePolicy?: string } | null | undefined): string {
  return context?.authoredVoicePolicy === AUTHORED_VOICE_POLICY_VERSION
    ? 'For contexts marked authored-voice-primary-1, the actual authored voiceExamples are the primary evidence for diction, rhythm, capitalization, line breaks and rhetorical shape. Preserve their demonstrated range rather than imposing a fixed cadence. Prefer faithful expression over generic tidiness or polished advice. Judge voice against those examples and the explicit owner direction, without copying their wording, premises, facts or experience.'
    : '';
}
