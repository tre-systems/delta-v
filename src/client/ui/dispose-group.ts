type DisposeFn = () => void;

export const composeDisposers = (...disposeFns: DisposeFn[]): DisposeFn => {
  return () => {
    for (const dispose of disposeFns) {
      dispose();
    }
  };
};
