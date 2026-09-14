import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const distRoot = new URL('../../../apps/site/dist/', import.meta.url);

type CssNode = {
  type: string;
  children?: Iterable<CssNode>;
  prelude?: CssNode;
  property?: string;
  value?: CssNode;
  important?: boolean;
};

// css-tree is already a build-tool dependency but does not ship TypeScript
// declarations. Keep this test's small parser boundary typed without a new package.
const cssTree = createRequire(import.meta.url)('css-tree') as {
  parse(source: string): CssNode;
  generate(node: CssNode): string;
  walk(
    ast: CssNode,
    visitor: {
      visit: 'Block';
      enter(this: { rule?: CssNode }, block: CssNode): void;
    },
  ): void;
};

test('emitted backdrop filters retain equivalent WebKit declarations for the CSS target', async () => {
  const files = (await readdir(distRoot, { recursive: true }))
    .filter((file) => file.endsWith('.css'))
    .sort();
  expect(files.length, 'The production build must emit CSS assets').toBeGreaterThan(0);

  let filterCount = 0;
  const coveredSelectors = new Set<string>();
  const missing: Array<{ file: string; selector: string; value: string }> = [];

  for (const file of files) {
    const ast = cssTree.parse(await readFile(new URL(file, distRoot), 'utf8'));
    cssTree.walk(ast, {
      visit: 'Block',
      enter(block) {
        const declarations = [...(block.children ?? [])].filter(
          (node) => node.type === 'Declaration',
        );
        const filters = declarations.filter(
          (node) => node.property?.toLowerCase() === 'backdrop-filter',
        );
        if (filters.length === 0) return;

        const prelude = this.rule?.prelude;
        const selector = prelude ? cssTree.generate(prelude) : '(non-selector block)';
        if (prelude?.type === 'SelectorList') {
          for (const item of prelude.children ?? []) {
            coveredSelectors.add(cssTree.generate(item));
          }
        }

        for (const filter of filters) {
          filterCount += 1;
          if (!filter.value) throw new Error(`Missing backdrop-filter value in ${file}`);
          const value = cssTree.generate(filter.value);
          const equivalentPrefix = declarations.some(
            (node) =>
              node.property?.toLowerCase() === '-webkit-backdrop-filter' &&
              node.value !== undefined &&
              cssTree.generate(node.value) === value &&
              Boolean(node.important) === Boolean(filter.important),
          );
          if (!equivalentPrefix) missing.push({ file, selector, value });
        }
      },
    });
  }

  expect(
    filterCount,
    'The compatibility check must inspect actual backdrop filters',
  ).toBeGreaterThan(0);
  for (const selector of ['.site-header', '.site-search-panel', '.figure-focus-dialog::backdrop']) {
    expect(coveredSelectors, `Built CSS must contain a backdrop-filter for ${selector}`).toContain(
      selector,
    );
  }
  expect(
    missing,
    'Every emitted backdrop-filter needs a same-block WebKit declaration with equal value and importance',
  ).toEqual([]);
});
