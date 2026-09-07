import type { Locator } from '@playwright/test';
import type { Camera } from 'plotly.js';

/** Plotly 4 can leave both layout camera declarations stale after react().
 * Keep this version-coupled, read-only renderer probe in one place. */
export async function cameraOf(plot: Locator): Promise<Camera> {
  return plot.evaluate((element) => {
    const scene = (
      element as HTMLElement & {
        _fullLayout?: { scene?: { _scene?: { getCamera(): Camera } } };
      }
    )._fullLayout?.scene?._scene;
    if (!scene) throw new Error('The live Plotly WebGL scene is not ready');
    const camera = structuredClone(scene.getCamera());
    // Resize normalizes camera vectors; discard only floating-point roundoff.
    for (const point of [camera.eye, camera.center, camera.up]) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const value = point[axis];
        if (value !== undefined) point[axis] = Number(value.toFixed(8));
      }
    }
    return camera;
  });
}
