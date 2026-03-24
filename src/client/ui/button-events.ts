import { byId, listen } from '../dom';
import type { Dispose } from '../reactive';
import { STATIC_BUTTON_BINDINGS } from './button-bindings';
import type { UIEvent } from './events';

export const bindStaticButtonEvents = (
  emit: (event: UIEvent) => void,
  trackDispose: (dispose: Dispose) => void,
): void => {
  for (const binding of STATIC_BUTTON_BINDINGS) {
    trackDispose(
      listen(byId(binding.id), 'click', () => {
        emit(binding.event);
      }),
    );
  }
};
