// @vitest-environment jsdom
// Editor preferences (grid, snapping, panel sizes …) kept in localStorage, not in the project file.
import { describe, it, expect } from 'vitest';
import { ui, DEFAULT_UI, PREF_KEYS, sanitizePrefs } from '../../src/lib/stores/ui';

describe('preferences', () => {
  it('snapping to objects starts off; the grid and snap settings are written when they change, nothing else', () => {
    expect(DEFAULT_UI.snapObjects).toBe(false);
    localStorage.removeItem('svge.preferences.v1');
    ui.set({ gridEnabled: true, gridSizeX: 25 });
    const saved = JSON.parse(localStorage.getItem('svge.preferences.v1')!);
    expect(saved).toMatchObject({ gridEnabled: true, gridSizeX: 25 });
    expect(Object.keys(saved).sort()).toEqual([...PREF_KEYS].sort());
    expect('selectedIds' in saved || 'fill' in saved).toBe(false);
    ui.set(Object.fromEntries(PREF_KEYS.map(k => [k, DEFAULT_UI[k]])));
  });
  it('stored values are checked: wrong types and keys are dropped, numbers clamped', () => {
    expect(sanitizePrefs({ gridEnabled: 'yes', gridSizeX: -5, panelWidth: 99999, tool: 'pen', blobSize: 50 }))
      .toEqual({ gridSizeX: 1, panelWidth: 560, blobSize: 50 });
    expect(sanitizePrefs('junk')).toEqual({});
  });
});
