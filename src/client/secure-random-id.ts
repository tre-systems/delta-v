export const createSecureRandomId = (): string => {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replaceAll('-', '');
  }

  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Secure random number generation is unavailable.');
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
};
