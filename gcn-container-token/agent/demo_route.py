"""Sample journey for offline demonstration and tests.

SAMPLE DATA. Not a real shipment. The container id is the standard ISO 6346 worked
example, the IMO is an illustrative number, and the coordinates are approximate port
centroids. No part of this has been verified by GCN.

The route deliberately contains two defects so the audit has something to catch:
  * a 31-day coverage gap across the Indian Ocean leg, and
  * a vessel-AIS position recorded after the container was discharged.
"""

DEMO = {
    "container_id": "CSQU3054383",
    "declared_route": "CNSHA-SGSIN-AEJEA-NLRTM",
    "waypoints": [
        {"at": "2026-03-01T06:00:00Z", "lat": 31.18, "lon": 121.52, "event_type": "GATE_OUT",
         "tier": "TIER2_CARRIER_EDI", "mode": "ROAD", "unlocode": None, "evidence_hash": "a1" * 16},
        {"at": "2026-03-02T14:00:00Z", "lat": 31.23, "lon": 121.47, "event_type": "LOADED_VESSEL",
         "tier": "TIER2_CARRIER_EDI", "mode": "YARD", "unlocode": "CNSHA", "evidence_hash": "b2" * 16},
        {"at": "2026-03-13T09:00:00Z", "lat": 1.26, "lon": 103.84, "event_type": "TRANSSHIPPED",
         "tier": "TIER3_VESSEL_AIS", "mode": "SEA", "unlocode": "SGSIN", "evidence_hash": "c3" * 16},
        # 31 days with nothing attested: the gap the auditor must refuse to paper over.
        {"at": "2026-04-13T07:00:00Z", "lat": 25.01, "lon": 55.06, "event_type": "DISCHARGED",
         "tier": "TIER2_CARRIER_EDI", "mode": "SEA", "unlocode": "AEJEA", "evidence_hash": "d4" * 16},
        # Ship's position after the box came ashore - not the container's position.
        {"at": "2026-04-15T07:00:00Z", "lat": 26.20, "lon": 56.30, "event_type": "VESSEL_POSITION",
         "tier": "TIER3_VESSEL_AIS", "mode": "SEA", "unlocode": None, "evidence_hash": "e5" * 16},
    ],
}
