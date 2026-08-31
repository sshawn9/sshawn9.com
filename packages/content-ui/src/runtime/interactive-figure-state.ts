export type InteractiveFigureState = 'ready' | 'error';

const STATUS_ELEMENT = 'interactive-figure-status';

export function setInteractiveFigureState(source: Element, state: InteractiveFigureState): void {
  const figure = source.closest<HTMLElement>('[data-figure-focus]');
  const status = figure?.querySelector<HTMLElement>(STATUS_ELEMENT);
  if (status) status.dataset.state = state;
}
