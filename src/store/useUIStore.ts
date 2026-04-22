import { create } from 'zustand';

export interface ToastMessage {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    description: string | React.ReactNode;
}

interface UIStore {
    isInitialized: boolean;
    isVaultUnlocked: boolean;
    isFirstLaunch: boolean;
    toasts: ToastMessage[];
    isLoading: boolean;
    isFullscreen: boolean;
    theme: 'default' | 'stealth' | 'matrix' | 'cyberpunk' | 'light';

    // Dialog states
    showConnectionDialog: boolean;
    showGroupDialog: boolean;
    showSettingsDialog: boolean;
    showPortScanner: boolean;
    showExternalTools: boolean;
    showCommandLibraryDialog: boolean;
    showCredentialManager: boolean;
    showCommandPalette: boolean;

    // Actions
    setIsInitialized: (init: boolean) => void;
    setIsLoading: (loading: boolean) => void;
    setIsFullscreen: (fullscreen: boolean) => void;
    setVaultUnlocked: (unlocked: boolean) => void;
    setFirstLaunch: (first: boolean) => void;
    addToast: (toast: Omit<ToastMessage, 'id'>) => void;
    removeToast: (id: string) => void;
    setTheme: (theme: UIStore['theme']) => void;

    // Dialog actions
    setShowConnectionDialog: (show: boolean) => void;
    setShowGroupDialog: (show: boolean) => void;
    setShowSettingsDialog: (show: boolean) => void;
    setShowPortScanner: (show: boolean) => void;
    setShowExternalTools: (show: boolean) => void;
    setShowCommandLibraryDialog: (show: boolean) => void;
    setShowCredentialManager: (show: boolean) => void;
    setShowCommandPalette: (show: boolean) => void;
}

let toastCounter = 0;

export const useUIStore = create<UIStore>((set, get) => ({
    isInitialized: false,
    isVaultUnlocked: false,
    isFirstLaunch: false,
    toasts: [],
    isLoading: false,
    isFullscreen: false,
    theme: (localStorage.getItem('nexus-theme') as any) || 'default',

    showConnectionDialog: false,
    showGroupDialog: false,
    showSettingsDialog: false,
    showPortScanner: false,
    showExternalTools: false,
    showCommandLibraryDialog: false,
    showCredentialManager: false,
    showCommandPalette: false,

    setIsInitialized: (isInitialized) => set({ isInitialized }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setIsFullscreen: (isFullscreen) => set({ isFullscreen }),
    setVaultUnlocked: (unlocked) => set({ isVaultUnlocked: unlocked }),
    setFirstLaunch: (first) => set({ isFirstLaunch: first }),
    
    addToast: (toast) => {
        const id = `toast-${toastCounter++}`;
        set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
        setTimeout(() => get().removeToast(id), 5000);
    },

    removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),

    setTheme: (theme) => {
        localStorage.setItem('nexus-theme', theme);
        set({ theme });
    },

    setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
    setShowGroupDialog: (show) => set({ showGroupDialog: show }),
    setShowSettingsDialog: (show) => set({ showSettingsDialog: show }),
    setShowPortScanner: (show) => set({ showPortScanner: show }),
    setShowExternalTools: (show) => set({ showExternalTools: show }),
    setShowCommandLibraryDialog: (show) => set({ showCommandLibraryDialog: show }),
    setShowCredentialManager: (show) => set({ showCredentialManager: show }),
    setShowCommandPalette: (show) => set({ showCommandPalette: show }),
}));
