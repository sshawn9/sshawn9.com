import { copyFile } from 'node:fs/promises';
for (const name of ['theme', 'wallpaper', 'styles'])
  await copyFile('src/' + name + '.css', 'dist/' + name + '.css');
