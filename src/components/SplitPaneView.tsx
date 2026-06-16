import React, { useState, useRef, useCallback } from 'react';
import type { Tab } from '../types';
import { TerminalView } from './ssh/TerminalView';

interface Props {
    primaryTab: Tab;
    secondaryTab: Tab;
    direction: 'h' | 'v';
    isActive: boolean;
}

export const SplitPaneView: React.FC<Props> = ({ primaryTab, secondaryTab, direction, isActive }) => {
    const [splitRatio, setSplitRatio] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragging.current = true;

        const onMouseMove = (ev: MouseEvent) => {
            if (!dragging.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            if (direction === 'h') {
                const ratio = ((ev.clientX - rect.left) / rect.width) * 100;
                setSplitRatio(Math.max(20, Math.min(80, ratio)));
            } else {
                const ratio = ((ev.clientY - rect.top) / rect.height) * 100;
                setSplitRatio(Math.max(20, Math.min(80, ratio)));
            }
        };

        const onMouseUp = () => {
            dragging.current = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [direction]);

    const isHorizontal = direction === 'h';

    return (
        <div
            ref={containerRef}
            className={`w-full h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'}`}
        >
            <div style={{ [isHorizontal ? 'width' : 'height']: `${splitRatio}%` }} className="overflow-hidden">
                <TerminalView tab={primaryTab} isActive={isActive} />
            </div>

            {/* Resizer */}
            <div
                className={`shrink-0 ${isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} bg-border hover:bg-accent/50 transition-colors`}
                onMouseDown={onMouseDown}
            />

            <div style={{ [isHorizontal ? 'width' : 'height']: `${100 - splitRatio}%` }} className="overflow-hidden flex-1">
                <TerminalView tab={secondaryTab} isActive={isActive} />
            </div>
        </div>
    );
};
