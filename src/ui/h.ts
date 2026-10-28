export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null;

function apply(el: Element, attrs: Attrs): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k === 'cls' ? 'class' : k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Tiny DOM builder. `cls` sets class, `onX` adds listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs ?? null);
  append(el, children);
  return el;
}

export function svg(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(el, attrs ?? null);
  append(el, children);
  return el;
}

export const clear = (el: Element): void => el.replaceChildren();
