/**
 * Laksha Protocol: High-Performance CRC-16-CCITT-FALSE Verification Engine
 * Designed for sub-microsecond ad-hoc frame validation in zero-infrastructure LoRa networks.
 */

/**
 * Precomputed 256-element lookup table for CRC-16-CCITT-FALSE.
 * Polynomial: 0x1021 (x^16 + x^12 + x^5 + 1)
 */
const CRC_TABLE = new Uint16Array(256);
(() => {
    for (let i = 0; i < 256; i++) {
        let crc = (i << 8) >>> 0;
        for (let j = 0; j < 8; j++) {
            crc = ((crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)) & 0xFFFF;
        }
        CRC_TABLE[i] = crc;
    }
})();

/**
 * Compute the CRC-16-CCITT-FALSE checksum.
 * @param data Input buffer (typically 14 bytes)
 * @returns 16-bit unsigned integer checksum
 */
export function computeCRC16(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        const tblIdx = ((crc >>> 8) ^ data[i]) & 0xFF;
        crc = ((crc << 8) ^ CRC_TABLE[tblIdx]) & 0xFFFF;
    }
    return crc;
}

/**
 * Validate a 16-byte Laksha frame integrity.
 */
export function validateFrameCRC(frame: Uint8Array): { isValid: boolean; calculatedCrc: number; receivedCrc: number } {
    if (frame.byteLength !== 16) {
        throw new Error(`Invalid frame length: ${frame.byteLength}. Expected 16 bytes.`);
    }

    const payload = frame.subarray(0, 14);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const receivedCrc = view.getUint16(14, false); // Big-Endian
    const calculatedCrc = computeCRC16(payload);

    return {
        isValid: calculatedCrc === receivedCrc,
        calculatedCrc,
        receivedCrc
    };
}

/**
 * Calculates CRC for first 14 bytes and injects it into offsets 14-15.
 */
export function injectCRC(frameBuffer16: Uint8Array): void {
    if (frameBuffer16.byteLength !== 16) {
        throw new Error("Buffer must be 16 bytes.");
    }
    const crc = computeCRC16(frameBuffer16.subarray(0, 14));
    const view = new DataView(frameBuffer16.buffer, frameBuffer16.byteOffset, frameBuffer16.byteLength);
    view.setUint16(14, crc, false); // Big-Endian
}

// --- Diagnostic & Fault Injection ---

/**
 * Inverts a single bit in the buffer at the specified index (0 to 127).
 */
export function corruptBit(buffer: Uint8Array, bitIndex: number): Uint8Array {
    const byteIdx = Math.floor(bitIndex / 8);
    if (byteIdx >= buffer.length) throw new Error("Bit index out of range.");
    
    const bitOffset = 7 - (bitIndex % 8);
    const corrupted = new Uint8Array(buffer);
    corrupted[byteIdx] ^= (1 << bitOffset);
    return corrupted;
}
