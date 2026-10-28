let region: HTMLElement | null = null;

export function mountAnnouncer(parent: HTMLElement): void {
  region = document.createElement('div');
  region.className = 'sr-only';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('role', 'status');
  parent.append(region);
}

/** Speak a message via the polite live region. */
export function announce(text: string): void {
  if (!region) return;
  region.textContent = '';
  // A fresh text node after a tick makes screen readers re-read identical messages.
  setTimeout(() => region && (region.textContent = text), 30);
}
