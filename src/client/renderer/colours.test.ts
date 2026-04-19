import { describe, expect, it } from 'vitest';
import { isOwnShipForViewer, viewerSideFor } from './colours';

describe('viewerSideFor', () => {
  it('maps own vs enemy when the viewer is one of the players', () => {
    expect(viewerSideFor(0, 0)).toBe('own');
    expect(viewerSideFor(1, 0)).toBe('enemy');
    expect(viewerSideFor(0, 1)).toBe('enemy');
    expect(viewerSideFor(1, 1)).toBe('own');
  });

  it('anchors P0=own and P1=enemy for spectators', () => {
    expect(viewerSideFor(0, -1)).toBe('own');
    expect(viewerSideFor(1, -1)).toBe('enemy');
  });
});

describe('isOwnShipForViewer', () => {
  it('returns true only for ships on the viewer side', () => {
    expect(isOwnShipForViewer(0, 0)).toBe(true);
    expect(isOwnShipForViewer(1, 0)).toBe(false);
    expect(isOwnShipForViewer(0, -1)).toBe(true);
    expect(isOwnShipForViewer(1, -1)).toBe(false);
  });
});
