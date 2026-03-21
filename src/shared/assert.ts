export const must = <T>(
  value: T,
  message = 'Expected value to be present',
): NonNullable<T> => {
  if (value == null) {
    throw new Error(message);
  }

  return value;
};
