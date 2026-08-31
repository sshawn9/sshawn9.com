import { component$, useSignal, useVisibleTask$ } from '@builder.io/qwik';
import { Link, useLocation } from '@builder.io/qwik-city';

function setPreference(key: 'theme' | 'wallpaper', value: 'dark' | 'light' | 'on' | 'off') {
  try {
    localStorage.setItem('poc:' + key, value);
  } catch {
    // Preferences remain usable in memory when storage is unavailable.
  }
}

/** Persistent, route-independent controls rendered outside RouterOutlet. */
export const SiteShell = component$(() => {
  const location = useLocation();
  const theme = useSignal<'dark' | 'light'>('dark');
  const wallpaper = useSignal<'on' | 'off'>('on');

  useVisibleTask$(() => {
    theme.value = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    wallpaper.value = document.documentElement.dataset.wallpaper === 'off' ? 'off' : 'on';
  });

  const localeHref = location.url.pathname.startsWith('/en/')
    ? location.url.pathname.replace(/^\/en\//, '/zh/')
    : location.url.pathname.replace(/^\/zh\//, '/en/');

  return (
    <header class="site-header" data-site-shell>
      <nav class="site-nav" aria-label="主导航">
        <Link class="brand" href="/zh/blog/">
          <span class="brand-mark" aria-hidden="true">
            S
          </span>
          <span class="brand-name">SHAWN</span>
        </Link>
        <Link class="nav-link nav-projects" href="/zh/blog/">
          项目
        </Link>
        <Link
          class="nav-link"
          href="/zh/blog/"
          aria-current={location.url.pathname.includes('/blog/') ? 'page' : undefined}
        >
          博客
        </Link>
        <Link class="nav-link" href="/zh/blog/">
          关于
        </Link>
        <span class="shell-actions">
          <Link class="shell-action" href={localeHref} aria-label="切换语言">
            文
          </Link>
          <button
            class="shell-action"
            type="button"
            aria-label="切换主题"
            onClick$={() => {
              theme.value = theme.value === 'dark' ? 'light' : 'dark';
              document.documentElement.dataset.theme = theme.value;
              setPreference('theme', theme.value);
            }}
          >
            {theme.value === 'dark' ? '☾' : '☀'}
          </button>
          <button
            class="shell-action"
            type="button"
            aria-label="切换壁纸"
            aria-pressed={wallpaper.value === 'on'}
            onClick$={() => {
              wallpaper.value = wallpaper.value === 'on' ? 'off' : 'on';
              document.documentElement.dataset.wallpaper = wallpaper.value;
              setPreference('wallpaper', wallpaper.value);
            }}
          >
            ▧
          </button>
        </span>
      </nav>
    </header>
  );
});
