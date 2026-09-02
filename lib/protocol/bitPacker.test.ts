import { describe, it, expect } from "vitest";
import {
  packEmergencyFrame,
  unpackEmergencyFrame,
  frameToHexString,
  hexStringToFrame,
  computeCRC16,
  runSelfTest,
  RawTelemetryInput,
} from "./bitPacker.js";

describe("Laksha 16-Byte Emergency Frame BitPacker", () => {
  it("should pack and unpack round-trip accurately for Mount Everest coordinates", () => {
    const input: RawTelemetryInput = {
      nodeId: 0x12345678,
      lat: 27.988056,
      lng: 86.925278,
      emergencyType: 1, // Medical
      isConscious: true,
      isGroup: false,
      batteryPercent: 85,
      hopLimit: 3,
    };

    const packed = packEmergencyFrame(input);
    expect(packed.length).toBe(16);

    const decoded = unpackEmergencyFrame(packed);
    expect(decoded.nodeId).toBe(input.nodeId);
    expect(decoded.lat).toBeCloseTo(input.lat, 6);
    expect(decoded.lng).toBeCloseTo(input.lng, 6);
    expect(decoded.emergencyType).toBe(input.emergencyType);
    expect(decoded.isConscious).toBe(true);
    expect(decoded.isGroup).toBe(false);
    expect(decoded.batteryPercent).toBe(85);
    expect(decoded.hopLimit).toBe(3);
    expect(decoded.isCrcValid).toBe(true);
    expect(decoded.calculatedCrc).toBe(decoded.receivedCrc);
  });

  it("should correctly handle coordinate boundaries and clamping", () => {
    const inputMax: RawTelemetryInput = {
      nodeId: 0xffffffff,
      lat: 90.0,
      lng: 180.0,
      emergencyType: 4, // Trapped
      isConscious: false,
      isGroup: true,
      batteryPercent: 100,
      hopLimit: 7,
    };

    const packedMax = packEmergencyFrame(inputMax);
    const decodedMax = unpackEmergencyFrame(packedMax);

    expect(decodedMax.nodeId).toBe(0xffffffff);
    expect(decodedMax.lat).toBe(90.0);
    expect(decodedMax.lng).toBe(180.0);
    expect(decodedMax.emergencyType).toBe(4);
    expect(decodedMax.isConscious).toBe(false);
    expect(decodedMax.isGroup).toBe(true);
    expect(decodedMax.batteryPercent).toBe(100);
    expect(decodedMax.hopLimit).toBe(7);
    expect(decodedMax.isCrcValid).toBe(true);

    const inputMin: RawTelemetryInput = {
      nodeId: 0,
      lat: -90.0,
      lng: -180.0,
      emergencyType: 0,
      isConscious: false,
      isGroup: false,
      batteryPercent: 0,
      hopLimit: 0,
    };

    const packedMin = packEmergencyFrame(inputMin);
    const decodedMin = unpackEmergencyFrame(packedMin);

    expect(decodedMin.lat).toBe(-90.0);
    expect(decodedMin.lng).toBe(-180.0);
    expect(decodedMin.batteryPercent).toBe(0);
    expect(decodedMin.hopLimit).toBe(0);
    expect(decodedMin.isCrcValid).toBe(true);
  });

  it("should detect corrupted data via CRC mismatch", () => {
    const input: RawTelemetryInput = {
      nodeId: 1001,
      lat: 12.345678,
      lng: 78.910111,
      emergencyType: 2,
      isConscious: true,
      isGroup: true,
      batteryPercent: 50,
      hopLimit: 5,
    };

    const packed = packEmergencyFrame(input);
    // Corrupt byte 4 (latitude)
    packed[4] ^= 0xff;

    const decoded = unpackEmergencyFrame(packed);
    expect(decoded.isCrcValid).toBe(false);
    expect(decoded.calculatedCrc).not.toBe(decoded.receivedCrc);
  });

  it("should format and parse hex strings correctly", () => {
    const input: RawTelemetryInput = {
      nodeId: 0xdeadbeef,
      lat: 45.123456,
      lng: -93.654321,
      emergencyType: 3, // Avalanche
      isConscious: true,
      isGroup: true,
      batteryPercent: 65,
      hopLimit: 2,
    };

    const packed = packEmergencyFrame(input);
    const hex = frameToHexString(packed);
    expect(hex.length).toBe(32);

    const parsedBytes = hexStringToFrame(hex);
    expect(parsedBytes).toEqual(packed);

    const decoded = unpackEmergencyFrame(parsedBytes);
    expect(decoded.nodeId).toBe(0xdeadbeef);
    expect(decoded.isCrcValid).toBe(true);
  });

  it("should throw error on invalid frame sizes and hex lengths", () => {
    expect(() => unpackEmergencyFrame(new Uint8Array(15))).toThrow("Invalid frame size");
    expect(() => unpackEmergencyFrame(new Uint8Array(17))).toThrow("Invalid frame size");
    expect(() => hexStringToFrame("1234")).toThrow("Invalid hex string length");
    expect(() => hexStringToFrame("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")).toThrow("Invalid hex string format");
  });

  it("should run self test without throwing errors", () => {
    expect(() => runSelfTest()).not.toThrow();
  });
});
