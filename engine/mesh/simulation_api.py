from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List
from .graph_engine import RFMeshTopology

router = APIRouter()
topology = RFMeshTopology()

class NodeConfig(BaseModel):
    id: str
    lat: float
    lon: float
    elev: float
    ptx: float = Field(default=20.0, ge=14.0, le=22.0)
    gant: float = 2.15

@router.post("/nodes/init")
async def init_nodes(configs: List[NodeConfig]):
    topology.build_topology([c.model_dump() for c in configs])
    return {"message": "Topology initialized"}

class SimulationRequest(BaseModel):
    lat: float
    lng: float
    triage: str

@router.post("/simulate")
async def simulate(req: SimulationRequest):
    result = topology.route_emergency_packet(req.lat, req.lng, "00")
    if not result:
        raise HTTPException(status_code=404, detail="No route found")
    return result

@router.post("/nodes/{node_id}/toggle")
async def toggle_node(node_id: str):
    if node_id not in topology.graph.nodes:
        raise HTTPException(status_code=404, detail="Node not found")
    
    current = topology.graph.nodes[node_id].get("status", "ONLINE")
    new_status = "OFFLINE" if current == "ONLINE" else "ONLINE"
    topology.graph.nodes[node_id]["status"] = new_status
    return {"node": node_id, "status": new_status}

@router.get("/topology")
async def get_topology():
    return {
        "nodes": [{"id": n, **topology.graph.nodes[n]} for n in topology.graph.nodes],
        "edges": [{"source": u, "target": v, **d} for u, v, d in topology.graph.edges(data=True)]
    }
