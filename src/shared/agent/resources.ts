import { SCENARIOS, type ScenarioKey } from '../map-data';

export const RULES_RESOURCE_MIME_TYPE = 'application/json';
export const RULES_CURRENT_URI = 'game://rules/current';

export interface ListedMcpResource {
  description: string;
  mimeType: string;
  name: string;
  title: string;
  uri: string;
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

export const listRulesResources = (): ListedMcpResource[] => [
  {
    name: 'delta-v-rules-current',
    title: 'Current Ruleset',
    description:
      'All shipped Delta-V scenario definitions and rules as structured JSON.',
    uri: RULES_CURRENT_URI,
    mimeType: RULES_RESOURCE_MIME_TYPE,
  },
  ...(
    Object.entries(SCENARIOS) as Array<
      [ScenarioKey, (typeof SCENARIOS)[ScenarioKey]]
    >
  ).map(([scenario, definition]) => ({
    name: `delta-v-rules-${scenario}`,
    title: `${definition.name} Rules`,
    description: `${definition.description} Structured scenario rules payload.`,
    uri: rulesScenarioUri(scenario),
    mimeType: RULES_RESOURCE_MIME_TYPE,
  })),
];

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
