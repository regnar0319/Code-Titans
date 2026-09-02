'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HopAdvancedEvent } from './PacketTraversalCanvas';

export interface TraversalQueueState {
    activeHop: HopAdvancedEvent | null;
    queuedCount: number;
    enqueue: (event: HopAdvancedEvent) => void;
    enqueueMany: (events: HopAdvancedEvent[]) => void;
    completeActiveHop: (hopId: string) => void;
    clear: () => void;
}

/** Serializes incoming hop telemetry into a single end-to-end visual journey. */
export function useTraversalQueue(
    incomingHops: readonly HopAdvancedEvent[] = [],
    onJourneyComplete?: (packetId: string) => void,
): TraversalQueueState {
    const queueRef = useRef<HopAdvancedEvent[]>([]);
    const packetIdRef = useRef<string | null>(null);
    const [activeHop, setActiveHop] = useState<HopAdvancedEvent | null>(null);
    const [queuedCount, setQueuedCount] = useState(0);

    const enqueue = useCallback((event: HopAdvancedEvent) => {
        if (queueRef.current.some((queued) => queued.hop_id === event.hop_id) || activeHop?.hop_id === event.hop_id) return;
        queueRef.current.push(event);
        setQueuedCount(queueRef.current.length);
        setActiveHop((current) => {
            if (current) return current;
            const next = queueRef.current.shift() ?? null;
            setQueuedCount(queueRef.current.length);
            packetIdRef.current = next?.packet_id ?? packetIdRef.current;
            return next;
        });
    }, [activeHop]);

    const enqueueMany = useCallback((events: HopAdvancedEvent[]) => {
        if (events.length === 0) return;
        const known = new Set([...(activeHop ? [activeHop.hop_id] : []), ...queueRef.current.map((event) => event.hop_id)]);
        const fresh = events.filter((event) => !known.has(event.hop_id));
        fresh.sort((left, right) => left.sequence - right.sequence);
        queueRef.current.push(...fresh);
        if (fresh.length === 0) return;
        setQueuedCount(queueRef.current.length);
        setActiveHop((current) => {
            if (current) return current;
            const next = queueRef.current.shift() ?? null;
            setQueuedCount(queueRef.current.length);
            packetIdRef.current = next?.packet_id ?? packetIdRef.current;
            return next;
        });
    }, [activeHop]);

    const completeActiveHop = useCallback((hopId: string) => {
        setActiveHop((current) => {
            if (!current || current.hop_id !== hopId) return current;
            const completedPacket = current.packet_id;
            const next = queueRef.current.shift() ?? null;
            setQueuedCount(queueRef.current.length);
            if (!next && packetIdRef.current === completedPacket) {
                packetIdRef.current = null;
                onJourneyComplete?.(completedPacket);
            }
            packetIdRef.current = next?.packet_id ?? packetIdRef.current;
            return next;
        });
    }, [onJourneyComplete]);

    const clear = useCallback(() => {
        queueRef.current = [];
        packetIdRef.current = null;
        setActiveHop(null);
        setQueuedCount(0);
    }, []);

    useEffect(() => {
        if (incomingHops.length > 0) enqueueMany([...incomingHops]);
    }, [enqueueMany, incomingHops]);

    return { activeHop, queuedCount, enqueue, enqueueMany, completeActiveHop, clear };
}
