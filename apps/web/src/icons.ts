/** 16px stroke icons, inlined so they inherit `currentColor` and need no requests. */
const svg = (body: string, fill = "none"): string =>
  `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  play: svg(`<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`),
  pause: svg(`<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>`),
  restart: svg(`<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3"/><path d="M3 3.5v4.8h4.8"/>`),
  prev: svg(`<path d="m15 5-7 7 7 7"/>`),
  next: svg(`<path d="m9 5 7 7-7 7"/>`),
  eye: svg(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>`),
  eyeOff: svg(`<path d="M2.5 12S6 5.5 12 5.5c2 0 3.7.7 5.1 1.7M21.5 12s-3.5 6.5-9.5 6.5c-2 0-3.7-.7-5.1-1.7"/><path d="m4 20 16-16"/>`),
  save: svg(`<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19.5h14"/>`),
  dice: svg(
    `<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>`,
  ),
};
