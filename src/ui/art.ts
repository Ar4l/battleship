// The home illustration, loaded on demand on wide screens only.
import { capsule, hit, last, miss, setN } from './grid';
import { html } from './h';

/** Static plotted board used as the home illustration on wide screens. */
export const chart = () => {
  setN(10);
  let s = '<svg class="art" viewBox="0 0 10 10"><rect class="art-bg" width="10" height="10"/><path class="art-rule" d="';
  for (let i = 1; i < 10; i++) s += `M${i} 0v10M0 ${i}h10`;
  s += '"/>' + capsule({ anchor: 21, vertical: false }, 4, 'own') + capsule({ anchor: 47, vertical: true }, 3, 'own');
  for (const c of [62, 15, 88, 44, 76, 90, 19]) s += miss(c);
  for (const c of [22, 23, 57]) s += hit(c);
  return html(s + last(57) + '</svg>');
};
