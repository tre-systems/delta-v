import {
  SCENARIO_DISPLAY_ORDER,
  SCENARIOS,
  type ScenarioKey,
} from '../map-data';
import type { ReplayTimeline } from '../replay';
import type { S2C } from '../types/protocol';
import type { AgentTurnInput } from './types';

export const RULES_RESOURCE_MIME_TYPE = 'application/json';
export const RULES_CURRENT_URI = 'game://rules/current';
export const LEADERBOARD_AGENTS_URI = 'game://leaderboard/agents';
export const MATCH_OBSERVATION_URI_TEMPLATE = 'game://matches/{id}/observation';
export const MATCH_LOG_URI_TEMPLATE = 'game://matches/{id}/log';
export const MATCH_REPLAY_URI_TEMPLATE = 'game://matches/{id}/replay';

export interface ListedMcpResource {
  description: string;
  mimeType: string;
  name: string;
  title: string;
  uri: string;
}

export interface MatchLogEntry {
  id: number;
  receivedAt: number;
  type: S2C['type'];
  message: S2C;
}

export const rulesScenarioUri = (scenario: ScenarioKey): string =>
  `game://rules/${scenario}`;

export const buildCurrentRulesResourceDocument = () => ({
  version: 1 as const,
  defaultScenario: 'duel',
  scenarios: SCENARIOS,
});

export const buildScenarioRulesResourceDocument = (scenario: ScenarioKey) => ({
  version: 1 as const,
  scenario,
  definition: SCENARIOS[scenario],
});

export interface LeaderboardAgentEntry {
  gamesPlayed: number;
  lastPlayedAt: number | null;
  provisional: boolean;
  rating: number;
  rd: number;
  username: string;
}

export const buildLeaderboardAgentsResourceDocument = (
  entries: LeaderboardAgentEntry[],
) => ({
  version: 1 as const,
  kind: 'agentLeaderboard' as const,
  entries,
});

export const listRulesResources = (): ListedMcpResource[] => [
  {
    name: 'delta-v-rules-current',
    title: 'Current Ruleset',
    description:
      'All shipped Delta-V scenario definitions and rules as structured JSON.',
    uri: RULES_CURRENT_URI,
    mimeType: RULES_RESOURCE_MIME_TYPE,
  },
  ...SCENARIO_DISPLAY_ORDER.map((scenario) => ({
    name: `delta-v-rules-${scenario}`,
    title: `${SCENARIOS[scenario].name} Rules`,
    description: `${SCENARIOS[scenario].description} Structured scenario rules payload.`,
    uri: rulesScenarioUri(scenario),
    mimeType: RULES_RESOURCE_MIME_TYPE,
  })),
];

export const leaderboardAgentsResource = (): ListedMcpResource => ({
  name: 'delta-v-leaderboard-agents',
  title: 'Agent Leaderboard',
  description:
    'Public agent leaderboard snapshot as structured JSON, ordered by rating.',
  uri: LEADERBOARD_AGENTS_URI,
  mimeType: RULES_RESOURCE_MIME_TYPE,
});

export const matchObservationUri = (id: string): string =>
  `game://matches/${id}/observation`;

export const matchLogUri = (id: string): string => `game://matches/${id}/log`;

export const matchReplayUri = (id: string): string =>
  `game://matches/${id}/replay`;

export const buildMatchObservationResourceDocument = (
  id: string,
  observation: AgentTurnInput,
) => ({
  version: 1 as const,
  kind: 'matchObservation' as const,
  id,
  observation,
});

export const buildMatchLogResourceDocument = (
  id: string,
  events: MatchLogEntry[],
  latestEventId: number,
  bufferedRemaining: number,
) => ({
  version: 1 as const,
  kind: 'matchLog' as const,
  id,
  latestEventId,
  bufferedRemaining,
  events,
});

export const buildMatchReplayResourceDocument = (
  id: string,
  replay: ReplayTimeline,
) => ({
  version: 1 as const,
  kind: 'matchReplay' as const,
  id,
  replay,
});

export const readRulesResourceDocument = (uri: string): unknown => {
  if (uri === RULES_CURRENT_URI) {
    return buildCurrentRulesResourceDocument();
  }

  for (const scenario of Object.keys(SCENARIOS) as ScenarioKey[]) {
    if (uri === rulesScenarioUri(scenario)) {
      return buildScenarioRulesResourceDocument(scenario);
    }
  }

  throw new Error(`Unknown rules resource: ${uri}`);
};

export const readRulesResourceText = (uri: string): string =>
  JSON.stringify(readRulesResourceDocument(uri), null, 2);
