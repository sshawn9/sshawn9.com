const screens = Array.from(document.querySelectorAll('[data-screen]'));
const screenLinks = Array.from(document.querySelectorAll('[data-screen-link]'));
const validScreens = new Set(screens.map((screen) => screen.dataset.screen));

function currentScreen() {
  const requested = window.location.hash.slice(1);
  return validScreens.has(requested) ? requested : 'articles';
}

function showScreen() {
  const activeScreen = currentScreen();

  screens.forEach((screen) => {
    const active = screen.dataset.screen === activeScreen;
    screen.classList.toggle('is-active', active);
    screen.toggleAttribute('hidden', !active);
  });

  screenLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${activeScreen}`;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  document.body.dataset.activeScreen = activeScreen;
  window.scrollTo(0, 0);
  window.requestAnimationFrame(() => window.scrollTo(0, 0));
}

document.querySelectorAll('[data-theme-toggle]').forEach((toggle) => {
  toggle.addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
  });
});

document.querySelectorAll('[data-prototype-compare]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const requestedFrom = Number(data.get('from'));
    const requestedTo = Number(data.get('to'));
    const error = form.querySelector('[data-compare-error]');

    if (requestedFrom === requestedTo) {
      error.hidden = false;
      return;
    }

    error.hidden = true;
    const [from, to] = [requestedFrom, requestedTo].sort((left, right) => left - right);
    const title = `比较 v${from} 与 v${to}`;
    document.querySelector('[data-compare-title]').textContent = title;
    document.querySelector('[data-compare-crumb]').textContent = title;
    document.querySelector('[data-compare-from]').textContent = `v${from}`;
    document.querySelector('[data-compare-to]').textContent = to === 3 ? `v${to} / 当前` : `v${to}`;
  });
});

window.addEventListener('hashchange', showScreen);
showScreen();
