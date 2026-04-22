import { create } from 'zustand';
import type { ServerConnection, Group, CreateConnectionRequest, UpdateConnectionRequest } from '../types';
import * as api from '../services/api';
import { eventBus } from './events';

interface ConnectionStore {
    connections: ServerConnection[];
    groups: Group[];
    searchQuery: string;
    editingConnection: ServerConnection | null;
    editingGroup: Group | null;
    
    // Actions
    setConnections: (connections: ServerConnection[]) => void;
    setGroups: (groups: Group[]) => void;
    setSearchQuery: (q: string) => void;
    setEditingConnection: (connection: ServerConnection | null) => void;
    setEditingGroup: (group: Group | null) => void;

    // API Actions
    fetchConnections: () => Promise<void>;
    createConnection: (req: CreateConnectionRequest) => Promise<void>;
    updateConnection: (req: UpdateConnectionRequest) => Promise<void>;
    deleteConnection: (id: string) => Promise<void>;
    createGroup: (name: string, parentId?: string | null) => Promise<void>;
    updateGroup: (id: string, name: string) => Promise<void>;
    deleteGroup: (id: string) => Promise<void>;
}

let loaded = false;

export const useConnectionStore = create<ConnectionStore>((set) => ({
    connections: [],
    groups: [],
    searchQuery: '',
    editingConnection: null,
    editingGroup: null,

    setConnections: (connections) => set({ connections }),
    setGroups: (groups) => set({ groups }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setEditingConnection: (editingConnection) => set({ editingConnection }),
    setEditingGroup: (editingGroup) => set({ editingGroup }),

    fetchConnections: async () => {
        if (loaded) return;
        loaded = true;
        
        try {
            const [conns, grps] = await Promise.all([
                api.getConnections(),
                api.getGroups()
            ]);
            set({ connections: conns, groups: grps });
        } catch (e) {
            loaded = false; // allow retry if failed
            throw e;
        }
    },

    createConnection: async (req) => {
        await api.createConnection(req);
        const conns = await api.getConnections();
        set({ connections: conns });
    },

    updateConnection: async (req) => {
        await api.updateConnection(req);
        const conns = await api.getConnections();
        set({ connections: conns, editingConnection: null });
    },

    deleteConnection: async (id) => {
        await api.deleteConnection(id);
        const conns = await api.getConnections();
        set({ connections: conns });
        eventBus.emit('connection_deleted', id);
    },

    createGroup: async (name, parentId) => {
        await api.createGroup(name, parentId);
        const grps = await api.getGroups();
        set({ groups: grps });
    },

    updateGroup: async (id, name) => {
        await api.updateGroup(id, name);
        const grps = await api.getGroups();
        set({ groups: grps, editingGroup: null });
    },

    deleteGroup: async (id) => {
        await api.deleteGroup(id);
        const grps = await api.getGroups();
        set({ groups: grps });
    }
}));
