const PATHS = {
  arrow: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  chevron: '<path d="m8 5 7 7-7 7"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.7 8.3-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/>',
  mountain: '<path d="m3 19 6.2-9 3.1 4.1 2.3-3.2L21 19"/><path d="M8 19h13"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.3 3-5 7-5s6.3 1.7 7 5"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  play: '<path d="m9 6 9 6-9 6V6Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
};

export function icon(name, label = "", className = "") {
  const path = PATHS[name] ?? PATHS.spark;
  const title = label ? `<title>${label}</title>` : "";
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${label ? "false" : "true"}">${title}${path}</svg>`;
}

export function mark(gua, className = "") {
  return `<span class="gua-mark ${className}" aria-hidden="true">${gua}</span>`;
}
