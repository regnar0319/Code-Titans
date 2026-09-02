"""Weighted directed-acyclic RF mesh topology and packet traversal emulator."""
from __future__ import annotations
import random
from itertools import islice
from dataclasses import dataclass
from typing import Any, Callable
import networkx as nx
from pydantic import BaseModel, ConfigDict, Field
from .rf_models import LORA_SENSITIVITY_DBM,elevation_angle_deg,haversine_km,lora_time_on_air_ms,packet_delivery_ratio,path_loss_db,rssi_snr
class NodeConfig(BaseModel):
    model_config=ConfigDict(extra="forbid")
    id:str; latitude:float=Field(ge=-90,le=90); longitude:float=Field(ge=-180,le=180)
    elevation_m:float; tx_power_dbm:float=Field(default=20,ge=14,le=22); frequency_mhz:float=868.1; status:str="ONLINE"; battery_percent:float=Field(default=100,ge=0,le=100)

@dataclass(frozen=True)
class TopologyChange:
    version: int
    kind: str
    node_id: str | None = None
    edge: tuple[str, str] | None = None

class RFMeshTopology:
    """DAG where every fixed edge strictly reduces distance to the base sink."""
    def __init__(self,sink_id:str="BASE-GW-00",rng:random.Random|None=None)->None:
        self.sink_id=sink_id; self.rng=rng or random.Random(); self.graph=nx.DiGraph(); self.nodes:dict[str,NodeConfig]={}
        self._blocked_edges:set[tuple[str,str]]=set(); self._listeners:list[Callable[[TopologyChange],None]]=[]; self.version=0
    def build_topology(self,nodes_config:list[dict[str,Any]])->None:
        self.nodes={n.id:n for n in map(NodeConfig.model_validate,nodes_config)}
        if self.sink_id not in self.nodes: raise ValueError("base sink missing")
        self.graph=nx.DiGraph(); [self.graph.add_node(n.id,**n.model_dump()) for n in self.nodes.values()]
        sink=self.nodes[self.sink_id]
        for u in self.nodes.values():
            for v in self.nodes.values():
                if u.id==v.id or u.status=="OFFLINE" or v.status=="OFFLINE": continue
                du=haversine_km(u.latitude,u.longitude,sink.latitude,sink.longitude); dv=haversine_km(v.latitude,v.longitude,sink.latitude,sink.longitude)
                if not dv < du-.001: continue
                m=self._edge(u,v)
                m["base_weight"]=m["weight"]
                if m["rssi"]>=LORA_SENSITIVITY_DBM:
                    if (u.id,v.id) in self._blocked_edges:m["weight"]=float("inf")
                    self.graph.add_edge(u.id,v.id,**m)
        self._blocked_edges.intersection_update(self.graph.edges)
    def _edge(self,u:NodeConfig,v:NodeConfig)->dict[str,float]:
        d=haversine_km(u.latitude,u.longitude,v.latitude,v.longitude); pl=path_loss_db(d,u.frequency_mhz,elevation_angle_deg(d,u.elevation_m,v.elevation_m)); r,s=rssi_snr(u.tx_power_dbm,pl); delay=lora_time_on_air_ms(16)+35+self.rng.uniform(4,24); p=packet_delivery_ratio(s)
        return {"distance_km":d,"rssi":r,"snr":s,"pdr":p,"delay_ms":delay,"weight":.45*min(1,d/25)+.45*(1-max(0,min(1,(s+20)/70)))+delay/1000}
    def set_node_status(self,node_id:str,online:bool)->None:
        if node_id not in self.nodes:raise KeyError(node_id)
        self.nodes[node_id]=self.nodes[node_id].model_copy(update={"status":"ONLINE" if online else "OFFLINE"}); self.build_topology([n.model_dump() for n in self.nodes.values()])
        self._notify(TopologyChange(self.version,"NODE_STATUS",node_id=node_id))

    def set_node_battery(self,node_id:str,battery_percent:float)->None:
        """Apply a battery reading; zero battery makes the node unavailable."""
        if node_id not in self.nodes:raise KeyError(node_id)
        if not 0 <= battery_percent <= 100:raise ValueError("battery_percent must be between 0 and 100")
        online=battery_percent > 0
        self.nodes[node_id]=self.nodes[node_id].model_copy(update={"battery_percent":battery_percent,"status":"ONLINE" if online else "OFFLINE"})
        self.build_topology([n.model_dump() for n in self.nodes.values()])
        self._notify(TopologyChange(self.version,"NODE_BATTERY",node_id=node_id))

    def subscribe(self,listener:Callable[[TopologyChange],None])->Callable[[],None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def set_edge_blocked(self,from_id:str,to_id:str,blocked:bool=True)->None:
        if not self.graph.has_edge(from_id,to_id) and (from_id,to_id) not in self._blocked_edges:raise KeyError(f"edge {from_id}->{to_id} not found")
        edge=(from_id,to_id)
        if blocked:self._blocked_edges.add(edge)
        else:self._blocked_edges.discard(edge)
        if self.graph.has_edge(*edge):
            if blocked:self.graph.edges[edge]["weight"]=float("inf")
            else:self.graph.edges[edge]["weight"]=self.graph.edges[edge]["base_weight"]
        self.version+=1; self._notify(TopologyChange(self.version,"EDGE_BLOCKED" if blocked else "EDGE_UNBLOCKED",edge=edge))

    def _notify(self,change:TopologyChange)->None:
        self.version+=1
        for listener in tuple(self._listeners):listener(change)
    def route_emergency_packet(self,origin_lat:float,origin_lng:float,payload_hex:str,max_ttl:int=7)->dict[str,Any]:
        if len(payload_hex)!=32 or any(c not in "0123456789abcdefABCDEF" for c in payload_hex):raise ValueError("payload_hex must be 32 hexadecimal characters")
        g=self.graph.copy(); origin=NodeConfig(id="ORIGIN",latitude=origin_lat,longitude=origin_lng,elevation_m=2800,tx_power_dbm=14);g.add_node("ORIGIN",**origin.model_dump())
        for n in self.nodes.values():
            if n.status!="OFFLINE":
                m=self._edge(origin,n)
                if m["rssi"]>=LORA_SENSITIVITY_DBM:g.add_edge("ORIGIN",n.id,**m)
        g.remove_edges_from([(u,v) for u,v,data in g.edges(data=True) if data.get("weight")==float("inf")])
        try: paths=list(islice(nx.shortest_simple_paths(g,"ORIGIN",self.sink_id,weight="weight"),2))
        except (nx.NetworkXNoPath,nx.NodeNotFound):return {"status":"NO_ROUTE","trace":[],"alternates":[]}
        if len(paths[0])-1>max_ttl:return {"status":"TTL_EXPIRED","trace":[],"alternates":paths[1:]}
        trace=[]
        for i,(u,v) in enumerate(zip(paths[0],paths[0][1:]),1):
            e=g.edges[u,v]; ok=self.rng.random()<=e["pdr"];trace.append({"hop":i,"from":u,"to":v,"rssi":round(e["rssi"],2),"snr":round(e["snr"],2),"delay_ms":round(e["delay_ms"],1),"pdr":round(e["pdr"],4),"status":"SUCCESS" if ok else "DROPPED"})
            if not ok:return {"status":"DROPPED","trace":trace,"alternates":paths[1:]}
        return {"status":"DELIVERED","trace":trace,"alternates":paths[1:]}
    def topology_payload(self)->dict[str,Any]:
        return {"version":self.version,"nodes":[n.model_dump() for n in self.nodes.values()],"edges":[{"from":u,"to":v,**{k:round(x,3) if isinstance(x,float) and x != float("inf") else x for k,x in e.items()}} for u,v,e in self.graph.edges(data=True)]}
