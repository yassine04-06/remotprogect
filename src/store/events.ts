type EventCallback<T = unknown> = (payload: T) => void;

class EventEmitter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private listeners: Record<string, EventCallback<any>[]> = {};

    on<T>(event: string, callback: EventCallback<T>) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);

        return () => this.off(event, callback);
    }

    off<T>(event: string, callback: EventCallback<T>) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit<T>(event: string, payload?: T) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(payload));
    }
}

export const eventBus = new EventEmitter();
