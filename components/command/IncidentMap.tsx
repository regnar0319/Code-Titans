'use client';

import { useEffect } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair, Map as MapIcon, Radio } from 'lucide-react';
import { BASE_GATEWAY, REPEATERS } from './mockData';
import { IncidentRecord, RepeaterNode, TriageType } from './types';
import 'leaflet/dist/leaflet.css';

interface IncidentMapProps {
    incidents: IncidentRecord[];
    selectedIncidentId: string | null;
    onSelectIncident: (incidentId: string) => void;
    isAirGapped: boolean;
    onAirGapChange: (isAirGapped: boolean) => void;
}

const TRIAGE_COLORS: Record<TriageType, string> = {
    MEDICAL: '#EF4444',
    TRAPPED: '#F97316',
    LOST: '#F59E0B',
    AVALANCHE: '#06B6D4',
};

function repeaterIcon(repeater: RepeaterNode): L.DivIcon {
    const color = repeater.status === 'NOMINAL' ? '#22C55E' : repeater.status === 'RELAYING' ? '#F59E0B' : '#EF4444';
    return L.divIcon({
        className: 'laksha-repeater-marker',
        html: `<div style="width:28px;height:28px;display:grid;place-items:center;clip-path:polygon(25% 6%,75% 6%,100% 50%,75% 94%,25% 94%,0 50%);background:${color};border:2px solid #fff;box-shadow:0 0 16px ${color}"><span style="width:7px;height:7px;border-radius:50%;background:#050505"></span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });
}

function incidentIcon(incident: IncidentRecord, selected: boolean): L.DivIcon {
    const color = TRIAGE_COLORS[incident.triage];
    return L.divIcon({
        className: 'laksha-incident-marker',
        html: `<div style="position:relative;width:${selected ? 34 : 28}px;height:${selected ? 34 : 28}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 0 ${selected ? 24 : 16}px ${color}"><span style="position:absolute;inset:-8px;border:1px solid ${color};border-radius:9999px;animation:laksha-ping 1.5s infinite"></span></div>`,
        iconSize: [selected ? 34 : 28, selected ? 34 : 28],
        iconAnchor: [selected ? 17 : 14, selected ? 17 : 14],
    });
}

function findPosition(id: string, incidents: IncidentRecord[]): [number, number] {
    const entity = [...incidents, ...REPEATERS, BASE_GATEWAY].find((item) => item.id === id);
    return entity ? [entity.latitude, entity.longitude] : [27.9868, 86.925];
}

export default function IncidentMap({
    incidents,
    selectedIncidentId,
    onSelectIncident,
    isAirGapped,
    onAirGapChange,
}: IncidentMapProps) {
    const selected = incidents.find((incident) => incident.id === selectedIncidentId) ?? incidents[0];

    // A disconnected browser immediately enters safe local-cache mode; the HUD remains available for manual control.
    useEffect(() => {
        const enterAirGapMode = () => onAirGapChange(true);
        if (!navigator.onLine) enterAirGapMode();
        window.addEventListener('offline', enterAirGapMode);
        return () => window.removeEventListener('offline', enterAirGapMode);
    }, [onAirGapChange]);

    return (
        <section className="relative h-full min-h-[520px] overflow-hidden bg-zinc-950">
            <MapContainer
                center={[28.01, 86.92]}
                zoom={9}
                scrollWheelZoom
                className="h-full min-h-[520px] w-full bg-[#07111a]"
                zoomControl={false}
            >
                {!isAirGapped ? (
                    <TileLayer
                        attribution="&copy; OpenTopoMap contributors"
                        url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                        eventHandlers={{ tileerror: () => onAirGapChange(true) }}
                    />
                ) : (
                    <TileLayer
                        attribution="Laksha local tile cache"
                        url="/tiles/{z}/{x}/{y}.png"
                        errorTileUrl=""
                    />
                )}

                {REPEATERS.map((repeater) => (
                    <Circle
                        key={`coverage-${repeater.id}`}
                        center={[repeater.latitude, repeater.longitude]}
                        radius={10_000}
                        pathOptions={{
                            color: repeater.status === 'LOW_BATTERY' ? '#EF4444' : '#22C55E',
                            fillColor: repeater.status === 'LOW_BATTERY' ? '#EF4444' : '#22C55E',
                            fillOpacity: 0.055,
                            weight: 1,
                            dashArray: '4 8',
                        }}
                    />
                ))}

                {[...REPEATERS, BASE_GATEWAY].map((repeater) => (
                    <Marker key={repeater.id} position={[repeater.latitude, repeater.longitude]} icon={repeaterIcon(repeater)}>
                        <Popup>
                            <strong>{repeater.name}</strong><br />
                            {repeater.status} · Battery {repeater.batteryPercent}%
                        </Popup>
                    </Marker>
                ))}

                {incidents.map((incident) => (
                    <Marker
                        key={incident.id}
                        position={[incident.latitude, incident.longitude]}
                        icon={incidentIcon(incident, incident.id === selectedIncidentId)}
                        eventHandlers={{ click: () => onSelectIncident(incident.id) }}
                    >
                        <Popup>
                            <strong>{incident.triage} · Node {incident.nodeId}</strong><br />
                            {incident.latitude.toFixed(6)}, {incident.longitude.toFixed(6)}<br />
                            RSSI {incident.rssi} dBm · SNR {incident.snr} dB
                        </Popup>
                    </Marker>
                ))}

                {selected?.route.map((hop) => (
                    <Polyline
                        key={`${selected.id}-${hop.fromId}-${hop.toId}`}
                        positions={[findPosition(hop.fromId, incidents), findPosition(hop.toId, incidents)]}
                        pathOptions={{ color: TRIAGE_COLORS[selected.triage], weight: 4, opacity: 0.9, dashArray: '10 10' }}
                    />
                ))}
            </MapContainer>

            {isAirGapped && (
                <div className="pointer-events-none absolute inset-0 z-[400] bg-[linear-gradient(rgba(34,197,94,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.10)_1px,transparent_1px)] bg-[size:48px_48px]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(1,8,13,0.45)_100%)]" />
                </div>
            )}

            <div className="absolute left-4 top-4 z-[500] space-y-2">
                <div className="rounded border border-sky-500/60 bg-zinc-950/90 p-3 shadow-xl backdrop-blur">
                    <div className="flex items-center gap-2 text-sky-300">
                        <Crosshair className="h-4 w-4" />
                        <span className="font-mono text-xs font-black tracking-wider">INCIDENT MAP</span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-zinc-400">10KM RF COVERAGE RINGS · LIVE HOP VECTOR</p>
                </div>
                <button
                    type="button"
                    onClick={() => onAirGapChange(!isAirGapped)}
                    className={`flex items-center gap-2 rounded border px-3 py-2 font-mono text-xs font-black shadow-xl transition ${
                        isAirGapped ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300' : 'border-sky-500 bg-zinc-950/90 text-sky-300'
                    }`}
                >
                    {isAirGapped ? <Radio className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
                    {isAirGapped ? 'AIR-GAPPED OFFLINE CACHE' : 'ONLINE TOPOGRAPHIC'}
                </button>
            </div>

            <style jsx global>{`@keyframes laksha-ping { 0%,100% { opacity:.9; transform:scale(.7) } 70% { opacity:0; transform:scale(1.55) } }`}</style>
        </section>
    );
}
