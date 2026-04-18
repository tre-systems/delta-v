import { reportError } from './telemetry';

let shown = false;

const GH_ISSUES_URL = 'https://github.com/tre-systems/delta-v/issues';

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

  const buildClipboardPayload = (): string => {
    const href = typeof location !== 'undefined' ? location.href : '';
    return [
      'Delta-V client error',
      `Message: ${message}`,
      `URL: ${href}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');
  };

  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = [
    'display:flex',
    'flex-wrap:wrap',
    'gap:10px',
    'justify-content:center',
    'margin-top:4px',
  ].join(';');

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.id = 'error-copy-details-btn';
  copyBtn.style.cssText = [
    'padding:10px 20px',
    'background:var(--chrome-surface-strong,rgba(7,14,28,0.88))',
    'color:var(--text,#eef4ff)',
    'border:1px solid var(--border-strong,rgba(122,215,255,0.38))',
    'border-radius:var(--radius-pill,999px)',
    "font-family:var(--font-display,'Space Grotesk',sans-serif)",
    'font-size:0.95rem',
    'cursor:pointer',
  ].join(';');
  copyBtn.textContent = 'Copy details';
  copyBtn.addEventListener('click', () => {
    const payload = buildClipboardPayload();
    const write = navigator.clipboard?.writeText(payload);
    if (write) {
      void write
        .then(() => {
          copyBtn.textContent = 'Copied!';
          window.setTimeout(() => {
            copyBtn.textContent = 'Copy details';
          }, 2500);
        })
        .catch(() => {
          copyBtn.textContent = 'Copy failed';
          window.setTimeout(() => {
            copyBtn.textContent = 'Copy details';
          }, 2500);
        });
    } else {
      copyBtn.textContent = 'Copy failed';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy details';
      }, 2500);
    }
  });

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.id = 'error-reload-btn';
  reloadBtn.style.cssText = [
    'padding:10px 24px',
    'background:var(--accent-soft,rgba(122,215,255,0.14))',
    'color:var(--accent,#7ad7ff)',
    'border:1px solid var(--border-strong,rgba(122,215,255,0.38))',
    'border-radius:var(--radius-pill,999px)',
    "font-family:var(--font-display,'Space Grotesk',sans-serif)",
    'font-size:0.95rem',
    'cursor:pointer',
  ].join(';');
  reloadBtn.textContent = 'Reload';
  reloadBtn.addEventListener('click', () => {
    window.location.reload();
  });

  const help = document.createElement('p');
  help.style.cssText = [
    'margin:0',
    'font-size:0.82rem',
    'color:var(--muted,#90a0ba)',
  ].join(';');
  help.appendChild(document.createTextNode('Having trouble? '));
  const reportLink = document.createElement('a');
  reportLink.href = GH_ISSUES_URL;
  reportLink.target = '_blank';
  reportLink.rel = 'noopener noreferrer';
  reportLink.textContent = 'Report on GitHub';
  reportLink.style.color = 'var(--accent,#7ad7ff)';
  help.appendChild(reportLink);
  help.appendChild(document.createTextNode('.'));

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

  actionsRow.appendChild(copyBtn);
  actionsRow.appendChild(reloadBtn);
  overlay.appendChild(actionsRow);
  overlay.appendChild(help);
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
    copyBtn.focus();
  });
};
