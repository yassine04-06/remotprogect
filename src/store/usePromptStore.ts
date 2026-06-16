import { create } from 'zustand';

// Imperative replacement for window.prompt(): `await prompt({...})` resolves to
// the entered string, or null if cancelled. A single <PromptDialog/> mounted at
// the app root renders the active request.

interface PromptOptions {
    title: string;
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    /** Optional client-side validation; return an error string to block submit. */
    validate?: (value: string) => string | null;
}

interface PromptState extends PromptOptions {
    open: boolean;
    resolve: ((value: string | null) => void) | null;
    prompt: (opts: PromptOptions) => Promise<string | null>;
    submit: (value: string) => void;
    cancel: () => void;
}

export const usePromptStore = create<PromptState>((set, get) => ({
    open: false,
    title: '',
    resolve: null,
    prompt: opts =>
        new Promise<string | null>(resolve => {
            set({ ...opts, open: true, resolve });
        }),
    submit: value => {
        get().resolve?.(value);
        set({ open: false, resolve: null });
    },
    cancel: () => {
        get().resolve?.(null);
        set({ open: false, resolve: null });
    },
}));

/** Convenience wrapper usable outside React components. */
export const prompt = (opts: PromptOptions) => usePromptStore.getState().prompt(opts);
