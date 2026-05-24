import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
    CredentialProfile,
    CreateCredentialProfileRequest,
    UpdateCredentialProfileRequest,
} from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Credential Profiles ──────────────────────────────────

export const getCredentialProfiles = () => invoke<CredentialProfile[]>('get_credential_profiles');

export const createCredentialProfile = (request: CreateCredentialProfileRequest) =>
    invoke<CredentialProfile>('create_credential_profile', { request });

export const updateCredentialProfile = (request: UpdateCredentialProfileRequest) =>
    invoke('update_credential_profile', { request });

export const deleteCredentialProfile = (id: string) => invoke('delete_credential_profile', { id });

// CRIT-A4: resolveCredentials removed — credentials are now resolved server-side
// inside each *_connect command. The frontend never receives plaintext passwords.
