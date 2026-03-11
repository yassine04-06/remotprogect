import { create } from 'zustand';
import type {
    ServerConnection,
    Group,
    Tab,
    TabStatus,
    CreateConnectionRequest,
    UpdateConnectionRequest,
    SavedCommand,
    CreateSavedCommandRequest,
    UpdateSavedCommandRequest
} from '../types';
import * as api from '../services/api';

interface ToastMessage {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    description: string | React.ReactNode;
}

interface AppStore {
    isVaultUnlocked: boolean;
    isFirstLaunch: boolean;
    connections: ServerConnection[];
    groups: Group[];
    savedCommands: SavedCommand[];
    tabs: Tab[];
    isBroadcastMode: boolean;
    activeTabId: string | null;
    searchQuery: string;
    toasts: ToastMessage[];
    isLoading: boolean;

    // Dialog states
    showConnectionDialog: boolean;
    showGroupDialog: boolean;
    showSettingsDialog: boolean;
    showPortScanner: boolean;
    showExternalTools: boolean;
    showCommandLibraryDialog: boolean;
    showCommandPalette: boolean;
    editingConnection: ServerConnection | null;
    editingGroup: Group | null;
    theme: 'default' | 'stealth' | 'matrix' | 'cyberpunk' | 'light';

    // Actions
    setVaultUnlocked: (unlocked: boolean) => void;
    setFirstLaunch: (first: boolean) => void;
    setConnections: (connections: ServerConnection[]) => void;
    setGroups: (groups: Group[]) => void;
    setSavedCommands: (commands: SavedCommand[]) => void;
    setBroadcastMode: (mode: boolean) => void;
    setActiveTabId: (id: string | null) => void;
    setActiveTab: (id: string | null) => void;
    addTab: (tab: Tab) => void;
    openTab: (connection: ServerConnection) => void;
    removeTab: (id: string) => void;
    closeTab: (id: string) => void;
    updateTabStatus: (id: string, status: TabStatus) => void;
    setSearchQuery: (q: string) => void;
    addToast: (toast: Omit<ToastMessage, 'id'>) => void;
    removeToast: (id: string) => void;

    // Dialog actions
    setShowConnectionDialog: (show: boolean) => void;
    setShowGroupDialog: (show: boolean) => void;
    setShowSettingsDialog: (show: boolean) => void;
    setShowPortScanner: (show: boolean) => void;
    setShowExternalTools: (show: boolean) => void;
    setShowCommandLibraryDialog: (show: boolean) => void;
    setShowCommandPalette: (show: boolean) => void;
    setEditingConnection: (connection: ServerConnection | null) => void;
    setEditingGroup: (group: Group | null) => void;

    // API Actions
    fetchData: () => Promise<void>;
    refreshData: () => Promise<void>;
    createConnection: (req: CreateConnectionRequest) => Promise<void>;
    updateConnection: (req: UpdateConnectionRequest) => Promise<void>;
    deleteConnection: (id: string) => Promise<void>;
    createGroup: (name: string, parentId?: string | null) => Promise<void>;
    updateGroup: (id: string, name: string) => Promise<void>;
    deleteGroup: (id: string) => Promise<void>;

    // Command Library Actions
    createSavedCommand: (req: CreateSavedCommandRequest) => Promise<void>;
    updateSavedCommand: (req: UpdateSavedCommandRequest) => Promise<void>;
    deleteSavedCommand: (id: string) => Promise<void>;
    setTheme: (theme: AppStore['theme']) => void;
}

let toastCounter = 0;

export const useAppStore = create<AppStore>((set, get) => ({
    isVaultUnlocked: false,
    isFirstLaunch: false,
    connections: [],
    groups: [],
    savedCommands: [],
    tabs: [],
    isBroadcastMode: false,
    activeTabId: null,
    searchQuery: '',
    toasts: [],
    isLoading: false,
    showConnectionDialog: false,
    showGroupDialog: false,
    showSettingsDialog: false,
    showPortScanner: false,
    showExternalTools: false,
    showCommandLibraryDialog: false,
    showCommandPalette: false,
    editingConnection: null,
    editingGroup: null,
    theme: (localStorage.getItem('nexus-theme') as any) || 'default',

    setVaultUnlocked: (unlocked) => set({ isVaultUnlocked: unlocked }),
    setFirstLaunch: (first) => set({ isFirstLaunch: first }),
    setConnections: (connections) => set({ connections }),
    setGroups: (groups) => set({ groups }),
    setSavedCommands: (savedCommands) => set({ savedCommands }),
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
            connection: c // Pass the full connection object
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

    updateTabStatus: (id, status) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, status } : t)
    })),

    setSearchQuery: (searchQuery) => set({ searchQuery }),

    addToast: (toast) => {
        const id = `toast-${toastCounter++}`;
        set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
        setTimeout(() => get().removeToast(id), 5000);
    },

    removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),

    setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
    setShowGroupDialog: (show) => set({ showGroupDialog: show }),
    setShowSettingsDialog: (show) => set({ showSettingsDialog: show }),
    setShowPortScanner: (show) => set({ showPortScanner: show }),
    setShowExternalTools: (show) => set({ showExternalTools: show }),
    setShowCommandLibraryDialog: (show) => set({ showCommandLibraryDialog: show }),
    setShowCommandPalette: (show) => set({ showCommandPalette: show }),
    setEditingConnection: (connection) => set({ editingConnection: connection }),
    setEditingGroup: (group) => set({ editingGroup: group }),

    fetchData: async () => {
        try {
            const [conns, grps, cmds] = await Promise.all([
                api.getConnections(),
                api.getGroups(),
                api.getSavedCommands()
            ]);
            set({ connections: conns, groups: grps, savedCommands: cmds });
        } catch (e) {
            get().addToast({ type: 'error', title: 'Fetch Error', description: String(e) });
        }
    },

    refreshData: async () => get().fetchData(),

    createConnection: async (req) => {
        try {
            await api.createConnection(req);
            await get().fetchData();
            set({ showConnectionDialog: false });
        } catch (e) {
            get().addToast({ type: 'error', title: 'Create Failed', description: String(e) });
            throw e;
        }
    },

    updateConnection: async (req) => {
        try {
            await api.updateConnection(req);
            await get().fetchData();
            set({ showConnectionDialog: false, editingConnection: null });
        } catch (e) {
            get().addToast({ type: 'error', title: 'Update Failed', description: String(e) });
            throw e;
        }
    },

    deleteConnection: async (id) => {
        try {
            await api.deleteConnection(id);
            await get().fetchData();
        } catch (e) {
            get().addToast({ type: 'error', title: 'Delete Failed', description: String(e) });
        }
    },

    createGroup: async (name, parentId) => {
        try {
            await api.createGroup(name, parentId);
            await get().fetchData();
            set({ showGroupDialog: false });
        } catch (e) {
            get().addToast({ type: 'error', title: 'Create Group Failed', description: String(e) });
        }
    },

    updateGroup: async (id, name) => {
        try {
            await api.updateGroup(id, name);
            await get().fetchData();
            set({ showGroupDialog: false, editingGroup: null });
        } catch (e) {
            get().addToast({ type: 'error', title: 'Update Group Failed', description: String(e) });
        }
    },

    deleteGroup: async (id) => {
        try {
            await api.deleteGroup(id);
            await get().fetchData();
        } catch (e) {
            get().addToast({ type: 'error', title: 'Delete Group Failed', description: String(e) });
        }
    },

    createSavedCommand: async (req) => {
        try {
            await api.createSavedCommand(req);
            await get().fetchData();
        } catch (e) {
            get().addToast({ type: 'error', title: 'Create Command Failed', description: String(e) });
            throw e;
        }
    },

    updateSavedCommand: async (req) => {
        try {
            await api.updateSavedCommand(req);
            await get().fetchData();
        } catch (e) {
            get().addToast({ type: 'error', title: 'Update Command Failed', description: String(e) });
            throw e;
        }
    },

    deleteSavedCommand: async (id) => {
        try {
            await api.deleteSavedCommand(id);
            await get().fetchData();
        } catch (e) {
            get().addToast({ type: 'error', title: 'Delete Command Failed', description: String(e) });
            throw e;
        }
    },

    setTheme: (theme) => {
        localStorage.setItem('nexus-theme', theme);
        set({ theme });
    },
}));
