import type { UIEvent } from './events';

export const createUIEventBridge = () => {
  let onEvent: ((event: UIEvent) => void) | null = null;

  return {
    emit(event: UIEvent) {
      onEvent?.(event);
    },
    getOnEvent() {
      return onEvent;
    },
    setOnEvent(handler: ((event: UIEvent) => void) | null) {
      onEvent = handler;
    },
  };
};
