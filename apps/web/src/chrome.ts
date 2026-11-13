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

const WRITE_UP = "https://erenterakye.com/blog/landing-a-spacecraft-with-decision-models/";
const SOURCE = "https://github.com/ErenTerakye/lowgate";

/** The footer both pages share: the pages again, where the project lives, who built it, and what the figures come from. */
export function siteFooter(bench: { readonly engine: string; readonly courses: readonly number[]; readonly at: string }): string {
  // The newest recording's date, not the rebuild's: results.json is a pure function of the recordings.
  const flown = new Date(bench.at).toLocaleDateString("en-GB", { dateStyle: "medium" });
  return `
    <footer class="site-foot">
      <div class="wrap">
        <nav aria-label="More">
          <a href="./">Replays</a>
          <a href="./results.html">Benchmark results</a>
          <a href="${WRITE_UP}">Write-up</a>
          <a href="${SOURCE}">Source on GitHub</a>
          <a href="${SOURCE}/blob/main/LICENSE">MIT licence</a>
        </nav>
        <p class="credit">Built by <a href="https://erenterakye.com">Eren Terakye</a></p>
        <p class="provenance">Engine ${bench.engine} · courses ${bench.courses[0]}–${bench.courses.at(-1)} · last course flown ${flown}. Every course is recorded and replays to its saved state hashes.</p>
      </div>
    </footer>`;
}
