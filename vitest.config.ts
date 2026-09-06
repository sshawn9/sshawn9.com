import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/unit.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/.results/**'],
  },
});
