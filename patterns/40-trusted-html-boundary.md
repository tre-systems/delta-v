# Trusted HTML Boundary

## Category
Client-Specific

## Intent
Funnel all `innerHTML` writes through a small set of auditable helpers (`setTrustedHTML`, `clearHTML`) so that the security boundary is grep-able in one place. If untrusted content ever needs to be rendered, a sanitizer can be added at this single choke point rather than being scattered across raw `innerHTML` assignments.

## How It Works in Delta-V

The boundary is defined by two functions in `dom.ts`:

1. **`setTrustedHTML(element, html)`** -- Sets `element.innerHTML = html`. The content is trusted because it comes from internal game state and static markup, never from user input or external sources.

2. **`clearHTML(element)`** -- Sets `element.innerHTML = ''` to remove all children.

The `el()` helper routes its `html` prop through `setTrustedHTML()`, ensuring that declarative element construction also respects the boundary.

The design principle is that all `innerHTML` writes should be discoverable by searching for `setTrustedHTML` and `clearHTML`. Any direct `innerHTML` assignment outside these two functions is a boundary violation.

## Key Locations

| File | Lines | Role |
|------|-------|------|
| `src/client/dom.ts` | 98-120 | `setTrustedHTML()` and `clearHTML()` definitions |
| `src/client/dom.ts` | 54 | `el()` routes `html` prop through `setTrustedHTML()` |
| `src/client/tutorial.ts` | 7 | Imports `setTrustedHTML` |
| `src/client/game/logistics-ui.ts` | (various) | Uses `clearHTML` for panel resets |
| `src/client/game/client-kernel.ts` | 4 | Imports `clearHTML` |

## Code Examples

The boundary functions:

```typescript
// src/client/dom.ts
export const setTrustedHTML = (element: HTMLElement, html: string): void => {
  element.innerHTML = html;
};

export const clearHTML = (element: HTMLElement): void => {
  element.innerHTML = '';
};
```

The `el()` helper uses the boundary:

```typescript
// src/client/dom.ts
if (props.html) setTrustedHTML(element, props.html);
```

## Consistency Analysis

**Boundary violation found**: There is one direct `innerHTML` assignment in production code that bypasses the boundary:

- **`src/client/ui/hud-chrome-view.ts` line 368**: `soundBtn.innerHTML = muted ? '<svg ...>' : '<svg ...>'`. This sets SVG icon markup directly on the sound button without going through `setTrustedHTML()`.

The content is trusted (static SVG markup hardcoded in the source), so this is not a security risk, but it is an inconsistency. It should be refactored to use `setTrustedHTML(soundBtn, muted ? '...' : '...')` for auditability.

**Test files** use `document.body.innerHTML = ...` for DOM setup, which is expected and does not need to go through the boundary since test markup is not production code.

All other `innerHTML` usage in production code goes through `setTrustedHTML()` or `clearHTML()`.

## Completeness Check

The boundary is simple and effective:

- **No sanitization needed currently**: All HTML content is internally generated (SVG icons, game state markup, static templates). There is no user-generated content rendered as HTML.
- **Future-proofing**: The comment in `dom.ts` explicitly notes that if untrusted content is ever needed, a sanitizer (e.g., DOMPurify) should be added inside `setTrustedHTML()` rather than scattering sanitization across the codebase.
- **One boundary violation** to fix: the `soundBtn.innerHTML` in `hud-chrome-view.ts`.

Potential improvement: A lint rule (e.g., ESLint `no-restricted-properties` on `innerHTML`) could enforce the boundary automatically, flagging any direct `innerHTML` assignment outside `dom.ts`.

## Related Patterns

- **Smart DOM Helpers** (Pattern 39): `el()` and `clearHTML()` are part of the same DOM helper module.
- **Canvas Renderer Factory** (Pattern 42): The renderer uses canvas APIs exclusively and does not touch `innerHTML`, keeping the boundary clean.
