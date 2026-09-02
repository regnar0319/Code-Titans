'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    AlertTriangle,
    Compass,
    Heart,
    Mountain,
    ShieldAlert,
    Radio,
    Zap,
    MapPin,
    Users,
    User,
} from 'lucide-react';
import {
    TriageType,
    FramePayload,
    serializeFrame,
    frameToHex,
} from '../../lib/protocol/frame';
import { enqueueEmergencyPacket, getQueueStats } from '../../lib/storage/offlineQueue';
import type { BatteryStatus } from '../../lib/types/battery';

// ============================================================================
// TYPES
// ============================================================================

interface GPSPosition {
    latitude: number;
    longitude: number;
    accuracy: number; // in meters
    timestamp: number;
}

interface BatteryInfo {
    level: number; // 0-100
    charging: boolean;
}

// ============================================================================
// MOCK DATA & FALLBACK COORDINATES
// ============================================================================

// Everest Base Camp & Pir Panjal Range fallback
const FALLBACK_GPS: GPSPosition = {
    latitude: 27.986065,
    longitude: 86.909249,
    accuracy: 12,
    timestamp: Date.now(),
};

const SIMULATED_DEVICE_ID = Math.floor(Math.random() * 0xffffffff);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TacticalSOSViewport() {
    // ========== State Management ==========
    const [triageType, setTriageType] = useState<TriageType>(TriageType.MEDICAL);
    const [isConscious, setIsConscious] = useState(true);
    const [isGroup, setIsGroup] = useState(false);

    const [holdProgress, setHoldProgress] = useState(0); // 0-100
    const [isHolding, setIsHolding] = useState(false);

    const [gpsPosition, setGpsPosition] = useState<GPSPosition | null>(null);
    const [batteryInfo, setBatteryInfo] = useState<BatteryInfo>({
        level: 78,
        charging: false,
    });

    const [isTransmitting, setIsTransmitting] = useState(false);
    const [transmitStartTime, setTransmitStartTime] = useState<number | null>(null);
    const [elapsedTime, setElapsedTime] = useState(0);

    const [hexPayload, setHexPayload] = useState('');
    const [showHexInspector, setShowHexInspector] = useState(false);

    // ========== Refs for Non-State Tracking ==========
    const holdStartTimeRef = useRef<number | null>(null);
    const holdAnimationFrameRef = useRef<number | null>(null);
    const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const gpsWatchIdRef = useRef<number | null>(null);
    const transmitIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // ========== GPS & Battery Initialization ==========
    useEffect(() => {
        // Track battery listener cleanup
        let batteryUnsubscribe: (() => void) | null = null;

        // Attempt to acquire GPS position
        if ('geolocation' in navigator) {
            gpsWatchIdRef.current = navigator.geolocation.watchPosition(
                (position) => {
                    setGpsPosition({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp,
                    });
                },
                (error) => {
                    console.warn('GPS acquisition failed, using fallback:', error);
                    setGpsPosition(FALLBACK_GPS);
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        } else {
            setGpsPosition(FALLBACK_GPS);
        }

        // Attempt to acquire Battery API
        if ('getBattery' in navigator) {
            (navigator.getBattery as any)().then((battery: BatteryStatus) => {
                const updateBattery = () => {
                    setBatteryInfo({
                        level: Math.round(battery.level * 100),
                        charging: battery.charging,
                    });
                };
                updateBattery();
                battery.addEventListener('levelchange', updateBattery);
                battery.addEventListener('chargingchange', updateBattery);

                // Store cleanup function to be called in effect cleanup
                batteryUnsubscribe = () => {
                    battery.removeEventListener('levelchange', updateBattery);
                    battery.removeEventListener('chargingchange', updateBattery);
                };
            });
        }

        return () => {
            if (gpsWatchIdRef.current) {
                navigator.geolocation.clearWatch(gpsWatchIdRef.current);
            }
            if (batteryUnsubscribe) {
                batteryUnsubscribe();
            }
        };
    }, []);

    // ========== Compute Current Payload & Hex ==========
    const currentPayload = useMemo<FramePayload>(() => {
        const position = gpsPosition || FALLBACK_GPS;
        return {
            nodeId: SIMULATED_DEVICE_ID,
            latitude: position.latitude,
            longitude: position.longitude,
            triageType,
            isConscious,
            groupCount: isGroup,
            batteryPercent: batteryInfo.level,
            ttl: 3,
        };
    }, [gpsPosition, triageType, isConscious, isGroup, batteryInfo.level]);

    // Update hex payload whenever payload changes
    useEffect(() => {
        try {
            const buffer = serializeFrame(currentPayload);
            setHexPayload(frameToHex(buffer));
        } catch (error) {
            console.error('Failed to serialize frame:', error);
            setHexPayload('00000000000000000000000000000000');
        }
    }, [currentPayload]);

    // ========== Hold-to-Trigger Logic ==========
    const completeSosActivation = useCallback(() => {
        // Haptic feedback
        if ('vibrate' in navigator) {
            navigator.vibrate([100, 50, 100]);
        }

        // Enqueue packet
        try {
            const item = enqueueEmergencyPacket(currentPayload);
            console.log('Emergency packet enqueued:', item.id);
        } catch (error) {
            console.error('Failed to enqueue packet:', error);
        }

        // Switch to transmitting state
        setIsTransmitting(true);
        setTransmitStartTime(Date.now());

        // Clear hold state
        setHoldProgress(0);
        setIsHolding(false);
        holdStartTimeRef.current = null;

        if (holdAnimationFrameRef.current) {
            cancelAnimationFrame(holdAnimationFrameRef.current);
        }
    }, [currentPayload]);

    const handleMouseDown = useCallback(() => {
        if (isTransmitting || holdStartTimeRef.current !== null) return;

        setIsHolding(true);
        holdStartTimeRef.current = Date.now();

        const animateHold = () => {
            if (!holdStartTimeRef.current) return;

            const elapsed = Date.now() - holdStartTimeRef.current;
            const progress = Math.min((elapsed / 3000) * 100, 100);

            setHoldProgress(progress);

            if (progress < 100) {
                holdAnimationFrameRef.current = requestAnimationFrame(animateHold);
            } else {
                // Hold completed!
                completeSosActivation();
            }
        };

        holdAnimationFrameRef.current = requestAnimationFrame(animateHold);
    }, [isTransmitting, completeSosActivation]);

    const handleMouseUp = useCallback(() => {
        if (!holdStartTimeRef.current) return;

        const elapsed = Date.now() - holdStartTimeRef.current;

        // Cancel if not held long enough
        if (elapsed < 3000) {
            cancelHold();
        }

        holdStartTimeRef.current = null;
        setIsHolding(false);

        if (holdAnimationFrameRef.current) {
            cancelAnimationFrame(holdAnimationFrameRef.current);
        }
    }, []);

    const cancelHold = useCallback(() => {
        setHoldProgress(0);

        // Flash amber warning
        if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
        touchTimeoutRef.current = setTimeout(() => {
            // Visual feedback already displayed via CSS
        }, 500);
    }, []);

    // ========== Transmit Timer ==========
    useEffect(() => {
        if (!isTransmitting || !transmitStartTime) return;

        transmitIntervalRef.current = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - transmitStartTime) / 1000));
        }, 100);

        return () => {
            if (transmitIntervalRef.current) {
                clearInterval(transmitIntervalRef.current);
            }
        };
    }, [isTransmitting, transmitStartTime]);

    // ========== Reset to Idle After 30 Seconds ==========
    useEffect(() => {
        if (!isTransmitting || elapsedTime < 30) return;

        const resetTimer = setTimeout(() => {
            setIsTransmitting(false);
            setTransmitStartTime(null);
            setElapsedTime(0);
        }, 500);

        return () => clearTimeout(resetTimer);
    }, [isTransmitting, elapsedTime]);

    // ========== Render ==========

    if (isTransmitting) {
        return <QueuedScreen elapsedTime={elapsedTime} payload={currentPayload} />;
    }

    return (
        <div className="min-h-screen bg-black text-white flex flex-col overflow-hidden touch-none select-none">
            {/* ===== HEADER: TELEMETRY ===== */}
            <header className="flex-shrink-0 bg-black border-b border-zinc-800 p-3 space-y-2">
                {/* Top Row: Battery & Transmitter Status */}
                <div className="flex items-center justify-between gap-3">
                    {/* Battery */}
                    <div className="flex items-center gap-2 flex-1">
                        <Zap size={18} className="text-yellow-400" />
                        <span className="text-sm font-mono text-white">
                            {batteryInfo.level}%
                        </span>
                        <div className="h-2 flex-1 rounded-full bg-zinc-700 overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-green-500 to-yellow-500 transition-all"
                                style={{
                                    width: `${batteryInfo.level}%`,
                                }}
                            />
                        </div>
                    </div>

                    {/* Transmitter Ready Indicator */}
                    <div className="flex items-center gap-1">
                        <Radio size={16} className="text-green-400 animate-pulse" />
                        <span className="text-xs font-bold text-green-400">READY</span>
                    </div>
                </div>

                {/* GPS Status Row */}
                <div className="flex items-start gap-2 bg-zinc-900 p-2 rounded border border-zinc-700">
                    <MapPin size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-white truncate">
                            {gpsPosition
                                ? `${gpsPosition.latitude.toFixed(6)}, ${gpsPosition.longitude.toFixed(6)}`
                                : 'Acquiring GPS...'}
                        </div>
                        <div className="text-xs text-zinc-400">
                            {gpsPosition
                                ? `±${Math.round(gpsPosition.accuracy)}m accuracy`
                                : 'No fix'}
                        </div>
                    </div>
                </div>
            </header>

            {/* ===== MAIN CONTENT ===== */}
            <main className="flex-1 flex flex-col justify-between p-4 space-y-4 pb-8">
                {/* Triage Mode Selector */}
                <TriageModeSelector
                    selected={triageType}
                    onChange={setTriageType}
                    disabled={isTransmitting}
                />

                {/* Conscious & Group Toggles */}
                <SurvivalStatusToggles
                    isConscious={isConscious}
                    onConsciousChange={setIsConscious}
                    isGroup={isGroup}
                    onGroupChange={setIsGroup}
                    disabled={isTransmitting}
                />

                {/* Hex Inspector Drawer */}
                <HexInspectorDrawer
                    hexPayload={hexPayload}
                    payload={currentPayload}
                    isOpen={showHexInspector}
                    onToggle={setShowHexInspector}
                />
            </main>

            {/* ===== FOOTER: HOLD-TO-TRIGGER SOS BUTTON ===== */}
            <footer className="flex-shrink-0 bg-black border-t border-zinc-800 p-4 flex items-center justify-center pb-8">
                <SOSButton
                    progress={holdProgress}
                    isHolding={isHolding}
                    onStart={handleMouseDown}
                    onEnd={handleMouseUp}
                    disabled={isTransmitting}
                />
            </footer>
        </div>
    );
}

// ============================================================================
// TRIAGE MODE SELECTOR
// ============================================================================

interface TriageModeSelectorProps {
    selected: TriageType;
    onChange: (type: TriageType) => void;
    disabled: boolean;
}

function TriageModeSelector({
    selected,
    onChange,
    disabled,
}: TriageModeSelectorProps) {
    const modes = [
        {
            type: TriageType.MEDICAL,
            label: 'MEDICAL',
            icon: Heart,
            color: 'bg-red-900 border-red-500 shadow-lg shadow-red-600/30',
            activeColor: 'bg-red-700 shadow-lg shadow-red-600/50',
        },
        {
            type: TriageType.LOST,
            label: 'LOST',
            icon: Compass,
            color: 'bg-amber-900 border-amber-500 shadow-lg shadow-amber-600/30',
            activeColor: 'bg-amber-700 shadow-lg shadow-amber-600/50',
        },
        {
            type: TriageType.AVALANCHE,
            label: 'AVALANCHE',
            icon: Mountain,
            color: 'bg-blue-900 border-blue-400 shadow-lg shadow-blue-600/30',
            activeColor: 'bg-blue-700 shadow-lg shadow-blue-600/50',
        },
        {
            type: TriageType.TRAPPED,
            label: 'TRAPPED',
            icon: ShieldAlert,
            color: 'bg-orange-900 border-orange-500 shadow-lg shadow-orange-600/30',
            activeColor: 'bg-orange-700 shadow-lg shadow-orange-600/50',
        },
    ];

    return (
        <div className="grid grid-cols-2 gap-3">
            {modes.map(({ type, label, icon: Icon, color, activeColor }) => (
                <button
                    key={type}
                    onClick={() => onChange(type)}
                    disabled={disabled}
                    className={`
            p-3 rounded-lg border-2 font-bold text-sm flex flex-col items-center gap-2
            transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
            ${selected === type ? activeColor : color}
          `}
                >
                    <Icon size={28} className="text-white" />
                    <span className="text-xs uppercase tracking-wider">{label}</span>
                </button>
            ))}
        </div>
    );
}

// ============================================================================
// SURVIVAL STATUS TOGGLES
// ============================================================================

interface SurvivalStatusTogglesProps {
    isConscious: boolean;
    onConsciousChange: (value: boolean) => void;
    isGroup: boolean;
    onGroupChange: (value: boolean) => void;
    disabled: boolean;
}

function SurvivalStatusToggles({
    isConscious,
    onConsciousChange,
    isGroup,
    onGroupChange,
    disabled,
}: SurvivalStatusTogglesProps) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {/* Conscious Toggle */}
            <button
                onClick={() => onConsciousChange(!isConscious)}
                disabled={disabled}
                className={`
          h-16 rounded-lg border-2 font-bold text-sm flex flex-col items-center justify-center gap-1
          transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
          ${isConscious
                        ? 'bg-green-900 border-green-500 shadow-lg shadow-green-600/30'
                        : 'bg-red-900 border-red-500 shadow-lg shadow-red-600/30'
                    }
        `}
            >
                <AlertTriangle size={20} className="text-white" />
                <span className="text-xs uppercase tracking-wider">
                    {isConscious ? 'CONSCIOUS' : 'UNCONSCIOUS'}
                </span>
            </button>

            {/* Group Toggle */}
            <button
                onClick={() => onGroupChange(!isGroup)}
                disabled={disabled}
                className={`
          h-16 rounded-lg border-2 font-bold text-sm flex flex-col items-center justify-center gap-1
          transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
          ${isGroup
                        ? 'bg-purple-900 border-purple-500 shadow-lg shadow-purple-600/30'
                        : 'bg-slate-800 border-slate-600 shadow-lg shadow-slate-600/30'
                    }
        `}
            >
                {isGroup ? (
                    <Users size={20} className="text-white" />
                ) : (
                    <User size={20} className="text-white" />
                )}
                <span className="text-xs uppercase tracking-wider">
                    {isGroup ? 'GROUP' : 'SOLO'}
                </span>
            </button>
        </div>
    );
}

// ============================================================================
// HEX INSPECTOR DRAWER
// ============================================================================

interface HexInspectorDrawerProps {
    hexPayload: string;
    payload: FramePayload;
    isOpen: boolean;
    onToggle: (open: boolean) => void;
}

function HexInspectorDrawer({
    hexPayload,
    payload,
    isOpen,
    onToggle,
}: HexInspectorDrawerProps) {
    const getFieldBreakdown = () => {
        const view = new DataView(
            new ArrayBuffer(16),
            0,
            16
        );

        // For display purposes, show conceptual breakdown
        return [
            {
                label: 'Node ID (Bytes 0-3)',
                value: `0x${payload.nodeId.toString(16).toUpperCase().padStart(8, '0')}`,
            },
            {
                label: 'Latitude (Bytes 4-7)',
                value: `${payload.latitude.toFixed(6)}°`,
            },
            {
                label: 'Longitude (Bytes 8-11)',
                value: `${payload.longitude.toFixed(6)}°`,
            },
            {
                label: 'Triage Type (Bits 0-3)',
                value: `${payload.triageType} (${TriageType[payload.triageType]})`,
            },
            {
                label: 'Battery & TTL (Byte 13)',
                value: `${payload.batteryPercent.toFixed(0)}% | TTL=${payload.ttl}`,
            },
        ];
    };

    return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <button
                onClick={() => onToggle(!isOpen)}
                className="w-full p-3 flex items-center justify-between bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
                <span className="text-sm font-bold text-white">HEX INSPECTOR</span>
                <span className="text-xs text-zinc-400">
                    {isOpen ? '▼' : '▶'}
                </span>
            </button>

            {isOpen && (
                <div className="p-4 space-y-4">
                    {/* Raw Hex */}
                    <div>
                        <p className="text-xs font-bold text-yellow-400 mb-2">
                            16-BYTE HEX (32 CHARS)
                        </p>
                        <div className="bg-black p-3 rounded font-mono text-sm text-green-400 break-all">
                            {hexPayload}
                        </div>
                    </div>

                    {/* Field Breakdown */}
                    <div>
                        <p className="text-xs font-bold text-blue-400 mb-2">
                            FIELD BREAKDOWN
                        </p>
                        <div className="space-y-2">
                            {getFieldBreakdown().map((field) => (
                                <div
                                    key={field.label}
                                    className="flex justify-between text-xs bg-black p-2 rounded border border-zinc-700"
                                >
                                    <span className="text-zinc-400">{field.label}</span>
                                    <span className="font-mono text-white font-bold">
                                        {field.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// SOS BUTTON WITH 3-SECOND HOLD RING
// ============================================================================

interface SOSButtonProps {
    progress: number; // 0-100
    isHolding: boolean;
    onStart: () => void;
    onEnd: () => void;
    disabled: boolean;
}

function SOSButton({
    progress,
    isHolding,
    onStart,
    onEnd,
    disabled,
}: SOSButtonProps) {
    const ringRadius = 55; // SVG circle radius
    const circumference = 2 * Math.PI * ringRadius;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
        <div
            className="relative w-40 h-40 flex items-center justify-center"
            onPointerDown={(event) => {
                if (disabled) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                onStart();
            }}
            onPointerUp={onEnd}
            onPointerCancel={onEnd}
            onLostPointerCapture={onEnd}
        >
            {/* Pulsing Background Glow */}
            <div
                className={`
          absolute inset-0 rounded-full blur-2xl
          transition-all duration-300
          ${isHolding
                        ? 'bg-red-600 opacity-60 animate-pulse'
                        : 'bg-red-900 opacity-30'
                    }
        `}
            />

            {/* SVG Circular Progress Ring */}
            <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 140 140"
                style={{ transform: 'rotate(-90deg)' }}
                aria-label="SOS hold progress indicator"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                {/* Background Ring */}
                <circle
                    cx="70"
                    cy="70"
                    r={ringRadius}
                    fill="none"
                    stroke="#27272A"
                    strokeWidth="3"
                />

                {/* Progress Ring */}
                <circle
                    cx="70"
                    cy="70"
                    r={ringRadius}
                    fill="none"
                    stroke={progress < 100 ? '#FF1E27' : '#FFE600'}
                    strokeWidth="4"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{
                        transition: isHolding ? 'none' : 'stroke-dashoffset 0.1s linear',
                    }}
                />
            </svg>

            {/* Central Button */}
            <button
                className={`
          relative z-10 w-32 h-32 rounded-full font-black text-2xl flex items-center justify-center
          transition-all duration-200 active:scale-95
          ${disabled
                        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                        : isHolding
                            ? 'bg-gradient-to-br from-red-500 to-red-700 text-white shadow-2xl shadow-red-600/60 scale-105'
                            : 'bg-gradient-to-br from-red-600 to-red-800 text-white shadow-lg shadow-red-600/40 hover:shadow-red-600/60'
                    }
        `}
                disabled={disabled}
            >
                {progress < 100 ? (
                    <>
                        <div className="text-center">
                            <div className="text-xs font-bold tracking-wider">HOLD</div>
                            <div className="text-lg">{Math.round(progress / 20)}s</div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="text-center">
                            <div className="text-lg">✓</div>
                        </div>
                    </>
                )}
            </button>

            {/* Hold Cancelled Indicator */}
            {progress > 0 && progress < 50 && !isHolding && (
                <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-xs font-bold text-amber-400 animate-pulse">
                    CANCELLED
                </div>
            )}
        </div>
    );
}

// ============================================================================
// SOS QUEUED SCREEN
// ============================================================================

interface QueuedScreenProps {
    elapsedTime: number;
    payload: FramePayload;
}

function QueuedScreen({ elapsedTime, payload }: QueuedScreenProps) {
    const queueStats = getQueueStats();

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center space-y-6 p-4">
            {/* Pulsing Beacon Icon */}
            <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full bg-red-600 opacity-30 animate-pulse" />
                <div className="absolute inset-2 rounded-full bg-red-600 opacity-50 animate-pulse" style={{ animationDelay: '0.1s' }} />
                <Radio size={60} className="absolute inset-1/2 transform -translate-x-1/2 -translate-y-1/2 text-red-400 animate-pulse" />
            </div>

            {/* Status Text */}
            <div className="text-center space-y-3">
                <h1 className="text-3xl font-black tracking-wider text-red-400">
                    TRANSMITTING
                </h1>
                <p className="text-lg text-white font-mono">
                    AWAITING RADIO TRANSPORT
                </p>
            </div>

            {/* Elapsed Time */}
            <div className="text-6xl font-black font-mono text-yellow-400">
                {String(Math.floor(elapsedTime / 60)).padStart(2, '0')}:
                {String(elapsedTime % 60).padStart(2, '0')}
            </div>

            {/* Queue Status */}
            <div className="bg-zinc-900 border-2 border-green-500 rounded-lg p-4 text-center max-w-xs">
                <p className="text-xs text-green-400 font-bold mb-2">QUEUE STATUS</p>
                <div className="text-sm text-white font-mono space-y-1">
                    <p>Queued: {queueStats.queued}</p>
                    <p>Transmitting: {queueStats.transmitting}</p>
                    <p>Delivered: {queueStats.delivered}</p>
                </div>
            </div>

            {/* Payload Summary */}
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-center max-w-xs">
                <p className="text-xs text-blue-400 font-bold mb-2">PAYLOAD</p>
                <div className="text-xs text-zinc-300 font-mono space-y-1">
                    <p>ID: {payload.nodeId.toString(16).toUpperCase()}</p>
                    <p>Lat: {payload.latitude.toFixed(4)}°</p>
                    <p>Lng: {payload.longitude.toFixed(4)}°</p>
                    <p>Type: {TriageType[payload.triageType]}</p>
                </div>
            </div>

            {/* Instructions */}
            <p className="text-xs text-zinc-500 text-center max-w-xs">
                SOS packet is stored locally. A radio transport must send it and update its delivery status.
            </p>
        </div>
    );
}
