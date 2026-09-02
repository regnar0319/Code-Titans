"""FastAPI endpoints for the Laksha RF mesh emulator."""
from __future__ import annotations
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .graph_engine import RFMeshTopology
router=APIRouter(prefix="/api/mesh",tags=["mesh"])
class SimulateRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    origin_lat:float=Field(ge=-90,le=90); origin_lng:float=Field(ge=-180,le=180)
    triage_code:int=Field(ge=0,le=4); payload_hex:str=Field(min_length=32,max_length=32); max_ttl:int=Field(default=7,ge=1,le=7)
class ToggleResponse(BaseModel): node_id:str; status:str
class BatteryRequest(BaseModel): battery_percent:float=Field(ge=0,le=100)
class EdgeToggleRequest(BaseModel): blocked:bool
class SimulationResponse(BaseModel): status:str; trace:list[dict[str,Any]]; alternates:list[list[str]]
SEED_NODES=[
 {"id":"BASE-GW-00","latitude":32.3126,"longitude":77.1628,"elevation_m":2050,"tx_power_dbm":22},
 {"id":"RIDGE-01","latitude":32.3711,"longitude":77.2469,"elevation_m":3978,"tx_power_dbm":20},
 {"id":"RIDGE-02","latitude":32.2356,"longitude":77.2552,"elevation_m":4105,"tx_power_dbm":20},
 {"id":"VALLEY-01","latitude":32.3094,"longitude":77.1704,"elevation_m":2805,"tx_power_dbm":17},
 {"id":"VALLEY-02","latitude":32.3485,"longitude":77.225,"elevation_m":2870,"tx_power_dbm":17},
]
mesh=RFMeshTopology(); mesh.build_topology(SEED_NODES)
@router.post("/simulate",response_model=SimulationResponse)
def simulate(request:SimulateRequest)->dict[str,Any]:
    try:return mesh.route_emergency_packet(request.origin_lat,request.origin_lng,request.payload_hex,request.max_ttl)
    except ValueError as error:raise HTTPException(status_code=422,detail=str(error)) from error
@router.post("/nodes/{node_id}/toggle",response_model=ToggleResponse)
def toggle(node_id:str)->ToggleResponse:
    try:
        online=mesh.nodes[node_id].status=="OFFLINE"; mesh.set_node_status(node_id,online)
        return ToggleResponse(node_id=node_id,status=mesh.nodes[node_id].status)
    except KeyError as error:raise HTTPException(status_code=404,detail="node not found") from error
@router.post("/nodes/{node_id}/battery",response_model=ToggleResponse)
def set_battery(node_id:str,request:BatteryRequest)->ToggleResponse:
    try:
        mesh.set_node_battery(node_id,request.battery_percent)
        return ToggleResponse(node_id=node_id,status=mesh.nodes[node_id].status)
    except KeyError as error:raise HTTPException(status_code=404,detail="node not found") from error
@router.post("/edges/{from_id}/{to_id}/block")
def block_edge(from_id:str,to_id:str,request:EdgeToggleRequest)->dict[str,Any]:
    try:
        mesh.set_edge_blocked(from_id,to_id,request.blocked)
        return {"from":from_id,"to":to_id,"blocked":request.blocked,"version":mesh.version}
    except KeyError as error:raise HTTPException(status_code=404,detail="edge not found") from error
@router.get("/topology")
def topology()->dict[str,Any]:return mesh.topology_payload()
