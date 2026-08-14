import { describe, expect, it } from 'vitest';

import { vec3 } from '../src/core/math';
import { CenterlineSpline } from '../src/track/spline';

/** A 100 m radius circle, sampled as 16 control points. */
const circle = (radius = 100, points = 16): ReturnType<typeof vec3>[] =>
  Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    return vec3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
  });

describe('CenterlineSpline', () => {
  it('rejects a centreline too short to interpolate', () => {
    expect(() => new CenterlineSpline([vec3(), vec3(1, 0, 0), vec3(2, 0, 0)])).toThrow();
  });

  it('measures the length of a known circle', () => {
    const s = new CenterlineSpline(circle(100, 32), 1);
    // Catmull-Rom through points on a circle is very slightly short.
    expect(s.length).toBeGreaterThan(2 * Math.PI * 100 * 0.99);
    expect(s.length).toBeLessThan(2 * Math.PI * 100 * 1.01);
  });

  it('keeps every sample on the circle', () => {
    const s = new CenterlineSpline(circle(100, 32), 2);
    for (let d = 0; d < s.length; d += 7) {
      const p = s.sampleAt(d).position;
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(100, 0);
    }
  });

  it('reports curvature of roughly 1/r on a circle', () => {
    const s = new CenterlineSpline(circle(100, 48), 1);
    const k = s.sampleAt(s.length * 0.3).curvature;
    expect(Math.abs(k)).toBeGreaterThan(0.008);
    expect(Math.abs(k)).toBeLessThan(0.012);
  });

  it('projects a point onto the centreline with the right lateral offset', () => {
    const s = new CenterlineSpline(circle(100, 32), 1);

    // A point 10 m outside the circle, at the +X side.
    const outside = s.project(vec3(110, 0, 0));
    expect(Math.abs(outside.t)).toBeCloseTo(10, 0);

    // And 10 m inside.
    const inside = s.project(vec3(90, 0, 0));
    expect(Math.abs(inside.t)).toBeCloseTo(10, 0);

    // The two must sit on opposite sides of the centreline.
    expect(Math.sign(outside.t)).toBe(-Math.sign(inside.t));
  });

  it('reports height separately from lateral offset', () => {
    const s = new CenterlineSpline(circle(100, 32), 1);
    const p = s.project(vec3(100, 3.5, 0));
    expect(p.height).toBeCloseTo(3.5, 1);
    expect(Math.abs(p.t)).toBeLessThan(0.5);
  });

  it('advances s monotonically around the lap', () => {
    const s = new CenterlineSpline(circle(100, 32), 1);
    let previous = -1;
    for (let i = 0; i < 40; i++) {
      const a = (i / 80) * Math.PI * 2;
      const p = s.project(vec3(Math.cos(a) * 100, 0, Math.sin(a) * 100));
      expect(p.s).toBeGreaterThan(previous);
      previous = p.s;
    }
  });

  it('gives the same answer with and without a search hint', () => {
    const s = new CenterlineSpline(circle(100, 32), 1);
    const point = vec3(0, 0, 104);
    const cold = s.project(point);
    const hinted = s.project(point, cold.s);
    expect(hinted.s).toBeCloseTo(cold.s, 6);
    expect(hinted.t).toBeCloseTo(cold.t, 6);
  });
});
