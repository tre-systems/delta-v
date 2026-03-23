// Lightweight DOM helpers for declarative UI construction.
//
// These reduce the verbosity of
// createElement/className/addEventListener/appendChild
// chains without introducing a framework. Use `el()` for
// building element trees, `show`/`hide`/`visible` for
// display toggling, and `byId` for typed lookups.

// --- Element creation ---

interface ElProps {
  class?: string;
  classList?: Record<string, boolean>;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
  disabled?: boolean;
  title?: string;
  data?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
  onKeydown?: (e: KeyboardEvent) => void;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
}

type Child = HTMLElement | string;

// Create an HTML element declaratively.
//
//   el('div', { class: 'card', onClick: handler },
//     el('span', { class: 'title', text: 'Hello' }),
//     'some text',
//   )
export const el = (
  tag: string,
  props?: ElProps,
  ...children: Child[]
): HTMLElement => {
  const element = document.createElement(tag);

  if (props) {
    if (props.class) element.className = props.class;

    if (props.classList) {
      for (const [cls, on] of Object.entries(props.classList)) {
        element.classList.toggle(cls, on);
      }
    }

    if (props.text) element.textContent = props.text;

    if (props.html) setTrustedHTML(element, props.html);

    if (props.style) {
      Object.assign(element.style, props.style);
    }

    if (props.disabled != null) {
      (element as HTMLButtonElement).disabled = props.disabled;
    }

    if (props.title) element.title = props.title;

    if (props.data) {
      for (const [key, value] of Object.entries(props.data)) {
        element.dataset[key] = value;
      }
    }

    if (props.onClick) {
      element.addEventListener('click', props.onClick as EventListener);
    }

    if (props.onKeydown) {
      element.addEventListener('keydown', props.onKeydown as EventListener);
    }

    if (props.onInput) {
      element.addEventListener('input', props.onInput as EventListener);
    }

    if (props.onChange) {
      element.addEventListener('change', props.onChange as EventListener);
    }
  }

  for (const child of children) {
    element.appendChild(
      typeof child === 'string' ? document.createTextNode(child) : child,
    );
  }

  return element;
};

// --- Trusted HTML boundary ---
//
// All innerHTML writes must go through these helpers so
// the boundary is auditable in one place. The content is
// trusted — it comes from internal game state and static
// markup, never from user input or external sources.
// If untrusted content is ever needed, add a sanitizer
// (e.g. DOMPurify) here instead of scattering raw
// innerHTML writes.

// Set innerHTML from a trusted internal source.
//
// Use this instead of raw `element.innerHTML = ...`
// so the security boundary is grep-able. All callers
// must pass only internally generated markup.
export const setTrustedHTML = (element: HTMLElement, html: string): void => {
  element.innerHTML = html;
};

// Clear an element's children via innerHTML.
export const clearHTML = (element: HTMLElement): void => {
  element.innerHTML = '';
};

// --- Event binding ---

// Bind an event listener and return a disposer that
// removes it. Use with `scope.add(listen(...))` to
// replace the 3-line addEventListener/scope.add/
// removeEventListener pattern.
export const listen = <T extends EventTarget, K extends string>(
  target: T,
  event: K,
  handler: (e: Event) => void,
  options?: AddEventListenerOptions,
): (() => void) => {
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
};

// --- List rendering ---

// Clear a container and render a list of items into it.
//
// Each item is rendered by the `renderItem` callback,
// which receives the item and its index and returns an
// HTMLElement to append. This replaces the common
// clearHTML → for-loop → createElement → appendChild
// pattern across view classes.
export const renderList = <T>(
  container: HTMLElement,
  items: T[],
  renderItem: (item: T, index: number) => HTMLElement,
): void => {
  clearHTML(container);

  for (let i = 0; i < items.length; i++) {
    container.appendChild(renderItem(items[i], i));
  }
};

// --- Visibility ---

// Hide an element by setting display to 'none'.
export const hide = (element: HTMLElement): void => {
  element.style.display = 'none';
};

// Show an element by restoring its display value.
export const show = (element: HTMLElement, display = ''): void => {
  element.style.display = display;
};

// Set element visibility based on a boolean condition.
export const visible = (
  element: HTMLElement,
  condition: boolean,
  display = '',
): void => {
  element.style.display = condition ? display : 'none';
};

// --- Lookup ---

// Typed getElementById that throws if the element doesn't exist.
export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Element #${id} not found`);
  }

  return element as T;
};
