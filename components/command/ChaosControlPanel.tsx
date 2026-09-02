'use client';

import { useEffect, useRef, useState } from 'react';
import { BatteryWarning, Check, RadioTower, Route, ShieldAlert, Zap } from 'lucide-react';
import { ConnectionState, useEmergencySocket } from '../../hooks/useEmergencySocket';

export interface ChaosRelayNode {
    id: string;
    name: string;
    batteryPercent: number;
}

export interface ChaosMountainPass {
    id: string;
    name: string;
    routeLabel: string;
}

export interface ChaosProfile {
    packetLossPercent: number;
    batteryFailureNodeId: string | null;
    blockedPassIds: string[];
}

export interface ChaosControlPanelProps {
    relayNodes?: ChaosRelayNode[];
    mountainPasses?: ChaosMountainPass[];
    initialProfile?: Partial<ChaosProfile>;
    socketPath?: string;
    onProfileChange?: (profile: ChaosProfile) => void;
    className?: string;
}

const DEFAULT_NODES: ChaosRelayNode[] = [
    { id: 'relay-north', name: 'North Ridge', batteryPercent: 86 },
    { id: 'relay-pass', name: 'Pass Junction', batteryPercent: 64 },
    { id: 'relay-south', name: 'South Camp', batteryPercent: 91 },
];

const DEFAULT_PASSES: ChaosMountainPass[] = [
    { id: 'pass-k2', name: 'K2 Traverse', routeLabel: 'NORTH > EAST' },
    { id: 'pass-shield', name: 'Shield Pass', routeLabel: 'WEST > BASE' },
];

const connectionStyles: Record<ConnectionState, { label: string; className: string }> = {
    CONNECTED: { label: 'LINKED', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
    CONNECTING: { label: 'CONNECTING', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    RECONNECTING: { label: 'RECONNECTING', className: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
    DISCONNECTED: { label: 'OFFLINE', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
    ERROR: { label: 'LINK ERROR', className: 'border-red-500/40 bg-red-500/10 text-red-300' },
};

function statusForProfile(profile: ChaosProfile): { label: string; className: string; iconClassName: string } {
    const hasCriticalFailure = profile.batteryFailureNodeId !== null || profile.blockedPassIds.length > 0;
    if (hasCriticalFailure) return { label: 'CRITICAL', className: 'border-red-500/50 bg-red-500/15 text-red-300', iconClassName: 'text-red-400' };
    if (profile.packetLossPercent >= 40) return { label: 'DEGRADED', className: 'border-amber-500/50 bg-amber-500/15 text-amber-300', iconClassName: 'text-amber-400' };
    return { label: 'NOMINAL', className: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300', iconClassName: 'text-emerald-400' };
}

export default function ChaosControlPanel({
    relayNodes = DEFAULT_NODES,
    mountainPasses = DEFAULT_PASSES,
    initialProfile,
    socketPath,
    onProfileChange,
    className = '',
}: ChaosControlPanelProps) {
    const { connectionState, dispatchAction } = useEmergencySocket(socketPath);
    const [profile, setProfile] = useState<ChaosProfile>(() => ({
        packetLossPercent: initialProfile?.packetLossPercent ?? 0,
        batteryFailureNodeId: initialProfile?.batteryFailureNodeId ?? null,
        blockedPassIds: initialProfile?.blockedPassIds ?? [],
    }));
    const hasMounted = useRef(false);
    const status = statusForProfile(profile);
    const connection = connectionStyles[connectionState];

    useEffect(() => {
        if (!hasMounted.current) {
            hasMounted.current = true;
            return;
        }
        const payload = { ...profile, blockedPassIds: [...profile.blockedPassIds] };
        onProfileChange?.(payload);
        dispatchAction('CHAOS_PROFILE_UPDATED', payload);
    }, [dispatchAction, onProfileChange, profile]);

    const setPacketLoss = (packetLossPercent: number) => setProfile((current) => ({ ...current, packetLossPercent }));
    const toggleBatteryFailure = () => setProfile((current) => ({
        ...current,
        batteryFailureNodeId: current.batteryFailureNodeId ? null : relayNodes[0]?.id ?? null,
    }));
    const togglePass = (passId: string) => setProfile((current) => ({
        ...current,
        blockedPassIds: current.blockedPassIds.includes(passId)
            ? current.blockedPassIds.filter((id) => id !== passId)
            : [...current.blockedPassIds, passId],
    }));

    return (
        <section className={`border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/30 ${className}`} aria-labelledby="chaos-control-heading">
            <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-4 py-4">
                <div>
                    <div className="flex items-center gap-2 text-red-400">
                        <ShieldAlert size={16} aria-hidden="true" />
                        <p className="font-mono text-[10px] font-bold tracking-[0.22em]">FAILURE INJECTION</p>
                    </div>
                    <h2 id="chaos-control-heading" className="mt-1 font-mono text-sm font-bold tracking-wide">CHAOS CONTROL</h2>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <span className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] font-bold tracking-widest ${status.className}`}>
                        <span className={`h-1.5 w-1.5 rounded-full bg-current ${status.iconClassName}`} /> {status.label}
                    </span>
                    <span className={`border px-2 py-1 font-mono text-[9px] tracking-widest ${connection.className}`}>{connection.label}</span>
                </div>
            </header>

            <div className="space-y-5 p-4">
                <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <label htmlFor="packet-loss" className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-wide text-zinc-200">
                            <Zap size={14} className="text-amber-400" aria-hidden="true" /> RF INTERFERENCE / PACKET LOSS
                        </label>
                        <output htmlFor="packet-loss" className="font-mono text-lg font-bold tabular-nums text-amber-300">{profile.packetLossPercent}%</output>
                    </div>
                    <input id="packet-loss" type="range" min="0" max="100" step="1" value={profile.packetLossPercent} onChange={(event) => setPacketLoss(Number(event.target.value))} className="h-2 w-full cursor-pointer accent-amber-400" aria-valuetext={`${profile.packetLossPercent}% packet loss`} />
                    <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-600"><span>NOMINAL</span><span>SEVERE ATTENUATION</span></div>
                </div>

                <div className="border-t border-zinc-900 pt-4">
                    <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold tracking-wide text-zinc-200">
                        <BatteryWarning size={14} className="text-red-400" aria-hidden="true" /> NODE BATTERY FAILURE
                    </div>
                    <select value={profile.batteryFailureNodeId ?? ''} onChange={(event) => setProfile((current) => ({ ...current, batteryFailureNodeId: event.target.value || null }))} className="mb-3 w-full border border-zinc-700 bg-black px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-red-400">
                        <option value="">SELECT RELAY NODE</option>
                        {relayNodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {node.batteryPercent}% CHARGE</option>)}
                    </select>
                    <button type="button" onClick={toggleBatteryFailure} disabled={relayNodes.length === 0} className={`flex w-full items-center justify-between border px-3 py-2 font-mono text-[10px] font-bold tracking-widest transition-colors ${profile.batteryFailureNodeId ? 'border-red-500/60 bg-red-950/40 text-red-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-red-500/60 hover:text-red-300'}`} aria-pressed={profile.batteryFailureNodeId !== null}>
                        <span>{profile.batteryFailureNodeId ? 'BATTERY DRAINED TO 0%' : 'DRAIN SELECTED NODE'}</span>
                        {profile.batteryFailureNodeId ? <Check size={15} aria-hidden="true" /> : <RadioTower size={15} aria-hidden="true" />}
                    </button>
                </div>

                <div className="border-t border-zinc-900 pt-4">
                    <div className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold tracking-wide text-zinc-200">
                        <Route size={14} className="text-sky-400" aria-hidden="true" /> BLOCKED MOUNTAIN PASSES
                    </div>
                    <div className="space-y-2">
                        {mountainPasses.map((pass) => {
                            const isBlocked = profile.blockedPassIds.includes(pass.id);
                            return <button key={pass.id} type="button" onClick={() => togglePass(pass.id)} aria-pressed={isBlocked} className={`flex w-full items-center justify-between border px-3 py-2 text-left transition-colors ${isBlocked ? 'border-red-500/60 bg-red-950/40' : 'border-zinc-800 bg-black hover:border-sky-500/60'}`}>
                                <span><span className={`block font-mono text-xs font-bold ${isBlocked ? 'text-red-300' : 'text-zinc-300'}`}>{pass.name}</span><span className="mt-1 block font-mono text-[9px] tracking-wider text-zinc-600">{pass.routeLabel}</span></span>
                                <span className={`font-mono text-[9px] font-bold tracking-widest ${isBlocked ? 'text-red-400' : 'text-emerald-400'}`}>{isBlocked ? 'SEVERED' : 'OPEN'}</span>
                            </button>;
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}