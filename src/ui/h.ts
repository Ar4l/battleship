export type Child = Node | string | number | null | undefined | false | Child[];

/**
 * Tiny DOM builder. `attrs` is a class name, or an object where `cls` sets the
 * class, `onX` adds listeners and value/checked/disabled are properties.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: string | Record<string, unknown> | null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(typeof attrs === 'string' ? { cls: attrs } : (attrs ?? {}))) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k === 'cls' ? 'class' : k, v === true ? '' : String(v));
  }
  el.append(...(kids.flat(9).filter((c) => c != null && c !== false) as (Node | string)[]));
  return el;
}

const tpl = document.createElement('template');
/** Parse one element from markup (used for static SVG). */
export const html = (s: string): Element => ((tpl.innerHTML = s), tpl.content.firstElementChild!);
