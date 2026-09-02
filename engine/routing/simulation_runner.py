import asyncio
from .router import MeshRouter, RoutingDecisionType

async def run_simulation():
    print("Starting alpine valley mesh simulation...")
    
    # Create nodes
    nodes = {nid: MeshRouter(nid) for nid in ['A', 'B', 'C', 'D']}
    
    # Node A emits a frame (14 bytes total, byte 13 is TTL=3)
    frame = bytearray([0x00] * 13) + bytearray([3])
    
    # A sends to B and C
    print("Node A broadcasting to B and C...")
    for target in ['B', 'C']:
        decision = await nodes[target].ingest_frame(bytes(frame), 'A', -80.0, 10.0)
        print(f"Node {target} decision: {decision.decision.name}")

    # Simulate duplicate reception (B receives from C, should be dropped)
    print("Node B receiving duplicate from C...")
    decision = await nodes['B'].ingest_frame(bytes(frame), 'C', -90.0, 5.0)
    print(f"Node B decision: {decision.decision.name}")
    
    # Verify D receives it
    decision = await nodes['D'].ingest_frame(decision.frame, 'B', -85.0, 8.0)
    print(f"Node D received: {decision.decision.name}")

if __name__ == "__main__":
    asyncio.run(run_simulation())
