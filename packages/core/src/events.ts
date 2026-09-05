export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

/**
 * Minimal typed emitter. A listener that throws never breaks the others or
 * the SDK operation that emitted; the error is reported through `onError`.
 */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  onError: (error: unknown, event: keyof Events) => void = () => {};

  on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<E extends keyof Events>(event: E, listener: Listener<Events[E]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<never>);
    if (!set.size) this.listeners.delete(event);
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        (listener as Listener<Events[E]>)(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size || 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
