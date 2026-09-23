function httpUrl(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials or a fragment.`);
  }
  return url;
}

function collections(inventory, label) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new Error(`${label} inventory must be an object.`);
  }
  if (typeof inventory.buildId !== 'string' || !inventory.buildId.trim()) {
    throw new Error(`${label} inventory is missing buildId.`);
  }
  if (inventory.mode !== 'production') {
    throw new Error(`${label} inventory must have mode production.`);
  }
  const site = httpUrl(inventory.site, `${label} site`);
  if (site.pathname !== '/' || site.search) throw new Error(`${label} site must be an origin.`);
  const maps = {};
  for (const name of ['pages', 'resources']) {
    if (!Array.isArray(inventory[name])) {
      throw new Error(`${label} inventory is missing the ${name} array.`);
    }
    const entries = new Map();
    for (const item of inventory[name]) {
      const url = httpUrl(item?.url, `${label} ${name} URL`);
      if (entries.has(item.url)) throw new Error(`${label} has duplicate ${name} URL: ${item.url}`);
      if (name === 'pages') {
        if (url.origin !== site.origin || typeof item.title !== 'string') {
          throw new Error(`${label} page must have a local URL and a title: ${item.url}`);
        }
      } else if (
        typeof item.type !== 'string' ||
        !item.type ||
        typeof item.external !== 'boolean' ||
        item.external !== (url.origin !== site.origin)
      ) {
        throw new Error(`${label} resource has an invalid type or external flag: ${item.url}`);
      }
      entries.set(item.url, item);
    }
    maps[name] = entries;
  }
  for (const url of maps.pages.keys()) {
    if (maps.resources.get(url)?.type !== 'html') {
      throw new Error(`${label} page is missing its HTML resource: ${url}`);
    }
  }
  // Each inventory includes page HTML in resources; report those URLs only as pages.
  maps.resources = new Map([...maps.resources].filter(([url]) => !maps.pages.has(url)));
  return { ...maps, origin: site.origin };
}

function difference(left, right) {
  return [...left.keys()]
    .filter((url) => !right.has(url))
    .sort()
    .map((url) => ({ ...left.get(url) }));
}

/** Validate both production snapshots and compare full URLs, without changing either input. */
export function compareInventories(before, after) {
  const previous = collections(before, 'Before');
  const current = collections(after, 'After');
  if (previous.origin !== current.origin) {
    throw new Error('Before and after inventories must describe the same site.');
  }
  return {
    site: current.origin,
    before: {
      buildId: before.buildId,
      pages: previous.pages.size,
      resources: previous.resources.size,
    },
    after: { buildId: after.buildId, pages: current.pages.size, resources: current.resources.size },
    pages: {
      added: difference(current.pages, previous.pages),
      removed: difference(previous.pages, current.pages),
    },
    resources: {
      added: difference(current.resources, previous.resources),
      removed: difference(previous.resources, current.resources),
    },
  };
}

function text(value) {
  return String(value)
    .replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])
    .replace(/[\\`*_[\]|]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
}

function link(url) {
  const target = url.replace(/[<>|\s]/g, (character) => encodeURIComponent(character));
  return `[${text(url)}](<${target}>)`;
}

export function renderInventoryDiffMarkdown(report, { limit = Infinity } = {}) {
  const output = [
    '### Production inventory changes',
    `Site: ${link(report.site)}  \nBefore: ${text(report.before.buildId)}  \nAfter: ${text(report.after.buildId)}`,
    '| Kind | Before | After | Added | Removed |\n| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const [name, label] of [
    ['pages', 'Pages'],
    ['resources', 'Resources'],
  ]) {
    output[2] += `\n| ${label} | ${report.before[name]} | ${report.after[name]} | ${report[name].added.length} | ${report[name].removed.length} |`;
  }
  output.push(
    'Compared by full URL, including query parameters. Resources exclude page URLs. Content changes at the same URL are not counted.',
  );
  for (const [name, label] of [
    ['pages', 'pages'],
    ['resources', 'resources'],
  ]) {
    for (const [change, verb] of [
      ['added', 'Added'],
      ['removed', 'Removed'],
    ]) {
      const entries = report[name][change];
      const rows = entries.slice(0, limit).map((item) => {
        const description = name === 'pages' ? item.title : item.type;
        return `- ${link(item.url)} — ${text(description)}${item.external ? ' (external)' : ''}`;
      });
      if (rows.length < entries.length) {
        rows.push(
          `\nShowing ${rows.length} of ${entries.length}; download diff.md for the complete list.`,
        );
      }
      output.push(
        `<details>\n<summary>${verb} ${label} (${entries.length})</summary>\n\n${rows.join('\n') || 'None.'}\n\n</details>`,
      );
    }
  }
  return output.join('\n\n') + '\n';
}

/** Leave room below GitHub's 1 MiB per-step limit; the artifact always has the full report. */
export function renderInventoryDiffSummary(report) {
  let limit = Math.max(
    report.pages.added.length,
    report.pages.removed.length,
    report.resources.added.length,
    report.resources.removed.length,
  );
  while (true) {
    const markdown = renderInventoryDiffMarkdown(report, { limit });
    if (Buffer.byteLength(markdown) <= 900 * 1024) return markdown;
    if (!limit)
      return '### Production inventory changes\n\nReport exceeds the summary limit; download diff.md for the complete report.\n';
    limit = Math.floor(limit / 2);
  }
}
