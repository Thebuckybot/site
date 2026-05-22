/**
 * EventBus — the Bucky VM runtime nervous system.
 *
 * Synchronous publish/subscribe channel that decouples producers of state
 * change from consumers. Services emit events; apps and the runtime react.
 * See docs/architecture/vm-runtime.md (section 5).
 *
 * Delivery is synchronous and ordered by subscription order. Each handler is
 * wrapped so that one failing subscriber cannot break the others.
 */
export function createEventBus() {
    /** @type {Map<string, Set<Function>>} */
    const channels = new Map();

    function on(eventName, handler) {
        if (typeof handler !== "function") return () => {};
        if (!channels.has(eventName)) channels.set(eventName, new Set());
        channels.get(eventName).add(handler);
        return () => off(eventName, handler);
    }

    function once(eventName, handler) {
        const unsubscribe = on(eventName, (payload) => {
            unsubscribe();
            handler(payload);
        });
        return unsubscribe;
    }

    function off(eventName, handler) {
        const set = channels.get(eventName);
        if (!set) return;
        set.delete(handler);
        if (!set.size) channels.delete(eventName);
    }

    function emit(eventName, payload) {
        const set = channels.get(eventName);
        if (!set || !set.size) return;
        // Iterate a copy so handlers may subscribe/unsubscribe during delivery.
        [...set].forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.error(`EventBus handler failed for "${eventName}":`, error);
            }
        });
    }

    function clear() {
        channels.clear();
    }

    return { on, once, off, emit, clear };
}
