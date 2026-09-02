import { describe, it, expect } from 'vitest';
import {
    TriageType,
    FramePayload,
    calculateCRC16,
    serializeFrame,
    deserializeFrame,
    frameToHex,
    hexToFrame,
} from '../frame';

describe('Laksha Protocol - 16-Byte Frame', () => {
    describe('CRC-16-CCITT Calculation', () => {
        it('should calculate correct CRC for zero buffer', () => {
            const buffer = new Uint8Array(14).fill(0);
            const crc = calculateCRC16(buffer);
            expect(typeof crc).toBe('number');
            expect(crc).toBe(0xffff); // Initial value for all zeros
        });

        it('should calculate consistent CRC for same input', () => {
            const buffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
            const crc1 = calculateCRC16(buffer);
            const crc2 = calculateCRC16(buffer);
            expect(crc1).toBe(crc2);
        });

        it('should detect single bit changes', () => {
            const buffer1 = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0, 0, 0, 0, 0, 0]);
            const buffer2 = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf1, 0, 0, 0, 0, 0, 0]);
            const crc1 = calculateCRC16(buffer1);
            const crc2 = calculateCRC16(buffer2);
            expect(crc1).not.toBe(crc2);
        });
    });

    describe('Frame Serialization', () => {
        it('should serialize minimal valid payload', () => {
            const payload: FramePayload = {
                nodeId: 1,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.UNSET,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 3,
            };

            const buffer = serializeFrame(payload);
            expect(buffer.length).toBe(16);
            expect(buffer).toBeInstanceOf(Uint8Array);
        });

        it('should serialize maximum valid values', () => {
            const payload: FramePayload = {
                nodeId: 0xffffffff,
                latitude: 90,
                longitude: 180,
                triageType: TriageType.TRAPPED,
                isConscious: true,
                groupCount: true,
                batteryPercent: 100,
                ttl: 7,
            };

            const buffer = serializeFrame(payload);
            expect(buffer.length).toBe(16);
        });

        it('should encode coordinates to 6 decimal precision', () => {
            const payload: FramePayload = {
                nodeId: 12345,
                latitude: 37.774929,
                longitude: -122.419415,
                triageType: TriageType.MEDICAL,
                isConscious: true,
                groupCount: false,
                batteryPercent: 75,
                ttl: 2,
            };

            const buffer = serializeFrame(payload);
            const view = new DataView(buffer.buffer);

            // Verify latitude encoding
            const latMicro = view.getInt32(4, false);
            expect(latMicro).toBe(Math.round(37.774929 * 1e6));

            // Verify longitude encoding
            const lngMicro = view.getInt32(8, false);
            expect(lngMicro).toBe(Math.round(-122.419415 * 1e6));
        });

        it('should pack triage type in bits 0-3 of byte 12', () => {
            const payload: FramePayload = {
                nodeId: 100,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.AVALANCHE,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 0,
            };

            const buffer = serializeFrame(payload);
            const triageByte = buffer[12];
            expect(triageByte & 0x0f).toBe(TriageType.AVALANCHE);
        });

        it('should pack conscious flag in bit 4 of byte 12', () => {
            const payload1: FramePayload = {
                nodeId: 100,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.MEDICAL,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 0,
            };
            const buffer1 = serializeFrame(payload1);
            expect((buffer1[12] >> 4) & 1).toBe(0);

            const payload2 = { ...payload1, isConscious: true };
            const buffer2 = serializeFrame(payload2);
            expect((buffer2[12] >> 4) & 1).toBe(1);
        });

        it('should encode battery level in 5% increments (0-20 scale)', () => {
            const testCases = [
                { percent: 0, level: 0 },
                { percent: 50, level: 10 },
                { percent: 100, level: 20 },
                { percent: 25, level: 5 },
            ];

            for (const { percent, level } of testCases) {
                const payload: FramePayload = {
                    nodeId: 1,
                    latitude: 0,
                    longitude: 0,
                    triageType: TriageType.UNSET,
                    isConscious: false,
                    groupCount: false,
                    batteryPercent: percent,
                    ttl: 0,
                };
                const buffer = serializeFrame(payload);
                expect(buffer[13] & 0x1f).toBe(level);
            }
        });

        it('should pack TTL in bits 5-7 of byte 13', () => {
            const payload: FramePayload = {
                nodeId: 1,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.UNSET,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 5,
            };
            const buffer = serializeFrame(payload);
            expect((buffer[13] >> 5) & 0x07).toBe(5);
        });

        it('should compute valid CRC-16 checksum', () => {
            const payload: FramePayload = {
                nodeId: 0x12345678,
                latitude: 45.123456,
                longitude: -120.654321,
                triageType: TriageType.LOST,
                isConscious: true,
                groupCount: false,
                batteryPercent: 60,
                ttl: 3,
            };

            const buffer = serializeFrame(payload);
            const view = new DataView(buffer.buffer);
            const storedCrc = view.getUint16(14, false);

            // Recalculate CRC
            const calculatedCrc = calculateCRC16(buffer.slice(0, 14));
            expect(storedCrc).toBe(calculatedCrc);
        });

        it('should reject invalid latitude', () => {
            const payload: FramePayload = {
                nodeId: 1,
                latitude: 91, // Out of range
                longitude: 0,
                triageType: TriageType.UNSET,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 0,
            };

            expect(() => serializeFrame(payload)).toThrow('Invalid latitude');
        });

        it('should reject invalid battery percent', () => {
            const payload: FramePayload = {
                nodeId: 1,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.UNSET,
                isConscious: false,
                groupCount: false,
                batteryPercent: 150, // Out of range
                ttl: 0,
            };

            expect(() => serializeFrame(payload)).toThrow('Invalid batteryPercent');
        });
    });

    describe('Frame Deserialization', () => {
        it('should reject non-16-byte buffers', () => {
            const buffer = new Uint8Array(15);
            expect(() => deserializeFrame(buffer)).toThrow('Invalid buffer length');
        });

        it('should decode valid frame correctly', () => {
            const originalPayload: FramePayload = {
                nodeId: 0x12345678,
                latitude: 37.774929,
                longitude: -122.419415,
                triageType: TriageType.MEDICAL,
                isConscious: true,
                groupCount: true,
                batteryPercent: 75,
                ttl: 4,
            };

            const buffer = serializeFrame(originalPayload);
            const decoded = deserializeFrame(buffer);

            expect(decoded.nodeId).toBe(originalPayload.nodeId);
            expect(decoded.latitude).toBeCloseTo(originalPayload.latitude, 6);
            expect(decoded.longitude).toBeCloseTo(originalPayload.longitude, 6);
            expect(decoded.triageType).toBe(originalPayload.triageType);
            expect(decoded.isConscious).toBe(originalPayload.isConscious);
            expect(decoded.groupCount).toBe(originalPayload.groupCount);
            expect(decoded.ttl).toBe(originalPayload.ttl);
            expect(decoded.isValidCrc).toBe(true);
        });

        it('should detect corrupted frames (invalid CRC)', () => {
            const payload: FramePayload = {
                nodeId: 100,
                latitude: 0,
                longitude: 0,
                triageType: TriageType.UNSET,
                isConscious: false,
                groupCount: false,
                batteryPercent: 50,
                ttl: 0,
            };

            const buffer = serializeFrame(payload);
            // Corrupt a data byte
            buffer[6] ^= 0x01;

            const decoded = deserializeFrame(buffer);
            expect(decoded.isValidCrc).toBe(false);
            expect(decoded.calculatedCrc).not.toBe(decoded.receivedCrc);
        });

        it('should round-trip payload without loss', () => {
            const original: FramePayload = {
                nodeId: 0xdeadbeef,
                latitude: -33.865143,
                longitude: 151.209900,
                triageType: TriageType.TRAPPED,
                isConscious: false,
                groupCount: true,
                batteryPercent: 33,
                ttl: 7,
            };

            const buffer = serializeFrame(original);
            const decoded = deserializeFrame(buffer);

            expect(decoded.nodeId).toBe(original.nodeId);
            expect(decoded.latitude).toBeCloseTo(original.latitude, 6);
            expect(decoded.longitude).toBeCloseTo(original.longitude, 6);
            expect(decoded.triageType).toBe(original.triageType);
            expect(decoded.isConscious).toBe(original.isConscious);
            expect(decoded.groupCount).toBe(original.groupCount);
            expect(decoded.batteryPercent).toBeCloseTo(original.batteryPercent, 1);
            expect(decoded.ttl).toBe(original.ttl);
        });
    });

    describe('Hex Conversion', () => {
        it('should convert frame to 32-char hex', () => {
            const buffer = new Uint8Array(16).fill(0xaa);
            const hex = frameToHex(buffer);
            expect(hex).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            expect(hex.length).toBe(32);
        });

        it('should reject invalid buffer length for hex conversion', () => {
            const buffer = new Uint8Array(15);
            expect(() => frameToHex(buffer)).toThrow('Expected 16 bytes');
        });

        it('should convert hex back to frame', () => {
            const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
            const hex = frameToHex(original);
            const restored = hexToFrame(hex);
            expect(restored).toEqual(original);
        });

        it('should handle hex with spaces/dashes', () => {
            const hex = '0102 0304-0506 0708-090a 0b0c-0d0e 0f10';
            const frame = hexToFrame(hex);
            expect(frame.length).toBe(16);
            expect(frame[0]).toBe(1);
            expect(frame[15]).toBe(16);
        });

        it('should reject invalid hex length', () => {
            expect(() => hexToFrame('aabbccdd')).toThrow('Invalid hex length');
        });
    });

    describe('Integration: End-to-End Frame Protocol', () => {
        it('should serialize and deserialize a complete emergency SOS', () => {
            const sos: FramePayload = {
                nodeId: 987654321,
                latitude: 45.50884,
                longitude: -122.63526,
                triageType: TriageType.AVALANCHE,
                isConscious: false,
                groupCount: true,
                batteryPercent: 15,
                ttl: 2,
            };

            const hex = frameToHex(serializeFrame(sos));
            expect(hex.length).toBe(32);

            const buffer = hexToFrame(hex);
            const decoded = deserializeFrame(buffer);

            expect(decoded.nodeId).toBe(sos.nodeId);
            expect(decoded.latitude).toBeCloseTo(sos.latitude, 6);
            expect(decoded.longitude).toBeCloseTo(sos.longitude, 6);
            expect(decoded.triageType).toBe(TriageType.AVALANCHE);
            expect(decoded.isConscious).toBe(false);
            expect(decoded.groupCount).toBe(true);
            expect(decoded.isValidCrc).toBe(true);
        });

        it('should produce consistent hex representation', () => {
            const payload: FramePayload = {
                nodeId: 0x11223344,
                latitude: 0.123456,
                longitude: -0.654321,
                triageType: TriageType.LOST,
                isConscious: true,
                groupCount: false,
                batteryPercent: 50,
                ttl: 3,
            };

            const hex1 = frameToHex(serializeFrame(payload));
            const hex2 = frameToHex(serializeFrame(payload));
            expect(hex1).toBe(hex2);
        });
    });
});
