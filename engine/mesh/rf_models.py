import math

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    \"\"\"Calculates distance in km between two lat/lon points.\"\"\"
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def calculate_path_loss(d_km: float, f_mhz: float, gamma: float = 2.7, alpha: float = 0.0) -> float:
    \"\"\"
    Modified Log-Distance Path Loss.
    PL(d) = 20log10(f) + 10 * gamma * log10(d) - 27.55 + alpha
    \"\"\"
    if d_km <= 0: return 0.0
    return 20 * math.log10(f_mhz) + 10 * gamma * math.log10(d_km) - 27.55 + alpha

def calculate_rssi(ptx_dbm: float, gant_dbi: float, path_loss: float) -> float:
    return ptx_dbm + gant_dbi - path_loss

def calculate_snr(rssi: float, n_floor: float = -120.0) -> float:
    return rssi - n_floor

def calculate_toa(payload_bytes: int, sf: int = 7, bw: int = 125, cr: int = 1) -> float:
    \"\"\"
    Calculates LoRa Time-on-Air (ms).
    Simplified approximation based on standard LoRa modulation parameters.
    \"\"\"
    # T_sym = 2^SF / BW
    t_sym = (2**sf) / (bw * 1000)
    # Payload symbols * symbol duration
    return (payload_bytes * 8 * t_sym) * 1000

def calculate_latency(d_km: float, v_signal: float = 300000.0) -> float:
    \"\"\"Returns signal propagation delay in ms.\"\"\"
    return (d_km * 1000 / v_signal) * 1000
