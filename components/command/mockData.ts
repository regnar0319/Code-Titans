import { IncidentRecord, RepeaterNode } from './types';

export const BASE_GATEWAY: RepeaterNode = {
    id: 'base-gateway',
    name: 'Base Camp Gateway',
    latitude: 27.9868,
    longitude: 86.925,
    status: 'NOMINAL',
    batteryPercent: 100,
};

export const REPEATERS: RepeaterNode[] = [
    { id: 'ridge-02', name: 'Ridge Repeater 02', latitude: 28.004, longitude: 86.885, status: 'RELAYING', batteryPercent: 72 },
    { id: 'valley-01', name: 'Valley Pass 01', latitude: 27.96, longitude: 86.865, status: 'NOMINAL', batteryPercent: 91 },
    { id: 'icefall-03', name: 'Khumbu Icefall 03', latitude: 27.99, longitude: 86.9, status: 'LOW_BATTERY', batteryPercent: 18 },
    { id: 'himachal-04', name: 'Himachal Alpine 04', latitude: 32.2432, longitude: 77.1892, status: 'RELAYING', batteryPercent: 66 },
    { id: 'rohtang-05', name: 'Rohtang Pass 05', latitude: 32.37, longitude: 77.25, status: 'NOMINAL', batteryPercent: 83 },
];

export const INCIDENTS: IncidentRecord[] = [
    {
        id: 'inc-aval-019', nodeId: 42949012, triage: 'AVALANCHE', isConscious: true, isGroup: true,
        batteryPercent: 85, hopCount: 3, status: 'UNRESOLVED', latitude: 32.2432, longitude: 77.1892,
        rawHex: '028F8EF401EBE0000499AD7003B5A4E2', rssi: -92, snr: 7.8,
        route: [
            { fromId: 'inc-aval-019', toId: 'himachal-04', label: 'Victim → Himachal Alpine 04', signalDbm: -92 },
            { fromId: 'himachal-04', toId: 'rohtang-05', label: 'Himachal Alpine 04 → Rohtang Pass 05', signalDbm: -84 },
            { fromId: 'rohtang-05', toId: 'base-gateway', label: 'Rohtang Pass 05 → Base Camp Gateway', signalDbm: -76 },
        ],
    },
    {
        id: 'inc-med-104', nodeId: 1048576, triage: 'MEDICAL', isConscious: false, isGroup: false,
        batteryPercent: 40, hopCount: 3, status: 'UNRESOLVED', latitude: 27.9924, longitude: 86.8875,
        rawHex: '0010000001AB5C10052C1199112891A4', rssi: -101, snr: 2.1,
        route: [
            { fromId: 'inc-med-104', toId: 'icefall-03', label: 'Victim → Khumbu Icefall 03', signalDbm: -101 },
            { fromId: 'icefall-03', toId: 'ridge-02', label: 'Khumbu Icefall 03 → Ridge Repeater 02', signalDbm: -96 },
            { fromId: 'ridge-02', toId: 'base-gateway', label: 'Ridge Repeater 02 → Base Camp Gateway', signalDbm: -81 },
        ],
    },
    {
        id: 'inc-lost-447', nodeId: 447392, triage: 'LOST', isConscious: true, isGroup: false,
        batteryPercent: 60, hopCount: 2, status: 'ACKNOWLEDGED', latitude: 27.9511, longitude: 86.8693,
        rawHex: '0006D37001AB38C0052D0DFD125472C1', rssi: -88, snr: 9.2,
        route: [
            { fromId: 'inc-lost-447', toId: 'valley-01', label: 'Victim → Valley Pass 01', signalDbm: -88 },
            { fromId: 'valley-01', toId: 'base-gateway', label: 'Valley Pass 01 → Base Camp Gateway', signalDbm: -74 },
        ],
    },
];
