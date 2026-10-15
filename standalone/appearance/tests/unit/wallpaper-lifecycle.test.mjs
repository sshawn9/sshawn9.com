import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createWallpaperController } from '@sshawn9/appearance/wallpaper';

// Contract tests: injected image/font adapters intentionally avoid browser APIs.
// Real decoding, font files and uninterrupted refresh frames belong to the
// Chromium/Firefox suite; passing this file is not visual verification.
const A = Object.freeze({ id: 'a', url: '/a.jpg', credit: 'Artist A', filename: 'a.jpg' });
const B = Object.freeze({ id: 'b', url: '/b.jpg', credit: 'Artist B', filename: 'b.jpg' });
const C = Object.freeze({ id: 'c', url: '/c.jpg', credit: 'Artist C', filename: 'c.jpg' });
const OPTIONS = { timeout: 3_000 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A deliberately late rejection must remain safe even before an adapter
  // starts awaiting it. Controller-originated unhandled rejections still fail
  // node:test normally; no process-level rejection handler is installed.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function cached(item) {
  return { item, blob: new Blob([`encoded fixture ${item.id}`], { type: 'image/jpeg' }) };
}

function snapshot(current = A, next = null) {
  return {
    version: 1,
    current: current ? cached(current) : null,
    next: next ? cached(next) : null,
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function fixture(t, settings = {}) {
  const calls = {
    source: [],
    prepare: [],
    fonts: [],
    commits: [],
    writes: [],
    cacheClear: [],
    reads: [],
    enabled: [],
    downloads: [],
    clear: 0,
  };
  const resources = [];
  let persisted = Object.hasOwn(settings, 'snapshot') ? settings.snapshot : snapshot();
  let displayed = null;
  const source = settings.source ?? (async () => null);

  const makePrepared = (item, blob) => {
    const record = { releases: 0 };
    const prepared = {
      item,
      blob: blob ?? cached(item).blob,
      image: null,
      release() {
        record.releases += 1;
      },
    };
    record.prepared = prepared;
    resources.push(record);
    return prepared;
  };

  const view = {
    commit(prepared, options) {
      // This is a single observable view transaction: picture and attribution
      // are represented by one owned PreparedWallpaper, never separate fields.
      const previous = displayed;
      displayed = prepared;
      calls.commits.push({ prepared, animate: options.animate });
      if (previous && previous !== prepared) previous.release();
    },
    setEnabled(value) {
      calls.enabled.push(value);
    },
    clear() {
      calls.clear += 1;
      displayed?.release();
      displayed = null;
    },
  };
  const cache = {
    async read(signal) {
      calls.reads.push(signal);
      return settings.read ? settings.read(signal) : persisted;
    },
    async write(value, signal) {
      calls.writes.push({ value, signal });
      if (settings.write) await settings.write(value, signal);
      else persisted = value;
    },
    async clear(signal) {
      calls.cacheClear.push(signal);
      if (settings.clearCache) await settings.clearCache(signal);
      persisted = null;
    },
  };
  const controller = createWallpaperController({
    source(context) {
      calls.source.push(context);
      return source(context);
    },
    async prepareImage(item, signal, cachedBlob) {
      calls.prepare.push({ item, signal, cachedBlob });
      return settings.prepareImage
        ? settings.prepareImage(item, signal, cachedBlob, makePrepared)
        : makePrepared(item, cachedBlob);
    },
    async fontsReady(item, signal) {
      calls.fonts.push({ item, signal });
      if (settings.fontsReady) await settings.fontsReady(item, signal);
    },
    view,
    ...(settings.noCache ? {} : { cache }),
    download(current) {
      calls.downloads.push(current);
    },
    timeoutMs: settings.timeoutMs ?? 1_000,
    rotationMs: settings.rotationMs ?? 30,
  });
  t.after(() => controller.destroy());
  return {
    controller,
    calls,
    resources,
    makePrepared,
    get displayed() {
      return displayed;
    },
    get persisted() {
      return persisted;
    },
    async init() {
      await controller.init({ enabled: true, autoRotate: false });
    },
    assertPair(item) {
      assert.equal(
        displayed?.item.id,
        item.id,
        'the visible image must remain the committed image',
      );
      assert.equal(
        displayed?.item.credit,
        item.credit,
        'attribution must remain paired with the visible image',
      );
      assert.equal(controller.getState().currentId, item.id);
    },
  };
}

test('wallpaper public import does not start networking, storage, or DOM work', OPTIONS, () => {
  const script = `
    const unexpected = label => () => { throw new Error('import side effect: ' + label); };
    globalThis.fetch = unexpected('fetch');
    globalThis.Image = class { constructor() { throw new Error('import side effect: Image'); } };
    globalThis.addEventListener = unexpected('listener');
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      Object.defineProperty(globalThis, key, { configurable: true, get: unexpected(key) });
    }
    const mod = await import('@sshawn9/appearance/wallpaper');
    if (typeof mod.createWallpaperController !== 'function') throw new Error('missing public export');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 2_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('controller construction is inert until explicit init', OPTIONS, async (t) => {
  const f = fixture(t);
  await flush();
  assert.equal(f.calls.reads.length, 0);
  assert.equal(f.calls.source.length, 0);
  assert.equal(f.calls.prepare.length, 0);
  assert.equal(f.calls.fonts.length, 0);
  assert.equal(f.calls.commits.length, 0);
  assert.equal(f.controller.getState().initialized, false);
});

test(
  'cached current and next restore without source selection, current download, or animation',
  OPTIONS,
  async (t) => {
    const saved = snapshot(A, B);
    const f = fixture(t, { snapshot: saved });
    await f.init();
    await flush();
    f.assertPair(A);
    assert.equal(
      f.calls.source.length,
      0,
      'both cache entries are present; no new selection is necessary',
    );
    assert.equal(f.calls.commits.length, 1);
    assert.equal(f.calls.commits[0].animate, false);
    const first = f.calls.prepare.find((call) => call.item.id === A.id);
    assert.ok(first, 'cached bytes still need preparation/decoding');
    assert.equal(
      first.cachedBlob,
      saved.current.blob,
      'reuse cached bytes instead of downloading the current URL',
    );
    assert.equal(f.calls.downloads.length, 0, 'restoration is not a download action');
  },
);

test(
  'repeated init reuses the committed state and does not replay a transition',
  OPTIONS,
  async (t) => {
    const f = fixture(t, { snapshot: snapshot(A, B) });
    await Promise.all([f.init(), f.init(), f.init()]);
    await f.init();
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 1);
    assert.equal(f.calls.prepare.filter((call) => call.item.id === A.id).length, 1);
    assert.equal(f.calls.source.length, 0);
  },
);

test('old image and attribution survive a pending replacement decode', OPTIONS, async (t) => {
  const gate = deferred();
  const started = deferred();
  const f = fixture(t, {
    snapshot: snapshot(A, B),
    async prepareImage(item, signal, blob, prepare) {
      if (item.id === B.id) {
        started.resolve();
        await gate.promise;
      }
      return prepare(item, blob);
    },
  });
  await f.init();
  const next = f.controller.next();
  await started.promise;
  await flush();
  f.assertPair(A);
  assert.equal(f.calls.commits.length, 1);
  gate.resolve();
  assert.equal(await next, true);
  f.assertPair(B);
  assert.equal(f.calls.commits.length, 2);
  assert.equal(f.calls.commits[1].animate, true);
});

test(
  'successful decode cannot commit before attribution fonts have succeeded',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async fontsReady(item) {
        if (item.id === B.id) {
          started.resolve();
          await gate.promise;
        }
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 1);
    gate.resolve();
    assert.equal(await next, true);
    f.assertPair(B);
  },
);

test(
  'a font failure retains the old pair and never commits the decoded candidate',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async fontsReady(item) {
        if (item.id === B.id) {
          started.resolve();
          await gate.promise;
        }
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    gate.reject(new Error('fixture font resource failed'));
    assert.equal(await next, false);
    await flush();
    f.assertPair(A);
    assert.equal(
      f.calls.commits.some((call) => call.prepared.item.id === B.id),
      false,
    );
    assert.equal(f.controller.getState().busy, false);
    for (const resource of f.resources.filter((record) => record.prepared.item.id === B.id)) {
      assert.equal(resource.releases, 1, 'an uncommitted decoded candidate must be released once');
    }
  },
);

test(
  'a replacement decode failure preserves the old pair and leaves no permanent busy state',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async prepareImage(item, signal, blob, prepare) {
        if (item.id === B.id) {
          started.resolve();
          await gate.promise;
        }
        return prepare(item, blob);
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    gate.reject(new Error('fixture decoder failed'));
    assert.equal(await next, false);
    f.assertPair(A);
    assert.equal(f.controller.getState().busy, false);
  },
);

test(
  'a font timeout is failure, never permission to show the candidate in fallback text',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      timeoutMs: 40,
      async fontsReady(item) {
        if (item.id === B.id) {
          started.resolve();
          await gate.promise;
        }
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    assert.equal(await next, false);
    f.assertPair(A);
    assert.equal(f.controller.getState().busy, false);
    gate.resolve();
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 1);
  },
);

test('concurrent next calls share one candidate preparation and one commit', OPTIONS, async (t) => {
  const gate = deferred();
  const started = deferred();
  const f = fixture(t, {
    snapshot: snapshot(A, B),
    async prepareImage(item, signal, blob, prepare) {
      if (item.id === B.id) {
        started.resolve();
        await gate.promise;
      }
      return prepare(item, blob);
    },
  });
  await f.init();
  const pending = [f.controller.next(), f.controller.next(), f.controller.next()];
  assert.equal(pending[0], pending[1], 'the public contract shares the pending next promise');
  assert.equal(pending[0], pending[2]);
  await started.promise;
  assert.equal(f.calls.prepare.filter((call) => call.item.id === B.id).length, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all(pending), [true, true, true]);
  f.assertPair(B);
  assert.equal(f.calls.commits.filter((call) => call.prepared.item.id === B.id).length, 1);
});

test(
  'cancel settles in-flight work, preserves current, and rejects a late decoded result',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    let candidateSignal;
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async prepareImage(item, signal, blob, prepare) {
        if (item.id === B.id) {
          candidateSignal = signal;
          started.resolve();
          await gate.promise; // Deliberately ignore abort to test the controller's own guard.
        }
        return prepare(item, blob);
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    f.controller.cancel();
    assert.equal(candidateSignal.aborted, true);
    assert.equal(await next, false);
    f.assertPair(A);
    assert.equal(f.controller.getState().busy, false);
    // A user cancel is distinct from the timeout failure tested above.
    assert.ok(!f.controller.getState().error, 'intentional cancellation is not a resource failure');
    gate.resolve();
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 1);
    for (const resource of f.resources.filter((record) => record.prepared.item.id === B.id)) {
      assert.equal(resource.releases, 1, 'late uncommitted resources must be reclaimed');
    }
  },
);

test(
  'a new request can succeed after cancellation, and the older result cannot overwrite it',
  OPTIONS,
  async (t) => {
    const oldGate = deferred();
    const oldStarted = deferred();
    let blockB = true;
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async source() {
        return C;
      },
      async prepareImage(item, signal, blob, prepare) {
        if (item.id === B.id && blockB) {
          oldStarted.resolve();
          await oldGate.promise;
        }
        return prepare(item, blob);
      },
    });
    await f.init();
    const oldNext = f.controller.next();
    await oldStarted.promise;
    f.controller.cancel();
    assert.equal(await oldNext, false);
    blockB = false;
    assert.equal(await f.controller.next(), true);
    const committedId = f.controller.getState().currentId;
    assert.notEqual(committedId, A.id, 'cancel must allow a subsequent successful operation');
    const commits = f.calls.commits.length;
    oldGate.resolve();
    await flush();
    assert.equal(f.controller.getState().currentId, committedId);
    assert.equal(f.calls.commits.length, commits, 'old operation must not replay a transition');
  },
);

test(
  'late font rejection after destroy is observed and cannot mutate or resurrect the view',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    let fontSignal;
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async fontsReady(item, signal) {
        if (item.id === B.id) {
          fontSignal = signal;
          started.resolve();
          await gate.promise;
        }
      },
    });
    await f.init();
    const next = f.controller.next();
    await started.promise;
    f.controller.destroy();
    assert.equal(fontSignal.aborted, true);
    assert.equal(await next, false);
    const commits = f.calls.commits.length;
    const writes = f.calls.writes.length;
    gate.reject(new Error('late font failure after destroy'));
    await flush();
    assert.equal(f.calls.commits.length, commits);
    assert.equal(
      f.calls.writes.length,
      writes,
      'destroyed operation cannot overwrite persisted state',
    );
    assert.equal(f.displayed, null);
    assert.equal(f.controller.getState().initialized, false);
  },
);

test('destroy is idempotent and releases a view-owned image exactly once', OPTIONS, async (t) => {
  const f = fixture(t, { snapshot: snapshot(A, B) });
  await f.init();
  const owned = f.calls.commits[0].prepared;
  f.controller.destroy();
  f.controller.destroy();
  await flush();
  assert.equal(f.resources.find((record) => record.prepared === owned).releases, 1);
  assert.equal(f.displayed, null);
  assert.equal(f.controller.getState().initialized, false);
});

test(
  'same controller can initialize again after destroy and restores without replaying animation',
  OPTIONS,
  async (t) => {
    const f = fixture(t, { snapshot: snapshot(A, B) });
    await f.init();
    f.controller.destroy();
    await f.init();
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 2);
    assert.deepEqual(
      f.calls.commits.map((call) => call.animate),
      [false, false],
    );
    assert.equal(f.calls.source.length, 0);
    for (const call of f.calls.prepare.filter((call) => call.item.id === A.id)) {
      assert.ok(call.cachedBlob instanceof Blob, 'reinit must reuse image bytes');
    }
  },
);

test(
  'destroy during initialization prevents a late cache result from committing',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    let readSignal;
    const f = fixture(t, {
      async read(signal) {
        readSignal = signal;
        started.resolve();
        return gate.promise;
      },
    });
    const init = f.init();
    await started.promise;
    f.controller.destroy();
    assert.equal(readSignal.aborted, true);
    await init;
    gate.resolve(snapshot(A, B));
    await flush();
    assert.equal(f.calls.commits.length, 0);
    assert.equal(f.displayed, null);
    assert.equal(f.controller.getState().initialized, false);
  },
);

test('corrupt cache metadata recovers through a bounded fresh load', OPTIONS, async (t) => {
  let selections = 0;
  const f = fixture(t, {
    snapshot: { version: 999, current: { item: A, blob: 'not a Blob' }, next: null },
    async source() {
      selections += 1;
      return selections === 1 ? C : null;
    },
  });
  await f.init();
  await flush();
  f.assertPair(C);
  assert.equal(f.controller.getState().busy, false);
  assert.ok(selections <= 2, 'corrupt cache must not cause unbounded selection retries');
  assert.equal(
    f.calls.prepare.some((call) => call.cachedBlob === 'not a Blob'),
    false,
  );
});

test(
  'corrupt cached image bytes fail closed and allow later normal recovery',
  OPTIONS,
  async (t) => {
    let allowFresh = false;
    const f = fixture(t, {
      snapshot: snapshot(A),
      async source() {
        return allowFresh ? C : null;
      },
      async prepareImage(item, signal, blob, prepare) {
        if (item.id === A.id && blob) throw new Error('cached JPEG decoding failed');
        return prepare(item, blob);
      },
    });
    await f.init();
    await flush();
    assert.equal(
      f.calls.commits.some((call) => call.prepared.item.id === A.id),
      false,
    );
    assert.equal(f.controller.getState().busy, false);
    allowFresh = true;
    assert.equal(await f.controller.next(), true);
    f.assertPair(C);
  },
);

test('cache read failure does not make a fresh source permanently unusable', OPTIONS, async (t) => {
  let selections = 0;
  const f = fixture(t, {
    async read() {
      throw new Error('storage unavailable');
    },
    async source() {
      selections += 1;
      return selections === 1 ? C : null;
    },
  });
  await f.init();
  await flush();
  f.assertPair(C);
  assert.equal(f.controller.getState().busy, false);
  assert.ok(selections <= 2);
});

test(
  'an exhausted source is finite and does not remove the displayed image',
  OPTIONS,
  async (t) => {
    const f = fixture(t);
    await f.init();
    const before = f.calls.source.length;
    assert.equal(await f.controller.next(), false);
    await flush();
    f.assertPair(A);
    assert.equal(f.controller.getState().busy, false);
    assert.ok(f.calls.source.length - before <= 1);
  },
);

test(
  'subscribers can unsubscribe and observe a successful commit without being called afterward',
  OPTIONS,
  async (t) => {
    const f = fixture(t, { snapshot: snapshot(A, B) });
    const states = [];
    const unsubscribe = f.controller.subscribe((state) => states.push({ ...state }));
    await f.init();
    assert.ok(states.some((state) => state.currentId === A.id));
    unsubscribe();
    const count = states.length;
    assert.equal(await f.controller.next(), true);
    await flush();
    assert.equal(states.length, count);
    f.assertPair(B);
  },
);

test(
  'auto rotation stops after disable and does not accumulate on repeated enables',
  OPTIONS,
  async (t) => {
    let counter = 0;
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      rotationMs: 30,
      async source() {
        counter += 1;
        return {
          id: `rotated-${counter}`,
          url: `/rotated-${counter}.jpg`,
          credit: `Artist ${counter}`,
        };
      },
    });
    await f.init();
    const rotated = deferred();
    const unsubscribe = f.controller.subscribe((state) => {
      if (state.currentId && state.currentId !== A.id) rotated.resolve();
    });
    f.controller.setAutoRotate(true);
    f.controller.setAutoRotate(true);
    f.controller.setAutoRotate(true);
    await rotated.promise;
    f.controller.setAutoRotate(false);
    unsubscribe();
    await flush();
    const commits = f.calls.commits.length;
    await sleep(100);
    assert.equal(
      f.calls.commits.length,
      commits,
      'disabled rotation cannot produce additional transitions',
    );
    assert.equal(f.controller.getState().autoRotate, false);
    await f.controller.setEnabled(false);
    assert.equal(f.controller.getState().enabled, false);
    f.controller.destroy();
    const finalCommits = f.calls.commits.length;
    await sleep(100);
    assert.equal(f.calls.commits.length, finalCommits);
  },
);

test(
  'controller works without a cache adapter and still requires explicit init',
  OPTIONS,
  async (t) => {
    let selected = false;
    const f = fixture(t, {
      noCache: true,
      async source() {
        if (selected) return null;
        selected = true;
        return A;
      },
    });
    assert.equal(f.calls.source.length, 0);
    await f.init();
    f.assertPair(A);
    assert.equal(f.calls.reads.length, 0);
    assert.equal(f.calls.writes.length, 0);
  },
);

test(
  'the first picture is not shown while its required attribution font is pending',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const started = deferred();
    let selected = false;
    const f = fixture(t, {
      snapshot: null,
      async source() {
        if (selected) return null;
        selected = true;
        return A;
      },
      async fontsReady(item) {
        if (item.id === A.id) {
          started.resolve();
          await gate.promise;
        }
      },
    });
    const init = f.init();
    await started.promise;
    await flush();
    assert.equal(f.displayed, null);
    assert.equal(
      f.calls.commits.length,
      0,
      'an image-only first commit would violate the display contract',
    );
    assert.equal(f.controller.getState().currentId, null);
    gate.resolve();
    await init;
    f.assertPair(A);
    assert.equal(f.calls.commits.length, 1);
  },
);

test('download uses the committed picture, never the pending replacement', OPTIONS, async (t) => {
  const gate = deferred();
  const started = deferred();
  const f = fixture(t, {
    snapshot: snapshot(A, B),
    async fontsReady(item) {
      if (item.id === B.id) {
        started.resolve();
        await gate.promise;
      }
    },
  });
  await f.init();
  const aBlob = f.displayed.blob;
  const next = f.controller.next();
  await started.promise;
  await f.controller.download();
  assert.equal(f.calls.downloads.length, 1);
  assert.equal(f.calls.downloads[0].item.id, A.id);
  assert.equal(f.calls.downloads[0].item.credit, A.credit);
  assert.equal(f.calls.downloads[0].blob, aBlob);
  gate.resolve();
  assert.equal(await next, true);
  await f.controller.download();
  assert.equal(f.calls.downloads[1].item.id, B.id);
  assert.equal(f.calls.downloads[1].item.credit, B.credit);
});

test(
  'cancellation prevents a late source response from replacing a newer successful request',
  OPTIONS,
  async (t) => {
    const oldResponse = deferred();
    const oldStarted = deferred();
    let selection = 0;
    let oldSignal;
    const f = fixture(t, {
      snapshot: snapshot(A),
      async source({ currentId, signal }) {
        selection += 1;
        if (selection === 1) {
          assert.equal(currentId, A.id);
          oldSignal = signal;
          oldStarted.resolve();
          return oldResponse.promise; // Deliberately ignore abort.
        }
        return selection === 2 ? C : null;
      },
    });
    await f.init();
    await oldStarted.promise;
    const oldNext = f.controller.next();
    f.controller.cancel();
    assert.equal(await oldNext, false);
    assert.equal(oldSignal.aborted, true);
    assert.equal(await f.controller.next(), true);
    f.assertPair(C);
    const commits = f.calls.commits.length;
    oldResponse.resolve(B);
    await flush();
    f.assertPair(C);
    assert.equal(f.calls.commits.length, commits);
    assert.equal(
      f.calls.prepare.some((call) => call.item.id === B.id),
      false,
      'an obsolete source response must not start decoding',
    );
  },
);

test(
  'destroy followed by reinit isolates a late result from the previous lifecycle',
  OPTIONS,
  async (t) => {
    const oldResponse = deferred();
    const oldStarted = deferred();
    let selection = 0;
    const f = fixture(t, {
      snapshot: snapshot(A),
      async source() {
        selection += 1;
        if (selection === 1) {
          oldStarted.resolve();
          return oldResponse.promise;
        }
        return selection === 2 ? C : null;
      },
    });
    await f.init();
    await oldStarted.promise;
    const oldNext = f.controller.next();
    f.controller.destroy();
    assert.equal(await oldNext, false);
    await f.init();
    assert.equal(await f.controller.next(), true);
    f.assertPair(C);
    const commits = f.calls.commits.length;
    const persistedCurrent = f.persisted?.current?.item.id;
    oldResponse.resolve(B);
    await flush();
    f.assertPair(C);
    assert.equal(f.calls.commits.length, commits);
    assert.equal(f.persisted?.current?.item.id, persistedCurrent);
    assert.equal(
      f.calls.prepare.some((call) => call.item.id === B.id),
      false,
    );
  },
);

test(
  'repeated visibility toggles preserve cache identity without selecting or downloading the current picture again',
  OPTIONS,
  async (t) => {
    const f = fixture(t, { snapshot: snapshot(A, B) });
    await f.init();
    await f.controller.setEnabled(false);
    await f.controller.setEnabled(false);
    assert.equal(f.controller.getState().enabled, false);
    await f.controller.setEnabled(true);
    await f.controller.setEnabled(true);
    await flush();
    f.assertPair(A);
    assert.equal(f.controller.getState().enabled, true);
    assert.equal(f.calls.source.length, 0);
    for (const call of f.calls.prepare.filter((call) => call.item.id === A.id)) {
      assert.ok(call.cachedBlob instanceof Blob);
    }
    assert.ok(f.calls.commits.every((call) => call.animate === false));
  },
);

test(
  'prefetch is image-only and does not prepare future attribution fonts until a switch is requested',
  OPTIONS,
  async (t) => {
    let selections = 0;
    const f = fixture(t, {
      snapshot: snapshot(A),
      async source() {
        selections += 1;
        return selections === 1 ? B : null;
      },
    });
    await f.init();
    await flush();
    f.assertPair(A);
    assert.equal(f.calls.prepare.filter((call) => call.item.id === B.id).length, 1);
    assert.equal(f.calls.fonts.filter((call) => call.item.id === B.id).length, 0);
    assert.equal(f.calls.commits.length, 1);
    assert.equal(f.persisted?.next?.item.id, B.id);
    assert.ok(f.persisted?.next?.blob instanceof Blob);
    assert.equal(await f.controller.next(), true);
    f.assertPair(B);
    assert.equal(f.calls.fonts.filter((call) => call.item.id === B.id).length, 1);
  },
);

test(
  'font failure can be retried without treating valid cached image bytes as corrupt',
  OPTIONS,
  async (t) => {
    let failFont = true;
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async fontsReady(item) {
        if (item.id === B.id && failFont) throw new Error('temporary font resource failure');
      },
    });
    await f.init();
    assert.equal(await f.controller.next(), false);
    f.assertPair(A);
    assert.equal(f.controller.getState().busy, false);
    failFont = false;
    assert.equal(await f.controller.next(), true);
    f.assertPair(B);
    assert.ok(!f.controller.getState().error);
    for (const call of f.calls.prepare.filter((call) => call.item.id === B.id)) {
      assert.ok(
        call.cachedBlob instanceof Blob,
        'a font failure must not force re-downloading valid cached image bytes',
      );
    }
  },
);

test(
  'a completed visible commit is not reported as a failed switch solely because persistence times out',
  OPTIONS,
  async (t) => {
    const gate = deferred();
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      timeoutMs: 40,
      async write(value, signal) {
        if (value.current?.item.id !== B.id) return;
        // Cache writers must honor AbortSignal. This double intentionally does
        // so, while the cache remains slow long enough to exercise the deadline.
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            cleanup();
            reject(signal.reason ?? new Error('cache write aborted'));
          };
          const cleanup = () => signal.removeEventListener('abort', onAbort);
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
          gate.promise.then(
            (value) => {
              cleanup();
              resolve(value);
            },
            (error) => {
              cleanup();
              reject(error);
            },
          );
        });
      },
    });
    await f.init();
    const result = await f.controller.next();
    f.assertPair(B);
    assert.equal(
      result,
      true,
      'true means the prepared picture and attribution were committed successfully',
    );
    assert.equal(f.controller.getState().busy, false);
    gate.resolve();
    await flush();
    f.assertPair(B);
  },
);

test(
  'cached-current font failure releases the decoded image without reclassifying it as a corrupt cache',
  OPTIONS,
  async (t) => {
    const f = fixture(t, {
      snapshot: snapshot(A, B),
      async fontsReady(item) {
        if (item.id === A.id) throw new Error('cached-current attribution font failed');
      },
    });
    await f.init();
    await flush();
    assert.equal(f.calls.commits.length, 0);
    assert.equal(f.displayed, null);
    assert.equal(f.controller.getState().currentId, null);
    assert.equal(f.controller.getState().busy, false);
    assert.equal(
      f.calls.source.length,
      0,
      'font failure is not a reason to silently select a different image',
    );
    assert.equal(
      f.calls.cacheClear.length,
      0,
      'valid cached image bytes must not be discarded as corrupt',
    );
    const decoded = f.resources.filter((record) => record.prepared.item.id === A.id);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].releases, 1);
  },
);
