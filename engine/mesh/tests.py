import unittest
from engine.mesh.rf_models import haversine_km, path_loss_db, rssi_snr, packet_delivery_ratio
from engine.mesh.graph_engine import RFMeshTopology
from engine.routing.router import MeshRouter

class TestRFMeshEngine(unittest.TestCase):
    def test_haversine(self):
        d = haversine_km(32.3126, 77.1628, 32.3711, 77.2469)
        self.assertGreater(d, 5.0)

    def test_path_loss(self):
        pl = path_loss_db(10.0, 868.1, 0.0)
        self.assertGreater(pl, 50.0)

    def test_rssi_snr(self):
        rssi, snr = rssi_snr(20.0, 95.0)
        self.assertEqual(rssi, 20.0 + 2.15 - 95.0)
        self.assertEqual(snr, rssi - (-120.0))

    def test_pdr(self):
        self.assertAlmostEqual(packet_delivery_ratio(10.0), 1.0, places=2)
        self.assertLess(packet_delivery_ratio(-25.0), 0.1)

    def test_topology_routing(self):
        nodes = [
            {"id": "BASE-GW-00", "latitude": 32.0, "longitude": 77.0, "elevation_m": 2000, "tx_power_dbm": 22},
            {"id": "RELAY-01", "latitude": 32.05, "longitude": 77.05, "elevation_m": 3000, "tx_power_dbm": 20},
        ]
        topo = RFMeshTopology(sink_id="BASE-GW-00")
        topo.build_topology(nodes)
        
        res = topo.route_emergency_packet(32.1, 77.1, "00000000000000000000000000000000", 7)
        self.assertIn(res["status"], ["DELIVERED", "DROPPED"])

    def test_blocked_edge_not_used_and_notifies_router(self):
        topo = RFMeshTopology()
        topo.nodes = {
            "BASE-GW-00": type("Node", (), {})(),
        }
        topo.graph.add_edges_from([
            ("ORIGIN", "PRIMARY", {"weight": 1}),
            ("PRIMARY", "BASE-GW-00", {"weight": 1}),
            ("ORIGIN", "ALTERNATE", {"weight": 2}),
            ("ALTERNATE", "BASE-GW-00", {"weight": 2}),
        ])
        topo.version = 1
        router = MeshRouter("ORIGIN")
        router.attach_topology(topo)
        packet = router.enqueue_packet("p-1", b"frame", "BASE-GW-00")
        self.assertEqual(packet.next_hop, "PRIMARY")
        topo.set_edge_blocked("PRIMARY", "BASE-GW-00")
        self.assertEqual(packet.next_hop, "ALTERNATE")
        self.assertEqual(packet.routing_header["next_hop"], "ALTERNATE")
        router.close()

if __name__ == "__main__":
    unittest.main()
