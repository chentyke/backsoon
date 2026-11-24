import { ICON, still } from './motion.js';

// The BackSoon mark is a "back soon" sign hung on a nail. Finishing setup
// hangs it: the sign drops onto the nail and swings to rest, the nail flashes
// and throws confetti in the mark's colors, the return arrow draws itself and
// a check settles on the corner.

const NAIL = { x: 32 / 64, y: 9.6 / 64 };
const PIECES = [
  { className: 'bit-sign', weight: 5 },
  { className: 'bit-nail', weight: 4 },
  { className: 'bit-string', weight: 3 },
  { className: 'bit-done', weight: 2 },
];
const pick = (() => {
  const bag = PIECES.flatMap(piece => Array(piece.weight).fill(piece.className));
  return () => bag[Math.floor(Math.random() * bag.length)];
})();
const between = (low, high) => low + Math.random() * (high - low);

// Dropped at a tilt, the sign catches on the nail and swings out as a damped
// pendulum around it.
function swing(drop, total) {
  const frames = [{ offset: 0, opacity: 0, transform: 'translateY(-22px) rotate(-26deg)', easing: 'cubic-bezier(.5, 0, .9, .6)' }];
  const catchAt = drop / total, steps = 36;
  for (let i = 0; i <= steps; i++) {
    const t = (total - drop) / 1000 * i / steps;
    const angle = -26 * Math.exp(-t / .38) * Math.cos(2 * Math.PI * t / .64);
    frames.push({ offset: catchAt + (1 - catchAt) * i / steps, opacity: 1, transform: `translateY(0px) rotate(${angle.toFixed(2)}deg)` });
  }
  frames.at(-1).transform = 'translateY(0px) rotate(0deg)';
  return frames;
}

function burst(x, y, delay) {
  const layer = Object.assign(document.createElement('div'), { className: 'confetti' });
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  const count = innerWidth < 520 ? 24 : 40, gravity = 750;
  const flights = Array.from({ length: count }, () => {
    const bit = Object.assign(document.createElement('i'), { className: pick() });
    layer.append(bit);
    // A fan thrown up and over the card, so the pieces rain across it
    // rather than off the page's empty margin.
    const angle = between(-112, -8) * Math.PI / 180;
    const speed = between(380, 920), spin = between(-540, 540), life = between(1.3, 2);
    const vx = Math.cos(angle) * speed * 1.4, vy = Math.sin(angle) * speed;
    const frames = Array.from({ length: 13 }, (_, k) => {
      const t = life * k / 12, drag = 1 - Math.exp(-t * 2.2);
      return {
        offset: k / 12,
        opacity: k === 0 ? 0 : k / 12 < .72 ? 1 : 1 - (k / 12 - .72) / .28,
        transform: `translate(${(vx / 2.2 * drag).toFixed(1)}px, ${(vy / 2.2 * drag + gravity * t * t / 2).toFixed(1)}px) ` +
          `rotate(${(spin * t).toFixed(0)}deg) scale(${k ? 1 : .3})`,
      };
    });
    bit.style.left = x + 'px';
    bit.style.top = y + 'px';
    return bit.animate(frames, { duration: life * 1000, delay: delay + between(0, 70), easing: 'linear', fill: 'both' }).finished;
  });
  Promise.allSettled(flights).then(() => layer.remove());
}

export function celebrate(tile) {
  if (still() || !tile.isConnected) return;
  const mark = tile.querySelector('.mark');
  const drop = 300, total = 1900;
  mark.querySelector('.mark-sign').animate(swing(drop, total), { duration: total, fill: 'backwards' });
  mark.querySelector('.mark-nail').animate(
    [{ transform: 'scale(0)' }, { transform: 'scale(1.25)', offset: .55 }, { transform: 'scale(1)' }],
    { duration: drop, easing: 'ease-out', fill: 'backwards' },
  );
  mark.querySelector('.mark-nail').animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: .3 }, { transform: 'scale(1)' }],
    { duration: 420, delay: drop, easing: 'ease-out' },
  );
  mark.querySelector('.mark-glow').animate(
    [{ opacity: .9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(3.4)' }],
    { duration: 620, delay: drop, easing: 'cubic-bezier(.22, 1, .36, 1)' },
  );
  mark.querySelector('.mark-arrow').animate(
    [{ strokeDasharray: '1 2', strokeDashoffset: 1 }, { strokeDasharray: '1 2', strokeDashoffset: 0 }],
    { duration: 560, delay: drop + 260, easing: 'cubic-bezier(.6, 0, .3, 1)', fill: 'backwards' },
  );
  tile.querySelector('.mark-check').animate(
    [{ opacity: 0, transform: 'scale(.3) rotate(-40deg)' }, { opacity: 1, transform: 'none' }],
    { ...ICON, delay: drop + 900, fill: 'backwards' },
  );
  tile.animate([{ transform: 'none' }, { transform: 'scale(.94)', offset: .4 }, { transform: 'none' }],
    { duration: 420, delay: drop, easing: 'ease-out' });
  // The nail never moves, so the confetti can be aimed and queued up front,
  // on the same clock as the rest.
  const box = mark.getBoundingClientRect();
  burst(box.left + box.width * NAIL.x, box.top + box.height * NAIL.y, drop);
}
