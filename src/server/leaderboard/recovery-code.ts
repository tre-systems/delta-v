const RECOVERY_CODE_PREFIX = 'dv1';
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_BODY_LENGTH = 24;
const RECOVERY_CODE_GROUP_LENGTH = 4;

export const generateRecoveryCode = (): string => {
  const bytes = new Uint8Array(RECOVERY_CODE_BODY_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  let body = '';
  for (const byte of bytes) {
    body += RECOVERY_CODE_ALPHABET[byte & 31];
  }

  return formatRecoveryCodeBody(body);
};

export const normalizeRecoveryCode = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const compact = value
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
  if (!compact.startsWith(RECOVERY_CODE_PREFIX.toUpperCase())) {
    return null;
  }

  const body = compact.slice(RECOVERY_CODE_PREFIX.length);
  if (
    body.length !== RECOVERY_CODE_BODY_LENGTH ||
    ![...body].every((char) => RECOVERY_CODE_ALPHABET.includes(char))
  ) {
    return null;
  }

  return formatRecoveryCodeBody(body);
};

export const hashRecoveryCode = async (
  recoveryCode: string,
): Promise<string> => {
  const encoded = new TextEncoder().encode(recoveryCode);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const formatRecoveryCodeBody = (body: string): string => {
  const groups: string[] = [];
  for (
    let index = 0;
    index < body.length;
    index += RECOVERY_CODE_GROUP_LENGTH
  ) {
    groups.push(body.slice(index, index + RECOVERY_CODE_GROUP_LENGTH));
  }
  return `${RECOVERY_CODE_PREFIX}-${groups.join('-')}`;
};
