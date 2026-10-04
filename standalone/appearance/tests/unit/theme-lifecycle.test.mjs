import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createThemeController } from '@sshawn9/appearance/theme';

const OPTIONS = { timeout: 3_000 };
const ATTRIBUTE = 'data-appearance-theme';
const TRANSITION = 'appearance-theme-changing';

// Deliberately minimal host doubles. Browser layout, real reduced-motion
// rendering and computed colors are verified separately in Playwright.
function rootDouble(initialAttribute = null) {
  const attributes = new Map(initialAttribute === null ? [] : [[ATTRIBUTE, initialAttribute]]);
  const classes = new Set(['host-owned-class']);
  const mutations = [];
  return {
    mutations,
    getAttribute(name) { return attributes.get(name) ?? null; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); mutations.push(['set', name, String(value)]); },
    removeAttribute(name) { attributes.delete(name); mutations.push(['remove', name]); },
    classList: {
      add(...values) { for (const value of values) classes.add(value); mutations.push(['class:add', ...values]); },
      remove(...values) { for (const value of values) classes.delete(value); mutations.push(['class:remove', ...values]); },
      contains(value) { return classes.has(value); },
      toggle(value, force) {
        const next = force === undefined ? !classes.has(value) : Boolean(force);
        if (next) classes.add(value); else classes.delete(value);
        mutations.push(['class:toggle', value, next]);
        return next;
      },
    },
  };
}

function mediaDouble(query, initialMatches = false) {
  const listeners = new Set();
  const added = [];
  const removed = [];
  return {
    media: query,
    matches: initialMatches,
    added,
    removed,
    get listenerCount() { return listeners.size; },
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      added.push(listener);
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, 'change');
      removed.push(listener);
      listeners.delete(listener);
    },
    addListener(listener) { added.push(listener); listeners.add(listener); },
    removeListener(listener) { removed.push(listener); listeners.delete(listener); },
    emit(matches) {
      this.matches = matches;
      const event = { type: 'change', media: query, matches };
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener.call(this, event);
        else listener.handleEvent(event);
      }
    },
  };
}

function fixture(t, settings = {}) {
  const root = rootDouble(settings.initialAttribute ?? null);
  const dark = mediaDouble('(prefers-color-scheme: dark)', settings.dark ?? false);
  const reduced = mediaDouble('(prefers-reduced-motion: reduce)', settings.reduced ?? false);
  const reads = [];
  const writes = [];
  const queries = [];
  const key = settings.storageKey ?? 'appearance:theme';
  const data = new Map(settings.saved === undefined ? [] : [[key, settings.saved]]);
  const storage = {
    getItem(name) {
      reads.push(name);
      if (settings.readError) throw new Error('fixture storage read denied');
      return data.get(name) ?? null;
    },
    setItem(name, value) {
      writes.push([name, String(value)]);
      if (settings.writeError) throw new Error('fixture storage write denied');
      data.set(name, String(value));
    },
  };
  const controller = createThemeController({
    root,
    storage,
    ...(settings.storageKey ? { storageKey: settings.storageKey } : {}),
    matchMedia(query) {
      queries.push(query);
      if (query === dark.media) return dark;
      if (query === reduced.media) return reduced;
      throw new Error(`unexpected media query: ${query}`);
    },
    transitionMs: settings.transitionMs ?? 25,
  });
  t.after(() => controller.destroy());
  return { root, dark, reduced, reads, writes, queries, data, key, controller };
}

test('theme public import does not access browser state, storage, networking, or wallpaper caches', OPTIONS, () => {
  const script = `
    const forbidden = name => () => { throw new Error('import side effect: ' + name); };
    globalThis.fetch = forbidden('fetch');
    globalThis.matchMedia = forbidden('matchMedia');
    globalThis.addEventListener = forbidden('listener');
    globalThis.Image = class { constructor() { throw new Error('wallpaper Image constructed'); } };
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      Object.defineProperty(globalThis, name, { configurable: true, get: forbidden(name) });
    }
    const mod = await import('@sshawn9/appearance/theme');
    if (typeof mod.createThemeController !== 'function') throw new Error('missing theme public export');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 2_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test('construction is inert and setPreference requires explicit initialization', OPTIONS, t => {
  const f = fixture(t);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.queries, []);
  assert.deepEqual(f.root.mutations, []);
  assert.equal(f.controller.getState().initialized, false);
  assert.throws(() => f.controller.setPreference('dark'));
  assert.deepEqual(f.root.mutations, []);
});

test('first initialization follows the system and applies without a transition', OPTIONS, t => {
  const f = fixture(t, { dark: true });
  const state = f.controller.init();
  assert.deepEqual(state, { preference: 'system', resolved: 'dark', initialized: true });
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.root.classList.contains(TRANSITION), false);
  assert.deepEqual(f.reads, ['appearance:theme']);
  assert.equal(f.dark.listenerCount, 1);
  assert.equal(f.reduced.listenerCount, 1);
});

test('saved explicit preference wins over a conflicting system preference', OPTIONS, t => {
  const f = fixture(t, { dark: true, saved: 'light' });
  f.controller.init();
  assert.deepEqual(f.controller.getState(), { preference: 'light', resolved: 'light', initialized: true });
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'light');
});

test('invalid persisted preference safely falls back to system without applying arbitrary attributes', OPTIONS, t => {
  const f = fixture(t, { dark: false, saved: '{"theme":"sepia"}' });
  f.controller.init();
  assert.equal(f.controller.getState().preference, 'system');
  assert.equal(f.controller.getState().resolved, 'light');
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'light');
});

test('storage read failure still permits an initialized system theme', OPTIONS, t => {
  const f = fixture(t, { dark: true, readError: true });
  assert.doesNotThrow(() => f.controller.init());
  assert.equal(f.controller.getState().initialized, true);
  assert.equal(f.controller.getState().resolved, 'dark');
});

test('preference changes update view, publish state and save only the configured namespace', OPTIONS, t => {
  const f = fixture(t, { storageKey: 'standalone-test:theme', dark: false });
  const states = [];
  f.controller.subscribe(state => states.push({ ...state }));
  assert.deepEqual(states, [], 'subscribe must not initialize or emit an invented current state');
  f.controller.init();
  f.controller.setPreference('dark');
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.controller.getState().preference, 'dark');
  assert.deepEqual(f.writes.at(-1), ['standalone-test:theme', 'dark']);
  assert.ok(f.reads.every(key => key === 'standalone-test:theme'));
  assert.ok(f.writes.every(([key]) => key === 'standalone-test:theme'));
  assert.equal(states.at(-1).resolved, 'dark');
  assert.equal(states.at(-1).preference, 'dark');
});

test('storage write failure does not block an explicit preference or future changes', OPTIONS, t => {
  const f = fixture(t, { writeError: true });
  f.controller.init();
  assert.doesNotThrow(() => f.controller.setPreference('dark'));
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.doesNotThrow(() => f.controller.setPreference('light'));
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'light');
});

test('invalid preference is rejected without mutating view or persistence', OPTIONS, t => {
  const f = fixture(t);
  f.controller.init();
  const state = { ...f.controller.getState() };
  const writes = f.writes.length;
  const mutations = f.root.mutations.length;
  assert.throws(() => f.controller.setPreference('sepia'));
  assert.deepEqual(f.controller.getState(), state);
  assert.equal(f.writes.length, writes);
  assert.equal(f.root.mutations.length, mutations);
});

test('system changes update system mode but do not override an explicit user choice', OPTIONS, t => {
  const f = fixture(t, { dark: false });
  f.controller.init();
  f.dark.emit(true);
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.controller.getState().preference, 'system');
  f.controller.setPreference('light');
  f.dark.emit(false);
  f.dark.emit(true);
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'light');
  assert.equal(f.controller.getState().preference, 'light');
  f.controller.setPreference('system');
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.controller.getState().preference, 'system');
});

test('repeated initialization neither duplicates media listeners nor replays first application', OPTIONS, t => {
  const f = fixture(t);
  const states = [];
  f.controller.subscribe(state => states.push({ ...state }));
  f.controller.init();
  const mutations = f.root.mutations.length;
  const notifications = states.length;
  f.controller.init();
  f.controller.init();
  assert.equal(f.dark.added.length, 1);
  assert.equal(f.reduced.added.length, 1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.root.mutations.length, mutations);
  assert.equal(states.length, notifications);
});

test('setting the same preference is a no-op for storage, view and notifications', OPTIONS, t => {
  const f = fixture(t);
  const states = [];
  f.controller.subscribe(state => states.push({ ...state }));
  f.controller.init();
  f.controller.setPreference('dark');
  const before = { writes: f.writes.length, mutations: f.root.mutations.length, states: states.length };
  f.controller.setPreference('dark');
  assert.deepEqual({ writes: f.writes.length, mutations: f.root.mutations.length, states: states.length }, before);
});

test('transition class has a bounded lifetime and repeated changes replace the earlier timer', OPTIONS, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { transitionMs: 100 });
  f.controller.init();
  assert.equal(f.root.classList.contains(TRANSITION), false);
  f.controller.setPreference('dark');
  assert.equal(f.root.classList.contains(TRANSITION), true);
  t.mock.timers.tick(60);
  f.controller.setPreference('light');
  t.mock.timers.tick(40);
  assert.equal(f.root.classList.contains(TRANSITION), true, 'the first timer must not end the later transition');
  t.mock.timers.tick(59);
  assert.equal(f.root.classList.contains(TRANSITION), true);
  t.mock.timers.tick(1);
  assert.equal(f.root.classList.contains(TRANSITION), false);
});

test('initial reduced-motion preference disables theme transition animation', OPTIONS, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { reduced: true });
  f.controller.init();
  f.controller.setPreference('dark');
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.root.classList.contains(TRANSITION), false);
  t.mock.timers.tick(10_000);
  assert.equal(f.root.classList.contains(TRANSITION), false);
});

test('switching reduced motion on clears an active transition immediately', OPTIONS, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clearTimer = t.mock.method(globalThis, 'clearTimeout');
  const f = fixture(t, { transitionMs: 100 });
  f.controller.init();
  f.controller.setPreference('dark');
  assert.equal(f.root.classList.contains(TRANSITION), true);
  const clears = clearTimer.mock.callCount();
  f.reduced.emit(true);
  assert.equal(f.root.classList.contains(TRANSITION), false);
  assert.ok(clearTimer.mock.callCount() > clears, 'the pending timer must be canceled, not merely visually hidden');
  f.controller.setPreference('light');
  assert.equal(f.root.classList.contains(TRANSITION), false);
  f.reduced.emit(false);
  f.controller.setPreference('dark');
  assert.equal(f.root.classList.contains(TRANSITION), true);
});

test('destroy removes both media listeners, cancels timers and restores the previous host attribute', OPTIONS, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clearTimer = t.mock.method(globalThis, 'clearTimeout');
  const f = fixture(t, { initialAttribute: 'host-original', transitionMs: 100 });
  f.controller.init();
  f.controller.setPreference('dark');
  const clears = clearTimer.mock.callCount();
  f.controller.destroy();
  assert.equal(f.dark.listenerCount, 0);
  assert.equal(f.reduced.listenerCount, 0);
  assert.ok(clearTimer.mock.callCount() > clears);
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'host-original');
  assert.equal(f.root.classList.contains(TRANSITION), false);
  assert.equal(f.root.classList.contains('host-owned-class'), true);
  assert.equal(f.controller.getState().initialized, false);
  const mutations = f.root.mutations.length;
  f.dark.emit(true);
  f.reduced.emit(true);
  t.mock.timers.tick(10_000);
  assert.equal(f.root.mutations.length, mutations, 'destroyed listeners/timers cannot touch the host later');
});

test('destroy restores attribute absence and is idempotent', OPTIONS, t => {
  const f = fixture(t);
  f.controller.init();
  assert.equal(f.root.hasAttribute(ATTRIBUTE), true);
  f.controller.destroy();
  assert.equal(f.root.hasAttribute(ATTRIBUTE), false);
  const mutations = f.root.mutations.length;
  f.controller.destroy();
  assert.equal(f.root.mutations.length, mutations);
  assert.throws(() => f.controller.setPreference('dark'));
});

test('same instance reinitializes with fresh saved preference and one listener per query', OPTIONS, t => {
  const f = fixture(t, { saved: 'light', initialAttribute: 'host-original' });
  f.controller.init();
  f.controller.destroy();
  f.data.set(f.key, 'dark');
  f.controller.init();
  assert.equal(f.controller.getState().preference, 'dark');
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'dark');
  assert.equal(f.root.classList.contains(TRANSITION), false);
  assert.equal(f.reads.length, 2);
  assert.equal(f.dark.listenerCount, 1);
  assert.equal(f.reduced.listenerCount, 1);
  f.controller.destroy();
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'host-original');
});

test('unsubscribe removes the callback while later preference changes remain functional', OPTIONS, t => {
  const f = fixture(t);
  const states = [];
  const unsubscribe = f.controller.subscribe(state => states.push({ ...state }));
  assert.deepEqual(states, []);
  f.controller.init();
  assert.equal(states.length, 1);
  unsubscribe();
  unsubscribe();
  f.controller.setPreference('dark');
  assert.equal(states.length, 1);
  assert.equal(f.controller.getState().resolved, 'dark');
});

test('theme init and changes never start wallpaper/network/cache work', OPTIONS, t => {
  const unexpected = name => () => { throw new Error(`theme invoked unrelated capability: ${name}`); };
  const original = new Map();
  const capabilities = {
    fetch: unexpected('fetch'),
    Image: class { constructor() { throw new Error('theme constructed a wallpaper Image'); } },
  };
  for (const [name, value] of Object.entries(capabilities)) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  for (const name of ['indexedDB', 'caches']) {
    original.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get: unexpected(name) });
  }
  t.after(() => {
    for (const [name, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const f = fixture(t);
  assert.doesNotThrow(() => f.controller.init());
  assert.doesNotThrow(() => f.controller.setPreference('dark'));
  assert.doesNotThrow(() => f.controller.setPreference('system'));
  f.dark.emit(true);
  f.controller.destroy();
  assert.equal(f.dark.listenerCount, 0);
});

test('destroy restores the host attribute captured at init rather than a stale construction-time value', OPTIONS, t => {
  const f = fixture(t, { initialAttribute: 'during-construction' });
  f.root.setAttribute(ATTRIBUTE, 'changed-by-host-before-init');
  f.controller.init();
  f.controller.setPreference('dark');
  f.controller.destroy();
  assert.equal(f.root.getAttribute(ATTRIBUTE), 'changed-by-host-before-init');
});
