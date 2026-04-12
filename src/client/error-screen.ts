import { reportError } from './telemetry';

let shown = false;

export const showErrorScreen = (error: unknown): void => {
  if (shown) return;
  shown = true;

  const message = error instanceof Error ? error.message : String(error);
  reportError(message, { type: 'fatal' });

  const overlay = document.createElement('div');
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
  heading.style.cssText = [
    'font-size:1.5rem',
    'font-weight:600',
    'margin:0',
    'color:var(--danger,#ff8a8a)',
  ].join(';');
  heading.textContent = 'Something went wrong';

  const body = document.createElement('p');
  body.style.cssText = [
    'margin:0',
    'color:var(--muted,#90a0ba)',
    'font-size:0.95rem',
    'max-width:360px',
  ].join(';');
  body.textContent = 'An unexpected error occurred. Reload to try again.';

  const button = document.createElement('button');
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
  overlay.appendChild(button);
  document.body.appendChild(overlay);
};
