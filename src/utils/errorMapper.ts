// Centralized error handling mapping Backend AppError to Frontend UI actions

export interface AppError {
    code: string;
    message: string;
}

export function parseBackendError(error: unknown): AppError {
    // If it's the exact JSON structure we expect
    if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
        return error as AppError;
    }

    // Try to parse stringified JSON (Tauri sometimes wraps Rust errors in a string)
    if (typeof error === 'string') {
        try {
            const parsed = JSON.parse(error);
            if (typeof parsed === 'object' && parsed !== null && 'code' in parsed && 'message' in parsed) {
                return parsed as AppError;
            }
        } catch {
            // String is not JSON, fallback
        }
    }

    // Fallback for unexpected errors
    return {
        code: 'UNKNOWN_ERROR',
        message: typeof error === 'string' ? error : String(error)
    };
}

export function getUserFriendlyErrorMessage(error: AppError): string {
    switch (error.code) {
        case 'AUTH_FAILED':
            return 'Authentication failed. Please verify your credentials or master password.';
        case 'DATABASE_ERROR':
            return 'A database error occurred. Your connection may not have been saved properly.';
        case 'NETWORK_ERROR':
            return 'Network timeout or connection refused. Is the server online?';
        case 'VAULT_ERROR':
            return 'Vault is locked or corrupted. Please unlock the vault.';
        case 'NOT_FOUND':
            return 'The requested resource was not found.';
        case 'INTERNAL_ERROR':
            return `Internal System Error: ${error.message}`;
        default:
            return error.message;
    }
}
