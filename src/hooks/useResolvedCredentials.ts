import { useState, useCallback } from 'react';
import * as api from '../services/api';
import type { ResolvedCredentials } from '../types';
import { useUIStore } from '../store';

export function useResolvedCredentials(connectionId: string) {
    const [credentials, setCredentials] = useState<ResolvedCredentials | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const addToast = useUIStore(s => s.addToast);

    const resolve = useCallback(async (): Promise<ResolvedCredentials | null> => {
        setIsLoading(true);
        setError(null);
        try {
            const creds = await api.resolveCredentials(connectionId);
            setCredentials(creds);
            return creds;
        } catch (err: any) {
            const msg = String(err);
            setError(msg);
            addToast({
                type: 'error',
                title: 'Credential Resolution Failed',
                description: msg,
            });
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [connectionId, addToast]);

    return { credentials, resolve, isLoading, error };
}
