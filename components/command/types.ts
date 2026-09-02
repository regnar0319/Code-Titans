export type TriageType = 'MEDICAL' | 'TRAPPED' | 'LOST' | 'AVALANCHE';
export type IncidentStatus = 'UNRESOLVED' | 'ACKNOWLEDGED' | 'DISPATCHED' | 'EVACUATED';
export type RepeaterStatus = 'NOMINAL' | 'RELAYING' | 'LOW_BATTERY';

export interface Coordinate {
    latitude: number;
    longitude: number;
}

export interface RepeaterNode extends Coordinate {
    id: string;
    name: string;
    status: RepeaterStatus;
    batteryPercent: number;
}

export interface HopSegment {
    fromId: string;
    toId: string;
    label: string;
    signalDbm: number;
}

export interface IncidentRecord extends Coordinate {
    id: string;
    nodeId: number;
    triage: TriageType;
    isConscious: boolean;
    isGroup: boolean;
    batteryPercent: number;
    hopCount: number;
    status: IncidentStatus;
    rawHex: string;
    rssi: number;
    snr: number;
    route: HopSegment[];
}
