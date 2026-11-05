import { useEffect, useState } from 'react';
import { binHrBackground, builtinHrGrid, type HrBackgroundFile, type HrGrid } from '@/lib/journeys/visual-data';

let cached: Promise<HrGrid> | null = null;

/** Loads data/journeys/hr-background.json once (binned); falls back to the built-in coarse grid. */
export function loadHrGrid(): Promise<HrGrid> {
  if (!cached) {
    cached = fetch('./data/journeys/hr-background.json')
      .then((r) => { if (!r.ok) throw new Error('hr-background unavailable'); return r.json() as Promise<HrBackgroundFile>; })
      .then((data) => {
        if (!Array.isArray(data?.bv) || !Array.isArray(data?.absMagV)) throw new Error('bad hr-background');
        const grid = binHrBackground(data);
        return grid.cells.length ? grid : builtinHrGrid();
      })
      .catch(() => { cached = null; return builtinHrGrid(); });
  }
  return cached;
}

export function useHrGrid(): HrGrid {
  const [grid, setGrid] = useState<HrGrid>(() => builtinHrGrid());
  useEffect(() => {
    let live = true;
    loadHrGrid().then((g) => { if (live) setGrid(g); });
    return () => { live = false; };
  }, []);
  return grid;
}
