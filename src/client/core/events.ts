// Tiny typed event bus for client-side decoupling (net -> fx/audio/hud).
import type { GameEvent, MatchState, RosterEntry } from '../../shared/protocol';

export interface ClientEvents {
  game: GameEvent;
  match: MatchState;
  roster: RosterEntry[];
  notice: string;
  chat: { from: string; text: string; team?: number };
  /** `map`/`mapSeed`: the world the authority runs (the page reloads into it if it built another one). */
  connected: { pid: string; entity: number; map: string; mapSeed: number };
  disconnected: string;
  localSpawn: number;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private map = new Map<keyof ClientEvents, Set<Handler<never>>>();
  on<K extends keyof ClientEvents>(k: K, h: Handler<ClientEvents[K]>): () => void {
    let set = this.map.get(k);
    if (!set) this.map.set(k, (set = new Set()));
    set.add(h as Handler<never>);
    return () => set!.delete(h as Handler<never>);
  }
  emit<K extends keyof ClientEvents>(k: K, payload: ClientEvents[K]): void {
    const set = this.map.get(k);
    if (set) for (const h of set) (h as Handler<ClientEvents[K]>)(payload);
  }
}

export const bus = new EventBus();
