import { create } from 'zustand';
import type {
    ServerConnection,
    Group,
    CreateConnectionRequest,
    UpdateConnectionRequest,
} from '../types';
import * as api from '../services/api';
import { eventBus } from './events';

interface ConnectionStore {
    connections: ServerConnection[];
    groups: Group[];
    searchQuery: string;
    editingConnection: ServerConnection | null;
    // M3: when set, the form opens in CREATE mode pre-filled from this template.
    templateConnection: ServerConnection | null;
    editingGroup: Group | null;
    loaded: boolean;

    // Actions
    setConnections: (connections: ServerConnection[]) => void;
    setGroups: (groups: Group[]) => void;
    setSearchQuery: (q: string) => void;
    setEditingConnection: (connection: ServerConnection | null) => void;
    setTemplateConnection: (connection: ServerConnection | null) => void;
    setEditingGroup: (group: Group | null) => void;
    resetForLock: () => void;

    // API Actions
    // force=true bypasses the "already loaded" guard — use it after mutations
    // (import, scan-to-add) to pull fresh data. Default (init) loads once.
    fetchConnections: (force?: boolean) => Promise<void>;
    createConnection: (req: CreateConnectionRequest) => Promise<void>;
    updateConnection: (req: UpdateConnectionRequest) => Promise<void>;
    deleteConnection: (id: string) => Promise<void>;
    createGroup: (name: string, parentId?: string | null) => Promise<void>;
    updateGroup: (id: string, name: string) => Promise<void>;
    deleteGroup: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
    connections: [],
    groups: [],
    searchQuery: '',
    editingConnection: null,
    templateConnection: null,
    editingGroup: null,
    loaded: false,

    setConnections: connections => set({ connections }),
    setGroups: groups => set({ groups }),
    setSearchQuery: searchQuery => set({ searchQuery }),
    setEditingConnection: editingConnection => set({ editingConnection }),
    setTemplateConnection: templateConnection => set({ templateConnection }),
    setEditingGroup: editingGroup => set({ editingGroup }),

    // Called when the vault is locked — resets state so re-unlock refetches fresh data
    resetForLock: () =>
        set({
            connections: [],
            groups: [],
            loaded: false,
            editingConnection: null,
            editingGroup: null,
        }),

    fetchConnections: async (force = false) => {
        if (get().loaded && !force) return;
        const [conns, grps] = await Promise.all([api.getConnections(), api.getGroups()]);
        set({ connections: conns, groups: grps, loaded: true });
    },

    createConnection: async req => {
        const newConn = await api.createConnection(req);
        set({ connections: [...get().connections, newConn] });
    },

    updateConnection: async req => {
        const updated = await api.updateConnection(req);
        set({
            connections: get().connections.map(c => c.id === updated.id ? updated : c),
            editingConnection: null,
        });
    },

    deleteConnection: async id => {
        await api.deleteConnection(id);
        set({ connections: get().connections.filter(c => c.id !== id) });
        eventBus.emit('connection_deleted', id);
    },

    createGroup: async (name, parentId) => {
        const newGroup = await api.createGroup(name, parentId);
        set({ groups: [...get().groups, newGroup] });
    },

    updateGroup: async (id, name) => {
        await api.updateGroup(id, name);
        set({
            groups: get().groups.map(g => g.id === id ? { ...g, name } : g),
            editingGroup: null,
        });
    },

    deleteGroup: async id => {
        await api.deleteGroup(id);
        set({ groups: get().groups.filter(g => g.id !== id) });
    },
}));
