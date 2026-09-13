import { expect, test, type Page } from '@playwright/test';

type WorkerProbe = {
  methods: Array<{ method: string; instanceId: string; query?: string }>;
  terminated: number;
};

async function observeIndexes(page: Page) {
  await page.addInitScript(() => {
    const probe: WorkerProbe = { methods: [], terminated: 0 };
    Object.assign(window, { searchIndexProbe: probe });
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (['init', 'destroy', 'search'].includes(message?.method)) {
        probe.methods.push({
          method: message.method,
          instanceId: message.instanceId,
          query: message.args?.[0],
        });
      }
      return Reflect.apply(send, this, [message, ...rest]);
    };
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      probe.terminated++;
      return terminate.call(this);
    };
  });
}
const readProbe = (page: Page) =>
  page.evaluate(
    () => (window as unknown as Window & { searchIndexProbe: WorkerProbe }).searchIndexProbe,
  );
const resultLinks = (page: Page) => page.locator('.site-search-result__link');
async function leaveSearch(page: Page) {
  await page.locator('a.site-header__nav-link[href="/en/about/"]').click();
  await expect(page.locator('.about-page')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
}

test('typing before the engine loads cannot attach an empty response to the new query', async ({
  page,
}) => {
  await observeIndexes(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/pagefind/pagefind.js', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/en/search/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
    await page.locator('[data-search-input]').fill('website');
    await page.waitForTimeout(450);
    release();
    await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'website');
    await expect(resultLinks(page).first()).toBeVisible();
    const links = await resultLinks(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
    expect(
      (await readProbe(page)).methods
        .filter((row) => row.method === 'search')
        .map((row) => row.query),
    ).toEqual(['website']);
    await page.reload();
    await expect(resultLinks(page)).toHaveCount(links.length);
    expect(
      await resultLinks(page).evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('href')),
      ),
    ).toEqual(links);
  } finally {
    release();
  }
});

test('each client-side search visit releases its index without breaking the next visit', async ({
  page,
}) => {
  await observeIndexes(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/search/?q=website');
  for (let visit = 1; visit <= 4; visit++) {
    await expect(resultLinks(page).first()).toBeVisible();
    await leaveSearch(page);
    await expect.poll(async () => (await readProbe(page)).terminated).toBe(visit);
    const methods = (await readProbe(page)).methods;
    expect(methods.filter((row) => row.method === 'destroy').map((row) => row.instanceId)).toEqual(
      methods.filter((row) => row.method === 'init').map((row) => row.instanceId),
    );
    if (visit < 4) await page.goBack();
  }
  expect(errors).toEqual([]);
});

for (const resource of ['pagefind.js', 'pagefind-worker.js']) {
  test(`leaving while ${resource} loads cannot retain an index or destroy the next visit`, async ({
    page,
  }) => {
    await observeIndexes(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let release!: () => void;
    let requested!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await page.route('**/pagefind/' + resource, async (route) => {
      requested();
      await gate;
      await route.continue();
    });
    try {
      await page.goto('/en/search/?q=website', { waitUntil: 'domcontentloaded' });
      await started;
      await leaveSearch(page);
      // Return before releasing the old initialization to exercise overlapping lifetimes.
      await page.goBack();
      await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
      release();
      await expect(resultLinks(page).first()).toBeVisible();
      await leaveSearch(page);
      await expect
        .poll(async () => {
          const methods = (await readProbe(page)).methods;
          return (
            methods.filter((row) => row.method === 'init').length -
            methods.filter((row) => row.method === 'destroy').length
          );
        })
        .toBe(0);
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}

test('a pending old query settles before index destruction while a new visit stays usable', async ({
  page,
}) => {
  await observeIndexes(page);
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message?.method === 'search' && message.args?.[0] === 'frenet') {
        Object.assign(window, {
          releaseOldSearch: () => Reflect.apply(send, this, [message, ...rest]),
        });
        return;
      }
      return Reflect.apply(send, this, [message, ...rest]);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/search/?q=website');
  await expect(resultLinks(page).first()).toBeVisible();
  await page.locator('[data-search-input]').fill('frenet');
  await page.waitForFunction(() => 'releaseOldSearch' in window);
  await leaveSearch(page);
  expect((await readProbe(page)).methods.filter((row) => row.method === 'destroy')).toEqual([]);
  await page.locator('a.site-header__search').first().click();
  await page.locator('[data-search-input]').fill('website');
  await expect(resultLinks(page).first()).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as Window & { releaseOldSearch(): void }).releaseOldSearch(),
  );
  await expect
    .poll(
      async () => (await readProbe(page)).methods.filter((row) => row.method === 'destroy').length,
    )
    .toBe(1);
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'website');
  await page.locator('[data-search-input]').fill('git identity');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'git identity');
  await leaveSearch(page);
  await expect.poll(async () => (await readProbe(page)).terminated).toBe(1);
  expect((await readProbe(page)).methods.filter((row) => row.method === 'destroy').length).toBe(2);
  expect(errors).toEqual([]);
});
