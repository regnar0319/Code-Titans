'use client';

import { useMemo, useState } from 'react';
import {
    Binary,
    Check,
    Copy,
    Cpu,
    ShieldAlert,
    ShieldCheck,
} from 'lucide-react';

export interface VisualHexInspectorProps {
    /** The current 16-byte Laksha frame as a 32-character hexadecimal string. */
    rawHex: string;
    /** CRC validation result for the unmodified frame. */
    isValidCrc: boolean;
    /** Called when the local corruption demonstration is enabled or cleared. */
    onCorruptToggle?: (isCorrupted: boolean) => void;
}

type SegmentId = 'node' | 'latitude' | 'longitude' | 'triage' | 'telemetry' | 'crc';

interface Segment {
    id: SegmentId;
    label: string;
    start: number;
    end: number;
    borderClass: string;
    textClass: string;
    glowClass: string;
}

const SEGMENTS: Segment[] = [
    {
        id: 'node',
        label: 'NODE UUID',
        start: 0,
        end: 3,
        borderClass: 'border-sky-500',
        textClass: 'text-sky-400',
        glowClass: 'bg-sky-500/10 shadow-sky-500/20',
    },
    {
        id: 'latitude',
        label: 'LATITUDE',
        start: 4,
        end: 7,
        borderClass: 'border-emerald-500',
        textClass: 'text-emerald-400',
        glowClass: 'bg-emerald-500/10 shadow-emerald-500/20',
    },
    {
        id: 'longitude',
        label: 'LONGITUDE',
        start: 8,
        end: 11,
        borderClass: 'border-teal-500',
        textClass: 'text-teal-400',
        glowClass: 'bg-teal-500/10 shadow-teal-500/20',
    },
    {
        id: 'triage',
        label: 'TRIAGE & FLAGS',
        start: 12,
        end: 12,
        borderClass: 'border-rose-500',
        textClass: 'text-rose-400',
        glowClass: 'bg-rose-500/10 shadow-rose-500/20',
    },
    {
        id: 'telemetry',
        label: 'BATTERY & TTL',
        start: 13,
        end: 13,
        borderClass: 'border-amber-500',
        textClass: 'text-amber-400',
        glowClass: 'bg-amber-500/10 shadow-amber-500/20',
    },
    {
        id: 'crc',
        label: 'CRC-16-CCITT',
        start: 14,
        end: 15,
        borderClass: 'border-purple-500',
        textClass: 'text-purple-400',
        glowClass: 'bg-purple-500/10 shadow-purple-500/20',
    },
];

const TRIAGE_NAMES: Record<number, string> = {
    0: 'UNSET',
    1: 'MEDICAL',
    2: 'LOST',
    3: 'AVALANCHE',
    4: 'TRAPPED',
};

function getSegment(byteOffset: number): Segment {
    return SEGMENTS.find(
        (segment) => byteOffset >= segment.start && byteOffset <= segment.end
    ) ?? SEGMENTS[0];
}

function normalizeHex(rawHex: string): string {
    return rawHex.replace(/[^0-9a-f]/gi, '').slice(0, 32).padEnd(32, '0').toUpperCase();
}

function hexToBytes(hex: string): Uint8Array {
    return Uint8Array.from(
        Array.from({ length: 16 }, (_, index) =>
            Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
        )
    );
}

function toBinary(value: number): string {
    return `0b${value.toString(2).padStart(8, '0')}`;
}

function coordinate(value: number, positive: string, negative: string): string {
    return `${Math.abs(value).toFixed(6)}° ${value >= 0 ? positive : negative}`;
}

export default function VisualHexInspector({
    rawHex,
    isValidCrc,
    onCorruptToggle,
}: VisualHexInspectorProps) {
    const [selectedSegmentId, setSelectedSegmentId] = useState<SegmentId>('node');
    const [isCorrupted, setIsCorrupted] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

    const frame = useMemo(() => {
        const hex = normalizeHex(rawHex);
        const bytes = hexToBytes(hex);

        // Flip bit 0 in byte 5 (the second latitude byte) for the live CRC demo.
        if (isCorrupted) {
            bytes[5] ^= 0x01;
        }

        const displayHex = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, '0').toUpperCase()
        ).join('');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const triageFlags = bytes[12];
        const telemetry = bytes[13];

        return {
            bytes,
            displayHex,
            nodeId: view.getUint32(0, false),
            latitude: view.getInt32(4, false) / 1_000_000,
            longitude: view.getInt32(8, false) / 1_000_000,
            triageCode: triageFlags & 0x0f,
            isConscious: (triageFlags & 0x10) !== 0,
            isGroup: (triageFlags & 0x20) !== 0,
            reservedBits: (triageFlags >> 6) & 0x03,
            batteryLevel: telemetry & 0x1f,
            batteryPercent: (telemetry & 0x1f) * 5,
            ttl: (telemetry >> 5) & 0x07,
            receivedCrc: view.getUint16(14, false),
        };
    }, [rawHex, isCorrupted]);

    const selectedSegment = SEGMENTS.find(
        (segment) => segment.id === selectedSegmentId
    ) ?? SEGMENTS[0];
    const crcIsValid = isValidCrc && !isCorrupted;
    const triageName = TRIAGE_NAMES[frame.triageCode] ?? 'RESERVED';

    const copyHex = async () => {
        try {
            await navigator.clipboard.writeText(frame.displayHex);
            setCopyState('copied');
        } catch {
            setCopyState('error');
        }
        window.setTimeout(() => setCopyState('idle'), 1800);
    };

    const toggleCorruption = () => {
        const next = !isCorrupted;
        setIsCorrupted(next);
        onCorruptToggle?.(next);
    };

    return (
        <section
            aria-label="Visual hex inspector"
            className="w-full space-y-4 rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-zinc-100 shadow-2xl"
        >
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-sky-400" aria-hidden="true" />
                    <div>
                        <h2 className="text-sm font-black tracking-[0.18em] text-white">
                            VISUAL HEX INSPECTOR
                        </h2>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                            Laksha 16-byte tactical frame
                        </p>
                    </div>
                </div>
                <div
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-bold ${
                        crcIsValid
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400'
                            : 'border-rose-500/60 bg-rose-500/10 text-rose-400'
                    }`}
                >
                    {crcIsValid ? (
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    ) : (
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    )}
                    CRC {crcIsValid ? 'VALID' : 'FAILED'}
                </div>
            </header>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={copyHex}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-200 transition hover:border-sky-500 hover:text-sky-300"
                >
                    {copyState === 'copied' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {copyState === 'copied' ? 'COPIED' : 'COPY HEX'}
                </button>
                <button
                    type="button"
                    onClick={toggleCorruption}
                    aria-pressed={isCorrupted}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition ${
                        isCorrupted
                            ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                            : 'border-amber-500/70 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                    }`}
                >
                    <Binary className="h-3.5 w-3.5" aria-hidden="true" />
                    {isCorrupted ? 'RESTORE BYTE 05' : 'CORRUPT BYTE 05'}
                </button>
                {copyState === 'error' && (
                    <span className="self-center font-mono text-[10px] text-rose-400">
                        Clipboard unavailable
                    </span>
                )}
            </div>

            <div className="rounded-lg border border-zinc-800 bg-black p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-zinc-500">
                    <span>RAW FRAME · 32 HEX CHARACTERS</span>
                    <span>{isCorrupted ? 'BYTE 05 · BIT 0 FLIPPED' : 'BIG-ENDIAN'}</span>
                </div>
                <output className="block break-all font-mono text-sm font-bold tracking-[0.14em] text-zinc-100">
                    {frame.displayHex}
                </output>
            </div>

            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {Array.from(frame.bytes, (byte, offset) => {
                    const segment = getSegment(offset);
                    const isSelected = selectedSegment.id === segment.id;
                    return (
                        <button
                            key={offset}
                            type="button"
                            aria-label={`Byte 0x${offset.toString(16).padStart(2, '0').toUpperCase()}, ${segment.label}`}
                            onClick={() => setSelectedSegmentId(segment.id)}
                            onMouseEnter={() => setSelectedSegmentId(segment.id)}
                            onFocus={() => setSelectedSegmentId(segment.id)}
                            className={`min-h-20 rounded-md border p-2 text-left transition duration-150 focus:outline-none focus:ring-2 focus:ring-white/70 ${
                                isSelected
                                    ? `${segment.borderClass} ${segment.glowClass} shadow-lg`
                                    : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-500'
                            }`}
                        >
                            <span className="block font-mono text-[10px] text-zinc-500">
                                0x{offset.toString(16).padStart(2, '0').toUpperCase()}
                            </span>
                            <span className={`mt-1 block font-mono text-lg font-black ${segment.textClass}`}>
                                {byte.toString(16).padStart(2, '0').toUpperCase()}
                            </span>
                            <span className="mt-1 block truncate font-mono text-[9px] text-zinc-500">
                                {segment.label}
                            </span>
                        </button>
                    );
                })}
            </div>

            <article className={`rounded-lg border p-3 ${selectedSegment.borderClass} ${selectedSegment.glowClass}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className={`font-mono text-xs font-black tracking-wider ${selectedSegment.textClass}`}>
                        {selectedSegment.label}
                    </h3>
                    <span className="font-mono text-[10px] text-zinc-400">
                        BYTES {selectedSegment.start.toString().padStart(2, '0')}–{selectedSegment.end.toString().padStart(2, '0')}
                    </span>
                </div>

                {(selectedSegment.id === 'triage' || selectedSegment.id === 'telemetry') ? (
                    <BitFieldRibbon
                        segment={selectedSegment.id}
                        byte={selectedSegment.id === 'triage' ? frame.bytes[12] : frame.bytes[13]}
                        frame={frame}
                    />
                ) : (
                    <SegmentInterpretation segment={selectedSegment.id} frame={frame} crcIsValid={crcIsValid} />
                )}
            </article>

            <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full min-w-[520px] border-collapse font-mono text-xs">
                    <tbody>
                        <SummaryRow label="Node ID" value={frame.nodeId.toString()} />
                        <SummaryRow
                            label="Decoded Position"
                            value={`${coordinate(frame.latitude, 'N', 'S')}  |  ${coordinate(frame.longitude, 'E', 'W')}`}
                        />
                        <SummaryRow label="Emergency" value={`${triageName} (Code ${frame.triageCode})`} />
                        <SummaryRow
                            label="Status"
                            value={`Conscious: ${frame.isConscious ? 'YES' : 'NO'}  |  Solo: ${frame.isGroup ? 'NO' : 'YES'}`}
                        />
                        <SummaryRow
                            label="Telemetry"
                            value={`Battery: ${frame.batteryPercent}%  |  Hop Limit: ${frame.ttl}`}
                        />
                        <SummaryRow
                            label="Checksum"
                            value={`0x${frame.receivedCrc.toString(16).padStart(4, '0').toUpperCase()} (${crcIsValid ? 'VALID' : 'INVALID'})`}
                            valid={crcIsValid}
                        />
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function SummaryRow({
    label,
    value,
    valid,
}: {
    label: string;
    value: string;
    valid?: boolean;
}) {
    return (
        <tr className="border-b border-zinc-800 last:border-0">
            <th className="w-36 bg-zinc-900 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {label}
            </th>
            <td className={`px-3 py-2 font-medium ${valid === false ? 'text-rose-400' : 'text-zinc-200'}`}>
                {value}
            </td>
        </tr>
    );
}

function SegmentInterpretation({
    segment,
    frame,
    crcIsValid,
}: {
    segment: SegmentId;
    frame: ReturnType<typeof decodeFrameForDisplay>;
    crcIsValid: boolean;
}) {
    const values: Partial<Record<SegmentId, string>> = {
        node: `Unsigned uint32 · ${frame.nodeId}`,
        latitude: `Scaled int32 · ${coordinate(frame.latitude, 'N', 'S')}`,
        longitude: `Scaled int32 · ${coordinate(frame.longitude, 'E', 'W')}`,
        crc: `0x${frame.receivedCrc.toString(16).padStart(4, '0').toUpperCase()} · ${crcIsValid ? 'VALID' : 'INVALID'}`,
    };
    return <p className="font-mono text-sm text-zinc-200">{values[segment]}</p>;
}

function BitFieldRibbon({
    segment,
    byte,
    frame,
}: {
    segment: 'triage' | 'telemetry';
    byte: number;
    frame: ReturnType<typeof decodeFrameForDisplay>;
}) {
    const isTriage = segment === 'triage';
    const parts = isTriage
        ? [
            { label: '7–6 RESERVED', value: frame.reservedBits.toString(2).padStart(2, '0'), width: 'w-1/4', tone: 'bg-zinc-700' },
            { label: '5 GROUP', value: frame.isGroup ? '1' : '0', width: 'w-1/8', tone: 'bg-rose-500/70' },
            { label: '4 CONSCIOUS', value: frame.isConscious ? '1' : '0', width: 'w-1/8', tone: 'bg-rose-400/80' },
            { label: '3–0 TYPE', value: frame.triageCode.toString(2).padStart(4, '0'), width: 'w-1/2', tone: 'bg-rose-600/80' },
        ]
        : [
            { label: '7–5 TTL', value: frame.ttl.toString(2).padStart(3, '0'), width: 'w-3/8', tone: 'bg-amber-600/80' },
            { label: '4–0 BATTERY', value: frame.batteryLevel.toString(2).padStart(5, '0'), width: 'w-5/8', tone: 'bg-amber-400/80' },
        ];

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between rounded bg-black/40 px-2 py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">Binary ribbon</span>
                <span className="font-mono text-sm font-black text-white">{toBinary(byte)}</span>
            </div>
            <div className="flex h-16 overflow-hidden rounded border border-white/10">
                {parts.map((part) => (
                    <div
                        key={part.label}
                        className={`flex ${part.width} ${part.tone} flex-col justify-center border-r border-black/40 px-2 last:border-r-0`}
                    >
                        <span className="font-mono text-xs font-black text-white">{part.value}</span>
                        <span className="font-mono text-[9px] font-bold text-white/75">{part.label}</span>
                    </div>
                ))}
            </div>
            <p className="font-mono text-xs text-zinc-300">
                {isTriage
                    ? `Type: ${TRIAGE_NAMES[frame.triageCode] ?? 'RESERVED'} · Conscious: ${frame.isConscious ? 'YES' : 'NO'} · Group: ${frame.isGroup ? 'YES' : 'NO'}`
                    : `Battery register: ${frame.batteryLevel} × 5% = ${frame.batteryPercent}% · TTL: ${frame.ttl}`}
            </p>
        </div>
    );
}

/** Kept as a type-only mirror of the memoized frame object. */
function decodeFrameForDisplay() {
    return {
        bytes: new Uint8Array(16),
        displayHex: '',
        nodeId: 0,
        latitude: 0,
        longitude: 0,
        triageCode: 0,
        isConscious: false,
        isGroup: false,
        reservedBits: 0,
        batteryLevel: 0,
        batteryPercent: 0,
        ttl: 0,
        receivedCrc: 0,
    };
}
