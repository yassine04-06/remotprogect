import React from 'react';
import { X, Terminal, Monitor, Loader2 } from 'lucide-react';
import { useTabStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

export const ConnectionTabs: React.FC = () => {
    const tabs = useTabStore(s => s.tabs);
    const activeTabId = useTabStore(s => s.activeTabId);
    const setActiveTab = useTabStore(s => s.setActiveTab);
    const closeTab = useTabStore(s => s.closeTab);

    const handleMiddleClick = (e: React.MouseEvent, tabId: string) => {
        if (e.button === 1) { // Middle click button
            e.preventDefault();
            closeTab(tabId);
        }
    };

    if (tabs.length === 0) return null;

    return (
        <div className="flex bg-transparent overflow-x-auto custom-scrollbar select-none h-full items-end gap-1 px-2">
            <AnimatePresence mode="popLayout">
                {tabs.map((tab) => {
                    const isActive = activeTabId === tab.id;

                    return (
                        <motion.div
                            layout
                            key={tab.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                group flex items-center min-w-[140px] max-w-[200px] h-9 px-3 rounded-t-xl cursor-pointer text-xs transition-all duration-300 relative
                ${isActive ? 'bg-base text-text-primary' : 'bg-surface/20 text-text-muted hover:bg-surface/40 hover:text-text-primary'}
              `}
                        >
                            {/* Active Bottom Glow */}
                            {isActive && (
                                <motion.div
                                    layoutId="activeTabGlow"
                                    className="absolute -bottom-px left-0 right-0 h-0.5 bg-accent shadow-[0_0_10px_rgba(137,180,250,0.5)]"
                                />
                            )}

                            {/* Icon */}
                            <span className={`mr-2 flex-shrink-0 transition-colors ${isActive ? 'text-accent' : 'opacity-40 group-hover:opacity-100'}`}>
                                {tab.protocol === 'SSH' ? <Terminal className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
                            </span>

                            {/* Name */}
                            <span className={`truncate flex-1 font-semibold tracking-tight ${isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}>
                                {tab.connectionName}
                            </span>

                            {/* Status Indicator */}
                            <span className="ml-2 flex-shrink-0 flex items-center">
                                {tab.status === 'connecting' && <Loader2 className="w-3 h-3 text-accent animate-spin" />}
                                {tab.status === 'connected' && <div className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                                {tab.status === 'error' && <div className="w-1.5 h-1.5 rounded-full bg-red-400" />}
                            </span>

                            {/* Close Button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                                className={`
                  ml-2 p-1 rounded-md transition-all
                  ${isActive ? 'opacity-40 hover:opacity-100 hover:bg-white/10' : 'opacity-0 group-hover:opacity-40 hover:opacity-100 hover:bg-white/10'}
                `}
                            >
                                <X className="w-2.5 h-2.5" />
                            </button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
};
