import { describe, it, expect } from 'vitest';
import { stereographicProject } from '../astronomy';

describe('sky chart angular scale', () => {
  it('puts a one degree separation at one degree times the chart scale', () => {
    const point = stereographicProject(1, 0, 0, 0, 10)!;
    expect(point.x).toBeCloseTo(-10, 2);
    expect(point.y).toBeCloseTo(0, 8);
  });
  it('places a star at the edge of a seven degree field on the projected field radius', () => {
    const scale = 12;
    const point = stereographicProject(3.5, 0, 0, 0, scale)!;
    const radius = 2 * Math.tan(7 * Math.PI / 720) * 180 / Math.PI * scale;
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(radius, 8);
  });
  it('keeps north up and east left across the RA wrap', () => {
    expect(stereographicProject(0, 0, 359, 0, 1)!.x).toBeCloseTo(-1, 3);
    expect(stereographicProject(0, 1, 0, 0, 1)!.y).toBeCloseTo(-1, 3);
    expect(stereographicProject(0, 0, 0, 0, 1)).toEqual({ x: -0, y: -0 });
  });
  it('does not draw objects behind the chart projection', () => {
    expect(stereographicProject(180, 0, 0, 0, 1)).toBeNull();
  });
});
