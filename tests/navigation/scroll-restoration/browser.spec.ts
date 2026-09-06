import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('a deep hard refresh restores the matching history entry at the first-contentful-paint observation boundary', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('capture-reload-frame') !== 'true') return;
    const paintObserver = new PerformanceObserver((entries, observer) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      sessionStorage.setItem('reload-first-frame-y', String(scrollY));
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  });
  await page.goto(articlePath);
  await page.evaluate(() => scrollTo(0, 3_200));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(3_200, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0,
      ),
    )
    .toBeCloseTo(3_200, 0);
  const savedY = await page.evaluate(
    () => (history.state as { sshawn9: { page: { y: number } } }).sshawn9.page.y,
  );
  await page.evaluate(() => sessionStorage.setItem('capture-reload-frame', 'true'));

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('reload-first-frame-y')))
    .not.toBeNull();
  const firstFrameY = Number(
    await page.evaluate(() => sessionStorage.getItem('reload-first-frame-y')),
  );

  expect(Math.abs(firstFrameY - savedY)).toBeLessThan(2);
  await expect(page.locator('#initial-frame-ready')).toHaveCount(1);
});

test('history traversal restores its scroll in the first sampled frames after the target route is swapped', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  const savedY = await page.evaluate(() => {
    scrollTo({
      top: Math.min(1_600, document.documentElement.scrollHeight - innerHeight),
      behavior: 'instant',
    });
    return scrollY;
  });
  expect(savedY).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await page.evaluate(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.blog-page')) return;
      observer.disconnect();
      const samples: number[] = [];
      const sample = () => {
        samples.push(scrollY);
        if (samples.length < 8) requestAnimationFrame(sample);
        else root.dataset.traversalScrollSamples = JSON.stringify(samples);
      };
      // MutationObserver runs inside the framework's atomic swap before its
      // saved scroll is applied. The first render opportunity is the behavior
      // boundary: no intermediate synchronous DOM state can reach the screen.
      requestAnimationFrame(sample);
    });
    observer.observe(root, { childList: true, subtree: true });
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-traversal-scroll-samples', /\[/);
  const samples = await page
    .locator('html')
    .evaluate((root) => JSON.parse((root as HTMLElement).dataset.traversalScrollSamples ?? '[]'));
  expect(samples).toHaveLength(8);
  expect(
    samples.every((sample: number) => Math.abs(sample - savedY) < 2),
    `saved=${savedY}; samples=${samples.join(',')}`,
  ).toBe(true);
});
