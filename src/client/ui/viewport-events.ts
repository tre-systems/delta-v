import { listen } from '../dom';
import type { Dispose } from '../reactive';

type BindViewportEventsInput = {
  mobileQuery: MediaQueryList;
  onMobileChange: (matches: boolean) => void;
  onViewportResize: () => void;
  trackDispose: (dispose: Dispose) => void;
};

export const bindViewportEvents = ({
  mobileQuery,
  onMobileChange,
  onViewportResize,
  trackDispose,
}: BindViewportEventsInput): void => {
  trackDispose(
    listen(mobileQuery, 'change', (event) => {
      onMobileChange((event as MediaQueryListEvent).matches);
    }),
  );
  trackDispose(listen(window, 'resize', onViewportResize));

  if (window.visualViewport) {
    trackDispose(listen(window.visualViewport, 'resize', onViewportResize));
  }
};
