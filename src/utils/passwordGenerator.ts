// Cryptographically-secure password generator (uses Web Crypto, not Math.random).

export interface PasswordOptions {
    length: number;
    lowercase: boolean;
    uppercase: boolean;
    digits: boolean;
    symbols: boolean;
    /** Exclude visually ambiguous chars (0/O, 1/l/I) for human transcription. */
    avoidAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: true,
};

const SETS = {
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.<>?',
};
const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|']);

/** Unbiased index in [0, max) via rejection sampling over crypto bytes. */
function secureIndex(max: number): number {
    const limit = 256 - (256 % max);
    const buf = new Uint8Array(1);
    let b: number;
    do {
        crypto.getRandomValues(buf);
        b = buf[0];
    } while (b >= limit);
    return b % max;
}

export function generatePassword(opts: PasswordOptions = DEFAULT_PASSWORD_OPTIONS): string {
    let pool = '';
    if (opts.lowercase) pool += SETS.lowercase;
    if (opts.uppercase) pool += SETS.uppercase;
    if (opts.digits) pool += SETS.digits;
    if (opts.symbols) pool += SETS.symbols;
    if (opts.avoidAmbiguous) {
        pool = [...pool].filter(c => !AMBIGUOUS.has(c)).join('');
    }
    if (pool.length === 0) pool = SETS.lowercase; // never empty

    const len = Math.max(4, Math.min(128, opts.length));
    let out = '';
    for (let i = 0; i < len; i++) out += pool[secureIndex(pool.length)];
    return out;
}
