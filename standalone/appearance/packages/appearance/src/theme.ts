export type ThemePreference = 'light' | 'dark' | 'system';
export type ThemeState = { preference: ThemePreference; resolved: 'light' | 'dark'; initialized: boolean };
export interface ThemeOptions {
  root: HTMLElement;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  storageKey?: string;
  matchMedia?: (query: string) => MediaQueryList;
  transitionMs?: number;
}
export function createThemeController(options: ThemeOptions) {
  let state: ThemeState = { preference: 'system', resolved: 'light', initialized: false };
  const subscribers = new Set<(state: ThemeState) => void>();
  let dark: MediaQueryList | undefined;
  let reduced: MediaQueryList | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: string | null = null;
  const notify = () => { for (const callback of subscribers) callback({ ...state }); };
  const clearTransition = () => { clearTimeout(timer); timer = undefined; options.root.classList.remove('appearance-theme-changing'); };
  function apply(animate: boolean) {
    const resolved = state.preference === 'system' ? (dark?.matches ? 'dark' : 'light') : state.preference;
    const changed = resolved !== state.resolved;
    clearTransition();
    if (animate && changed && !reduced?.matches && (options.transitionMs ?? 220) > 0) {
      options.root.classList.add('appearance-theme-changing');
      timer = setTimeout(clearTransition, options.transitionMs ?? 220);
    }
    state = { ...state, resolved };
    options.root.setAttribute('data-appearance-theme', resolved);
    notify();
  }
  const onSystemChange = () => { if (state.preference === 'system') apply(true); };
  const onMotionChange = () => { if (reduced?.matches) clearTransition(); };
  return {
    init(): ThemeState {
      if (state.initialized) return { ...state };
      const matcher = options.matchMedia ?? options.root.ownerDocument.defaultView?.matchMedia.bind(options.root.ownerDocument.defaultView);
      if (!matcher) throw new Error('Theme initialization requires matchMedia');
      previous = options.root.getAttribute('data-appearance-theme');
      dark = matcher('(prefers-color-scheme: dark)');
      reduced = matcher('(prefers-reduced-motion: reduce)');
      let preference: ThemePreference = 'system';
      try {
        const saved = options.storage?.getItem(options.storageKey ?? 'appearance:theme');
        if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved;
      } catch { /* Storage denial must not prevent theme use. */ }
      state = { ...state, preference, initialized: true };
      dark.addEventListener('change', onSystemChange);
      reduced.addEventListener('change', onMotionChange);
      apply(false);
      return { ...state };
    },
    setPreference(preference: ThemePreference) {
      if (!state.initialized) throw new Error('Initialize the theme first');
      if (!['light', 'dark', 'system'].includes(preference)) throw new Error('Invalid theme preference');
      if (preference === state.preference) return;
      state = { ...state, preference };
      try { options.storage?.setItem(options.storageKey ?? 'appearance:theme', preference); } catch { /* Optional persistence. */ }
      apply(true);
    },
    getState: (): ThemeState => ({ ...state }),
    subscribe(callback: (value: ThemeState) => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
    destroy() {
      if (!state.initialized) return;
      dark?.removeEventListener('change', onSystemChange);
      reduced?.removeEventListener('change', onMotionChange);
      clearTransition();
      if (previous === null) options.root.removeAttribute('data-appearance-theme');
      else options.root.setAttribute('data-appearance-theme', previous);
      state = { ...state, initialized: false };
      dark = reduced = undefined;
    },
  };
}
