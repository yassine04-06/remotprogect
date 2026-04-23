import { create } from 'zustand';
import type { Tab, TabStatus, ServerConnection } from '../types';
import { eventBus } from './events';

interface TabStore {
    tabs: Tab[];
    isBroadcastMode: boolean;
    activeTabId: string | null;

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
}

// Track whether the eventBus listener has been registered to prevent duplicates
let eventListenerRegistered = false;

export const useTabStore = create<TabStore>((set, get) => {
    // Register event listener exactly once, synchronously, with a guard
    if (!eventListenerRegistered) {
        eventListenerRegistered = true;
        eventBus.on('connection_deleted', (id: string) => {
            const tabs = get().tabs;
            const tabToClose = tabs.find(t => t.connectionId === id);
            if (tabToClose) {
                get().closeTab(tabToClose.id);
            }
        });
    }

    return {
        tabs: [],
        isBroadcastMode: false,
        activeTabId: null,

        setBroadcastMode: (isBroadcastMode) => set({ isBroadcastMode }),
        setActiveTabId: (activeTabId) => set({ activeTabId }),
        setActiveTab: (id) => set({ activeTabId: id }),

    addTab: (tab) => set((state) => {
        const exists = state.tabs.find(t => t.id === tab.id);
        if (exists) return { activeTabId: tab.id };
        return { tabs: [...state.tabs, tab], activeTabId: tab.id };
    }),

    openTab: (c) => {
        const exists = get().tabs.find(t => t.connectionId === c.id);
        if (exists) {
            set({ activeTabId: exists.id });
            return;
        }
        get().addTab({
            id: `tab-${Date.now()}`,
            connectionId: c.id,
            connectionName: c.name,
            protocol: c.protocol,
            status: 'idle',
            connection: c 
        });
    },

    removeTab: (id) => set((state) => {
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
        return { tabs: newTabs, activeTabId: newActive };
    }),

    closeTab: (id) => get().removeTab(id),

    closeAllTabs: () => set({ tabs: [], activeTabId: null }),

    updateTabStatus: (id, status) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, status } : t)
    }))
    };
});
