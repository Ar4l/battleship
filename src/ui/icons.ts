import { svg } from './h';

const PATHS = {
  copy: 'M8 8h11v11H8zM5 16V5h11',
  share: 'M12 15V3M7 8l5-5 5 5M5 12v8h14v-8',
  rotate: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  soundOn: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  check: 'M4 12.5l5 5L20 6.5',
  dice: 'M4 4h16v16H4zM9 9h.01M15 15h.01M15 9h.01M9 15h.01',
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName): SVGElement =>
  svg(
    'svg',
    { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'icon', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'square' },
    svg('path', { d: PATHS[name] }),
  );
