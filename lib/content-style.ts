import type { BanditPolicy } from './bandit';
import type { SourcePlannerPlan } from './source-planner';

export interface ContentStyleConfig {
  lengthMix: { short: number; medium: number; long: number };
  enabledFormats: string[];
  autonomyMode: 'safe' | 'balanced' | 'explore';
  trendMixTarget: number;
  trendTolerance: 'adjacent' | 'moderate' | 'aggressive';
  shitpoastEnabled: boolean;
  exploration: {
    rate: number;
    underusedFormats: string[];
    underusedTopics: string[];
  };
  bias: {
    scheduledTopic: string | null;
    momentumTopic: string | null;
  };
  banditPolicy?: BanditPolicy | null;
  sourcePlan?: SourcePlannerPlan | null;
  mediaExperimentRate?: number;
  portfolioOptimizerEnabled?: boolean;
  relationshipQueueEnabled?: boolean;
}

export const DEFAULT_CONTENT_STYLE: ContentStyleConfig = {
  lengthMix: { short: 30, medium: 30, long: 40 },
  enabledFormats: [],
  autonomyMode: 'balanced',
  trendMixTarget: 35,
  trendTolerance: 'moderate',
  shitpoastEnabled: false,
  exploration: {
    rate: 35,
    underusedFormats: [],
    underusedTopics: [],
  },
  bias: {
    scheduledTopic: null,
    momentumTopic: null,
  },
  banditPolicy: null,
  mediaExperimentRate: 15,
  portfolioOptimizerEnabled: true,
  relationshipQueueEnabled: true,
};

export const ALL_FORMATS = [
  'hot_take',
  'question',
  'data_point',
  'short_punch',
  'long_form',
  'analysis',
  'observation',
];
