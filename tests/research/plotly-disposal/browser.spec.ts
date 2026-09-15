import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const articlePath = '/en/blog/frenet-arc-length-conversion/';
const explorerSelector = '[data-frenet-explorer="phi"]';
type Method = 'newPlot' | 'react' | 'restyle' | 'relayout';
type Role = 'main' | 'geometry';
type Rule = { method: Method; role: Role; action: 'hold' | 'reject' | 'throw' };
type Entry = {
  method: Method | 'purge';
  role: Role;
  phase: 'start' | 'native-settled' | 'held' | 'delivered' | 'rejected' | 'purge';
  pending: number;
  connected: boolean;
};
type Report = {
  connected: boolean;
  pending: number;
  errors: string[];
  entries: Entry[];
  plots: Array<{ role: Role; containers: number; layout: boolean }>;
  state: { busy: string | null; error: string; interactive: string | undefined };
};
type Probe = {
  arm(owner: number, rules: Rule[]): void;
  release(owner: number, fail?: boolean): void;
  report(owner: number): Report | undefined;
};

declare global {
  interface Window {
    __plotlyDisposal: Probe;
  }
}

async function installProbe(page: Page, initialRules: Rule[] = []) {
  await page.addInitScript(
    ({ selector, rules }) => {
      type Plot = HTMLElement & { _fullLayout?: unknown };
      type Api = Record<Method, (plot: Plot, ...args: unknown[]) => unknown> & {
        purge(plot: Plot): unknown;
      };
      type Owner = {
        root: HTMLElement;
        status: HTMLElement | null;
        plots: Record<Role, Plot>;
        pending: number;
        entries: Entry[];
        rules: Rule[];
        releases: Array<(fail: boolean) => void>;
      };
      const errors: string[] = [];
      window.addEventListener('error', (event) => errors.push(event.message));
      window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
      const owners: Owner[] = [];
      const byRoot = new WeakMap<HTMLElement, Owner>();
      const ownerFor = (plot: Plot) => {
        const root = plot.closest<HTMLElement>(selector);
        if (!root) return undefined;
        const existing = byRoot.get(root);
        if (existing) return existing;
        // Other islands on this article remain real, but are outside this probe.
        if (root !== document.querySelector(selector)) return undefined;
        const owner: Owner = {
          root,
          status:
            root
              .closest('[data-figure-focus]')
              ?.querySelector<HTMLElement>('interactive-figure-status') ?? null,
          plots: {
            main: root.querySelector<Plot>('.frenet-main-plot')!,
            geometry: root.querySelector<Plot>('.frenet-geometry-plot')!,
          },
          pending: 0,
          entries: [],
          rules: owners.length === 0 ? [...rules] : [],
          releases: [],
        };
        owners.push(owner);
        byRoot.set(root, owner);
        return owner;
      };
      window.__plotlyDisposal = {
        arm(id, nextRules) {
          const owner = owners[id - 1];
          if (!owner || owner.pending) throw new Error('Arm only an idle, initialized owner.');
          owner.rules = [...nextRules];
        },
        release(id, fail = false) {
          const owner = owners[id - 1];
          if (!owner?.releases.length) throw new Error('No held Plotly result to release.');
          owner.releases.splice(0).forEach((release) => release(fail));
        },
        report(id) {
          const owner = owners[id - 1];
          if (!owner) return undefined;
          return {
            connected: owner.root.isConnected,
            pending: owner.pending,
            errors,
            entries: owner.entries,
            plots: (['main', 'geometry'] as const).map((role) => ({
              role,
              containers: owner.plots[role].querySelectorAll('.plot-container').length,
              layout: Boolean(owner.plots[role]._fullLayout),
            })),
            state: {
              busy:
                owner.root.querySelector('.frenet-plot-shell')?.getAttribute('aria-busy') ?? null,
              error: owner.root.querySelector('.frenet-plot-error')?.textContent ?? '',
              interactive: owner.status?.dataset.state,
            },
          };
        },
      };

      let installed: Api | undefined;
      // The installed Plotly distribution publishes this same object before its
      // module export returns. No module download or native drawing is delayed.
      Object.defineProperty(window, 'Plotly', {
        configurable: true,
        get: () => installed,
        set(api: Api) {
          if (installed === api) return;
          installed = api;
          for (const method of ['newPlot', 'react', 'restyle', 'relayout'] as const) {
            const original = api[method];
            api[method] = function (plot, ...args) {
              const owner = ownerFor(plot);
              if (!owner) return original.call(api, plot, ...args);
              const role = plot === owner.plots.main ? 'main' : 'geometry';
              const note = (phase: Entry['phase']) =>
                owner.entries.push({
                  method,
                  role,
                  phase,
                  pending: owner.pending,
                  connected: plot.isConnected,
                });
              const index = owner.rules.findIndex(
                (rule) => rule.method === method && rule.role === role,
              );
              const rule = index < 0 ? undefined : owner.rules.splice(index, 1)[0];
              owner.pending++;
              note('start');
              if (rule?.action === 'throw') {
                owner.pending--;
                note('rejected');
                throw new Error('Controlled synchronous Plotly failure.');
              }
              let result: unknown;
              try {
                result = original.call(api, plot, ...args);
              } catch (error) {
                owner.pending--;
                note('rejected');
                throw error;
              }
              return Promise.resolve(result)
                .then(async (value) => {
                  note('native-settled');
                  if (rule?.action === 'hold') {
                    note('held');
                    await new Promise<void>((resolve, reject) =>
                      owner.releases.push((fail) =>
                        fail ? reject(new Error('Controlled late Plotly rejection.')) : resolve(),
                      ),
                    );
                  }
                  if (rule?.action === 'reject')
                    throw new Error('Controlled rejection after real Plotly drawing.');
                  return value;
                })
                .then(
                  (value) => {
                    owner.pending--;
                    note('delivered');
                    return value;
                  },
                  (error: unknown) => {
                    owner.pending--;
                    note('rejected');
                    throw error;
                  },
                );
            };
          }
          const purge = api.purge;
          api.purge = (plot) => {
            const owner = ownerFor(plot);
            if (owner)
              owner.entries.push({
                method: 'purge',
                role: plot === owner.plots.main ? 'main' : 'geometry',
                phase: 'purge',
                pending: owner.pending,
                connected: plot.isConnected,
              });
            return purge.call(api, plot);
          };
        },
      });
    },
    { selector: explorerSelector, rules: initialRules },
  );
}

async function report(page: Page, owner = 1) {
  const value = await page.evaluate((id) => window.__plotlyDisposal.report(id), owner);
  if (!value) throw new Error(`Plotly owner ${owner} has not been observed.`);
  return value;
}

async function openExplorer(page: Page) {
  await page.goto(articlePath);
  const explorer = page.locator(explorerSelector).first();
  await explorer.scrollIntoViewIfNeeded();
  return explorer;
}

async function ready(page: Page, owner = 1) {
  const explorer = page.locator(explorerSelector).first();
  await expect(explorer.locator('.frenet-plot-shell')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30_000,
  });
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible();
  await expect(explorer.locator('.frenet-geometry-plot .plot-container')).toBeVisible();
  // Let the initial ResizeObserver delivery run before arming an update rule.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect.poll(async () => (await report(page, owner)).pending).toBe(0);
}

async function held(page: Page, method: Method, role: Role) {
  await expect
    .poll(() => page.evaluate(() => window.__plotlyDisposal.report(1)?.entries ?? []), {
      timeout: 30_000,
    })
    .toContainEqual(expect.objectContaining({ method, role, phase: 'held' }));
  const state = await report(page);
  expect(state.plots.find((plot) => plot.role === role)?.containers).toBeGreaterThan(0);
  expect(
    state.entries.some(
      (entry) => entry.method === method && entry.role === role && entry.phase === 'native-settled',
    ),
  ).toBe(true);
}

async function leave(page: Page) {
  await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator(explorerSelector)).toHaveCount(0);
}

async function expectDisposed(page: Page, owner = 1) {
  await expect
    .poll(async () =>
      (await report(page, owner)).plots.every((plot) => !plot.layout && plot.containers === 0),
    )
    .toBe(true);
  const state = await report(page, owner);
  expect(state.errors).toEqual([]);
  const purges = state.entries.filter((entry) => entry.phase === 'purge');
  expect(purges.length).toBeGreaterThan(0);
  expect(purges.every((entry) => entry.pending === 0)).toBe(true);
  for (const role of ['main', 'geometry'] as const) {
    if (state.entries.some((entry) => entry.method === 'newPlot' && entry.role === role)) {
      expect(purges.filter((entry) => entry.role === role)).toHaveLength(1);
    }
  }
}

for (const role of ['main', 'geometry'] as const) {
  test(`leaving while the ${role} creation result is held stops initialization and disposes its plots`, async ({
    page,
  }) => {
    await installProbe(page, [{ method: 'newPlot', role, action: 'hold' }]);
    await openExplorer(page);
    await held(page, 'newPlot', role);
    await leave(page);
    const beforeRelease = await report(page);
    expect(beforeRelease.connected).toBe(false);
    expect(beforeRelease.entries.filter((entry) => entry.phase === 'purge')).toEqual([]);
    await page.evaluate(() => window.__plotlyDisposal.release(1));
    await expectDisposed(page);
    const disposed = await report(page);
    expect(disposed.entries.filter((entry) => entry.phase === 'start')).toEqual(
      beforeRelease.entries.filter((entry) => entry.phase === 'start'),
    );
    expect(disposed.state).toEqual(beforeRelease.state);
  });
}

test('a rejected geometry creation cleans both partially created plots without announcing readiness', async ({
  page,
}) => {
  await installProbe(page, [{ method: 'newPlot', role: 'geometry', action: 'reject' }]);
  const explorer = await openExplorer(page);
  await expect(explorer.locator('.frenet-plot-error')).toContainText('Controlled rejection', {
    timeout: 30_000,
  });
  await expectDisposed(page);
  const failed = await report(page);
  expect(
    failed.entries.filter(
      (entry) => entry.method === 'newPlot' && entry.phase === 'native-settled',
    ),
  ).toHaveLength(2);
  expect(failed.state.interactive).toBe('error');
  await leave(page);
  await expectDisposed(page);
});

const updates: Array<{ name: string; heldMethod: Method; heldRole: Role; rules: Rule[] }> = [
  {
    name: 'react rejection while the other figure is pending',
    heldMethod: 'react',
    heldRole: 'geometry',
    rules: [
      { method: 'react', role: 'main', action: 'reject' },
      { method: 'react', role: 'geometry', action: 'hold' },
    ],
  },
  {
    name: 'restyle rejection delivered after leaving',
    heldMethod: 'restyle',
    heldRole: 'geometry',
    rules: [{ method: 'restyle', role: 'geometry', action: 'hold' }],
  },
  {
    name: 'second relayout throwing synchronously while the first is pending',
    heldMethod: 'relayout',
    heldRole: 'main',
    rules: [
      { method: 'relayout', role: 'main', action: 'hold' },
      { method: 'relayout', role: 'geometry', action: 'throw' },
    ],
  },
];

for (const scenario of updates) {
  test(`${scenario.name} cannot purge early or touch the next page's plots`, async ({ page }) => {
    await installProbe(page);
    const explorer = await openExplorer(page);
    await ready(page);
    await page.evaluate((rules) => window.__plotlyDisposal.arm(1, rules), scenario.rules);
    if (scenario.heldMethod === 'react') await explorer.locator('.frenet-reset').click();
    else if (scenario.heldMethod === 'restyle') {
      await explorer.locator('[data-frenet-control="d"] [role="slider"]').press('ArrowRight');
    } else {
      // Both 1280px and wider viewports hit the article's max-width. Shrink it
      // enough to change the plot panels and trigger their ResizeObserver.
      await page.setViewportSize({ width: 1000, height: 900 });
    }
    await held(page, scenario.heldMethod, scenario.heldRole);
    if (scenario.rules.some((rule) => rule.action !== 'hold')) {
      await expect
        .poll(async () => (await report(page)).entries.some((entry) => entry.phase === 'rejected'))
        .toBe(true);
    }
    await leave(page);
    const beforeRelease = await report(page);
    expect(beforeRelease.connected).toBe(false);
    expect(beforeRelease.entries.filter((entry) => entry.phase === 'purge')).toEqual([]);

    await page.goBack();
    await page.locator(explorerSelector).first().scrollIntoViewIfNeeded();
    await ready(page, 2);
    await page.evaluate(
      (fail) => window.__plotlyDisposal.release(1, fail),
      scenario.heldMethod === 'restyle',
    );
    await expectDisposed(page);
    const disposed = await report(page);
    expect(disposed.entries.filter((entry) => entry.phase === 'start')).toEqual(
      beforeRelease.entries.filter((entry) => entry.phase === 'start'),
    );
    expect(disposed.state).toEqual(beforeRelease.state);
    expect((await report(page, 2)).entries.filter((entry) => entry.phase === 'purge')).toEqual([]);
    await ready(page, 2);
    await leave(page);
    await expectDisposed(page, 2);
  });
}
