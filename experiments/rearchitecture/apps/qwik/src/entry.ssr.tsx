import { renderToStream, type RenderToStreamOptions } from '@builder.io/qwik/server';
import Root from './root';

export default function render(options: RenderToStreamOptions) {
  return renderToStream(<Root />, {
    ...options,
    containerAttributes: {
      lang: 'zh-CN',
      'data-theme': 'dark',
      'data-wallpaper': 'on',
      ...options.containerAttributes,
    },
  });
}
