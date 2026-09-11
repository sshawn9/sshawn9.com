function escapeHtml(value) {
  return String(value).replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character],
  );
}

function text(value) {
  return escapeHtml(value)
    .replace(/[\\`*_[\]|]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}

function link(label, target) {
  const href = target.replace(/[<>|\s]/g, (character) => encodeURIComponent(character));
  return `[${text(label)}](<${href}>)`;
}

function size(bytes) {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function totalSize(totals, key) {
  const unknown = totals.unknownResources ? ` + ${totals.unknownResources} unknown` : '';
  return size(totals[key]) + unknown;
}

function sizeSummary(totals) {
  return `${totals.files} unique local files · Local size total: ${totalSize(totals, 'knownBytes')} · Brotli size total (local): ${totalSize(totals, 'knownBrotliBytes')}`;
}

function relationships(relations, reference) {
  return relations.length ? relations.map((url) => `- ${reference(url)}`).join('\n') : 'None.';
}

function details(id, label, body) {
  return `<a id="${id}"></a>\n\n<details>\n<summary>${escapeHtml(label)}</summary>\n\n${body}\n\n</details>`;
}

/** Render the same inventory as navigable Markdown; never re-analyze or mutate it. */
export function renderInventoryMarkdown(report) {
  const origin = new URL(report.site).origin;
  const displayUrl = (value) => {
    const url = new URL(value);
    return url.origin === origin ? url.pathname + url.search : value;
  };
  const pageIds = new Map(report.pages.map((page, index) => [page.url, `page-${index}`]));
  const resourceIds = new Map(
    report.resources.map((resource, index) => [resource.url, `resource-${index}`]),
  );
  const pageLink = (url) => link(displayUrl(url), `#${pageIds.get(url)}`);
  const resourceLink = (url) => link(displayUrl(url), `#${resourceIds.get(url)}`);
  const errors = report.diagnostics.filter((item) => item.level === 'error').length;
  const external = report.resources.filter((resource) => resource.external).length;
  const output = [
    '# Resource inventory',
    `Build: ${text(report.buildId)}  \nMode: ${text(report.mode)}  \nSite: ${link(report.site, report.site)}`,
    `Pages: ${report.pages.length} · Resource URLs: ${report.resources.length} (${external} external) · Errors: ${errors} · Warnings: ${report.diagnostics.length - errors}`,
    `All resources, including unreferenced files: ${sizeSummary(report.sizeTotals)}`,
    '[Pages](#pages) · [Resources](#resources) · [Page resources](#page-resources) · [Resource pages](#resource-pages) · [Diagnostics](#diagnostics)',
    `${text(report.scope)}\n\nAssociated resources include in-page interactions and image variants. These are dependencies, not cache measurements.`,
    `Brotli size (local) uses Node's default settings: quality ${report.compression.quality}, window ${report.compression.window}, ${text(report.compression.mode)} mode. Each file is compressed separately for these extensions: ${report.compression.extensions.map(text).join(', ')}. Other file types retain their original size. These are local calculations, not measured CDN transfer sizes.`,
    'Totals count each physical local file once, even when several URLs reference it. Unknown sizes are shown separately as "+ N unknown", not counted as zero. Page totals include the page HTML and its associated resources; adding page totals would double-count shared files.',
    '## Limitations',
    report.limitations.map((limitation) => `- ${text(limitation)}`).join('\n'),
    '## Diagnostics',
    report.diagnostics.length
      ? '| Level | Source | Message |\n| --- | --- | --- |\n' +
        report.diagnostics
          .map(
            (item) =>
              `| ${text(item.level)} | ${link(displayUrl(item.url), item.url)} | ${text(item.message)} |`,
          )
          .join('\n')
      : 'None.',
    '## Pages',
    'Follow a page title to its expandable dependency list. Page URLs open the actual website.',
    '| Page | URL | Referenced resources | Local size total | Brotli size total (local) |\n| --- | --- | ---: | ---: | ---: |\n' +
      report.pages
        .map((page) => {
          const relations = report.pageResources[page.url];
          const totals = report.pageSizeTotals[page.url];
          return `| ${link(page.title || displayUrl(page.url), `#${pageIds.get(page.url)}`)} | ${link(displayUrl(page.url), page.url)} | ${relations.length} | ${totalSize(totals, 'knownBytes')} | ${totalSize(totals, 'knownBrotliBytes')} |`;
        })
        .join('\n'),
    '## Resources',
    'Sorted by page reference count. Local size is the stored file size; Brotli size follows the local calculation policy above. Resources with no references are not necessarily unused.',
  ];
  const resources = report.resources.toSorted((a, b) => {
    const left = report.resourcePages[a.url];
    const right = report.resourcePages[b.url];
    return right.length - left.length || a.url.localeCompare(b.url);
  });
  output.push(
    '| Resource | Type | Local size | Brotli size (local) | Location | Referenced pages |\n| --- | --- | ---: | ---: | --- | ---: |\n' +
      resources
        .map((resource) => {
          const relations = report.resourcePages[resource.url];
          const location = resource.external
            ? 'External'
            : resource.file === null
              ? 'Missing local file'
              : 'Local';
          return `| ${resourceLink(resource.url)} | ${text(resource.type)} | ${size(resource.bytes)} | ${size(resource.brotliBytes)} | ${location} | ${relations.length} |`;
        })
        .join('\n'),
    '## Page resources',
    'Expand a page to inspect its dependencies. Resource links jump to their reverse lookup below.',
  );
  for (const page of report.pages) {
    const relations = report.pageResources[page.url];
    output.push(
      details(
        pageIds.get(page.url),
        `${displayUrl(page.url)} — ${relations.length} resources`,
        `${text(page.title)}\n\n${link(displayUrl(page.url), page.url)}\n\n${sizeSummary(report.pageSizeTotals[page.url])}\n\n${relationships(relations, resourceLink)}`,
      ),
    );
  }
  output.push(
    '## Resource pages',
    'Expand a resource to see its page references. Page links jump back to the corresponding dependency list.',
  );
  for (const resource of resources) {
    const relations = report.resourcePages[resource.url];
    output.push(
      details(
        resourceIds.get(resource.url),
        `${displayUrl(resource.url)} — ${relations.length} pages`,
        `${link(displayUrl(resource.url), resource.url)} · Local size: ${size(resource.bytes)} · Brotli size (local): ${size(resource.brotliBytes)}\n\n${relationships(relations, pageLink)}`,
      ),
    );
  }
  return output.join('\n\n') + '\n';
}
