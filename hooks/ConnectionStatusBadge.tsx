'use client';

import type { ConnectionState } from './useEmergencySocket';

interface ConnectionStatusBadgeProps {
    connectionState: ConnectionState;
    pingLatencyMs: number | null;
}

const stateStyles: Record<ConnectionState, { label: string; beacon: string }> = {
    CONNECTING: { label: 'CONNECTING', beacon: 'bg-amber-400' },
    CONNECTED: { label: 'LINKED', beacon: 'bg-emerald-400' },
    RECONNECTING: { label: 'RECONNECTING', beacon: 'bg-amber-400' },
    DISCONNECTED: { label: 'OFFLINE', beacon: 'bg-red-500' },
    ERROR: { label: 'ERROR', beacon: 'bg-red-500' },
};

export default function ConnectionStatusBadge({ connectionState, pingLatencyMs }: ConnectionStatusBadgeProps) {
    const style = stateStyles[connectionState];
    return (
        <div className="inline-flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-zinc-300" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${style.beacon} ${connectionState === 'CONNECTED' ? 'animate-pulse' : ''}`} aria-hidden="true" />
            <span>{style.label}</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500">{pingLatencyMs === null ? '--' : `${Math.round(pingLatencyMs)}ms`}</span>
        </div>
    );
}
