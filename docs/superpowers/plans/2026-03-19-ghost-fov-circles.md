# Ghost FOV Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render faint amber dashed FOV circles for all upcoming (future) route steps in SkyChart, with a toggle button to show/hide them.

**Architecture:** Two additions to `SkyChart.tsx` only — a `showGhostCircles` boolean state wired to a toggle button in the existing controls panel, and a ghost-circles SVG block inserted just before the hop-dot markers block so it renders underneath everything else.

**Tech Stack:** React, TypeScript, SVG (inline in SkyChart.tsx)

---

### Task 1: Add state + ghost circle SVG rendering

**Files:**
- Modify: `client/src/components/SkyChart.tsx:52` (add state)
- Modify: `client/src/components/SkyChart.tsx:694` (insert ghost block before hop-dot markers)

- [ ] **Step 1: Add `showGhostCircles` state**

  In `SkyChart.tsx`, after the existing `const [showLegend, setShowLegend] = useState(true);` line (~line 52), add:

  ```tsx
  const [showGhostCircles, setShowGhostCircles] = useState(true);
  ```

- [ ] **Step 2: Insert ghost circles SVG block before the hop-dot markers block**

  The hop-dot markers block starts at `{route?.hops.map((hop, index) => {` (~line 695). Insert the following block immediately before it:

  ```tsx
  {showGhostCircles && route && route.hops
    .map((hop, index) => ({ hop, index }))
    .filter(({ index }) => index > animStep)
    .map(({ hop, index }) => {
      const pt = project(hop.center.ra, hop.center.dec);
      if (!pt) return null;
      return (
        <g key={`ghost-fov-${index}`}>
          {fovShape === 'circle' ? (
            <circle
              cx={pt.x}
              cy={pt.y}
              r={(fovWidth / 2) * scale}
              fill="rgba(245, 158, 11, 0.05)"
              stroke="rgba(245, 158, 11, 0.30)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ) : (
            <rect
              x={pt.x - (fovWidth / 2) * scale}
              y={pt.y - (fovHeight / 2) * scale}
              width={fovWidth * scale}
              height={fovHeight * scale}
              fill="rgba(245, 158, 11, 0.05)"
              stroke="rgba(245, 158, 11, 0.30)"
              strokeWidth="1"
              strokeDasharray="4 4"
              rx="3"
            />
          )}
        </g>
      );
    })}
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd /Users/lorenzo/Downloads/starhop-planner-source && npm run check
  ```

  Expected: no errors.

- [ ] **Step 4: Smoke-check in browser**

  The dev server is already running on port 3001. Open http://localhost:3001, pick any target (e.g. M31), compute a route, and step to step 1. Amber dashed circles should appear at the positions of steps 2, 3, 4, … and disappear as you advance past each one. On the last step no ghost circles should appear.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/lorenzo/Downloads/starhop-planner-source
  git add client/src/components/SkyChart.tsx
  git commit -m "feat: render amber ghost FOV circles for upcoming route steps"
  ```

---

### Task 2: Add show/hide toggle button to controls panel

**Files:**
- Modify: `client/src/components/SkyChart.tsx:881` (add button inside the sliders panel)

- [ ] **Step 1: Add toggle button inside the sliders panel**

  The sliders panel `<div>` ends just before the zoom buttons div (~line 881). Inside that panel `<div>`, after the last slider column (navStarSize, ends ~line 880), add another column:

  ```tsx
  {/* Ghost circles toggle */}
  <div
    className="flex flex-col items-center gap-0.5"
    title={showGhostCircles ? 'Hide upcoming FOV circles' : 'Show upcoming FOV circles'}
  >
    <button
      onClick={() => setShowGhostCircles(v => !v)}
      style={{
        width: 18,
        height: 60,
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          cx="7" cy="7" r="5.5"
          stroke={showGhostCircles ? 'rgba(245,158,11,0.75)' : 'rgba(77,98,128,0.6)'}
          strokeWidth="1.2"
          strokeDasharray="3 2"
          fill={showGhostCircles ? 'rgba(245,158,11,0.12)' : 'none'}
        />
      </svg>
    </button>
    <span
      className="text-[9px] select-none leading-none"
      style={{ color: showGhostCircles ? 'rgba(245,158,11,0.6)' : '#4d6280' }}
    >
      ◌
    </span>
  </div>
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd /Users/lorenzo/Downloads/starhop-planner-source && npm run check
  ```

  Expected: no errors.

- [ ] **Step 3: Verify toggle works in browser**

  In the running app at http://localhost:3001: with a route active, click the new dashed-circle button in the controls panel. Ghost circles should disappear; clicking again should restore them. The button icon should turn amber when active and grey when off.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/lorenzo/Downloads/starhop-planner-source
  git add client/src/components/SkyChart.tsx
  git commit -m "feat: add show/hide toggle for ghost FOV circles"
  ```
