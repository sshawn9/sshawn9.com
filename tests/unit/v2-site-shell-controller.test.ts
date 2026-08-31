import { describe, expect, it } from 'vitest';
import {
  createSiteShellControllerScript,
  installSiteShellController,
} from '../../apps/site-v2/src/runtime/site-shell-controller';

type Listener = (event: Event & { newDocument?: Document }) => void;

class FakeElement {
  readonly dataset: Record<string, string | undefined> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = '';

  constructor(key?: string) {
    if (key) this.dataset.shellSyncKey = key;
  }

  getAttribute(name: string): string | null {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return this.dataset[key] ?? null;
    }
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    } else this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      delete this.dataset[key];
    } else this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[data-shell-sync-key]') {
      return this.children.filter((child) => child.dataset.shellSyncKey);
    }
    if (selector === '[data-shell-nav-prefix]') {
      return this.children.filter((child) => child.dataset.shellNavPrefix);
    }
    return [];
  }

  querySelector(): FakeElement | null {
    return null;
  }

  addEventListener(): void {}

  removeEventListener(): void {}
}

function fakeDocument(shell: FakeElement, pathname: string) {
  const listeners = new Map<string, Listener[]>();
  return {
    defaultView: { location: { pathname } },
    querySelector: (selector: string) => (selector === '[data-site-shell]' ? shell : null),
    addEventListener: (name: string, listener: Listener) => {
      const existing = listeners.get(name) ?? [];
      existing.push(listener);
      listeners.set(name, existing);
    },
    removeEventListener: (name: string, listener: Listener) => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatch(name: string, event: Event & { newDocument?: Document }) {
      for (const listener of listeners.get(name) ?? []) listener(event);
    },
  };
}

describe('v2 site shell controller', () => {
  it('updates explicit shell semantics without replacing persistent nodes', () => {
    const currentShell = new FakeElement();
    currentShell.dataset.shellLocale = 'en';
    const currentBlog = new FakeElement('blog');
    currentBlog.dataset.shellNavPrefix = '/en/blog/';
    currentBlog.setAttribute('href', '/en/blog/');
    currentBlog.setAttribute('data-shell-copy-text', '');
    currentBlog.textContent = 'Blog';
    currentShell.children.push(currentBlog);

    const targetShell = new FakeElement();
    targetShell.dataset.shellLocale = 'zh';
    const targetBlog = new FakeElement('blog');
    targetBlog.dataset.shellNavPrefix = '/zh/blog/';
    targetBlog.setAttribute('href', '/zh/blog/');
    targetBlog.setAttribute('aria-current', 'page');
    targetBlog.setAttribute('data-shell-copy-text', '');
    targetBlog.textContent = '博客';
    targetShell.children.push(targetBlog);

    const currentDocument = fakeDocument(currentShell, '/en/blog/');
    const targetDocument = fakeDocument(targetShell, '/zh/blog/');
    installSiteShellController(currentDocument as unknown as Document);
    currentDocument.dispatch('astro:before-swap', {
      newDocument: targetDocument as unknown as Document,
    } as Event & { newDocument: Document });

    expect(currentShell.children[0]).toBe(currentBlog);
    expect(currentShell.dataset.shellLocale).toBe('zh');
    expect(currentBlog.getAttribute('href')).toBe('/zh/blog/');
    expect(currentBlog.textContent).toBe('博客');
    expect(currentBlog.getAttribute('aria-current')).toBe('page');
  });

  it('emits a self-contained classic-script body', () => {
    expect(() => new Function('document', createSiteShellControllerScript())).not.toThrow();
  });

  it('releases document listeners and its installation marker', () => {
    const currentShell = new FakeElement();
    const currentBlog = new FakeElement('blog');
    currentBlog.setAttribute('href', '/en/blog/');
    currentShell.children.push(currentBlog);

    const targetShell = new FakeElement();
    const targetBlog = new FakeElement('blog');
    targetBlog.setAttribute('href', '/zh/blog/');
    targetShell.children.push(targetBlog);

    const currentDocument = fakeDocument(currentShell, '/en/blog/');
    const targetDocument = fakeDocument(targetShell, '/zh/blog/');
    const dispose = installSiteShellController(currentDocument as unknown as Document);
    expect(dispose).toBeTypeOf('function');
    dispose?.();
    currentDocument.dispatch('astro:before-swap', {
      newDocument: targetDocument as unknown as Document,
    } as Event & { newDocument: Document });

    expect(currentBlog.getAttribute('href')).toBe('/en/blog/');
    expect(currentShell.dataset.shellControllerInstalled).toBeUndefined();
  });
});
