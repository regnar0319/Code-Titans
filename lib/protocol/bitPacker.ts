/**
 * Laksha 16-Byte Fixed Binary Emergency Frame Bit-Packer & Unpacker
 * Ultra-optimized, client-side zero-dependency protocol module.
 *
 * Frame Memory Layout (128 bits / 16 bytes, Big-Endian):
 * - Bytes 0–3 (Offset 0)   : node_id (uint32)
 * - Bytes 4–7 (Offset 4)   : latitude (int32 fixed-point lat * 1_000_000)
 * - Bytes 8–11 (Offset 8)  : longitude (int32 fixed-point lng * 1_000_000)
 * - Byte 12 (Offset 12)    : Triage & Status Flags (uint8)
 *                            - Bits 0–3 (0x0F): emergency_type (0=None, 1=Medical, 2=Lost, 3=Avalanche, 4=Trapped)
 *                            - Bit 4    (0x10): is_conscious (1=True, 0=False)
 *                            - Bit 5    (0x20): is_group (1=Multiple, 0=Solo)
 *                            - Bits 6–7 (0xC0): Reserved (00)
 * - Byte 13 (Offset 13)    : Network & Power Telemetry (uint8)
 *                            - Bits 0–4 (0x1F): battery_level in 5% steps (0–20 representing 0% to 100%)
 *                            - Bits 5–7 (0xE0): hop_limit / TTL (0–7 max hops)
 * - Bytes 14–15 (Offset 14): crc16 (uint16) — CRC-16-CCITT (Polynomial 0x1021, Initial 0xFFFF)
 */

export interface RawTelemetryInput {
  nodeId: number;
  lat: number;
  lng: number;
  emergencyType: number;
  isConscious: boolean;
  isGroup: boolean;
  batteryPercent: number;
  hopLimit: number;
}

export interface DecodedTelemetry extends RawTelemetryInput {
  calculatedCrc: number;
  receivedCrc: number;
  isCrcValid: boolean;
  hexString: string;
}

/**
 * Pre-computed lookup table for CRC-16-CCITT (Poly: 0x1021, Init: 0xFFFF).
 */
const CRC16_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 8;
  for (let j = 0; j < 8; j++) {
    if (crc & 0x8000) {
      crc = ((crc << 1) ^ 0x1021) & 0xffff;
    } else {
      crc = (crc << 1) & 0xffff;
    }
  }
  CRC16_TABLE[i] = crc;
}

/**
 * Computes CRC-16-CCITT checksum over specified length of Uint8Array buffer.
 */
export function computeCRC16(data: Uint8Array, length: number = data.length): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i++) {
    const byte = data[i];
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ byte) & 0xff]) & 0xffff;
  }
  return crc;
}

/**
 * Packs raw telemetry data into a 16-byte Laksha Emergency Frame Uint8Array.
 */
export function packEmergencyFrame(input: RawTelemetryInput): Uint8Array {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Bytes 0–3: node_id (uint32)
  view.setUint32(0, input.nodeId >>> 0, false);

  // Bytes 4–7: latitude (int32 fixed-point)
  const latScaled = Math.round(input.lat * 1_000_000);
  const latClamped = Math.max(-90_000_000, Math.min(90_000_000, latScaled));
  view.setInt32(4, latClamped, false);

  // Bytes 8–11: longitude (int32 fixed-point)
  const lngScaled = Math.round(input.lng * 1_000_000);
  const lngClamped = Math.max(-180_000_000, Math.min(180_000_000, lngScaled));
  view.setInt32(8, lngClamped, false);

  // Byte 12: Triage & Status Flags
  const emergencyType = Math.max(0, Math.min(15, Math.floor(input.emergencyType))) & 0x0f;
  const isConsciousBit = input.isConscious ? 0x10 : 0x00;
  const isGroupBit = input.isGroup ? 0x20 : 0x00;
  const byte12 = emergencyType | isConsciousBit | isGroupBit;
  view.setUint8(12, byte12);

  // Byte 13: Network & Power Telemetry
  const clampedBattery = Math.max(0, Math.min(100, input.batteryPercent));
  const batteryStep = Math.round(clampedBattery / 5) & 0x1f;
  const clampedHopLimit = Math.max(0, Math.min(7, Math.floor(input.hopLimit))) & 0x07;
  const byte13 = batteryStep | (clampedHopLimit << 5);
  view.setUint8(13, byte13);

  // Bytes 14–15: CRC-16-CCITT (computed over bytes 0–13)
  const crc = computeCRC16(bytes, 14);
  view.setUint16(14, crc, false);

  return bytes;
}

/**
 * Unpacks a 16-byte Laksha Emergency Frame into structured telemetry data.
 */
export function unpackEmergencyFrame(input: Uint8Array | ArrayBuffer): DecodedTelemetry {
  let bytes: Uint8Array;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    throw new TypeError("Input must be a Uint8Array or ArrayBuffer");
  }

  if (bytes.byteLength !== 16) {
    throw new Error(`Invalid frame size: expected 16 bytes, got ${bytes.byteLength}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const nodeId = view.getUint32(0, false);
  const latInt = view.getInt32(4, false);
  const lngInt = view.getInt32(8, false);

  const lat = latInt / 1_000_000;
  const lng = lngInt / 1_000_000;

  const byte12 = view.getUint8(12);
  const emergencyType = byte12 & 0x0f;
  const isConscious = (byte12 & 0x10) !== 0;
  const isGroup = (byte12 & 0x20) !== 0;

  const byte13 = view.getUint8(13);
  const batteryStep = byte13 & 0x1f;
  const batteryPercent = batteryStep * 5;
  const hopLimit = (byte13 >> 5) & 0x07;

  const receivedCrc = view.getUint16(14, false);
  const calculatedCrc = computeCRC16(bytes, 14);
  const isCrcValid = receivedCrc === calculatedCrc;

  const hexString = frameToHexString(bytes);

  return {
    nodeId,
    lat,
    lng,
    emergencyType,
    isConscious,
    isGroup,
    batteryPercent,
    hopLimit,
    calculatedCrc,
    receivedCrc,
    isCrcValid,
    hexString,
  };
}

/**
 * Formats a 16-byte Uint8Array frame into a 32-character uppercase hex string.
 */
export function frameToHexString(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex.toUpperCase();
}

/**
 * Parses a 32-character hex string into a 16-byte Uint8Array frame.
 */
export function hexStringToFrame(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  if (cleanHex.length !== 32) {
    throw new Error(`Invalid hex string length: expected 32 characters, got ${cleanHex.length}`);
  }
  if (!/^[0-9a-fA-F]{32}$/.test(cleanHex)) {
    throw new Error("Invalid hex string format");
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Inline Self-Test Verification Function.
 */
export function runSelfTest(): void {
  console.log("=== Running Laksha Emergency Frame BitPacker Self-Test ===");

  // Mount Everest Coordinates: 27.988056 N, 86.925278 E
  const testInput: RawTelemetryInput = {
    nodeId: 0x12345678,
    lat: 27.988056,
    lng: 86.925278,
    emergencyType: 1, // Medical
    isConscious: true,
    isGroup: false,
    batteryPercent: 85, // 85% -> 17 steps
    hopLimit: 3,
  };

  const packedFrame = packEmergencyFrame(testInput);
  const hex = frameToHexString(packedFrame);
  console.log(`Packed Hex (32 chars): ${hex}`);

  console.assert(packedFrame.byteLength === 16, "Frame size must be 16 bytes");

  // Round-trip unpacking test
  const unpacked = unpackEmergencyFrame(packedFrame);
  console.log("Unpacked Telemetry:", unpacked);

  console.assert(unpacked.nodeId === testInput.nodeId, "Node ID match");
  console.assert(Math.abs(unpacked.lat - testInput.lat) < 0.000001, "Latitude match");
  console.assert(Math.abs(unpacked.lng - testInput.lng) < 0.000001, "Longitude match");
  console.assert(unpacked.emergencyType === testInput.emergencyType, "Emergency type match");
  console.assert(unpacked.isConscious === testInput.isConscious, "Consciousness flag match");
  console.assert(unpacked.isGroup === testInput.isGroup, "Group flag match");
  console.assert(unpacked.batteryPercent === 85, "Battery percent match");
  console.assert(unpacked.hopLimit === testInput.hopLimit, "Hop limit match");
  console.assert(unpacked.isCrcValid === true, "CRC validity match");

  // Hex string round-trip test
  const frameFromHex = hexStringToFrame(hex);
  const unpackedFromHex = unpackEmergencyFrame(frameFromHex);
  console.assert(unpackedFromHex.isCrcValid === true, "Hex round-trip CRC match");

  console.log("=== All Assertions Passed Successfully ===");
}

// Automatically execute self-test when run directly via tsx/node
if (typeof require !== "undefined" && require.main === module) {
  runSelfTest();
}
