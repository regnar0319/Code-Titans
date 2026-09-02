"""RF propagation and LoRa timing primitives for the Laksha mesh."""
from __future__ import annotations
from math import atan2, ceil, cos, exp, log10, pi, sin, sqrt
NOISE_FLOOR_DBM=-120.0
LORA_SENSITIVITY_DBM=-118.0
def haversine_km(a_lat:float,a_lon:float,b_lat:float,b_lon:float)->float:
    """Great-circle distance (km), using Haversine."""
    p=pi/180; x=sin((b_lat-a_lat)*p/2)**2+cos(a_lat*p)*cos(b_lat*p)*sin((b_lon-a_lon)*p/2)**2
    return 2*6371.0088*atan2(sqrt(x),sqrt(1-x))
def elevation_angle_deg(distance_km:float,source_m:float,target_m:float)->float:
    return atan2(target_m-source_m,max(1,distance_km*1000))*180/pi
def path_loss_db(distance_km:float,frequency_mhz:float,angle_deg:float)->float:
    """PL=20log10(f)+10γlog10(d)-27.55+α; γ=2.7 clear, 3.8 obstructed."""
    d=max(.001,distance_km); obstructed=angle_deg<0
    return 20*log10(frequency_mhz)+10*(3.8 if obstructed else 2.7)*log10(d)-27.55+(8+abs(angle_deg)*.25 if obstructed else 0)
def rssi_snr(tx_dbm:float,loss_db:float,gain_dbi:float=2.15)->tuple[float,float]:
    r=tx_dbm+gain_dbi-loss_db; return r,r-NOISE_FLOOR_DBM
def lora_time_on_air_ms(payload_bytes:int,sf:int=9,bw_hz:int=125000,cr:int=1)->float:
    """Semtech LoRa symbol/payload equation for explicit header and CRC."""
    if not 7<=sf<=12 or payload_bytes<0: raise ValueError("payload/SF invalid")
    ts=2**sf/bw_hz; de=int(sf>=11 and bw_hz==125000)
    symbols=8+max(0,ceil((8*payload_bytes-4*sf+28+16)/(4*(sf-2*de)))*(cr+4))
    return (12.25+symbols)*ts*1000
def packet_delivery_ratio(snr_db:float,sf:int=9)->float:
    """Sigmoidal BER-derived PDR, clamped away from exactly 0/1."""
    threshold=-7.5-(sf-7)*1.5
    try: return max(.001,min(.999,1/(1+exp(-.72*(snr_db-threshold)))))
    except OverflowError: return .001 if snr_db<threshold else .999
