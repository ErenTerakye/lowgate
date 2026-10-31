/** The header both pages share: the project's name, and a link to each page with the current one marked. */
export function siteHeader(current: "replays" | "results"): string {
  const link = (page: typeof current, href: string, text: string) =>
    `<a href="${href}"${page === current ? ' aria-current="page"' : ""}>${text}</a>`;
  return `
    <header class="site-head">
      <div class="wrap">
        <a class="wordmark" href="./">Low Gate</a>
        <nav aria-label="Pages">${link("replays", "./", "Replays")}${link("results", "./results.html", "Benchmark results")}</nav>
      </div>
    </header>`;
}

/** Keeps --head-h on the root equal to the header's height, for anything that sticks just below a pinned header. */
export function trackHeaderHeight(): void {
  const head = document.querySelector<HTMLElement>(".site-head");
  if (!head) return;
  new ResizeObserver(() => document.documentElement.style.setProperty("--head-h", `${head.offsetHeight}px`)).observe(head);
}
