import { beforeEach, describe, expect, it, vi } from 'vitest';

import { autoJoinFromUrl } from './client-runtime';

describe('autoJoinFromUrl', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/');
  });

  it('strips dead code params when route falls back to the menu', () => {
    history.replaceState(null, '', '/?code=dead');
    const joinGame = vi.fn();
    const spectateGame = vi.fn();
    const viewArchivedReplay = vi.fn();
    const setMenuState = vi.fn();

    autoJoinFromUrl(joinGame, spectateGame, viewArchivedReplay, setMenuState);

    expect(window.location.search).toBe('');
    expect(joinGame).not.toHaveBeenCalled();
    expect(setMenuState).toHaveBeenCalledOnce();
  });

  it('keeps valid live-game routes and starts a join', () => {
    history.replaceState(null, '', '/?code=ABCDE');
    const joinGame = vi.fn();

    autoJoinFromUrl(joinGame, vi.fn(), vi.fn(), vi.fn());

    expect(window.location.search).toBe('?code=ABCDE');
    expect(joinGame).toHaveBeenCalledWith('ABCDE', null);
  });
});
