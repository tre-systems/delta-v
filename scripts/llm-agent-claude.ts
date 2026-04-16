import Anthropic from '@anthropic-ai/sdk';

import type { AgentTurnInput } from '../src/shared/agent';

import { buildDeltaVAgentPrompt } from './delta-v-agent-prompt';

const SUBMIT_ACTION_TOOL: Anthropic.Tool = {
  name: 'submit_action',
  description:
    'Submit your chosen action for this turn. Pick the candidate index that best achieves your tactical goals.',
  input_schema: {
    type: 'object' as const,
    properties: {
      candidateIndex: {
        type: 'integer',
        description:
          'Index into the candidates array (0-based). Candidate 0 is the built-in AI recommendation.',
      },
      chat: {
        type: 'string',
        description:
          'Optional short message or taunt shown to your opponent (max 200 chars). Only include if you have something memorable to say.',
        maxLength: 200,
      },
    },
    required: ['candidateIndex'],
  },
};

const main = async (): Promise<void> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  const fallbackIndex = 0;

  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: fallbackIndex }));
    return;
  }

  let input: AgentTurnInput;
  try {
    input = JSON.parse(raw) as AgentTurnInput;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: fallbackIndex }));
    return;
  }

  const recommended =
    typeof input.recommendedIndex === 'number' &&
    Number.isInteger(input.recommendedIndex) &&
    input.recommendedIndex >= 0
      ? input.recommendedIndex
      : fallbackIndex;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'ANTHROPIC_API_KEY not set, falling back to recommended\n',
    );
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildDeltaVAgentPrompt(input);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      tools: [SUBMIT_ACTION_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract the tool_use block
    const toolUse = message.content.find(
      (c: { type: string }) => c.type === 'tool_use',
    ) as
      | { type: 'tool_use'; input: { candidateIndex?: number; chat?: string } }
      | undefined;

    if (toolUse) {
      const { candidateIndex, chat } = toolUse.input;

      if (
        typeof candidateIndex === 'number' &&
        Number.isInteger(candidateIndex) &&
        candidateIndex >= 0 &&
        candidateIndex < input.candidates.length
      ) {
        const trimmedChat =
          typeof chat === 'string' && chat.trim()
            ? chat.trim().slice(0, 200)
            : undefined;
        process.stdout.write(
          JSON.stringify({ candidateIndex, chat: trimmedChat }),
        );
        return;
      }
    }

    // Fallback: no valid tool call
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
  } catch (error) {
    process.stderr.write(
      `Claude API error, falling back to recommended: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
