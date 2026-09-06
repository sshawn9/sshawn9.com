import { describe, expect, it } from 'vitest';
import { automaticRange } from '@sshawn9/content-ui/frenet-explorer/model';

describe('Frenet automatic display range', () => {
  it('clips display ranges while retaining the dℓ/ds = 1 reference', () => {
    expect(automaticRange([1.4, 1.6], [0, 2])).toEqual([0.964, 1.6360000000000001]);
    expect(automaticRange([100, 200], [0, 2])).toEqual([0.94, 2]);
  });
});
