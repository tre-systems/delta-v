export type BoundedBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'body_too_large' | 'invalid_json' };

const readBoundedText = async (
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: string } | { ok: false }> => {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maxBytes) return { ok: false };
  }
  if (!request.body) return { ok: true, value: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('request body limit exceeded').catch(() => {});
      return { ok: false };
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      value: new TextDecoder('utf-8', { fatal: true }).decode(joined),
    };
  } catch {
    return { ok: true, value: '' };
  }
};

export const readBoundedJson = async <T>(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult<T>> => {
  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) return { ok: false, reason: 'body_too_large' };
  try {
    return { ok: true, value: JSON.parse(body.value) as T };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
};
