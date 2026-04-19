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
    const resumeLocalGame = vi.fn(() => false);
    const setMenuState = vi.fn();

    autoJoinFromUrl(
      joinGame,
      spectateGame,
      viewArchivedReplay,
      resumeLocalGame,
      setMenuState,
    );

    expect(window.location.search).toBe('');
    expect(joinGame).not.toHaveBeenCalled();
    expect(resumeLocalGame).toHaveBeenCalledOnce();
    expect(setMenuState).toHaveBeenCalledOnce();
  });

  it('keeps valid live-game routes and starts a join', () => {
    history.replaceState(null, '', '/?code=ABCDE');
    const joinGame = vi.fn();

    autoJoinFromUrl(
      joinGame,
      vi.fn(),
      vi.fn(),
      vi.fn(() => false),
      vi.fn(),
    );

    expect(window.location.search).toBe('?code=ABCDE');
    expect(joinGame).toHaveBeenCalledWith('ABCDE', null);
  });

  it('restores a local game when there is no URL-driven session', () => {
    const resumeLocalGame = vi.fn(() => true);
    const setMenuState = vi.fn();

    autoJoinFromUrl(vi.fn(), vi.fn(), vi.fn(), resumeLocalGame, setMenuState);

    expect(resumeLocalGame).toHaveBeenCalledOnce();
    expect(setMenuState).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });
});
