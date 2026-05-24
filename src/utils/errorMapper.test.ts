import { describe, it, expect } from 'vitest';
import { parseBackendError, getUserFriendlyErrorMessage } from './errorMapper';

// ── parseBackendError ─────────────────────────────────────────────────────────

describe('parseBackendError', () => {
    it('passes through a well-formed AppError object unchanged', () => {
        const err = { code: 'AUTH_FAILED', message: 'wrong password' };
        expect(parseBackendError(err)).toEqual(err);
    });

    it('parses a JSON-stringified AppError (Tauri string-wrapping)', () => {
        const inner = { code: 'DATABASE_ERROR', message: 'constraint violation' };
        const result = parseBackendError(JSON.stringify(inner));
        expect(result).toEqual(inner);
    });

    it('falls back to UNKNOWN_ERROR for a plain string that is not JSON', () => {
        const result = parseBackendError('something went wrong');
        expect(result).toEqual({ code: 'UNKNOWN_ERROR', message: 'something went wrong' });
    });

    it('falls back to UNKNOWN_ERROR for a JSON string that lacks code/message fields', () => {
        const result = parseBackendError(JSON.stringify({ foo: 'bar' }));
        expect(result).toEqual({ code: 'UNKNOWN_ERROR', message: JSON.stringify({ foo: 'bar' }) });
    });

    it('falls back to UNKNOWN_ERROR for null', () => {
        const result = parseBackendError(null);
        expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('falls back to UNKNOWN_ERROR for a number', () => {
        const result = parseBackendError(42);
        expect(result.code).toBe('UNKNOWN_ERROR');
        expect(result.message).toBe('42');
    });

    it('falls back to UNKNOWN_ERROR for an object missing the message field', () => {
        const result = parseBackendError({ code: 'AUTH_FAILED' });
        expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('falls back to UNKNOWN_ERROR for an object missing the code field', () => {
        const result = parseBackendError({ message: 'oops' });
        expect(result.code).toBe('UNKNOWN_ERROR');
    });

    it('handles an empty string without crashing', () => {
        const result = parseBackendError('');
        expect(result.code).toBe('UNKNOWN_ERROR');
        expect(result.message).toBe('');
    });

    it('handles undefined without crashing', () => {
        const result = parseBackendError(undefined);
        expect(result.code).toBe('UNKNOWN_ERROR');
    });
});

// ── getUserFriendlyErrorMessage ───────────────────────────────────────────────

describe('getUserFriendlyErrorMessage', () => {
    const cases: Array<[string, RegExp]> = [
        ['AUTH_FAILED',       /authentication failed/i],
        ['DATABASE_ERROR',    /database error/i],
        ['NETWORK_ERROR',     /network timeout|connection refused/i],
        ['VAULT_ERROR',       /vault.*locked|locked.*vault/i],
        ['NOT_FOUND',         /not found/i],
        ['INTERNAL_ERROR',    /internal system error/i],
        ['VALIDATION_ERROR',  /validation message/i],  // should pass message through
        ['UNKNOWN_CODE',      /raw message/i],          // default: pass message through
    ];

    it.each(cases)('code %s returns the expected hint', (code, pattern) => {
        const msg = code === 'VALIDATION_ERROR' ? 'validation message'
                  : code === 'UNKNOWN_CODE'     ? 'raw message'
                  : code === 'INTERNAL_ERROR'   ? 'something broke'
                  : 'ignored';

        const friendly = getUserFriendlyErrorMessage({ code, message: msg });
        expect(friendly).toMatch(pattern);
    });

    it('INTERNAL_ERROR embeds the raw message in the response', () => {
        const result = getUserFriendlyErrorMessage({ code: 'INTERNAL_ERROR', message: 'SEGFAULT' });
        expect(result).toContain('SEGFAULT');
    });

    it('VALIDATION_ERROR returns the message verbatim', () => {
        const result = getUserFriendlyErrorMessage({ code: 'VALIDATION_ERROR', message: 'Port must be 1–65535' });
        expect(result).toBe('Port must be 1–65535');
    });

    it('unknown code returns the raw message verbatim', () => {
        const result = getUserFriendlyErrorMessage({ code: 'MADE_UP', message: 'surprise' });
        expect(result).toBe('surprise');
    });
});
