// Shared UI breakpoints for JS-driven layout decisions.
//
// The CSS in static/styles/responsive.css drives visual layout at several
// widths (760 / 640 / 420). JavaScript code that needs to match those
// breakpoints imports from this file so the numbers agree. If you change a
// value here, update the corresponding `@media (max-width: ...)` rule in
// responsive.css to keep JS and CSS in sync.

export const MOBILE_BREAKPOINT_PX = 760;
export const COMPACT_BREAKPOINT_PX = 640;
export const TINY_BREAKPOINT_PX = 420;

export const isMobileViewport = (
  windowLike: { innerWidth: number } = window,
): boolean => windowLike.innerWidth <= MOBILE_BREAKPOINT_PX;
