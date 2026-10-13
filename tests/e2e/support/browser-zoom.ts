import assert from "node:assert/strict";

type Viewport = { width: number; height: number };

type ViewportMetrics = {
  devicePixelRatio: number;
  layoutHeight: number;
  layoutWidth: number;
  physicalHeight: number;
  physicalWidth: number;
  visualHeight: number | undefined;
  visualScale: number | undefined;
  visualWidth: number | undefined;
};

export function createBrowserZoomGeometry(
  physicalViewport: Viewport,
  factor: number,
) {
  return {
    baseline: { viewport: physicalViewport, deviceScaleFactor: 1 },
    zoomed: {
      viewport: {
        width: physicalViewport.width / factor,
        height: physicalViewport.height / factor,
      },
      deviceScaleFactor: factor,
    },
  };
}

export function assertBrowserZoomGeometry(
  geometry: ReturnType<typeof createBrowserZoomGeometry>,
  baseline: ViewportMetrics,
  zoomed: ViewportMetrics,
) {
  for (const [label, measured, expected] of [
    ["baseline", baseline, geometry.baseline],
    ["zoomed", zoomed, geometry.zoomed],
  ] as const) {
    assert.deepEqual(
      measured,
      {
        devicePixelRatio: expected.deviceScaleFactor,
        layoutHeight: expected.viewport.height,
        layoutWidth: expected.viewport.width,
        physicalHeight: geometry.baseline.viewport.height,
        physicalWidth: geometry.baseline.viewport.width,
        visualHeight: expected.viewport.height,
        visualScale: 1,
        visualWidth: expected.viewport.width,
      },
      `${label} must preserve the physical desktop viewport`,
    );
  }
}
