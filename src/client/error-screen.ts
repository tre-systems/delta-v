import { reportError } from './telemetry';

let shown = false;

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const listFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(focusableSelector));

export const showErrorScreen = (error: unknown): void => {
  if (shown) return;
  shown = true;

  const message = error instanceof Error ? error.message : String(error);
  reportError(message, { type: 'fatal' });

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'error-screen-title');
  overlay.tabIndex = -1;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'background:var(--bg,#040b16)',
    'color:var(--text,#eef4ff)',
    "font-family:var(--font-display,'Space Grotesk',sans-serif)",
    'z-index:9999',
    'gap:16px',
    'padding:24px',
    'text-align:center',
  ].join(';');

  const heading = document.createElement('h1');
  heading.id = 'error-screen-title';
  heading.style.cssText = [
    'font-size:1.5rem',
    'font-weight:600',
    'margin:0',
    'color:var(--danger,#ff8a8a)',
  ].join(';');
  heading.textContent = 'Something went wrong';

  const body = document.createElement('p');
  body.id = 'error-screen-desc';
  body.style.cssText = [
    'margin:0',
    'color:var(--muted,#90a0ba)',
    'font-size:0.95rem',
    'max-width:360px',
  ].join(';');
  body.textContent = 'An unexpected error occurred. Reload to try again.';

  const trimmed = message.trim();
  let detail: HTMLParagraphElement | null = null;
  if (trimmed.length > 0) {
    const maxLen = 200;
    const snippet =
      trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
    detail = document.createElement('p');
    detail.id = 'error-screen-detail';
    detail.style.cssText = [
      'margin:0',
      'color:var(--muted,#90a0ba)',
      'font-size:0.78rem',
      'max-width:420px',
      'word-break:break-word',
      'font-family:var(--font-mono,monospace)',
    ].join(';');
    detail.textContent = snippet;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText = [
    'margin-top:8px',
    'padding:10px 24px',
    'background:var(--accent-soft,rgba(122,215,255,0.14))',
    'color:var(--accent,#7ad7ff)',
    'border:1px solid var(--border-strong,rgba(122,215,255,0.38))',
    'border-radius:var(--radius-pill,999px)',
    "font-family:var(--font-display,'Space Grotesk',sans-serif)",
    'font-size:0.95rem',
    'cursor:pointer',
  ].join(';');
  button.textContent = 'Reload';
  button.addEventListener('click', () => {
    window.location.reload();
  });

  overlay.appendChild(heading);
  overlay.appendChild(body);
  if (detail) {
    overlay.appendChild(detail);
    overlay.setAttribute(
      'aria-describedby',
      'error-screen-desc error-screen-detail',
    );
  } else {
    overlay.setAttribute('aria-describedby', 'error-screen-desc');
  }
  overlay.appendChild(button);
  document.body.appendChild(overlay);

  const trapFocus = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab') return;
    const nodes = listFocusable(overlay);
    if (nodes.length === 0) return;
    if (nodes.length === 1) {
      ev.preventDefault();
      nodes[0].focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey) {
      if (active === first || !overlay.contains(active)) {
        ev.preventDefault();
        last.focus();
      }
    } else if (active === last || !overlay.contains(active)) {
      ev.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('keydown', trapFocus);
  requestAnimationFrame(() => {
    button.focus();
  });
};
