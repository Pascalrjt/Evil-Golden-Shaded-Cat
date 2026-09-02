# Pickup Pilot prototype

Static HTML prototype for DECO6500. It implements a focused passenger/driver
pickup flow using Leaflet and OpenStreetMap, with simulated report verification
and shared live state.

## Run

```bash
python3 -m http.server 4173 --directory uber-pickup-prototype
```

Then open `http://localhost:4173`.

## Scope represented

- Passenger pickup-point status, freshness and source
- Explainable alternative pickup-point selection
- Passenger/driver shared confirmation
- Driver and passenger condition reporting
- Simulated live synchronization and activity history

The map data, verification, report aggregation, expiry and infrastructure sync
are deliberately simulated for evaluation fidelity.
