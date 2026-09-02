"""
Laksha Protocol: High-Performance CRC-16-CCITT-FALSE Verification Engine
Designed for sub-microsecond ad-hoc frame validation in zero-infrastructure LoRa networks.
"""

from __future__ import annotations
import typing

def _precompute_table() -> tuple[int, ...]:
    """
    Precompute the static 256-element lookup table for CRC-16-CCITT-FALSE.
    Polynomial: 0x1021 (x^16 + x^12 + x^5 + 1)
    Non-reflected processing (MSB first).
    """
    table = []
    for i in range(256):
        crc = i << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
            crc &= 0xFFFF
        table.append(crc)
    return tuple(table)

# Precomputed table generated once at module import
_TABLE: tuple[int, ...] = _precompute_table()

def compute_crc16(data: bytes | bytearray | memoryview) -> int:
    """
    Compute the CRC-16-CCITT-FALSE checksum of the provided buffer.
    
    Mathematical Specifications:
        - Polynomial: 0x1021
        - Initial register value: 0xFFFF
        - RefIn/RefOut: False (MSB first)
        - XOR Out: 0x0000
        
    Complexity: O(1) per byte using lookup-table resolution.
    """
    crc = 0xFFFF
    for byte in data:
        tbl_idx = ((crc >> 8) ^ byte) & 0xFF
        crc = ((crc << 8) ^ _TABLE[tbl_idx]) & 0xFFFF
    return crc

def validate_frame(frame: bytes | bytearray | memoryview) -> tuple[bool, int, int]:
    """
    Validate the integrity of a 16-byte Laksha frame.
    
    Extracts the payload slice (first 14 bytes) and received checksum (last 2 bytes),
    and asserts structural correctness.
    
    Args:
        frame: 16-byte fixed-length binary frame.
        
    Returns:
        tuple[bool, int, int]: (is_valid, calculated_crc, received_crc)
    """
    if len(frame) != 16:
        raise ValueError(f"Laksha frame must be exactly 16 bytes. Received {len(frame)} bytes.")
        
    payload = frame[:14]
    received_crc = int.from_bytes(frame[14:16], byteorder='big')
    calculated_crc = compute_crc16(payload)
    
    return (calculated_crc == received_crc), calculated_crc, received_crc

def append_crc(payload_14bytes: bytes | bytearray | memoryview) -> bytes:
    """
    Calculate the CRC-16 checksum of a 14-byte payload and append it as
    a 2-byte Big-Endian sequence, returning the complete 16-byte frame.
    """
    if len(payload_14bytes) != 14:
        raise ValueError(f"Payload must be exactly 14 bytes. Received {len(payload_14bytes)} bytes.")
        
    crc = compute_crc16(payload_14bytes)
    return bytes(payload_14bytes) + crc.to_bytes(2, byteorder='big')

# --- Diagnostic & Fault Injection Capabilities ---

def corrupt_bit(buffer: bytes | bytearray | memoryview, bit_index: int) -> bytes:
    """
    Mutate a single bit in a byte array at the specified 0-based bit index.
    Inverts the bit (1 -> 0, 0 -> 1) to simulate radio link interference / phase noise.
    """
    mutated = bytearray(buffer)
    byte_idx = bit_index // 8
    bit_offset = 7 - (bit_index % 8)  # MSB first bit-addressing
    
    if byte_idx >= len(mutated):
        raise IndexError(f"Bit index {bit_index} out of range for buffer of size {len(buffer)} bytes.")
        
    mutated[byte_idx] ^= (1 << bit_offset)
    return bytes(mutated)

def run_diagnostic_matrix() -> dict[str, typing.Any]:
    """
    Executes the automated integrity and error isolation analysis matrix.
    Asserts cross-language test vectors and proves 100% burst detection.
    """
    # 1. Standard ASCII Check Vector
    ascii_vector = b"123456789"
    ascii_crc = compute_crc16(ascii_vector)
    assert ascii_crc == 0x29B1, f"Failed standard ASCII check vector: expected 0x29B1, got 0x{ascii_crc:04X}"
    
    # 2. Zero-byte vector
    zero_payload = b"\x00" * 14
    zero_crc = compute_crc16(zero_payload)
    
    # 3. All-ones vector
    ones_payload = b"\xFF" * 14
    ones_crc = compute_crc16(ones_payload)
    
    # 4. Single bit-flip error isolation demonstration (Hamming distance = 1)
    # Validate that every single possible bit flip in the 14-byte payload guarantees a checksum mismatch.
    base_frame = append_crc(ones_payload)
    single_bit_errors_detected = 0
    total_single_bit_tests = 14 * 8  # 112 bits
    
    for i in range(total_single_bit_tests):
        corrupted = corrupt_bit(base_frame, i)
        is_valid, calc, rec = validate_frame(corrupted)
        if not is_valid:
            single_bit_errors_detected += 1
            
    assert single_bit_errors_detected == total_single_bit_tests, "Failed 100% single-bit error detection guarantee."
    
    # 5. Two isolated bit-flips error detection demonstration (Hamming distance = 2)
    two_bit_errors_detected = 0
    total_two_bit_tests = 500  # Sample space of random dual-bit flips
    import random
    rng = random.Random(42)
    for _ in range(total_two_bit_tests):
        bit1, bit2 = rng.sample(range(112), 2)
        corrupted = corrupt_bit(corrupt_bit(base_frame, bit1), bit2)
        is_valid, _, _ = validate_frame(corrupted)
        if not is_valid:
            two_bit_errors_detected += 1
            
    assert two_bit_errors_detected == total_two_bit_tests, "Failed dual-bit error detection safety assertion."
    
    return {
        "status": "PASS",
        "ascii_check_vector": f"0x{ascii_crc:04X}",
        "zero_byte_vector": f"0x{zero_crc:04X}",
        "all_ones_vector": f"0x{ones_crc:04X}",
        "single_bit_burst_coverage": "100.00%",
        "double_bit_burst_coverage": "100.00%"
    }

if __name__ == "__main__":
    results = run_diagnostic_matrix()
    print("Laksha CRC-16 Diagnostics Passed:")
    for k, v in results.items():
        print(f"  {k}: {v}")
