import { describe, expect, it } from 'vitest';
import { createInitialState, surfaceArrays } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet surface shape', () => {
  it('creates surface arrays matching the selected variables', () => {
    const surface = surfaceArrays(createInitialState(['phi', 'd']));
    expect(surface.x).toHaveLength(121);
    expect(surface.y).toHaveLength(61);
    expect(surface.z).toHaveLength(61);
    expect(surface.z[0]).toHaveLength(121);
  });
});
