// Groq Llama 3.3 70B agent for Delta-V
// Uses Groq's OpenAI-compatible API with function calling

import type { AgentTurnInput } from '../src/shared/agent';

import { buildDeltaVAgentPrompt } from './delta-v-agent-prompt';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const SUBMIT_ACTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'submit_action',
    description:
      'Submit your chosen action for this turn. Pick the candidate index that best achieves your tactical goals.',
    parameters: {
      type: 'object',
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
  },
};

interface GroqResponse {
  choices: Array<{
    message: {
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

const groqMain = async (): Promise<void> => {
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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    process.stderr.write('GROQ_API_KEY not set, falling back to recommended\n');
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
    return;
  }

  try {
    const prompt = buildDeltaVAgentPrompt(input);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        tools: [SUBMIT_ACTION_TOOL],
        tool_choice: { type: 'function', function: { name: 'submit_action' } },
        messages: [
          {
            role: 'system',
            content:
              'You are a tactical AI playing Delta-V. Analyze the game state and choose the best action by calling submit_action. Be decisive.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Groq API ${response.status}: ${body}`);
    }

    const data = (await response.json()) as GroqResponse;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.name === 'submit_action') {
      const args = JSON.parse(toolCall.function.arguments) as {
        candidateIndex?: number;
        chat?: string;
      };

      if (
        typeof args.candidateIndex === 'number' &&
        Number.isInteger(args.candidateIndex) &&
        args.candidateIndex >= 0 &&
        args.candidateIndex < input.candidates.length
      ) {
        const trimmedChat =
          typeof args.chat === 'string' && args.chat.trim()
            ? args.chat.trim().slice(0, 200)
            : undefined;
        process.stdout.write(
          JSON.stringify({
            candidateIndex: args.candidateIndex,
            chat: trimmedChat,
          }),
        );
        return;
      }
    }

    // Fallback: no valid tool call
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
  } catch (error) {
    process.stderr.write(
      `Groq API error, falling back to recommended: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
  }
};

void groqMain().catch((error: unknown) => {
  process.stderr.write(
    `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
