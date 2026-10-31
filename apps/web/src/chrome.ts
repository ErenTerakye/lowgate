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
