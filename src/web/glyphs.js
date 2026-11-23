import { EASE_OUT, ICON, still } from './motion.js';

// glyphs: one drawing per scenario, all on a 24 unit grid
const ring = '<circle class="g-track" cx="12" cy="12" r="9"/>';
const GLYPHS = {
  progress: ring + '<circle class="g-arc" cx="12" cy="12" r="9" pathLength="100" transform="rotate(-90 12 12)"/>',
  spin: ring + '<g class="g-spin"><circle cx="12" cy="12" r="9" pathLength="100" class="g-arc g-short"/></g>',
  starting: '<circle class="g-dash g-rotate" cx="12" cy="12" r="9" stroke-dasharray="1.4 4.25"/><circle class="g-solid g-pulse" cx="12" cy="12" r="3.2"/>',
  stopping: ring + '<rect class="g-solid g-breathe" x="8.5" y="8.5" width="7" height="7" rx="1.6"/>',
  waiting: ring + '<g class="g-breathe"><line class="g-line" x1="10" y1="9" x2="10" y2="15"/><line class="g-line" x1="14" y1="9" x2="14" y2="15"/></g>',
  needsInput: '<circle class="g-solid g-halo" cx="12" cy="12" r="10"/><circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M12 7.2v6"/><circle class="g-ink" cx="12" cy="16.6" r="1.35"/>',
  overtime: ring + '<path class="g-line" d="M12 7.5V12"/><path class="g-line g-hand" d="M12 12l3.2 1.8"/>',
  warning: '<path class="g-fill" d="M10.3 3.9a2 2 0 0 1 3.4 0l7.7 13.3A2 2 0 0 1 19.7 20H4.3a2 2 0 0 1-1.7-2.8z"/><path class="g-mark" d="M12 9v4.2"/><circle class="g-ink" cx="12" cy="16.6" r="1.3"/>',
  checks: '<circle class="g-dash g-rotate" cx="12" cy="12" r="9" stroke-dasharray="1 3.35"/><path class="g-line" d="M8.2 12.3l2.6 2.5 5-5.4"/>',
  chat: '<path class="g-line" d="M4 11.5c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1.1 0-2.2-.2-3.2-.6L4.5 19.5l1.1-3.4C4.6 14.8 4 13.2 4 11.5z"/><circle class="g-solid g-dot" cx="8.6" cy="11.6" r="1.25"/><circle class="g-solid g-dot" cx="12" cy="11.6" r="1.25"/><circle class="g-solid g-dot" cx="15.4" cy="11.6" r="1.25"/>',
  succeeded: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" pathLength="1" d="M7.6 12.4l3 3 5.8-6.4"/>',
  resolved: '<circle class="g-dash g-thin" cx="12" cy="12" r="11.4" stroke-dasharray="1 2.58"/><circle class="g-fill" cx="12" cy="12" r="8.6"/><path class="g-mark" pathLength="1" d="M8.4 12.3l2.4 2.4 4.8-5.2"/>',
  failed: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/>',
  interrupted: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M12.8 6.6 9 12.6h4.4l-2.4 5"/>',
  exited: ring + '<path class="g-line" d="M7.5 12h8m-3.5-3.5 3.5 3.5-3.5 3.5"/>',
  stopped: '<circle class="g-fill" cx="12" cy="12" r="10"/><rect class="g-ink" x="8.6" y="8.6" width="6.8" height="6.8" rx="1.4"/>',
};

export function setGlyph(box, key, animate) {
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const old = box.querySelector('.g:not([data-leaving])');
  const next = document.createElement('span');
  next.className = 'g';
  next.innerHTML = '<svg viewBox="0 0 24 24">' + GLYPHS[key] + '</svg>';
  box.append(next);
  if (!old) return;
  if (!animate || still()) { old.remove(); return; }
  old.dataset.leaving = '';
  old.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.5) rotate(30deg)', filter: 'blur(4px)' }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
  next.animate([{ opacity: 0, transform: 'scale(.5) rotate(-30deg)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { ...ICON, fill: 'backwards' });
  celebrate(next, key);
}

function celebrate(g, key) {
  const svg = g.querySelector('svg');
  if (key === 'succeeded' || key === 'resolved') {
    svg.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 420, easing: EASE_OUT, delay: 80 });
    g.querySelector('.g-fill').animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 280, easing: EASE_OUT, fill: 'backwards' });
    const mark = g.querySelector('.g-mark');
    mark.style.strokeDasharray = '1';
    mark.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 300, delay: 140, easing: EASE_OUT, fill: 'backwards' });
  } else if (key === 'failed' || key === 'interrupted') {
    g.querySelector('.g-mark').animate([0, -2.5, 2.5, -1.6, 1.6, 0].map(x => ({ transform: 'translateX(' + x + 'px)' })),
      { duration: 460, delay: 120 });
  }
}
