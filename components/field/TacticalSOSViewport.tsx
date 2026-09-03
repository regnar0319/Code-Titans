'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertTriangle, Compass, Heart, Mountain, ShieldAlert, Radio, Zap, MapPin, Users, User,
} from 'lucide-react';
import { TriageType, FramePayload, serializeFrame, frameToHex } from '../../lib/protocol/frame';
import { enqueueEmergencyPacket, getQueueStats } from '../../lib/storage/offlineQueue';
import type { BatteryStatus } from '../../lib/types/battery';

interface GPSPosition { latitude: number; longitude: number; accuracy: number; timestamp: number; }
interface BatteryInfo { level: number; charging: boolean; }

const FALLBACK_GPS: GPSPosition = {
  latitude: 27.986065, longitude: 86.909249, accuracy: 12, timestamp: Date.now(),
};
const SIMULATED_DEVICE_ID = Math.floor(Math.random() * 0xffffffff);

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{children}</p>;
}

export default function TacticalSOSViewport() {
  const [triageType, setTriageType] = useState<TriageType>(TriageType.MEDICAL);
  const [isConscious, setIsConscious] = useState(true);
  const [isGroup, setIsGroup] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [gpsPosition, setGpsPosition] = useState<GPSPosition | null>(null);
  const [batteryInfo, setBatteryInfo] = useState<BatteryInfo>({ level: 78, charging: false });
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [transmitStartTime, setTransmitStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [hexPayload, setHexPayload] = useState('');
  const [showHexInspector, setShowHexInspector] = useState(true);

  const holdStartTimeRef = useRef<number | null>(null);
  const holdAnimationFrameRef = useRef<number | null>(null);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const transmitIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let batteryUnsubscribe: (() => void) | null = null;
    if ('geolocation' in navigator) {
      gpsWatchIdRef.current = navigator.geolocation.watchPosition(
        (position) => setGpsPosition({
          latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, timestamp: position.timestamp,
        }),
        (error) => { console.warn('GPS acquisition failed, using fallback:', error); setGpsPosition(FALLBACK_GPS); },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
      );
    } else {
      setGpsPosition(FALLBACK_GPS);
    }

    if ('getBattery' in navigator) {
      (navigator.getBattery as any)().then((battery: BatteryStatus) => {
        const updateBattery = () => setBatteryInfo({
          level: Math.round(battery.level * 100), charging: battery.charging,
        });
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
        batteryUnsubscribe = () => {
          battery.removeEventListener('levelchange', updateBattery);
          battery.removeEventListener('chargingchange', updateBattery);
        };
      });
    }

    return () => {
      if (gpsWatchIdRef.current) navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      if (batteryUnsubscribe) batteryUnsubscribe();
    };
  }, []);

  const currentPayload = useMemo<FramePayload>(() => {
    const position = gpsPosition || FALLBACK_GPS;
    return {
      nodeId: SIMULATED_DEVICE_ID, latitude: position.latitude, longitude: position.longitude,
      triageType, isConscious, groupCount: isGroup, batteryPercent: batteryInfo.level, ttl: 3,
    };
  }, [gpsPosition, triageType, isConscious, isGroup, batteryInfo.level]);

  useEffect(() => {
    try {
      setHexPayload(frameToHex(serializeFrame(currentPayload)));
    } catch (error) {
      console.error('Failed to serialize frame:', error);
      setHexPayload('00000000000000000000000000000000');
    }
  }, [currentPayload]);

  const completeSosActivation = useCallback(() => {
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
    try {
      const item = enqueueEmergencyPacket(currentPayload);
      console.log('Emergency packet enqueued:', item.id);
    } catch (error) {
      console.error('Failed to enqueue packet:', error);
    }
    setIsTransmitting(true);
    setTransmitStartTime(Date.now());
    setHoldProgress(0);
    setIsHolding(false);
    holdStartTimeRef.current = null;
    if (holdAnimationFrameRef.current) cancelAnimationFrame(holdAnimationFrameRef.current);
  }, [currentPayload]);

  const handleMouseDown = useCallback(() => {
    if (isTransmitting || holdStartTimeRef.current !== null) return;
    setIsHolding(true);
    holdStartTimeRef.current = Date.now();
    const animateHold = () => {
      if (!holdStartTimeRef.current) return;
      const progress = Math.min(((Date.now() - holdStartTimeRef.current) / 3000) * 100, 100);
      setHoldProgress(progress);
      if (progress < 100) holdAnimationFrameRef.current = requestAnimationFrame(animateHold);
      else completeSosActivation();
    };
    holdAnimationFrameRef.current = requestAnimationFrame(animateHold);
  }, [isTransmitting, completeSosActivation]);

  const cancelHold = useCallback(() => {
    setHoldProgress(0);
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => {}, 500);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!holdStartTimeRef.current) return;
    if (Date.now() - holdStartTimeRef.current < 3000) cancelHold();
    holdStartTimeRef.current = null;
    setIsHolding(false);
    if (holdAnimationFrameRef.current) cancelAnimationFrame(holdAnimationFrameRef.current);
  }, [cancelHold]);

  useEffect(() => {
    if (!isTransmitting || !transmitStartTime) return;
    transmitIntervalRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - transmitStartTime) / 1000));
    }, 100);
    return () => { if (transmitIntervalRef.current) clearInterval(transmitIntervalRef.current); };
  }, [isTransmitting, transmitStartTime]);

  useEffect(() => {
    if (!isTransmitting || elapsedTime < 30) return;
    const resetTimer = setTimeout(() => {
      setIsTransmitting(false); setTransmitStartTime(null); setElapsedTime(0);
    }, 500);
    return () => clearTimeout(resetTimer);
  }, [isTransmitting, elapsedTime]);

  if (isTransmitting) return <QueuedScreen elapsedTime={elapsedTime} payload={currentPayload} />;

  const queueStats = getQueueStats();
  const hasQueuedPackets = queueStats.queued + queueStats.transmitting > 0;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#05070a] text-white selection:bg-amber-400 selection:text-black">
      <div className="pointer-events-none fixed inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-4 grid gap-3 rounded-xl border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 shadow-[0_0_24px_rgba(239,68,68,.16)]">
              <Radio size={19} />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[.24em] text-zinc-500">Laksha / field terminal</p>
              <h1 className="truncate font-mono text-sm font-black tracking-[.1em] text-zinc-100 sm:text-base">EMERGENCY TELEMETRY CONSOLE</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider">
            <span className="flex items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-emerald-300">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" /></span>
              link active
            </span>
            <span className={`rounded-md border px-2.5 py-2 ${hasQueuedPackets ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
              queue {queueStats.queued + queueStats.transmitting}
            </span>
          </div>
        </header>

        <main className="grid flex-1 gap-4 lg:grid-cols-[minmax(300px,.9fr)_minmax(360px,1.25fr)_minmax(300px,.9fr)]">
          <section className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 shadow-xl shadow-black/20 backdrop-blur-md">
              <PanelLabel>Live field telemetry</PanelLabel>
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-black/40 p-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    <span className="flex items-center gap-1.5"><Zap size={13} className="text-amber-300" /> device power</span>
                    <span className="font-black text-zinc-100">{batteryInfo.level}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-lime-400 to-amber-300 transition-all duration-500" style={{ width: `${batteryInfo.level}%` }} />
                  </div>
                </div>
                <div className="flex min-w-0 items-start gap-3 rounded-lg border border-sky-400/20 bg-sky-400/[.04] p-3">
                  <MapPin size={17} className="mt-0.5 shrink-0 text-sky-300" />
                  <div className="min-w-0 font-mono">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300">GPS position</p>
                    <p className="mt-1 truncate text-xs font-black text-zinc-100">
                      {gpsPosition ? `${gpsPosition.latitude.toFixed(6)}, ${gpsPosition.longitude.toFixed(6)}` : 'ACQUIRING FIX…'}
                    </p>
                    <p className="mt-1 text-[10px] text-zinc-500">{gpsPosition ? `±${Math.round(gpsPosition.accuracy)}M ACCURACY` : 'NO FIX'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-zinc-950/70 p-4 shadow-xl shadow-black/20 backdrop-blur-md">
              <PanelLabel>Survival status</PanelLabel>
              <SurvivalStatusToggles isConscious={isConscious} onConsciousChange={setIsConscious} isGroup={isGroup} onGroupChange={setIsGroup} disabled={isTransmitting} />
            </div>

            <QueueStatusPanel stats={queueStats} />
          </section>

          <section className="flex min-h-[530px] flex-col rounded-xl border border-white/10 bg-zinc-950/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-md">
            <div className="mb-5 flex items-center justify-between">
              <div><PanelLabel>Emergency command</PanelLabel><p className="font-mono text-xs text-zinc-400">SELECT INCIDENT CLASSIFICATION</p></div>
              <span className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 font-mono text-[10px] font-black tracking-wider text-red-300">SOS ARM</span>
            </div>
            <TriageModeSelector selected={triageType} onChange={setTriageType} disabled={isTransmitting} />
            <div className="mt-auto flex flex-col items-center border-t border-white/10 pt-6">
              <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[.2em] text-zinc-500">Hold to transmit distress frame</p>
              <SOSButton progress={holdProgress} isHolding={isHolding} onStart={handleMouseDown} onEnd={handleMouseUp} disabled={isTransmitting} />
            </div>
          </section>

          <section className="min-w-0">
            <HexInspectorDrawer hexPayload={hexPayload} payload={currentPayload} isOpen={showHexInspector} onToggle={setShowHexInspector} />
          </section>
        </main>
      </div>
    </div>
  );
}

function QueueStatusPanel({ stats }: { stats: ReturnType<typeof getQueueStats> }) {
  const accumulating = stats.queued + stats.transmitting > 0;
  return (
    <div className={`rounded-xl border p-4 shadow-xl shadow-black/20 backdrop-blur-md ${accumulating ? 'border-amber-400/35 bg-amber-400/[.06]' : 'border-white/10 bg-zinc-950/70'}`}>
      <div className="mb-3 flex items-center justify-between"><PanelLabel>Offline queue</PanelLabel><span className={`mb-3 rounded px-2 py-1 font-mono text-[9px] font-black uppercase tracking-wider ${accumulating ? 'bg-amber-400/15 text-amber-300' : 'bg-zinc-800 text-zinc-500'}`}>{accumulating ? 'accumulating' : 'clear'}</span></div>
      <div className="grid grid-cols-2 gap-2 font-mono text-xs">
        <Stat label="queued" value={stats.queued} accent={accumulating ? 'text-amber-300' : 'text-zinc-200'} />
        <Stat label="sending" value={stats.transmitting} accent="text-emerald-300" />
        <Stat label="delivered" value={stats.delivered} accent="text-sky-300" />
        <Stat label="failed" value={stats.failed} accent="text-red-300" />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className="rounded-md border border-white/5 bg-black/30 p-2.5"><p className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</p><p className={`mt-1 text-lg font-black ${accent}`}>{String(value).padStart(2, '0')}</p></div>;
}

function TriageModeSelector({ selected, onChange, disabled }: {
  selected: TriageType; onChange: (type: TriageType) => void; disabled: boolean;
}) {
  const modes = [
    { type: TriageType.MEDICAL, label: 'Medical', icon: Heart, tone: 'red' },
    { type: TriageType.LOST, label: 'Lost', icon: Compass, tone: 'amber' },
    { type: TriageType.AVALANCHE, label: 'Avalanche', icon: Mountain, tone: 'sky' },
    { type: TriageType.TRAPPED, label: 'Trapped', icon: ShieldAlert, tone: 'orange' },
  ];
  const tones: Record<string, string> = {
    red: 'border-red-400/40 text-red-300 hover:border-red-300 hover:bg-red-400/[.08] data-[active=true]:border-red-400 data-[active=true]:bg-red-400/[.14]',
    amber: 'border-amber-400/40 text-amber-300 hover:border-amber-300 hover:bg-amber-400/[.08] data-[active=true]:border-amber-400 data-[active=true]:bg-amber-400/[.14]',
    sky: 'border-sky-400/40 text-sky-300 hover:border-sky-300 hover:bg-sky-400/[.08] data-[active=true]:border-sky-400 data-[active=true]:bg-sky-400/[.14]',
    orange: 'border-orange-400/40 text-orange-300 hover:border-orange-300 hover:bg-orange-400/[.08] data-[active=true]:border-orange-400 data-[active=true]:bg-orange-400/[.14]',
  };
  return <div className="grid grid-cols-2 gap-3">{modes.map(({ type, label, icon: Icon, tone }) => (
    <button key={type} type="button" data-active={selected === type} onClick={() => onChange(type)} disabled={disabled}
      className={`group min-h-28 rounded-xl border bg-black/25 p-4 text-left transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}>
      <Icon size={23} className="mb-5 transition-transform duration-200 group-hover:scale-110" />
      <span className="block font-mono text-sm font-black uppercase tracking-wider">{label}</span>
      <span className="mt-1 block font-mono text-[9px] uppercase tracking-[.18em] text-zinc-500">Type 0{type}</span>
    </button>
  ))}</div>;
}

function SurvivalStatusToggles({ isConscious, onConsciousChange, isGroup, onGroupChange, disabled }: {
  isConscious: boolean; onConsciousChange: (value: boolean) => void; isGroup: boolean; onGroupChange: (value: boolean) => void; disabled: boolean;
}) {
  const controlClass = 'group flex min-h-24 flex-col justify-between rounded-lg border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50';
  return <div className="grid grid-cols-2 gap-3">
    <button type="button" onClick={() => onConsciousChange(!isConscious)} disabled={disabled} className={`${controlClass} ${isConscious ? 'border-emerald-400/40 bg-emerald-400/[.07] text-emerald-300' : 'border-red-400/40 bg-red-400/[.07] text-red-300'}`}>
      <AlertTriangle size={19} /><span className="font-mono text-[10px] font-black uppercase tracking-wider">{isConscious ? 'Conscious' : 'Unconscious'}</span>
    </button>
    <button type="button" onClick={() => onGroupChange(!isGroup)} disabled={disabled} className={`${controlClass} ${isGroup ? 'border-violet-400/40 bg-violet-400/[.07] text-violet-300' : 'border-zinc-700 bg-black/30 text-zinc-300'}`}>
      {isGroup ? <Users size={19} /> : <User size={19} />}<span className="font-mono text-[10px] font-black uppercase tracking-wider">{isGroup ? 'Group' : 'Solo'}</span>
    </button>
  </div>;
}

function HexInspectorDrawer({ hexPayload, payload, isOpen, onToggle }: {
  hexPayload: string; payload: FramePayload; isOpen: boolean; onToggle: (open: boolean) => void;
}) {
  const fields = [
    ['NODE ID', `0x${payload.nodeId.toString(16).toUpperCase().padStart(8, '0')}`],
    ['LATITUDE', `${payload.latitude.toFixed(6)}°`],
    ['LONGITUDE', `${payload.longitude.toFixed(6)}°`],
    ['TRIAGE / FLAGS', `${payload.triageType} / ${TriageType[payload.triageType]}`],
    ['BATTERY / TTL', `${payload.batteryPercent.toFixed(0)}% / ${payload.ttl}`],
  ];
  return <div className="h-full rounded-xl border border-cyan-400/20 bg-zinc-950/75 p-4 shadow-2xl shadow-black/30 backdrop-blur-md">
    <button type="button" onClick={() => onToggle(!isOpen)} className="flex w-full items-center justify-between text-left transition-colors hover:text-cyan-200">
      <div><PanelLabel>Protocol inspector</PanelLabel><p className="font-mono text-xs text-zinc-300">16-BYTE BINARY FRAME</p></div>
      <span className="mb-3 grid h-8 w-8 place-items-center rounded border border-cyan-400/20 bg-cyan-400/[.06] font-mono text-xs text-cyan-300">{isOpen ? '−' : '+'}</span>
    </button>
    {isOpen && <div className="mt-5 space-y-5">
      <div className="rounded-lg border border-cyan-400/20 bg-black/60 p-3">
        <p className="mb-2 font-mono text-[9px] font-black uppercase tracking-[.2em] text-cyan-300">Raw telemetry / hex</p>
        <code className="block break-all font-mono text-sm font-bold leading-6 tracking-[.12em] text-emerald-300">{hexPayload}</code>
      </div>
      <div className="space-y-2">
        {fields.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 rounded-md border border-white/5 bg-black/25 px-3 py-2.5 font-mono">
          <span className="text-[9px] font-bold tracking-wider text-zinc-500">{label}</span><span className="text-right text-[10px] font-black text-zinc-100">{value}</span>
        </div>)}
      </div>
      <div className="rounded-md border border-emerald-400/20 bg-emerald-400/[.05] px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">CRC-16 / frame integrity armed</div>
    </div>}
  </div>;
}

function SOSButton({ progress, isHolding, onStart, onEnd, disabled }: {
  progress: number; isHolding: boolean; onStart: () => void; onEnd: () => void; disabled: boolean;
}) {
  const ringRadius = 62;
  const circumference = 2 * Math.PI * ringRadius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;
  return <div className="relative grid h-48 w-48 place-items-center" onPointerDown={(event) => {
    if (disabled) return; event.currentTarget.setPointerCapture(event.pointerId); onStart();
  }} onPointerUp={onEnd} onPointerCancel={onEnd} onLostPointerCapture={onEnd}>
    <div className={`absolute inset-2 rounded-full blur-3xl transition duration-300 ${isHolding ? 'bg-red-500/60 animate-pulse' : 'bg-red-500/15'}`} />
    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 160 160" role="progressbar" aria-label="SOS hold progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
      <circle cx="80" cy="80" r={ringRadius} fill="none" stroke="#27272a" strokeWidth="3" />
      <circle cx="80" cy="80" r={ringRadius} fill="none" stroke={progress < 100 ? '#fb3f48' : '#facc15'} strokeWidth="4" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
    </svg>
    <button type="button" disabled={disabled} className={`relative z-10 grid h-32 w-32 place-items-center rounded-full border font-mono transition duration-200 active:scale-95 ${isHolding ? 'scale-105 border-red-300 bg-red-500 text-white shadow-[0_0_40px_rgba(239,68,68,.65)]' : 'border-red-400/70 bg-red-600 text-white shadow-[0_0_28px_rgba(220,38,38,.35)] hover:bg-red-500 hover:shadow-[0_0_38px_rgba(239,68,68,.55)]'} disabled:cursor-not-allowed disabled:opacity-50`}>
      <span className="text-center"><span className="block text-2xl font-black tracking-[.16em]">SOS</span><span className="mt-1 block text-[9px] font-bold tracking-[.16em]">{progress ? `${Math.ceil(progress / 33.34)} SEC` : 'HOLD 3 SEC'}</span></span>
    </button>
  </div>;
}

function QueuedScreen({ elapsedTime, payload }: { elapsedTime: number; payload: FramePayload }) {
  const queueStats = getQueueStats();
  return <div className="min-h-screen bg-[#05070a] px-4 py-8 text-white">
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center rounded-2xl border border-amber-400/30 bg-zinc-950/80 p-6 text-center shadow-2xl shadow-black/60">
      <div className="mb-7 grid h-24 w-24 place-items-center rounded-full border border-red-400/50 bg-red-500/10 text-red-400 shadow-[0_0_35px_rgba(239,68,68,.25)]"><Radio size={43} className="animate-pulse" /></div>
      <p className="font-mono text-[10px] font-black uppercase tracking-[.25em] text-amber-300">Offline relay queue</p>
      <h1 className="mt-3 font-mono text-3xl font-black tracking-[.08em] text-red-400">TRANSMITTING</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-wider text-zinc-500">Awaiting radio transport</p>
      <p className="my-8 font-mono text-6xl font-black text-zinc-100">{String(Math.floor(elapsedTime / 60)).padStart(2, '0')}:{String(elapsedTime % 60).padStart(2, '0')}</p>
      <div className="grid w-full grid-cols-3 gap-2 border-t border-white/10 pt-5 font-mono text-xs"><Stat label="queued" value={queueStats.queued} accent="text-amber-300" /><Stat label="sending" value={queueStats.transmitting} accent="text-emerald-300" /><Stat label="sent" value={queueStats.delivered} accent="text-sky-300" /></div>
      <p className="mt-6 rounded border border-white/10 bg-black/30 px-3 py-2 font-mono text-[10px] text-zinc-400">ID {payload.nodeId.toString(16).toUpperCase()} · {TriageType[payload.triageType]}</p>
    </div>
  </div>;
}
