interface CandidatePayload {
  recommendedIndex?: number;
}

const main = async (): Promise<void> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  let payload: CandidatePayload;
  try {
    payload = JSON.parse(raw) as CandidatePayload;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
    return;
  }

  const candidateIndex =
    typeof payload.recommendedIndex === 'number' &&
    Number.isInteger(payload.recommendedIndex) &&
    payload.recommendedIndex >= 0
      ? payload.recommendedIndex
      : 0;

  process.stdout.write(JSON.stringify({ candidateIndex }));
};

void main().catch(() => {
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
