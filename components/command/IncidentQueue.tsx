'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, HeartPulse, Radio, ShieldCheck, Users } from 'lucide-react';
import { IncidentRecord, IncidentStatus, TriageType } from './types';

interface IncidentQueueProps {
    incidents: IncidentRecord[];
    selectedIncidentId: string | null;
    onSelect: (id: string) => void;
    onStatusChange: (id: string, status: IncidentStatus) => void;
}

const PRIORITY: Record<TriageType, number> = { MEDICAL: 0, TRAPPED: 1, AVALANCHE: 2, LOST: 3 };
const TONE: Record<TriageType, string> = {
    MEDICAL: 'border-rose-500 text-rose-300',
    TRAPPED: 'border-orange-500 text-orange-300',
    LOST: 'border-amber-500 text-amber-300',
    AVALANCHE: 'border-cyan-500 text-cyan-300',
};

export default function IncidentQueue({ incidents, selectedIncidentId, onSelect, onStatusChange }: IncidentQueueProps) {
    const [filter, setFilter] = useState<'ALL' | TriageType>('ALL');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const queued = useMemo(
        () => incidents.filter((item) => filter === 'ALL' || item.triage === filter).sort((a, b) => PRIORITY[a.triage] - PRIORITY[b.triage]),
        [incidents, filter]
    );
    const unresolved = incidents.filter((item) => item.status !== 'EVACUATED').length;

    return (
        <aside className="flex h-full min-h-[520px] flex-col border-l border-zinc-800 bg-zinc-950">
            <header className="border-b border-zinc-800 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><HeartPulse className="h-5 w-5 text-rose-400" /><h2 className="font-mono text-sm font-black tracking-wider">TRIAGE DISPATCH</h2></div>
                    <span className="rounded bg-rose-500/15 px-2 py-1 font-mono text-xs font-bold text-rose-300">{unresolved} OPEN</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
                    <Metric label="RELAYS" value="5 / 6" tone="text-emerald-400" />
                    <Metric label="ALERTS" value={String(unresolved)} tone="text-rose-400" />
                    <Metric label="GATEWAY" value="SERIAL / WS" tone="text-sky-400" />
                </div>
            </header>

            <div className="flex gap-1 overflow-x-auto border-b border-zinc-800 p-2">
                {(['ALL', 'MEDICAL', 'TRAPPED', 'AVALANCHE', 'LOST'] as const).map((item) => (
                    <button key={item} type="button" onClick={() => setFilter(item)}
                        className={`rounded px-2 py-1 font-mono text-[10px] font-bold transition ${filter === item ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-200'}`}>
                        {item}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {queued.map((incident) => {
                    const expanded = expandedId === incident.id;
                    return (
                        <article key={incident.id} onClick={() => onSelect(incident.id)}
                            className={`cursor-pointer rounded-lg border-l-4 border border-zinc-800 bg-zinc-900/70 p-3 transition hover:bg-zinc-900 ${TONE[incident.triage]} ${selectedIncidentId === incident.id ? 'ring-1 ring-white/40' : ''}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div><p className="font-mono text-[10px] text-zinc-500">NODE {incident.nodeId}</p><h3 className="font-mono text-xs font-black">{incident.triage}</h3></div>
                                <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{incident.status}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-zinc-400">
                                <span>CONSCIOUS: {incident.isConscious ? 'YES' : 'NO'}</span><span>{incident.isGroup ? 'GROUP' : 'SOLO'}</span>
                                <span>BAT: {incident.batteryPercent}%</span><span>HOPS: {incident.hopCount}</span>
                                <span className="col-span-2">{incident.latitude.toFixed(6)}, {incident.longitude.toFixed(6)}</span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-1" onClick={(event) => event.stopPropagation()}>
                                <Action label="DISPATCH" onClick={() => onStatusChange(incident.id, 'DISPATCHED')} />
                                <Action label="ACK RELAY" onClick={() => onStatusChange(incident.id, 'ACKNOWLEDGED')} />
                                <Action label="EVACUATE" onClick={() => onStatusChange(incident.id, 'EVACUATED')} />
                            </div>
                            <button type="button" onClick={(event) => { event.stopPropagation(); setExpandedId(expanded ? null : incident.id); }}
                                className="mt-2 flex w-full items-center justify-between border-t border-zinc-800 pt-2 font-mono text-[10px] text-zinc-400">
                                PAYLOAD / LINK METRICS {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                            {expanded && <div className="mt-2 rounded bg-black p-2 font-mono text-[10px] text-zinc-300"><p className="break-all text-amber-300">HEX {incident.rawHex}</p><p className="mt-1">RSSI {incident.rssi} dBm · SNR {incident.snr} dB · {incident.hopCount} HOPS</p></div>}
                        </article>
                    );
                })}
            </div>
        </aside>
    );
}
function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
    return <div className="rounded border border-zinc-800 bg-black p-2"><p className="text-zinc-600">{label}</p><p className={`mt-1 truncate font-bold ${tone}`}>{value}</p></div>;
}
function Action({ label, onClick }: { label: string; onClick: () => void }) {
    return <button type="button" onClick={onClick} className="rounded border border-zinc-700 bg-black px-1 py-1.5 font-mono text-[9px] font-bold text-zinc-300 transition hover:border-sky-400 hover:text-sky-300">{label}</button>;
}
