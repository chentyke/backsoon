// motion: springs are sampled into css linear() so waapi and transitions share one curve
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const linearOk = CSS.supports('transition-timing-function', 'linear(0, 1)');
const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
function spring(duration, bounce = 0) {
  const zeta = 1 - bounce, w = 2 * Math.PI / duration;
  const wd = w * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const x = t => zeta < 1 ? 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta * w / wd * Math.sin(wd * t)) :
    1 - Math.exp(-w * t) * (1 + w * t);
  const envelope = t => zeta < 1 ? Math.exp(-zeta * w * t) * Math.hypot(1, zeta * w / wd) : Math.exp(-w * t) * (1 + w * t);
  let end = duration;
  while (envelope(end) > 0.002 && end < duration * 4) end += 0.01;
  if (!linearOk) return { duration: Math.round(duration * 1000), easing: EASE_OUT };
  const steps = Math.max(24, Math.round(end * 64));
  const points = Array.from({ length: steps + 1 }, (_, i) => i === steps ? 1 : +x(end * i / steps).toFixed(4));
  return { duration: Math.round(end * 1000), easing: 'linear(' + points.join(', ') + ')' };
}
const OPEN = spring(.44, .14);
const CLOSE = spring(.36, .04);
const ICON = spring(.55, .32);
const REORDER = spring(.38, .14);
const BAR = spring(.7, .08);
const SLIDE = spring(.34, 0);
document.documentElement.style.setProperty('--bar-ease', BAR.easing);
document.documentElement.style.setProperty('--bar-dur', BAR.duration + 'ms');
const still = () => reduce.matches;
const RISE = [{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }];

function swapText(el, text, animate) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!animate || still() || !el.isConnected || !text) return;
  el.animate([{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { duration: 360, easing: EASE_OUT });
}

function tween(el, to, format) {
  const from = el._value;
  el._value = to;
  cancelAnimationFrame(el._raf);
  if (to == null || from == null || from === to || still()) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = now => {
    const k = Math.min(1, (now - start) / 650);
    el.textContent = format(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// disclosure height glides open and shut
function smoothDetails(details) {
  const summary = details.querySelector('summary');
  summary.addEventListener('click', event => {
    if (still()) return;
    event.preventDefault();
    const opening = details._closing || !details.open;
    const from = details.getBoundingClientRect().height;
    details._motion?.cancel();
    details._closing = !opening;
    details.open = true;
    const to = opening ? details.getBoundingClientRect().height :
      summary.getBoundingClientRect().height + parseFloat(getComputedStyle(details).paddingTop);
    details.style.overflow = 'clip';
    const motion = details._motion = details.animate({ height: [from + 'px', to + 'px'] }, SLIDE);
    if (opening) for (const child of [...details.children].slice(1))
      child.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
    motion.onfinish = () => {
      details.style.overflow = '';
      if (details._closing) { details.open = false; details._closing = false; }
    };
  });
}

export { CLOSE, EASE_OUT, ICON, OPEN, REORDER, RISE, smoothDetails, still, swapText, tween };
