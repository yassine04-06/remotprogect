import { useEffect } from 'react';
import { useConnectionStore } from './useConnectionStore';
import { useCredentialStore } from './useCredentialStore';
import { useUIStore } from './useUIStore';
import { parseBackendError, getUserFriendlyErrorMessage } from '../utils/errorMapper';

export function useGlobalDataInitializer() {
  const fetchConnections = useConnectionStore(s => s.fetchConnections);
  const fetchCredentials = useCredentialStore(s => s.fetchCredentialProfiles);
  const setLoading = useUIStore(s => s.setIsLoading);
  const setInitialized = useUIStore(s => s.setIsInitialized);
  const addToast = useUIStore(s => s.addToast);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setLoading(true);

      const results = await Promise.allSettled([
        fetchConnections(),
        fetchCredentials()
      ]);

      if (!mounted) return;

      results.forEach(r => {
        if (r.status === 'rejected') {
          const appError = parseBackendError(r.reason);
          addToast({
            type: 'error',
            title: `Error: ${appError.code}`,
            description: getUserFriendlyErrorMessage(appError)
          });
        }
      });

      setLoading(false);
      setInitialized(true);
    };

    init();

    return () => {
      mounted = false;
    };
  }, [fetchConnections, fetchCredentials, setLoading, setInitialized, addToast]);
}
