'use client';

import { useState } from 'react';
import type L from 'leaflet';
import PacketTraversalCanvas, { type HopAdvancedEvent } from './PacketTraversalCanvas';
import { useTraversalQueue } from './useTraversalQueue';

const nodes = [
    { name: 'ORIGIN', lat: 28.0, lng: 86.9 },
    { name: 'RIDGE-01', lat: 28.04, lng: 86.95 },
    { name: 'RIDGE-02', lat: 28.08, lng: 87.0 },
    { name: 'BASE CAMP', lat: 28.11, lng: 87.04 },
];

function scenario(status?: HopAdvancedEvent['status'], noisy = false): HopAdvancedEvent[] {
    return nodes.slice(0, -1).map((from, index) => {
        const to = nodes[index + 1];
        return {
            type: 'HOP_ADVANCED', hop_id: `demo-${Date.now()}-${index}`, packet_id: `DEMO-${status ?? 'IDEAL'}`,
            sequence: index + 1, from_node: from.name, to_node: to.name,
            from_lat: from.lat, from_lng: from.lng, to_lat: to.lat, to_lng: to.lng,
            from_elevation_m: 2200 + index * 500, to_elevation_m: 2700 + index * 500,
            rssi: noisy ? -92 - index * 9 : -72, snr: noisy ? 7 - index * 9 : 12,
            hop_index: index + 1, total_hops: 3, timestamp: Date.now(), latency_ms: 650,
            status: status && index === 1 ? status : 'SUCCESS',
        };
    });
}

/** Development-only trigger panel for exercising the packet animation states. */
interface DemoTraversalTriggerProps {
    mapInstance?: L.Map | null;
}

export default function DemoTraversalTrigger({ mapInstance = null }: DemoTraversalTriggerProps) {
    const [label, setLabel] = useState('IDLE');
    const [lossVisible, setLossVisible] = useState(false);
    const { activeHop, enqueueMany, queuedCount, completeActiveHop } = useTraversalQueue();
    const run = (name: string, hops: HopAdvancedEvent[]) => { setLabel(name); enqueueMany(hops); };
    return (
        <>
            {mapInstance && <PacketTraversalCanvas activeHop={activeHop} mapInstance={mapInstance} onHopComplete={completeActiveHop} />}
            {lossVisible && <div className="pointer-events-none absolute left-1/2 top-1/2 z-[700] -translate-x-1/2 border border-red-500 bg-red-950/90 px-3 py-2 font-mono text-[10px] font-black tracking-[0.12em] text-red-200 shadow-[0_0_24px_rgba(239,68,68,0.45)]">PACKET LOSS - NOISE FLOOR BREACH</div>}
            <div className="absolute right-4 top-4 z-[600] w-56 border border-zinc-700 bg-zinc-950/95 p-3 font-mono text-[10px] text-zinc-300 shadow-xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between text-sky-300"><span>TRAVERSAL LAB</span><span>{queuedCount}</span></div>
            <div className="mb-2 text-zinc-500">{label}</div>
            <div className="grid gap-1">
                <button type="button" onClick={() => run('IDEAL 3-HOP ROUTE', scenario())} className="border border-emerald-600/70 px-2 py-1 text-left text-emerald-300 hover:bg-emerald-500/10">IDEAL ROUTE</button>
                <button type="button" onClick={() => run('MARGINAL VALLEY PASS', scenario(undefined, true))} className="border border-amber-600/70 px-2 py-1 text-left text-amber-300 hover:bg-amber-500/10">MARGINAL PASS</button>
                <button type="button" onClick={() => { setLossVisible(true); window.setTimeout(() => setLossVisible(false), 1400); run('MID-HOP PACKET DROP', scenario('DROPPED')); }} className="border border-red-600/70 px-2 py-1 text-left text-red-300 hover:bg-red-500/10">PACKET DROP</button>
            </div>
            </div>
        </>
    );
}
