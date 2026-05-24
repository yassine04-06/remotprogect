import { create } from 'zustand';
import type { Tab, TabStatus, ServerConnection } from '../types';

// eventBus is imported where the listener is wired — NOT here.
// MED-A4: the listener was previously registered inside create() with a
// module-level guard flag.  That pattern breaks under Vite HMR because the
// module is re-evaluated (resetting the flag) while the eventBus singleton
// (which survives HMR) still holds the old callback — resulting in N
// duplicate listeners after N hot-reloads.  The fix is to move the
// subscription to a React useEffect in App.tsx so React's cleanup cycle
// removes the old listener before mounting the new one.

interface TabStore {
    tabs: Tab[];
    isBroadcastMode: boolean;
    activeTabId: string | null;
    // 90-6: split pane
    splitTabId: string | null;
    splitDirection: 'h' | 'v';
    // M-2: per-tab last-active timestamp (ms). Drives the MRU mount window in
    // App.tsx so only the most recently used tabs render the heavy view.
    lastActiveAt: Record<string, number>;

    // Actions
    setBroadcastMode: (mode: boolean) => void;
    setActiveTabId: (id: string | null) => void;
    setActiveTab: (id: string | null) => void;
    addTab: (tab: Tab) => void;
    openTab: (connection: ServerConnection) => void;
    removeTab: (id: string) => void;
    closeTab: (id: string) => void;
    closeAllTabs: () => void;
    updateTabStatus: (id: string, status: TabStatus) => void;
    setSplitTab: (tabId: string | null, direction?: 'h' | 'v') => void;
}

export const useTabStore = create<TabStore>((set, get) => {
    return {
        tabs: [],
        isBroadcastMode: false,
        activeTabId: null,
        splitTabId: null,
        splitDirection: 'h',
        lastActiveAt: {},

        setBroadcastMode: isBroadcastMode => set({ isBroadcastMode }),
        setActiveTabId: activeTabId => set(state => ({
            activeTabId,
            lastActiveAt: activeTabId
                ? { ...state.lastActiveAt, [activeTabId]: Date.now() }
                : state.lastActiveAt,
        })),
        setActiveTab: id => set(state => ({
            activeTabId: id,
            lastActiveAt: id
                ? { ...state.lastActiveAt, [id]: Date.now() }
                : state.lastActiveAt,
        })),

        addTab: tab =>
            set(state => {
                const now = Date.now();
                const exists = state.tabs.find(t => t.id === tab.id);
                if (exists) {
                    return {
                        activeTabId: tab.id,
                        lastActiveAt: { ...state.lastActiveAt, [tab.id]: now },
                    };
                }
                return {
                    tabs: [...state.tabs, tab],
                    activeTabId: tab.id,
                    lastActiveAt: { ...state.lastActiveAt, [tab.id]: now },
                };
            }),

        openTab: c => {
            const exists = get().tabs.find(t => t.connectionId === c.id);
            if (exists) {
                set(state => ({
                    activeTabId: exists.id,
                    lastActiveAt: { ...state.lastActiveAt, [exists.id]: Date.now() },
                }));
                return;
            }
            get().addTab({
                // Date.now() alone collides when two tabs are opened in the
                // same millisecond (test runs + rapid clicks). Add a random
                // suffix so the id is genuinely unique.
                id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                connectionId: c.id,
                connectionName: c.name,
                protocol: c.protocol,
                status: 'idle',
                connection: c,
            });
        },

        removeTab: id =>
            set(state => {
                const idx = state.tabs.findIndex(t => t.id === id);
                const newTabs = state.tabs.filter(t => t.id !== id);
                let newActive = state.activeTabId;
                if (state.activeTabId === id) {
                    if (newTabs.length > 0) {
                        newActive = newTabs[Math.max(0, idx - 1)].id;
                    } else {
                        newActive = null;
                    }
                }
                // Drop the timestamp for the closed tab; refresh activity for the new active tab.
                const { [id]: _dropped, ...remaining } = state.lastActiveAt;
                const lastActiveAt = newActive
                    ? { ...remaining, [newActive]: Date.now() }
                    : remaining;
                return { tabs: newTabs, activeTabId: newActive, lastActiveAt };
            }),

        closeTab: id => get().removeTab(id),

        closeAllTabs: () => set({ tabs: [], activeTabId: null, splitTabId: null, lastActiveAt: {} }),

        updateTabStatus: (id, status) =>
            set(state => ({
                tabs: state.tabs.map(t => (t.id === id ? { ...t, status } : t)),
            })),

        setSplitTab: (tabId, direction = 'h') =>
            set({ splitTabId: tabId, splitDirection: direction }),
    };
});
