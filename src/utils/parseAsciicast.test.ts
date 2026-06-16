import { describe, it, expect } from 'vitest';
import { parseAsciicast, parseResizeData, formatTime } from './parseAsciicast';

const header = JSON.stringify({ version: 2, width: 80, height: 24 });

describe('parseAsciicast', () => {
    it('parses header + output/input/resize events', () => {
        const raw = [
            header,
            '[0.5, "o", "hello"]',
            '[1.0, "i", "ls\\n"]',
            '[1.2, "r", "100x30"]',
        ].join('\n');
        const cast = parseAsciicast(raw);
        expect(cast.header.width).toBe(80);
        expect(cast.events).toHaveLength(3);
        expect(cast.events.map(e => e.type)).toEqual(['o', 'i', 'r']);
        expect(cast.duration).toBe(1.2);
    });

    it('throws on empty input', () => {
        expect(() => parseAsciicast('')).toThrow('Empty recording file');
        expect(() => parseAsciicast('  \n  \n')).toThrow('Empty recording file');
    });

    it('throws on unsupported version', () => {
        expect(() => parseAsciicast(JSON.stringify({ version: 1, width: 80, height: 24 })))
            .toThrow('Unsupported asciinema version: 1');
    });

    it('skips malformed event lines without throwing', () => {
        const raw = [
            header,
            'not json at all',
            '[0.1, "o", "ok"]',
            '[0.2, "o"]',            // too short
            '{"not":"array"}',        // not an array
            '[0.3, "x", "unknown"]',  // unknown event type
            '["bad", "o", "data"]',   // time not a number
            '[0.4, "o", 123]',        // data not a string
            '[0.5, "i", "good"]',
        ].join('\n');
        const cast = parseAsciicast(raw);
        expect(cast.events.map(e => e.data)).toEqual(['ok', 'good']);
        expect(cast.duration).toBe(0.5);
    });

    it('duration is 0 when no events', () => {
        expect(parseAsciicast(header).duration).toBe(0);
    });
});

describe('parseResizeData', () => {
    it('parses valid {cols}x{rows}', () => {
        expect(parseResizeData('120x40')).toEqual({ cols: 120, rows: 40 });
    });
    it('rejects malformed / zero / negative', () => {
        expect(parseResizeData('80')).toBeNull();
        expect(parseResizeData('0x40')).toBeNull();
        expect(parseResizeData('axb')).toBeNull();
        expect(parseResizeData('80x40x10')).toBeNull();
        expect(parseResizeData('')).toBeNull();
    });
});

describe('formatTime', () => {
    it('formats m:ss.d', () => {
        expect(formatTime(0)).toBe('0:00.0');
        expect(formatTime(65.4)).toBe('1:05.4');
        expect(formatTime(9.99)).toBe('0:09.9');
    });
});
