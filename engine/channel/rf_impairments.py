import math
import random
import numpy as np
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Tuple, List

class WeatherProfile(Enum):
    CLEAR_ALPINE = 0.01
    DENSE_FOG = 0.15
    HEAVY_SNOWFALL = 0.45
    TORRENTIAL_RAIN = 1.20

class ReceptionStatus(Enum):
    SUCCESS = auto()
    WEAK_MARGIN = auto()
    CRC_ERROR_BIT_FLIP = auto()
    UNREACHABLE_NOISE_FLOOR = auto()
    DROPPED_CHANNEL_FADE = auto()

@dataclass(frozen=True)
class RFChannelConfig:
    frequency_mhz: float = 868.1
    bandwidth_hz: float = 125000.0
    spreading_factor: int = 7
    coding_rate: int = 1
    tx_power_dbm: float = 14.0
    tx_gain_dbi: float = 2.15
    rx_gain_dbi: float = 2.15
    nf_db: float = 6.0
    weather: WeatherProfile = WeatherProfile.CLEAR_ALPINE
    is_los: bool = True
    terrain_gamma: float = 2.7
    shadowing_sigma: float = 6.0

@dataclass
class ChannelDegradationResult:
    prx_dbm: float
    snr_db: float
    path_loss_db: float
    fading_loss_db: float
    pdr: float
    delay_ms: float
    is_corrupted: bool
    reception_status: ReceptionStatus

class RFImpairmentSimulator:
    def __init__(self, seed: int | None = None):
        if seed is not None:
            np.random.seed(seed)
            random.seed(seed)

    def set_weather_profile(self, profile: WeatherProfile) -> None:
        self.current_weather = profile

    def _calculate_toa(self, payload_bytes: int, sf: int, bw: float, cr: int) -> float:
        \"\"\"
        LoRa Time-on-Air (ToA) calculation.
        T_sym = 2^SF / BW
        \"\"\"
        t_sym = (2**sf) / bw
        # Simplified LoRa packet duration model
        num_symbols = 8 + max(math.ceil((8 * payload_bytes - 4 * sf + 28 + 16) / (4 * (sf - 2))) * (cr + 4), 0)
        return (num_symbols * t_sym) * 1000  # ms

    def _apply_fading(self, is_los: bool) -> float:
        \"\"\"
        Applies Multipath Fast Fading.
        Rician for LoS (K=6dB), Rayleigh for NLoS.
        Returns loss in dB.
        \"\"\"
        if is_los:
            # Rician K-factor in linear scale
            k_db = 6.0
            k = 10**(k_db / 10.0)
            s = math.sqrt(k / (k + 1))
            sigma = math.sqrt(1 / (2 * (k + 1)))
            x = np.random.normal(s, sigma)
            y = np.random.normal(0, sigma)
            magnitude = math.sqrt(x**2 + y**2)
        else:
            # Rayleigh fading
            x = np.random.normal(0, 1/math.sqrt(2))
            y = np.random.normal(0, 1/math.sqrt(2))
            magnitude = math.sqrt(x**2 + y**2)
            
        return -20 * math.log10(max(magnitude, 1e-9))

    def apply_channel_effects(self, payload: bytes, distance_km: float, config: RFChannelConfig) -> Tuple[bytes, ChannelDegradationResult]:
        \"\"\"
        Physics-based channel degradation.
        \"\"\"
        # 1. Path Loss (FSPL)
        # PL = 20log10(d) + 20log10(f) + 32.44
        pl_free = 20 * math.log10(max(distance_km, 0.001)) + 20 * math.log10(config.frequency_mhz) + 32.44
        
        # 2. Terrain & Shadowing
        terrain_loss = 10 * (config.terrain_gamma - 2.0) * math.log10(max(distance_km, 1.0)) if distance_km > 1.0 else 0
        shadowing = np.random.normal(0, config.shadowing_sigma)
        
        # 3. Weather
        weather_loss = config.weather.value * distance_km
        
        # 4. Fast Fading
        fading_loss = self._apply_fading(config.is_los)
        
        total_path_loss = pl_free + terrain_loss + shadowing + weather_loss
        
        # 5. Link Budget
        prx = config.tx_power_dbm + config.tx_gain_dbi + config.rx_gain_dbi - total_path_loss - fading_loss
        
        # 6. Noise Floor
        # N = -174 dBm/Hz + 10log10(BW) + NF
        noise_floor = -174 + 10 * math.log10(config.bandwidth_hz) + config.nf_db
        snr = prx - noise_floor
        
        # 7. LoRa Sensitivity Check
        # Thresholds approx: SF7: -7.5, SF10: -15.0, SF12: -20.0
        snr_thresholds = {7: -7.5, 8: -10.0, 9: -12.5, 10: -15.0, 11: -17.5, 12: -20.0}
        snr_limit = snr_thresholds.get(config.spreading_factor, -7.5)
        
        # 8. PDR calculation (Sigmoidal BER approach)
        # Using a simplified BER model for LoRa: BER = 0.5 * erfc(SNR/sqrt(2))
        # PDR = (1-BER)^L
        ber = 0.5 * math.erfc((snr - snr_limit) / 3.0) # Adjusted steepness
        pdr = (1 - ber)**(len(payload) * 8)
        
        # 9. Timing
        toa = self._calculate_toa(len(payload), config.spreading_factor, config.bandwidth_hz, config.coding_rate)
        prop_delay = (distance_km / 300000.0) * 1000 # ms
        jitter = random.uniform(0, 10.0)
        total_delay = toa + prop_delay + jitter
        
        # 10. Reception Logic
        status = ReceptionStatus.SUCCESS
        is_corrupted = False
        mutated_payload = bytearray(payload)
        
        if prx < (noise_floor + snr_limit - 5): # Hard floor
            status = ReceptionStatus.UNREACHABLE_NOISE_FLOOR
            pdr = 0.0
        elif random.random() > pdr:
            if random.random() > 0.3: # 70% chance of hard drop vs bit flip
                status = ReceptionStatus.DROPPED_CHANNEL_FADE
            else:
                status = ReceptionStatus.CRC_ERROR_BIT_FLIP
                is_corrupted = True
                # Flip 1-2 bits
                for _ in range(random.randint(1, 2)):
                    byte_idx = random.randint(0, len(mutated_payload)-1)
                    bit_idx = random.randint(0, 7)
                    mutated_payload[byte_idx] ^= (1 << bit_idx)
        elif snr < (snr_limit + 3):
            status = ReceptionStatus.WEAK_MARGIN

        return bytes(mutated_payload), ChannelDegradationResult(
            prx_dbm=prx,
            snr_db=snr,
            path_loss_db=total_path_loss,
            fading_loss_db=fading_loss,
            pdr=pdr,
            delay_ms=total_delay,
            is_corrupted=is_corrupted,
            reception_status=status
        )

if __name__ == \"__main__\":
    print(\"RF Channel Impairments Emulation Engine - Demonstration\")
    print(\"=\" * 60)
    
    sim = RFImpairmentSimulator(seed=42)
    payload = b\"LAKSHA_EMERGENCY\" # 16 bytes
    distances = [1.0, 5.0, 10.0, 15.0, 20.0, 25.0]
    
    for weather in [WeatherProfile.CLEAR_ALPINE, WeatherProfile.HEAVY_SNOWFALL]:
        print(f\"\\nCondition: {weather.name}\")
        print(f\"{'Dist(km)':<10} | {'Avg SNR(dB)':<12} | {'Avg PDR':<8} | {'Bit Flips':<10} | {'Status'}\")
        print(\"-\" * 75)
        
        for d in distances:
            snrs = []
            pdrs = []
            corruptions = 0
            results = []
            
            for _ in range(100): # Run 100 trials per distance
                config = RFChannelConfig(weather=weather, is_los=(d < 10.0))
                _, res = sim.apply_channel_effects(payload, d, config)
                snrs.append(res.snr_db)
                pdrs.append(res.pdr)
                if res.is_corrupted: corruptions += 1
                results.append(res.reception_status)
            
            avg_snr = sum(snrs) / len(snrs)
            avg_pdr = sum(pdrs) / len(pdrs)
            most_common_status = max(set(results), key=results.count)
            
            print(f\"{d:<10.1f} | {avg_snr:<12.2f} | {avg_pdr:<8.3f} | {corruptions:<10} | {most_common_status.name}\")
