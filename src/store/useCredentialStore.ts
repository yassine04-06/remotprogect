import { create } from 'zustand';
import type { 
    CredentialProfile, 
    SavedCommand, 
    CreateCredentialProfileRequest, 
    UpdateCredentialProfileRequest,
    CreateSavedCommandRequest,
    UpdateSavedCommandRequest
} from '../types';
import * as api from '../services/api';

interface CredentialStore {
    credentialProfiles: CredentialProfile[];
    savedCommands: SavedCommand[];
    loaded: boolean;

    // Actions
    setCredentialProfiles: (profiles: CredentialProfile[]) => void;
    setSavedCommands: (commands: SavedCommand[]) => void;
    resetForLock: () => void;

    // API Actions
    fetchCredentialProfiles: () => Promise<void>;
    
    // Credential Profiles Actions
    createCredentialProfile: (req: CreateCredentialProfileRequest) => Promise<void>;
    updateCredentialProfile: (req: UpdateCredentialProfileRequest) => Promise<void>;
    deleteCredentialProfile: (id: string) => Promise<void>;

    // Command Library Actions
    createSavedCommand: (req: CreateSavedCommandRequest) => Promise<void>;
    updateSavedCommand: (req: UpdateSavedCommandRequest) => Promise<void>;
    deleteSavedCommand: (id: string) => Promise<void>;
}

export const useCredentialStore = create<CredentialStore>((set, get) => ({
    credentialProfiles: [],
    savedCommands: [],
    loaded: false,

    setCredentialProfiles: (credentialProfiles) => set({ credentialProfiles }),
    setSavedCommands: (savedCommands) => set({ savedCommands }),

    resetForLock: () => set({
        credentialProfiles: [],
        savedCommands: [],
        loaded: false,
    }),

    fetchCredentialProfiles: async () => {
        if (get().loaded) return;
        try {
            const [cmds, profiles] = await Promise.all([
                api.getSavedCommands(),
                api.getCredentialProfiles()
            ]);
            set({ savedCommands: cmds, credentialProfiles: profiles, loaded: true });
        } catch (e) {
            // Don't set loaded on failure — allow retry
            throw e;
        }
    },

    createCredentialProfile: async (req) => {
        await api.createCredentialProfile(req);
        const profiles = await api.getCredentialProfiles();
        set({ credentialProfiles: profiles });
    },

    updateCredentialProfile: async (req) => {
        await api.updateCredentialProfile(req);
        const profiles = await api.getCredentialProfiles();
        set({ credentialProfiles: profiles });
    },

    deleteCredentialProfile: async (id) => {
        await api.deleteCredentialProfile(id);
        const profiles = await api.getCredentialProfiles();
        set({ credentialProfiles: profiles });
    },

    createSavedCommand: async (req) => {
        await api.createSavedCommand(req);
        const cmds = await api.getSavedCommands();
        set({ savedCommands: cmds });
    },

    updateSavedCommand: async (req) => {
        await api.updateSavedCommand(req);
        const cmds = await api.getSavedCommands();
        set({ savedCommands: cmds });
    },

    deleteSavedCommand: async (id) => {
        await api.deleteSavedCommand(id);
        const cmds = await api.getSavedCommands();
        set({ savedCommands: cmds });
    }
}));
