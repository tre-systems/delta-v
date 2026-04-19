export const isDurableObjectCodeUpdateError = (error: unknown): boolean =>
  error instanceof TypeError &&
  /Durable Object's code has been updated/i.test(error.message);
