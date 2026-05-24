// LOW-9 + M-6: Parse asciinema v2 (.cast) recordings.
// Beyond the standard 'o' (output) events we also surface 'i' (user input)
// and 'r' (resize, data formatted as "{cols}x{rows}" — custom extension
// produced by the Rust recorder so playback can resize the terminal).

export interface AsciicastHeader {
    version: number;
    width: number;
    height: number;
    timestamp?: number;
    title?: string;
}

export type AsciicastEventType = 'o' | 'i' | 'r';

export interface AsciicastEvent {
    time: number;
    type: AsciicastEventType;
    data: string;
}

export interface Asciicast {
    header: AsciicastHeader;
    events: AsciicastEvent[];
    duration: number;
}

export function parseAsciicast(raw: string): Asciicast {
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
        throw new Error('Empty recording file');
    }

    const header: AsciicastHeader = JSON.parse(lines[0]);
    if (header.version !== 2) {
        throw new Error(`Unsupported asciinema version: ${header.version}`);
    }

    const events: AsciicastEvent[] = [];

    for (let i = 1; i < lines.length; i++) {
        try {
            const parsed = JSON.parse(lines[i]);
            if (!Array.isArray(parsed) || parsed.length < 3) continue;
            const [time, type, data] = parsed as [number, string, string];
            if (typeof time !== 'number' || typeof data !== 'string') continue;
            if (type === 'o' || type === 'i' || type === 'r') {
                events.push({ time, type, data });
            }
        } catch {
            // Skip malformed lines
        }
    }

    const duration = events.length > 0 ? events[events.length - 1].time : 0;

    return { header, events, duration };
}

/** Parse a "{cols}x{rows}" resize event payload. Returns null if malformed. */
export function parseResizeData(data: string): { cols: number; rows: number } | null {
    const m = data.match(/^(\d+)x(\d+)$/);
    if (!m) return null;
    const cols = Number(m[1]);
    const rows = Number(m[2]);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
    return { cols, rows };
}

export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}
