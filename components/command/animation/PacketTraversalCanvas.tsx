'use client';

import { useEffect, useRef } from 'react';
import type L from 'leaflet';

export interface HopAdvancedEvent {
    type: 'HOP_ADVANCED';
    hop_id: string;
    packet_id: string;
    sequence: number;
    from_node: string;
    to_node: string;
    from_lat: number;
    from_lng: number;
    to_lat: number;
    to_lng: number;
    from_elevation_m?: number;
    to_elevation_m?: number;
    rssi: number;
    snr: number;
    hop_index: number;
    total_hops: number;
    timestamp: number;
    latency_ms?: number;
    status?: 'SUCCESS' | 'DROPPED' | 'BIT_CORRUPTED';
}

interface PacketTraversalCanvasProps {
    activeHop: HopAdvancedEvent | null;
    mapInstance: L.Map | null;
    playbackSpeed?: number;
    onHopComplete?: (hopId: string) => void;
}

interface Point { x: number; y: number }
interface Ripple { x: number; y: number; age: number; maxAge: number }
interface Ember { x: number; y: number; vx: number; vy: number; age: number }

const TAIL_LENGTH = 9;
const RIPPLE_COUNT = 3;
const EMBER_COUNT = 8;
const TAU = Math.PI * 2;

function signalColor(event: HopAdvancedEvent): string {
    if (event.snr > 5 && event.rssi > -85) return '#10B981';
    if (event.snr >= 0) return '#F59E0B';
    return '#EF4444';
}

function quadratic(a: Point, control: Point, b: Point, t: number): Point {
    const inverse = 1 - t;
    return {
        x: inverse * inverse * a.x + 2 * inverse * t * control.x + t * t * b.x,
        y: inverse * inverse * a.y + 2 * inverse * t * control.y + t * t * b.y,
    };
}

/** Canvas overlay synchronized to Leaflet's container projection on every frame. */
export default function PacketTraversalCanvas({ activeHop, mapInstance, playbackSpeed = 1, onHopComplete }: PacketTraversalCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const hopRef = useRef(activeHop);
    const progressRef = useRef(0);
    const lastFrameRef = useRef(0);
    const tailRef = useRef<Point[]>([]);
    const ripplesRef = useRef<Ripple[]>([]);
    const embersRef = useRef<Ember[]>([]);
    const completedRef = useRef<string | null>(null);

    useEffect(() => {
        hopRef.current = activeHop;
        progressRef.current = 0;
        completedRef.current = null;
        tailRef.current.length = 0;
        ripplesRef.current.length = 0;
        embersRef.current.length = 0;
    }, [activeHop]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !mapInstance) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        let frame = 0;
        let mounted = true;

        const resize = () => {
            const rect = mapInstance.getContainer().getBoundingClientRect();
            const ratio = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        };
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mapInstance.getContainer());
        mapInstance.on('move zoom resize', resize);
        resize();

        const render = (now: number) => {
            if (!mounted) return;
            const rect = mapInstance.getContainer().getBoundingClientRect();
            const dt = lastFrameRef.current ? Math.min(64, now - lastFrameRef.current) : 16.67;
            lastFrameRef.current = now;
            context.clearRect(0, 0, rect.width, rect.height);
            const event = hopRef.current;
            if (event) {
                const start = mapInstance.latLngToContainerPoint([event.from_lat, event.from_lng]);
                const end = mapInstance.latLngToContainerPoint([event.to_lat, event.to_lng]);
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const distance = Math.hypot(dx, dy) || 1;
                const elevationFactor = Math.max(-0.35, Math.min(0.75, ((event.to_elevation_m ?? 0) - (event.from_elevation_m ?? 0)) / 5000));
                const arc = Math.min(100, Math.max(24, distance * (0.18 + elevationFactor * 0.12)));
                const control = { x: (start.x + end.x) / 2 - (dy / distance) * arc, y: (start.y + end.y) / 2 + (dx / distance) * arc };
                const duration = Math.max(400, Math.min(1200, event.latency_ms ?? 600));
                const dropped = event.status === 'DROPPED' || event.status === 'BIT_CORRUPTED';
                progressRef.current = Math.min(1, progressRef.current + (dt * playbackSpeed) / duration);
                const visibleProgress = dropped ? Math.min(progressRef.current, 0.58) : progressRef.current;
                const photon = quadratic(start, control, end, visibleProgress);
                const tail = tailRef.current;
                tail.push(photon);
                if (tail.length > TAIL_LENGTH) tail.shift();
                const color = signalColor(event);
                context.globalCompositeOperation = 'lighter';
                for (let index = 0; index < tail.length; index += 1) {
                    const point = tail[index];
                    const alpha = (index + 1) / tail.length * 0.55;
                    context.fillStyle = color;
                    context.globalAlpha = alpha;
                    context.beginPath();
                    context.arc(point.x, point.y, 2 + (index / tail.length) * 2, 0, TAU);
                    context.fill();
                }
                context.globalAlpha = 1;
                if (dropped && progressRef.current >= 0.58 && embersRef.current.length === 0) {
                    for (let index = 0; index < EMBER_COUNT; index += 1) {
                        const angle = (index / EMBER_COUNT) * TAU;
                        embersRef.current.push({ x: photon.x, y: photon.y, vx: Math.cos(angle) * (1.5 + index * 0.15), vy: Math.sin(angle) * (1.5 + index * 0.15), age: 0 });
                    }
                }
                for (const ember of embersRef.current) {
                    ember.age += dt;
                    ember.x += ember.vx * dt / 16;
                    ember.y += ember.vy * dt / 16;
                    context.globalAlpha = Math.max(0, 1 - ember.age / 500);
                    context.fillStyle = '#EF4444';
                    context.fillRect(ember.x - 2, ember.y - 2, 4, 4);
                }
                if (!dropped) {
                    context.shadowBlur = 22;
                    context.shadowColor = color;
                    context.fillStyle = color;
                    context.beginPath();
                    context.arc(photon.x, photon.y, 5, 0, TAU);
                    context.fill();
                    context.shadowBlur = 0;
                }
                if (progressRef.current >= 1 && !completedRef.current) {
                    completedRef.current = event.hop_id;
                    const impact = end;
                    for (let index = 0; index < RIPPLE_COUNT; index += 1) ripplesRef.current.push({ x: impact.x, y: impact.y, age: index * 110, maxAge: 500 });
                    onHopComplete?.(event.hop_id);
                }
            }
            context.globalCompositeOperation = 'lighter';
            for (let index = ripplesRef.current.length - 1; index >= 0; index -= 1) {
                const ripple = ripplesRef.current[index];
                ripple.age += dt;
                if (ripple.age >= ripple.maxAge) { ripplesRef.current.splice(index, 1); continue; }
                const ratio = ripple.age / ripple.maxAge;
                context.globalAlpha = 0.8 * (1 - ratio);
                context.strokeStyle = '#10B981';
                context.lineWidth = 2;
                context.beginPath();
                context.arc(ripple.x, ripple.y, ratio * 32, 0, TAU);
                context.stroke();
            }
            context.globalAlpha = 1;
            frame = requestAnimationFrame(render);
        };
        frame = requestAnimationFrame(render);
        return () => { mounted = false; cancelAnimationFrame(frame); resizeObserver.disconnect(); mapInstance.off('move zoom resize', resize); };
    }, [mapInstance, onHopComplete, playbackSpeed]);

    return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[450]" aria-label="Live packet traversal animation" />;
}
