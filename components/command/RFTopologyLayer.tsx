'use client';

import { useMemo, useState } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, Marker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { Activity, BatteryCharging, Radio, Sun } from 'lucide-react';

export type RFNodeType =
    | 'BASE_GATEWAY'
    | 'RIDGE_REPEATER'
    | 'VALLEY_RELAY'
    | 'AERIAL_DRONE_NODE';

export type RFNodeStatus = 'NOMINAL' | 'DEGRADED' | 'OFFLINE';

export interface RFTransceiverNode {
    id: string;
    name: string;
    type: RFNodeType;
    coordinates: [latitude: number, longitude: number];
    altitudeMeters: number;
    frequencyMhz: number;
    txPowerDbm: number;
    effectiveRangeKm: number;
    status: RFNodeStatus;
    batteryPercent: number;
    solarCharging: boolean;
    connectedNeighbors: string[];
}

export const MOUNTAIN_NETWORK_TOPOLOGY: RFTransceiverNode[] = [
    {
        id: 'BASE-GW-00', name: 'Solang Base Gateway', type: 'BASE_GATEWAY',
        coordinates: [32.3126, 77.1628], altitudeMeters: 2050, frequencyMhz: 868.1,
        txPowerDbm: 22, effectiveRangeKm: 25, status: 'NOMINAL', batteryPercent: 100,
        solarCharging: true, connectedNeighbors: ['NODE-RP-01', 'NODE-VR-01'],
    },
    {
        id: 'NODE-RP-01', name: 'Rohtang Ridge Repeater', type: 'RIDGE_REPEATER',
        coordinates: [32.3711, 77.2469], altitudeMeters: 3978, frequencyMhz: 868.1,
        txPowerDbm: 20, effectiveRangeKm: 22, status: 'NOMINAL', batteryPercent: 88,
        solarCharging: true, connectedNeighbors: ['BASE-GW-00', 'NODE-RP-02', 'NODE-VR-02'],
    },
    {
        id: 'NODE-RP-02', name: 'Hamta Ridge Repeater', type: 'RIDGE_REPEATER',
        coordinates: [32.2356, 77.2552], altitudeMeters: 4105, frequencyMhz: 868.1,
        txPowerDbm: 20, effectiveRangeKm: 20, status: 'DEGRADED', batteryPercent: 46,
        solarCharging: false, connectedNeighbors: ['NODE-RP-01', 'NODE-RP-03'],
    },
    {
        id: 'NODE-RP-03', name: 'Chandrakhani Ridge Repeater', type: 'RIDGE_REPEATER',
        coordinates: [32.1601, 77.2005], altitudeMeters: 3660, frequencyMhz: 868.1,
        txPowerDbm: 18, effectiveRangeKm: 18, status: 'NOMINAL', batteryPercent: 76,
        solarCharging: true, connectedNeighbors: ['NODE-RP-02', 'NODE-VR-01'],
    },
    {
        id: 'NODE-VR-01', name: 'Solang Valley Relay', type: 'VALLEY_RELAY',
        coordinates: [32.3094, 77.1704], altitudeMeters: 2805, frequencyMhz: 868.1,
        txPowerDbm: 17, effectiveRangeKm: 10, status: 'NOMINAL', batteryPercent: 67,
        solarCharging: true, connectedNeighbors: ['BASE-GW-00', 'NODE-RP-03'],
    },
    {
        id: 'NODE-VR-02', name: 'Marhi Valley Relay', type: 'VALLEY_RELAY',
        coordinates: [32.3485, 77.225], altitudeMeters: 2870, frequencyMhz: 868.1,
        txPowerDbm: 17, effectiveRangeKm: 9, status: 'OFFLINE', batteryPercent: 8,
        solarCharging: false, connectedNeighbors: ['NODE-RP-01'],
    },
];

interface RFTopologyLayerProps {
    nodes?: RFTransceiverNode[];
}

interface TopologyToggles {
    coverage: boolean;
    backhaul: boolean;
    badges: boolean;
}

const STATUS_COLOR: Record<RFNodeStatus, string> = {
    NOMINAL: '#10B981',
    DEGRADED: '#F59E0B',
    OFFLINE: '#64748B',
};

function tacticalIcon(node: RFTransceiverNode, status: RFNodeStatus): L.DivIcon {
    const color = STATUS_COLOR[status];
    const common = `fill="#081018" stroke="${color}" stroke-width="2.5"`;
    const shape = node.type === 'BASE_GATEWAY'
        ? `<circle cx="20" cy="20" r="16" ${common}/><circle cx="20" cy="20" r="10" fill="none" stroke="${color}" stroke-width="1.5"/><path d="M20 8v24M14 16l6-8 6 8M12 28h16" stroke="${color}" stroke-width="2" fill="none"/>`
        : node.type === 'RIDGE_REPEATER'
            ? `<path d="M20 3 35 11v18L20 37 5 29V11Z" ${common}/><path d="M20 11v17M13 29l7-18 7 18" stroke="${color}" stroke-width="2" fill="none"/>`
            : node.type === 'VALLEY_RELAY'
                ? `<path d="M20 4 36 20 20 36 4 20Z" ${common}/><path d="M12 20h16M20 12v16" stroke="${color}" stroke-width="2"/>`
                : `<path d="M5 20h30M20 5v30M10 10l20 20M30 10 10 30" stroke="${color}" stroke-width="2"/><circle cx="20" cy="20" r="7" ${common}/>`;
    return L.divIcon({
        className: 'laksha-rf-node',
        html: `<div style="position:relative;width:40px;height:40px;filter:drop-shadow(0 0 8px ${color})"><svg viewBox="0 0 40 40" width="40" height="40">${shape}<circle cx="33" cy="7" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/></svg></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
    });
}

function haversineKm(a: [number, number], b: [number, number]): number {
    const radians = (value: number) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const deltaLat = radians(b[0] - a[0]);
    const deltaLon = radians(b[1] - a[1]);
    const h = Math.sin(deltaLat / 2) ** 2
        + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(deltaLon / 2) ** 2;
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function midpoint(a: [number, number], b: [number, number]): [number, number] {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function RFTopologyLayer({ nodes = MOUNTAIN_NETWORK_TOPOLOGY }: RFTopologyLayerProps) {
    const [overrides, setOverrides] = useState<Record<string, RFNodeStatus>>({});
    const [pingedNodeId, setPingedNodeId] = useState<string | null>(null);
    const [toggles, setToggles] = useState<TopologyToggles>({ coverage: true, backhaul: true, badges: true });

    const network = useMemo(
        () => nodes.map((node) => ({ ...node, status: overrides[node.id] ?? node.status })),
        [nodes, overrides]
    );

    const links = useMemo(() => {
        const seen = new Set<string>();
        return network.flatMap((node) => node.connectedNeighbors.flatMap((neighborId) => {
            const neighbor = network.find((candidate) => candidate.id === neighborId);
            const key = [node.id, neighborId].sort().join(':');
            if (!neighbor || seen.has(key)) return [];
            seen.add(key);
            return [{ from: node, to: neighbor, key }];
        }));
    }, [network]);

    const toggle = (key: keyof TopologyToggles) => {
        setToggles((current) => ({ ...current, [key]: !current[key] }));
    };

    return (
        <>
            {toggles.coverage && network.map((node) => {
                const color = STATUS_COLOR[node.status];
                const outerRadius = node.effectiveRangeKm * 1000;
                return (
                    <span key={`coverage-${node.id}`}>
                        <Circle center={node.coordinates} radius={outerRadius / 2} pathOptions={{ color, fillColor: color, fillOpacity: node.status === 'OFFLINE' ? 0.02 : 0.15, weight: 1.5 }} />
                        <Circle center={node.coordinates} radius={outerRadius} pathOptions={{ color, fillColor: color, fillOpacity: node.status === 'OFFLINE' ? 0.01 : 0.05, weight: 1, dashArray: '6 10' }} />
                    </span>
                );
            })}

            {toggles.backhaul && links.map(({ from, to, key }) => {
                const isOperational = from.status !== 'OFFLINE' && to.status !== 'OFFLINE';
                const color = isOperational ? '#06B6D4' : '#64748B';
                const distance = haversineKm(from.coordinates, to.coordinates);
                return (
                    <span key={key}>
                        <Polyline positions={[from.coordinates, to.coordinates]} pathOptions={{ color, weight: 2, opacity: isOperational ? 0.9 : 0.35, dashArray: '7 9' }} />
                        <Marker position={midpoint(from.coordinates, to.coordinates)} interactive={false}
                            icon={L.divIcon({ className: 'laksha-link-label', html: `<span style="display:block;border:1px solid ${color};border-radius:4px;background:#050505dd;color:${color};padding:2px 5px;font:700 10px monospace;white-space:nowrap">${distance.toFixed(1)} km</span>`, iconAnchor: [25, 10] })} />
                    </span>
                );
            })}

            {network.map((node) => (
                <Marker key={node.id} position={node.coordinates} icon={tacticalIcon(node, node.status)}>
                    <Tooltip permanent={toggles.badges} direction="top" offset={[0, -22]} className="!border-zinc-700 !bg-zinc-950 !text-zinc-100">
                        <span className="font-mono text-[10px]">{node.id} | Alt: {node.altitudeMeters}m | Batt: {node.batteryPercent}%</span>
                    </Tooltip>
                    {toggles.badges && <CircleMarker center={node.coordinates} radius={3} pathOptions={{ color: STATUS_COLOR[node.status], fillColor: STATUS_COLOR[node.status], fillOpacity: 1 }} />}
                    <Popup minWidth={245}>
                        <div className="space-y-3 bg-zinc-950 font-mono text-xs text-zinc-100">
                            <div><p className="font-black text-sky-300">{node.name}</p><p className="text-zinc-400">{node.id} · {node.altitudeMeters}m ASL</p></div>
                            <div className="grid grid-cols-2 gap-2 rounded border border-zinc-700 bg-black p-2">
                                <p>BATTERY <b className="text-emerald-400">{node.batteryPercent}%</b></p>
                                <p>SOLAR <b className={node.solarCharging ? 'text-amber-300' : 'text-zinc-500'}>{node.solarCharging ? '12W CHARGE' : 'IDLE'}</b></p>
                                <p>{node.frequencyMhz} MHz</p><p>TX {node.txPowerDbm} dBm · SF{node.status === 'DEGRADED' ? '10' : '7'}</p>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => { setPingedNodeId(node.id); window.setTimeout(() => setPingedNodeId(null), 1400); }} className="flex items-center gap-1 rounded border border-cyan-500 px-2 py-1 text-cyan-300"><Activity className="h-3 w-3" />{pingedNodeId === node.id ? 'PING OK' : 'PING NODE'}</button>
                                <button type="button" onClick={() => setOverrides((current) => ({ ...current, [node.id]: node.status === 'OFFLINE' ? 'NOMINAL' : 'OFFLINE' }))} className="rounded border border-rose-500 px-2 py-1 text-rose-300">{node.status === 'OFFLINE' ? 'RESTORE NODE' : 'TAKE OFFLINE'}</button>
                            </div>
                        </div>
                    </Popup>
                </Marker>
            ))}

            <div className="absolute bottom-4 left-4 z-[500] w-60 rounded border border-zinc-700 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-emerald-400"><Radio className="h-4 w-4" /><span className="font-mono text-xs font-black tracking-wider">RF TOPOLOGY</span></div>
                <HudToggle checked={toggles.coverage} label="Show RF Coverage Rings" onChange={() => toggle('coverage')} />
                <HudToggle checked={toggles.backhaul} label="Show Inter-Node Backhaul Links" onChange={() => toggle('backhaul')} />
                <HudToggle checked={toggles.badges} label="Show Hardware Status Badges" onChange={() => toggle('badges')} />
            </div>
        </>
    );
}

function HudToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
    return <label className="flex cursor-pointer items-center gap-2 py-1.5 font-mono text-[10px] text-zinc-300"><input type="checkbox" checked={checked} onChange={onChange} className="accent-emerald-500" />{label}</label>;
}
