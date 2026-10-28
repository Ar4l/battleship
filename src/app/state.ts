import type { Match } from '../game/engine';
import type { Fleet } from '../game/types';

export type NoticeKind = 'room-full' | 'failed' | 'left' | 'version' | 'invalid-move' | 'bad-link';
export type VerdictState = 'pending' | 'verified' | 'cheat' | 'unverified';

export type AppState =
  | { s: 'home'; code?: string }
  | { s: 'lobby-host'; code: number; relaysDown: boolean }
  | { s: 'lobby-guest'; code: number; slow: boolean }
  | { s: 'direct-host'; step: 'gathering' | 'share' | 'connecting'; blob?: string; error?: string }
  | { s: 'direct-guest'; step: 'gathering' | 'share' | 'connecting'; blob?: string }
  | { s: 'forwarded'; ok: boolean; blob: string }
  | { s: 'placement'; ready: { me: boolean; them: boolean } }
  | { s: 'battle'; match: Match; banner?: string; stalled?: boolean }
  | {
      s: 'end';
      match: Match;
      verdict: VerdictState;
      reason?: string;
      /** Their check of my fleet: null = not yet received. */
      theirVerdict: boolean | null;
      theirFleet?: Fleet;
      rematch: { me: boolean; them: boolean };
      peerLeft: boolean;
      editing?: boolean;
    }
  | { s: 'notice'; kind: NoticeKind; code?: number; detail?: string };
