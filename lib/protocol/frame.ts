/**
 * Laksha Protocol: 16-byte Fixed Binary Frame
 * Production-grade emergency communication protocol for zero-internet regions
 */

// ============================================================================
// ENUMS & TYPES
// ============================================================================

export enum TriageType {
    UNSET = 0,
    MEDICAL = 1,
    LOST = 2,
    AVALANCHE = 3,
    TRAPPED = 4,
}

export interface FramePayload {
    nodeId: number; // uint32: 0 to 4,294,967,295
    latitude: number; // float: -90.000000 to +90.000000
    longitude: number; // float: -180.000000 to +180.000000
    triageType: TriageType; // Enum: MEDICAL, LOST, AVALANCHE, TRAPPED
    isConscious: boolean; // Bit flag
    groupCount: boolean; // Bit flag (indicates group presence)
    batteryPercent: number; // 0-100%, packed as 0-20 (5% increments)
    ttl: number; // 0-7 hops
}

export interface DecodedFrame extends FramePayload {
    isValidCrc: boolean;
    calculatedCrc: number;
    receivedCrc: number;
    rawHex: string;
}

// ============================================================================
// CRC-16-CCITT CALCULATION
// ============================================================================

const CRC16_POLYNOMIAL = 0x1021;
const CRC16_INIT = 0xffff;

/**
 * Generates CRC-16-CCITT lookup table for fast computation
 */
function generateCRC16Table(): Uint16Array {
    const table = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc << 1) ^ (crc & 0x8000 ? CRC16_POLYNOMIAL : 0);
            crc &= 0xffff;
        }
        table[i] = crc;
    }
    return table;
}

const CRC16_TABLE = generateCRC16Table();

/**
 * Calculate CRC-16-CCITT checksum over data buffer
 * @param buffer Data to checksum (typically first 14 bytes)
 * @returns 16-bit CRC value
 */
export function calculateCRC16(buffer: Uint8Array): number {
    let crc = CRC16_INIT;
    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        const tblIdx = ((crc >> 8) ^ byte) & 0xff;
        crc = ((crc << 8) ^ CRC16_TABLE[tblIdx]) & 0xffff;
    }
    return crc;
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a FramePayload into a 16-byte Big-Endian binary buffer
 * @param payload Emergency message payload
 * @returns Uint8Array of exactly 16 bytes
 * @throws Error if payload.nodeId outside [0, 4294967295]
 * @throws Error if payload.latitude outside [-90, 90]
 * @throws Error if payload.longitude outside [-180, 180]
 * @throws Error if payload.batteryPercent outside [0, 100]
 * @throws Error if payload.ttl outside [0, 7]
 */
export function serializeFrame(payload: FramePayload): Uint8Array {
    // Validate values before JavaScript's numeric coercions can alter the frame.
    if (!Number.isInteger(payload.nodeId) || payload.nodeId < 0 || payload.nodeId > 0xffffffff) {
        throw new Error(`Invalid nodeId: ${payload.nodeId}`);
    }
    if (!Number.isFinite(payload.latitude) || payload.latitude < -90 || payload.latitude > 90) {
        throw new Error(`Invalid latitude: ${payload.latitude}`);
    }
    if (!Number.isFinite(payload.longitude) || payload.longitude < -180 || payload.longitude > 180) {
        throw new Error(`Invalid longitude: ${payload.longitude}`);
    }
    if (!Number.isFinite(payload.batteryPercent) || payload.batteryPercent < 0 || payload.batteryPercent > 100) {
        throw new Error(`Invalid batteryPercent: ${payload.batteryPercent}`);
    }
    if (!Number.isInteger(payload.ttl) || payload.ttl < 0 || payload.ttl > 7) {
        throw new Error(`Invalid ttl: ${payload.ttl}`);
    }
    if (!Number.isInteger(payload.triageType) || !Object.values(TriageType).includes(payload.triageType)) {
        throw new Error(`Invalid triageType: ${payload.triageType}`);
    }
    if (typeof payload.isConscious !== 'boolean' || typeof payload.groupCount !== 'boolean') {
        throw new Error('isConscious and groupCount must be booleans');
    }

    // Create 16-byte buffer
    const buffer = new Uint8Array(16);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);

    // Bytes 0-3: Node ID (uint32, Big-Endian)
    view.setUint32(0, payload.nodeId, false);

    // Bytes 4-7: Latitude (int32, Big-Endian, micro-degrees)
    const latMicro = Math.round(payload.latitude * 1e6);
    view.setInt32(4, latMicro, false);

    // Bytes 8-11: Longitude (int32, Big-Endian, micro-degrees)
    const lngMicro = Math.round(payload.longitude * 1e6);
    view.setInt32(8, lngMicro, false);

    // Byte 12: Triage Code & Flags
    // Bits 0-3: Emergency Type
    // Bit 4: Conscious state
    // Bit 5: Group count flag
    // Bits 6-7: Reserved
    let triageByte = payload.triageType & 0x0f;
    triageByte |= (payload.isConscious ? 1 : 0) << 4;
    triageByte |= (payload.groupCount ? 1 : 0) << 5;
    buffer[12] = triageByte;

    // Byte 13: Telemetry & TTL
    // Bits 0-4: Battery level (0-20 representing 0%-100%)
    // Bits 5-7: TTL/Hop Limit
    const batteryLevel = Math.round((payload.batteryPercent / 100) * 20);
    let telemetryByte = batteryLevel & 0x1f;
    telemetryByte |= (payload.ttl & 0x07) << 5;
    buffer[13] = telemetryByte;

    // Bytes 14-15: CRC-16-CCITT over first 14 bytes
    const crcValue = calculateCRC16(buffer.slice(0, 14));
    view.setUint16(14, crcValue, false);

    return buffer;
}

// ============================================================================
// DESERIALIZATION
// ============================================================================

/**
 * Deserialize a 16-byte binary buffer into a DecodedFrame
 * @param buffer Exactly 16-byte frame
 * @returns DecodedFrame with validation results
 * @throws Error if buffer is not exactly 16 bytes
 */
export function deserializeFrame(buffer: Uint8Array): DecodedFrame {
    if (buffer.length !== 16) {
        throw new Error(`Invalid buffer length: expected 16, got ${buffer.length}`);
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);

    // Bytes 0-3: Node ID
    const nodeId = view.getUint32(0, false);

    // Bytes 4-7: Latitude (micro-degrees)
    const latMicro = view.getInt32(4, false);
    const latitude = latMicro / 1e6;

    // Bytes 8-11: Longitude (micro-degrees)
    const lngMicro = view.getInt32(8, false);
    const longitude = lngMicro / 1e6;

    // Byte 12: Triage & Flags
    const triageByte = buffer[12];
    const triageType = (triageByte & 0x0f) as TriageType;
    const isConscious = ((triageByte >> 4) & 1) === 1;
    const groupCount = ((triageByte >> 5) & 1) === 1;

    // Byte 13: Telemetry & TTL
    const telemetryByte = buffer[13];
    const batteryLevel = telemetryByte & 0x1f;
    const batteryPercent = (batteryLevel / 20) * 100;
    const ttl = (telemetryByte >> 5) & 0x07;

    // Bytes 14-15: Received CRC
    const receivedCrc = view.getUint16(14, false);

    // Verify CRC
    const calculatedCrc = calculateCRC16(buffer.slice(0, 14));
    const isValidCrc = calculatedCrc === receivedCrc;

    return {
        nodeId,
        latitude,
        longitude,
        triageType,
        isConscious,
        groupCount,
        batteryPercent,
        ttl,
        isValidCrc,
        calculatedCrc,
        receivedCrc,
        rawHex: frameToHex(buffer),
    };
}

// ============================================================================
// HEX CONVERSION UTILITIES
// ============================================================================

/**
 * Convert binary frame to hex string
 * @param buffer 16-byte frame
 * @returns 32-character hex string (lowercase)
 */
export function frameToHex(buffer: Uint8Array): string {
    if (buffer.length !== 16) {
        throw new Error(`Expected 16 bytes, got ${buffer.length}`);
    }
    return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to binary frame
 * @param hex 32-character hex string
 * @returns Uint8Array of exactly 16 bytes
 * @throws Error if hex is invalid or wrong length
 */
export function hexToFrame(hex: string): Uint8Array {
    if (!/^[0-9a-f]{32}$/i.test(hex)) {
        throw new Error('Hex frame must contain exactly 32 hexadecimal characters');
    }
    const cleaned = hex.toLowerCase();

    const buffer = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        buffer[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return buffer;
}
