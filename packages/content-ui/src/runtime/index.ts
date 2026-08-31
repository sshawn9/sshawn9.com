import { defineFigureFocusController } from './figure-focus-controller';
import { defineInteractiveFigureStatus } from './interactive-figure-status';

export function installContentUiRuntime(): void {
  defineFigureFocusController();
  defineInteractiveFigureStatus();
}
