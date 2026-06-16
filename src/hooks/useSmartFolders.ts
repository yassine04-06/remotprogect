import { useCallback, useEffect, useState } from 'react';

// Smart folders are saved view presets (a tag + sort mode) that re-populate the
// connection list on click. Stored locally — they're personal views, not data.

export interface SmartFolder {
    id: string;
    name: string;
    tag: string;
    sortMode: 'alpha' | 'recent' | 'favorites';
}

const KEY = 'nexorc-smart-folders';

function load(): SmartFolder[] {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as SmartFolder[]) : [];
    } catch {
        return [];
    }
}

export function useSmartFolders() {
    const [folders, setFolders] = useState<SmartFolder[]>(load);

    useEffect(() => {
        localStorage.setItem(KEY, JSON.stringify(folders));
    }, [folders]);

    const addFolder = useCallback((name: string, tag: string, sortMode: SmartFolder['sortMode']) => {
        setFolders(f => [...f, { id: crypto.randomUUID(), name, tag, sortMode }]);
    }, []);

    const removeFolder = useCallback((id: string) => {
        setFolders(f => f.filter(x => x.id !== id));
    }, []);

    return { folders, addFolder, removeFolder };
}
