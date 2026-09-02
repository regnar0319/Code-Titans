'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'ERROR';
export type Topic = 'mesh:hops' | 'mesh:incidents' | 'mesh:nodes';
export type TelemetryEvent = { topic?: string; type: string; sequence?: number; [key: string]: unknown };
export type HopEvent = TelemetryEvent & { type: 'HOP_ADVANCED'; sequence: number };
export type IncidentEvent = TelemetryEvent & { incident_id: string; type: string; sequence: number };
export type NodeStatusEvent = TelemetryEvent & { node_id: string; status: 'NOMINAL' | 'DEGRADED' | 'OFFLINE'; battery: number; sequence: number };
export type IncidentMap = Map<string, IncidentEvent>;
export type NodeStatusMap = Map<string, NodeStatusEvent>;

export interface EmergencySocketState {
    connectionState: ConnectionState;
    lastHopEvent: HopEvent | null;
    incidents: IncidentMap;
    nodeStatuses: NodeStatusMap;
    lastReceivedSequence: number;
    pingLatencyMs: number | null;
    subscribe: (topic: Topic) => void;
    unsubscribe: (topic: Topic) => void;
    dispatchAction: (actionType: string, payload: unknown) => void;
}

const DEFAULT_TOPICS: Topic[] = ['mesh:hops', 'mesh:incidents', 'mesh:nodes'];
const MAX_BACKOFF_MS = 8000;

function socketUrl(path: string): string {
    if (typeof window === 'undefined') return path;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
}

export function useEmergencySocket(path = '/ws/telemetry'): EmergencySocketState {
    const [connectionState, setConnectionState] = useState<ConnectionState>('CONNECTING');
    const [lastHopEvent, setLastHopEvent] = useState<HopEvent | null>(null);
    const [incidents, setIncidents] = useState<IncidentMap>(() => new Map());
    const [nodeStatuses, setNodeStatuses] = useState<NodeStatusMap>(() => new Map());
    const [lastReceivedSequence, setLastReceivedSequence] = useState(0);
    const [pingLatencyMs, setPingLatencyMs] = useState<number | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const lastSequenceRef = useRef(0);
    const pendingEventsRef = useRef<Map<number, TelemetryEvent>>(new Map());
    const subscriptionsRef = useRef<Set<Topic>>(new Set(DEFAULT_TOPICS));
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const heartbeatRef = useRef<{ sentAt: number } | null>(null);
    const stoppedRef = useRef(false);

    const send = useCallback((message: Record<string, unknown>) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify(message));
        }
    }, []);

    const applyEvent = useCallback((event: TelemetryEvent) => {
        if (event.type === 'HOP_ADVANCED') setLastHopEvent(event as HopEvent);
        if (event.type === 'INCIDENT_INGESTED' || event.type === 'INCIDENT_UPDATED') {
            const incident = event as IncidentEvent;
            setIncidents((current) => new Map(current).set(incident.incident_id, incident));
        }
        if (event.type === 'INCIDENT_RESOLVED') {
            const incident = event as IncidentEvent;
            setIncidents((current) => {
                const next = new Map(current);
                next.delete(incident.incident_id);
                return next;
            });
        }
        if (event.type === 'NODE_STATUS_CHANGED') {
            const node = event as NodeStatusEvent;
            setNodeStatuses((current) => new Map(current).set(node.node_id, node));
        }
    }, []);

    const processEvent = useCallback((event: TelemetryEvent) => {
        const sequence = event.sequence;
        if (typeof sequence !== 'number' || sequence <= lastSequenceRef.current) return;
        pendingEventsRef.current.set(sequence, event);
        let next = lastSequenceRef.current + 1;
        while (pendingEventsRef.current.has(next)) {
            const ordered = pendingEventsRef.current.get(next);
            pendingEventsRef.current.delete(next);
            if (ordered) applyEvent(ordered);
            lastSequenceRef.current = next;
            setLastReceivedSequence(next);
            next += 1;
        }
    }, [applyEvent]);

    const connect = useCallback(() => {
        if (stoppedRef.current || document.visibilityState !== 'visible') return;
        setConnectionState(reconnectAttemptRef.current ? 'RECONNECTING' : 'CONNECTING');
        const socket = new WebSocket(socketUrl(path));
        socketRef.current = socket;
        socket.onopen = () => {
            reconnectAttemptRef.current = 0;
            setConnectionState('CONNECTED');
            socket.send(JSON.stringify({
                action: 'RESUME',
                session_id: sessionIdRef.current,
                last_seq: lastSequenceRef.current,
                subscriptions: [...subscriptionsRef.current],
            }));
        };
        socket.onmessage = (message) => {
            try {
                const event = JSON.parse(message.data) as TelemetryEvent & { session_id?: string; server_time?: number };
                if (event.type === 'SESSION_READY') {
                    sessionIdRef.current = event.session_id ?? null;
                } else if (event.type === 'HEARTBEAT') {
                    if (heartbeatRef.current) setPingLatencyMs(Date.now() - heartbeatRef.current.sentAt);
                    heartbeatRef.current = { sentAt: Date.now() };
                    send({ action: 'PONG' });
                } else {
                    processEvent(event);
                }
            } catch {
                setConnectionState('ERROR');
            }
        };
        socket.onerror = () => setConnectionState('ERROR');
        socket.onclose = () => {
            socketRef.current = null;
            if (!stoppedRef.current && document.visibilityState === 'visible') {
                const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** reconnectAttemptRef.current) + Math.random() * 300;
                reconnectAttemptRef.current += 1;
                reconnectTimerRef.current = setTimeout(connect, delay);
            } else if (!stoppedRef.current) setConnectionState('DISCONNECTED');
        };
    }, [path, processEvent, send]);

    useEffect(() => {
        stoppedRef.current = false;
        connect();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                reconnectTimerRef.current && clearTimeout(reconnectTimerRef.current);
                socketRef.current?.close(1000, 'tab inactive');
                setConnectionState('DISCONNECTED');
            } else if (!socketRef.current) connect();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            stoppedRef.current = true;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            socketRef.current?.close(1000, 'component unmounted');
        };
    }, [connect]);

    const subscribe = useCallback((topic: Topic) => {
        subscriptionsRef.current.add(topic);
        send({ action: 'SUBSCRIBE', topic });
    }, [send]);
    const unsubscribe = useCallback((topic: Topic) => {
        subscriptionsRef.current.delete(topic);
        send({ action: 'UNSUBSCRIBE', topic });
    }, [send]);
    const dispatchAction = useCallback((actionType: string, payload: unknown) => {
        send({ action: actionType, payload });
    }, [send]);

    return { connectionState, lastHopEvent, incidents, nodeStatuses, lastReceivedSequence, pingLatencyMs, subscribe, unsubscribe, dispatchAction };
}
