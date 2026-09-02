'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { INCIDENTS } from './mockData';
import IncidentQueue from './IncidentQueue';
import { IncidentRecord, IncidentStatus } from './types';

const IncidentMap = dynamic(() => import('./IncidentMap'), {
    ssr: false,
    loading: () => <div className="grid h-full min-h-[520px] place-items-center bg-zinc-950 font-mono text-xs text-sky-400">INITIALIZING LOCAL MAP LAYER…</div>,
});

export default function IncidentCommandConsole() {
    const [incidents, setIncidents] = useState<IncidentRecord[]>(INCIDENTS);
    const [selectedIncidentId, setSelectedIncidentId] = useState<string>(INCIDENTS[0].id);
    const [isAirGapped, setIsAirGapped] = useState(true);

    const updateStatus = (id: string, status: IncidentStatus) => {
        setIncidents((current) => current.map((incident) => incident.id === id ? { ...incident, status } : incident));
        setSelectedIncidentId(id);
    };

    return (
        <main className="min-h-screen bg-black text-zinc-100">
            <div className="border-b border-zinc-800 bg-zinc-950 px-4 py-3">
                <p className="font-mono text-[10px] font-bold tracking-[0.25em] text-sky-400">LAKSHA / INCIDENT COMMAND CONSOLE</p>
                <p className="mt-1 font-mono text-xs text-zinc-500">AIR-GAPPED MOUNTAIN BASE CAMP · LOCAL RF TELEMETRY OPERATIONS</p>
            </div>
            <div className="grid min-h-[calc(100vh-71px)] grid-cols-1 lg:grid-cols-[65fr_35fr]">
                <IncidentMap incidents={incidents} selectedIncidentId={selectedIncidentId} onSelectIncident={setSelectedIncidentId} isAirGapped={isAirGapped} onAirGapChange={setIsAirGapped} />
                <IncidentQueue incidents={incidents} selectedIncidentId={selectedIncidentId} onSelect={setSelectedIncidentId} onStatusChange={updateStatus} />
            </div>
        </main>
    );
}
