// LOW-9: Session recording playback UI — asciinema v2 (.cast) player
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    X, Play, Pause, Square, RefreshCw, Film, Loader2, ChevronRight,
} from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import * as api from '../services/api';
import type { RecordingInfo } from '../types';
import { parseAsciicast, formatTime, parseResizeData } from '../utils/parseAsciicast';
import type { Asciicast } from '../utils/parseAsciicast';

interface Props {
    onClose: () => void;
}

type PlayState = 'stopped' | 'playing' | 'paused';

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
type Speed = typeof SPEED_OPTIONS[number];

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseFilenameDate(filename: string): string {
    // Format: {8-char-id}_{unix_ts}.cast
    const match = filename.match(/_(\d+)\.cast$/);
    if (!match) return filename;
    const ts = parseInt(match[1], 10);
    return new Date(ts * 1000).toLocaleString();
}

export function RecordingsView({ onClose }: Props) {
    const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [cast, setCast] = useState<Asciicast | null>(null);
    const [loadingCast, setLoadingCast] = useState(false);
    const [castError, setCastError] = useState<string | null>(null);

    const [playState, setPlayState] = useState<PlayState>('stopped');
    const [currentTime, setCurrentTime] = useState(0);
    const [speed, setSpeed] = useState<Speed>(1);

    const termContainerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const playTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const currentTimeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const playStartWallRef = useRef<number>(0);
    const playStartCastRef = useRef<number>(0);

    // ESC closes
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    // Load recording list
    const loadList = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setRecordings(await api.sshRecordingList());
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    // Initialize xterm when cast is loaded
    useEffect(() => {
        if (!cast || !termContainerRef.current) return;

        // Dispose previous terminal
        if (termRef.current) {
            termRef.current.dispose();
            termRef.current = null;
        }

        const term = new Terminal({
            cols: cast.header.width,
            rows: cast.header.height,
            theme: {
                background: '#0d0d0d',
                foreground: '#d4d4d4',
                cursor: '#d4d4d4',
            },
            disableStdin: true,
            cursorBlink: false,
            fontSize: 13,
            fontFamily: '"Cascadia Code", "Fira Code", monospace',
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(termContainerRef.current);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        return () => {
            term.dispose();
            termRef.current = null;
        };
    }, [cast]);

    // Clear pending timers helper
    const clearPlayback = useCallback(() => {
        playTimersRef.current.forEach(t => clearTimeout(t));
        playTimersRef.current = [];
        if (currentTimeIntervalRef.current !== null) {
            clearInterval(currentTimeIntervalRef.current);
            currentTimeIntervalRef.current = null;
        }
    }, []);

    // Stop playback fully
    const stopPlayback = useCallback(() => {
        clearPlayback();
        setPlayState('stopped');
        setCurrentTime(0);
        if (termRef.current) {
            termRef.current.reset();
        }
    }, [clearPlayback]);

    // Start playback from a given cast time offset
    const startPlayback = useCallback((fromTime: number, currentCast: Asciicast) => {
        if (!termRef.current) return;
        clearPlayback();

        const eventsToPlay = currentCast.events.filter(ev => ev.time >= fromTime);
        const wallStart = performance.now();
        playStartWallRef.current = wallStart;
        playStartCastRef.current = fromTime;

        const timers: ReturnType<typeof setTimeout>[] = [];

        for (const ev of eventsToPlay) {
            const delay = ((ev.time - fromTime) / speed) * 1000;
            const t = setTimeout(() => {
                if (ev.type === 'o') {
                    // Standard output → render
                    termRef.current?.write(ev.data);
                } else if (ev.type === 'r') {
                    // M-6: resize event ("WxH") → resize the player terminal too
                    const dims = parseResizeData(ev.data);
                    if (dims && termRef.current) {
                        try { termRef.current.resize(dims.cols, dims.rows); }
                        catch { /* xterm may refuse silly sizes — ignore */ }
                    }
                }
                // 'i' (user input) is recorded for completeness but not
                // rendered: the remote PTY's echo of the input is already
                // captured in the 'o' stream.
            }, delay);
            timers.push(t);
        }

        // End-of-recording timer
        const endDelay = ((currentCast.duration - fromTime) / speed) * 1000;
        const endTimer = setTimeout(() => {
            setPlayState('stopped');
            setCurrentTime(currentCast.duration);
            if (currentTimeIntervalRef.current !== null) {
                clearInterval(currentTimeIntervalRef.current);
                currentTimeIntervalRef.current = null;
            }
        }, endDelay);
        timers.push(endTimer);

        playTimersRef.current = timers;

        // Update currentTime display every 100ms
        currentTimeIntervalRef.current = setInterval(() => {
            const elapsed = (performance.now() - wallStart) / 1000;
            setCurrentTime(Math.min(fromTime + elapsed * speed, currentCast.duration));
        }, 100);

        setPlayState('playing');
    }, [speed, clearPlayback]);

    const handlePlay = useCallback(() => {
        if (!cast) return;
        if (playState === 'paused') {
            startPlayback(currentTime, cast);
        } else {
            if (termRef.current) termRef.current.reset();
            setCurrentTime(0);
            startPlayback(0, cast);
        }
    }, [cast, playState, currentTime, startPlayback]);

    const handlePause = useCallback(() => {
        clearPlayback();
        setPlayState('paused');
    }, [clearPlayback]);

    const handleStop = useCallback(() => {
        stopPlayback();
    }, [stopPlayback]);

    // When speed changes while playing, restart from current time
    useEffect(() => {
        if (playState === 'playing' && cast) {
            startPlayback(currentTime, cast);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speed]);

    // Select a recording and load it
    const selectRecording = async (filename: string) => {
        // Stop current playback
        clearPlayback();
        setPlayState('stopped');
        setCurrentTime(0);
        if (termRef.current) termRef.current.reset();

        setSelectedFile(filename);
        setCastError(null);
        setCast(null);
        setLoadingCast(true);

        try {
            const raw = await api.sshRecordingRead(filename);
            const parsed = parseAsciicast(raw);
            setCast(parsed);
        } catch (e) {
            setCastError(String(e));
        } finally {
            setLoadingCast(false);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            clearPlayback();
        };
    }, [clearPlayback]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-6xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                style={{ maxHeight: '90vh', height: '90vh' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
                    <div className="flex items-center gap-3">
                        <Film className="w-5 h-5 text-accent" />
                        <h2 className="text-base font-bold text-text-primary">Session Recordings</h2>
                        <span className="text-xs text-text-muted">({recordings.length} recordings)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={loadList}
                            disabled={loading}
                            aria-label="Refresh recordings"
                            className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            onClick={onClose}
                            aria-label="Close"
                            className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Body: list + player */}
                <div className="flex-1 overflow-hidden flex">
                    {/* Recording list — left 40% */}
                    <div className="w-2/5 border-r border-border flex flex-col overflow-hidden">
                        {error && (
                            <div className="m-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
                        )}
                        {loading ? (
                            <div className="flex items-center justify-center py-12 text-text-muted">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                            </div>
                        ) : recordings.length === 0 ? (
                            <div className="flex flex-col items-center justify-center flex-1 text-center px-6 py-12 text-text-muted">
                                <Film className="w-10 h-10 mb-4 opacity-30" />
                                <p className="text-sm font-medium mb-1">No recordings yet.</p>
                                <p className="text-xs opacity-60">Start a recording from any SSH session using the ● Record button.</p>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-surface border-b border-border">
                                        <tr className="text-text-muted uppercase text-[10px] tracking-wider">
                                            <th className="px-4 py-2 text-left font-semibold">Date / Time</th>
                                            <th className="px-3 py-2 text-right font-semibold w-20">Size</th>
                                            <th className="w-6" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recordings.map(r => (
                                            <tr
                                                key={r.filename}
                                                className={`border-b border-border/30 cursor-pointer transition-colors ${
                                                    selectedFile === r.filename
                                                        ? 'bg-accent/10 text-text-primary'
                                                        : 'hover:bg-white/3 text-text-muted'
                                                }`}
                                                onClick={() => selectRecording(r.filename)}
                                            >
                                                <td className="px-4 py-2.5">
                                                    <div className="font-medium text-text-primary text-[11px]">
                                                        {parseFilenameDate(r.filename)}
                                                    </div>
                                                    <div className="text-[10px] opacity-50 font-mono truncate max-w-[180px]" title={r.filename}>
                                                        {r.filename}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                                    {formatBytes(r.size_bytes)}
                                                </td>
                                                <td className="pr-3">
                                                    {selectedFile === r.filename && (
                                                        <ChevronRight className="w-3.5 h-3.5 text-accent" />
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Player pane — right 60% */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {!selectedFile ? (
                            <div className="flex flex-col items-center justify-center flex-1 text-text-muted">
                                <Film className="w-12 h-12 mb-4 opacity-20" />
                                <p className="text-sm">Select a recording to play</p>
                            </div>
                        ) : loadingCast ? (
                            <div className="flex items-center justify-center flex-1 text-text-muted">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading recording…
                            </div>
                        ) : castError ? (
                            <div className="flex flex-col items-center justify-center flex-1 px-6 gap-3">
                                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs max-w-sm text-center">
                                    {castError}
                                </div>
                            </div>
                        ) : cast ? (
                            <>
                                {/* Terminal */}
                                <div className="flex-1 overflow-hidden bg-[#0d0d0d] p-2">
                                    <div ref={termContainerRef} className="w-full h-full" />
                                </div>

                                {/* Controls bar */}
                                <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-3 bg-surface/50">
                                    {/* Play / Pause / Stop */}
                                    <div className="flex items-center gap-1">
                                        {playState === 'playing' ? (
                                            <button
                                                type="button"
                                                onClick={handlePause}
                                                className="p-1.5 rounded-md hover:bg-white/5 text-text-primary transition-colors"
                                                title="Pause"
                                                aria-label="Pause"
                                            >
                                                <Pause className="w-4 h-4" />
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handlePlay}
                                                className="p-1.5 rounded-md hover:bg-accent/10 hover:text-accent text-text-primary transition-colors"
                                                title={playState === 'paused' ? 'Resume' : 'Play'}
                                                aria-label={playState === 'paused' ? 'Resume' : 'Play'}
                                            >
                                                <Play className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleStop}
                                            className="p-1.5 rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
                                            title="Stop (restart)"
                                            aria-label="Stop"
                                        >
                                            <Square className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* Time */}
                                    <span className="text-xs font-mono text-text-muted tabular-nums">
                                        {formatTime(currentTime)} / {formatTime(cast.duration)}
                                    </span>

                                    {/* Progress bar */}
                                    <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-accent rounded-full transition-[width] duration-100"
                                            style={{ width: `${cast.duration > 0 ? (currentTime / cast.duration) * 100 : 0}%` }}
                                        />
                                    </div>

                                    {/* Speed selector */}
                                    <div className="flex items-center gap-1">
                                        <span className="text-[10px] text-text-muted uppercase tracking-wider">Speed</span>
                                        <div className="flex items-center gap-0.5">
                                            {SPEED_OPTIONS.map(s => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setSpeed(s)}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                                        speed === s
                                                            ? 'bg-accent text-white'
                                                            : 'text-text-muted hover:bg-white/5 hover:text-text-primary'
                                                    }`}
                                                >
                                                    {s}×
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
