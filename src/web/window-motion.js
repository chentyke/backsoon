import { CLOSE, EASE_OUT, OPEN, RISE, still } from './motion.js';

export function bindWindowMotion(dialog, onClose) {
  const sheet = dialog.querySelector('.sheet');
  const surface = dialog.querySelector('.surface');
  const shade = surface.querySelector('.shade');
  const scrim = dialog.querySelector('.scrim');

  let motions = [], closing = false;
  let origin = null;
  const ROW_RADIUS = 16;
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const frame = (r, radius) => ({ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', borderRadius: radius + 'px' });
  const clip = (r, to, radius) => 'inset(' + (r.y - to.y) + 'px ' + (to.x + to.w - r.x - r.w) + 'px ' +
    (to.y + to.h - r.y - r.h) + 'px ' + (r.x - to.x) + 'px round ' + radius + 'px)';
  const sheetRadius = () => parseFloat(getComputedStyle(sheet).borderTopLeftRadius) || 28;
  const onScreen = r => r.h > 0 && r.y + r.h > 0 && r.y < innerHeight && r.x + r.w > 0 && r.x < innerWidth;

  function ghostOf(row) {
    surface.querySelector('.card')?.remove();
    const ghost = row.cloneNode(true);
    ghost.removeAttribute('data-lifted');
    ghost.style.width = row.offsetWidth + 'px';
    ghost.style.height = row.offsetHeight + 'px';
    for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
    // the copy is decoration, so it must not answer queries meant for the window
    ghost.querySelector('.status').className = 'label';
    surface.append(ghost);
    return ghost;
  }

  function stopMotions() {
    for (const motion of motions) motion.cancel();
    motions = [];
  }

  function settle(list, done) {
    motions = list;
    Promise.all(list.map(motion => motion.finished)).then(() => { if (motions === list) done(); }, () => {});
  }

  function openWindow(row) {
    origin = row;
    stopMotions();
    closing = false;
    dialog.showModal();
    sheet.querySelector('.dialog-body').scrollTop = 0;
    row.toggleAttribute('data-lifted', true);
    if (still()) return;
    const from = box(row), to = box(sheet), radius = sheetRadius();
    const rise = [...dialog.querySelectorAll('[data-rise]')].map((el, i) =>
      el.animate(RISE, { duration: 480, easing: EASE_OUT, delay: 24 + i * 26, fill: 'backwards' }));
    if (!onScreen(from)) {
      settle([sheet.animate([{ opacity: 0, transform: 'translateY(16px) scale(.96)' }, { opacity: 1, transform: 'none' }], OPEN),
        scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }), ...rise], () => {});
      return;
    }
    dialog.dataset.phase = 'morph';
    const ghost = ghostOf(row);
    settle([
      surface.animate([frame(from, ROW_RADIUS), frame(to, radius)], { ...OPEN, fill: 'both' }),
      sheet.animate([{ clipPath: clip(from, to, ROW_RADIUS) }, { clipPath: 'inset(0px 0px 0px 0px round ' + radius + 'px)' }], { ...OPEN, fill: 'both' }),
      ghost.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(3px)' }], { duration: 200, easing: 'ease-out', fill: 'both' }),
      shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN.duration * .7, easing: 'ease-out', fill: 'both' }),
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN.duration * .7, easing: 'ease-out', fill: 'both' }),
      ...rise,
    ], () => { stopMotions(); delete dialog.dataset.phase; ghost.remove(); });
  }

  function finishClose() {
    stopMotions();
    const row = origin;
    const trigger = row?.querySelector('button');
    row?.removeAttribute('data-lifted');
    surface.querySelector('.card')?.remove();
    delete dialog.dataset.phase;
    origin = null;
    if (dialog.open) dialog.close();
    closing = false;
    onClose();
    trigger?.focus({ preventScroll: true });
  }

  function dismiss() {
    if (closing || !dialog.open) return;
    closing = true;
    if (still()) { finishClose(); return; }
    const row = origin;
    const to = box(sheet), radius = sheetRadius();
    // pick up from wherever an unfinished opening left things
    const morphing = dialog.dataset.phase === 'morph';
    const css = getComputedStyle(surface), sheetCss = getComputedStyle(sheet);
    const current = morphing ? { left: css.left, top: css.top, width: css.width, height: css.height, borderRadius: css.borderTopLeftRadius } : frame(to, radius);
    const currentClip = morphing ? sheetCss.clipPath : 'inset(0px 0px 0px 0px round ' + radius + 'px)';
    const opacity = { sheet: +sheetCss.opacity, scrim: +getComputedStyle(scrim).opacity, shade: morphing ? +getComputedStyle(shade).opacity : 1 };
    stopMotions();
    const target = row && box(row);
    if (!target || !onScreen(target)) {
      settle([sheet.animate([{ opacity: opacity.sheet }, { opacity: 0, transform: 'translateY(12px) scale(.96)' }], { duration: 200, easing: 'ease-in', fill: 'both' }),
        scrim.animate([{ opacity: opacity.scrim }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'both' })], finishClose);
      return;
    }
    dialog.dataset.phase = 'morph';
    const ghost = ghostOf(row);
    settle([
      surface.animate([current, frame(target, ROW_RADIUS)], { ...CLOSE, fill: 'both' }),
      sheet.animate([{ clipPath: currentClip }, { clipPath: clip(target, to, ROW_RADIUS) }], { ...CLOSE, fill: 'both' }),
      sheet.animate([{ opacity: opacity.sheet }, { opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'both' }),
      ghost.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 200, delay: CLOSE.duration * .3, easing: 'ease-out', fill: 'both' }),
      shade.animate([{ opacity: opacity.shade }, { opacity: 0 }], { duration: CLOSE.duration * .8, easing: 'ease-out', fill: 'both' }),
      scrim.animate([{ opacity: opacity.scrim }, { opacity: 0 }], { duration: CLOSE.duration * .85, easing: 'ease-out', fill: 'both' }),
    ], finishClose);
  }

  sheet.querySelector('#dismiss').onclick = dismiss;
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => { if (!sheet.contains(event.target)) dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open && origin) { closing = true; finishClose(); } });
  addEventListener('resize', () => {
    if (dialog.dataset.phase !== 'morph' || closing) return;
    stopMotions();
    delete dialog.dataset.phase;
    surface.querySelector('.card')?.remove();
  });

  return { open: openWindow, close: finishClose, get closing() { return closing; } };
}
