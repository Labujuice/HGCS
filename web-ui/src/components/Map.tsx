import React, { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export interface Waypoint {
  command: "TAKEOFF" | "WAYPOINT" | "LAND" | "RTL" | "LOITER";
  latitude: number;
  longitude: number;
  altitude: number;
  hold_time?: number;
  radius?: number;
}

export interface MapVehicle {
  id: number;
  latitude: number;
  longitude: number;
  heading: number;
  armed: boolean;
  mode: string;
  altitude?: number;
  autopilot?: string;
}

interface MapProps {
  vehicles: { [id: number]: MapVehicle };
  activeVehicleId: number | null;
  waypoints: Waypoint[];
  selectedWpIndex: number | null;
  onWaypointsChange: (wps: Waypoint[]) => void;
  onSelectWp: (idx: number | null) => void;
  isFlyView: boolean;
  onMapGuidedAction?: (
    action: "go_to" | "orbit",
    lat: number,
    lon: number
  ) => void;
  editMode: "none" | "waypoint" | "survey";
  surveyPolygonPoints: Array<{ latitude: number; longitude: number }>;
  onSurveyPointsChange: (pts: Array<{ latitude: number; longitude: number }>) => void;
  surveyGridPoints: Array<{ latitude: number; longitude: number }>;
}

export const FlightMap: React.FC<MapProps> = ({
  vehicles,
  activeVehicleId,
  waypoints,
  selectedWpIndex,
  onWaypointsChange,
  onSelectWp,
  isFlyView,
  onMapGuidedAction,
  editMode,
  surveyPolygonPoints,
  onSurveyPointsChange,
  surveyGridPoints,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const droneMarkersRef = useRef<{ [id: number]: L.Marker }>({});
  const wpMarkersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);

  // Survey specific refs
  const surveyMarkersRef = useRef<L.Marker[]>([]);
  const surveyPolygonRef = useRef<L.Polygon | null>(null);
  const surveyGridPolylineRef = useRef<L.Polyline | null>(null);

  const wpsStateRef = useRef<Waypoint[]>(waypoints);
  wpsStateRef.current = waypoints;

  const onWaypointsChangeRef = useRef(onWaypointsChange);
  onWaypointsChangeRef.current = onWaypointsChange;

  const onSelectWpRef = useRef(onSelectWp);
  onSelectWpRef.current = onSelectWp;

  const isFlyViewRef = useRef(isFlyView);
  isFlyViewRef.current = isFlyView;

  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  const surveyPointsRef = useRef(surveyPolygonPoints);
  surveyPointsRef.current = surveyPolygonPoints;

  const onSurveyPointsChangeRef = useRef(onSurveyPointsChange);
  onSurveyPointsChangeRef.current = onSurveyPointsChange;

  const onMapGuidedActionRef = useRef(onMapGuidedAction);
  onMapGuidedActionRef.current = onMapGuidedAction;

  const [isFollowing, setIsFollowing] = useState(true);
  const lastCenterTimeRef = useRef<number>(0);

  // ─── Flight Trajectory Refs ─────────────────────────────────
  const trajectoriesRef = useRef<Record<number, L.LatLngLiteral[]>>({});
  const prevArmedRef = useRef<Record<number, boolean>>({});
  const trajectoryPolylinesRef = useRef<Record<number, L.Polyline>>({});

  // ─── 1. Map initialization ─────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [24.7746, 121.0446],
      zoom: 17,
      zoomControl: false,
      doubleClickZoom: false,
    });

    // Satellite tile layer (Esri World Imagery — no API key needed)
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles © Esri — Source: Esri, Maxar, GeoEye, Earthstar Geographics",
      }
    ).addTo(map);

    // Zoom control bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Disable follow on manual pan
    map.on("dragstart", () => setIsFollowing(false));

    // Window resize handler
    const handleResize = () => map.invalidateSize();
    window.addEventListener("resize", handleResize);

    // Map click — deselect WP (Plan View only, click does not trigger guided)
    map.on("click", () => {
      if (!isFlyViewRef.current) {
        onSelectWp(null);
      }
    });

    // Double-click → Guided action popup (Fly View) or Add element (Plan View)
    map.on("dblclick", (e) => {
      const { lat, lng } = e.latlng;

      if (isFlyViewRef.current) {
        // Fly View: Popup Go-To / Orbit
        const popupEl = document.createElement("div");
        popupEl.style.cssText = "min-width:130px; padding:4px;";
        popupEl.innerHTML = `
          <div style="font-family:monospace;font-size:9px;font-weight:bold;margin-bottom:5px;color:#7c3aed;border-bottom:1px solid #374151;padding-bottom:3px;">GUIDED ACTION</div>
          <button class="popup-btn go-to" style="display:block;width:100%;text-align:left;background:#0f172a;color:#38bdf8;border:1px solid #0284c7;padding:4px 8px;border-radius:4px;margin-bottom:4px;font-size:10px;cursor:pointer;font-weight:700;">📍 Go To Here</button>
          <button class="popup-btn orbit" style="display:block;width:100%;text-align:left;background:#0f172a;color:#f472b6;border:1px solid #db2777;padding:4px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:700;">🔄 Orbit Here</button>
        `;
        L.popup({ closeButton: false })
          .setLatLng(e.latlng)
          .setContent(popupEl)
          .openOn(map);
        popupEl.querySelector(".go-to")?.addEventListener("click", () => {
          onMapGuidedActionRef.current?.("go_to", lat, lng);
          map.closePopup();
        });
        popupEl.querySelector(".orbit")?.addEventListener("click", () => {
          onMapGuidedActionRef.current?.("orbit", lat, lng);
          map.closePopup();
        });
      } else {
        // Plan View: Add elements based on editMode
        if (editModeRef.current === "waypoint") {
          const currentWps = [...wpsStateRef.current];
          let command: Waypoint["command"] = "WAYPOINT";
          if (currentWps.length === 0) command = "TAKEOFF";
          const newWp: Waypoint = {
            command,
            latitude: parseFloat(lat.toFixed(6)),
            longitude: parseFloat(lng.toFixed(6)),
            altitude: command === "TAKEOFF" ? 30.0 : 50.0,
            hold_time: command === "WAYPOINT" ? 5 : undefined,
          };
          let nextWps = [...currentWps];
          if (currentWps.length > 0 && currentWps[currentWps.length - 1].command === "RTL") {
            nextWps.splice(currentWps.length - 1, 0, newWp);
          } else {
            nextWps.push(newWp);
          }
          onWaypointsChangeRef.current?.(nextWps);
          onSelectWpRef.current?.(nextWps.length - 1);
        } else if (editModeRef.current === "survey") {
          const updatedPts = [...surveyPointsRef.current, {
            latitude: parseFloat(lat.toFixed(6)),
            longitude: parseFloat(lng.toFixed(6)),
          }];
          onSurveyPointsChangeRef.current?.(updatedPts);
        }
      }
    });

    mapRef.current = map;

    return () => {
      window.removeEventListener("resize", handleResize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // ─── 1.1 Invalidate size when view tab changes ─────────────
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 120);
    }
  }, [isFlyView]);

  // ─── 2. Drone markers (multi-vehicle) ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const incomingIds = Object.keys(vehicles).map(Number);

    // Remove stale markers
    Object.keys(droneMarkersRef.current).forEach((idStr) => {
      const id = Number(idStr);
      if (!incomingIds.includes(id)) {
        droneMarkersRef.current[id].remove();
        delete droneMarkersRef.current[id];
      }
    });

    // Update / create markers
    incomingIds.forEach((id) => {
      const vehicle = vehicles[id];
      const isActive = id === activeVehicleId;

      // Drone SVG icon with heading rotation
      const fillColor = isActive ? "#10B981" : "#94a3b8";
      const glowSvg = isActive
        ? `filter: drop-shadow(0 0 6px #10B981) drop-shadow(0 0 12px rgba(16,185,129,0.4));`
        : "";

      const droneIcon = L.divIcon({
        html: `
          <div style="position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center;">
            <!-- Vehicle ID label -->
            <div style="
              position:absolute; top:-10px; left:50%; transform:translateX(-50%) rotate(${-vehicle.heading}deg);
              background:${fillColor}; color:white; font-family:monospace; font-size:8px; font-weight:800;
              padding:1px 4px; border-radius:3px; border:1px solid rgba(255,255,255,0.6); white-space:nowrap;
              box-shadow:0 2px 6px rgba(0,0,0,0.4); pointer-events:none;
            ">#${id}</div>
            <!-- Drone arrow rotated by heading -->
            <div style="transform:rotate(${vehicle.heading}deg); ${glowSvg} display:flex;">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
                <!-- Heading arrow -->
                <polygon points="17,2 24,26 17,22 10,26" fill="${fillColor}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
                <!-- Center dot -->
                <circle cx="17" cy="22" r="3" fill="white" opacity="0.9"/>
              </svg>
            </div>
          </div>
        `,
        className: "drone-marker-div",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      // Popup content (refreshed on each telemetry update)
      const popupHtml = `
        <div style="font-family:monospace;font-size:11px;padding:6px 8px;line-height:1.5;min-width:150px;">
          <div style="font-weight:800;border-bottom:1px solid #374151;padding-bottom:4px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span style="color:${isActive ? "#10B981" : "#94a3b8"};">UAV #${id}</span>
            <span style="font-size:9px;background:rgba(14,165,233,0.15);padding:1px 5px;border-radius:3px;color:#38bdf8;border:1px solid rgba(14,165,233,0.3);">${vehicle.mode}</span>
          </div>
          <div style="display:grid;grid-template-columns:auto auto;gap:2px 10px;">
            <span style="color:#6b7280;font-size:9px;">Autopilot</span>
            <span style="font-weight:700;color:#a78bfa;">${vehicle.autopilot || "PX4"}</span>
            <span style="color:#6b7280;font-size:9px;">Altitude</span>
            <span style="font-weight:700;color:#38bdf8;">${(vehicle.altitude ?? 0).toFixed(1)} m</span>
            <span style="color:#6b7280;font-size:9px;">Heading</span>
            <span style="font-weight:700;color:#fbbf24;">${vehicle.heading}°</span>
            <span style="color:#6b7280;font-size:9px;">Lat</span>
            <span style="color:#a78bfa;font-size:10px;">${vehicle.latitude.toFixed(5)}</span>
            <span style="color:#6b7280;font-size:9px;">Lon</span>
            <span style="color:#a78bfa;font-size:10px;">${vehicle.longitude.toFixed(5)}</span>
          </div>
        </div>
      `;

      if (!droneMarkersRef.current[id]) {
        const marker = L.marker([vehicle.latitude, vehicle.longitude], {
          icon: droneIcon,
        }).addTo(map);

        marker.bindPopup(popupHtml, {
          closeButton: false,
          closeOnClick: false,
          autoClose: false,
          className: "drone-popup-follow",
          offset: [0, -12],
        });

        droneMarkersRef.current[id] = marker;

        // Initial center for active vehicle
        if (isActive) {
          map.setView([vehicle.latitude, vehicle.longitude], map.getZoom());
        }
      } else {
        const marker = droneMarkersRef.current[id];
        marker.setLatLng([vehicle.latitude, vehicle.longitude]);
        marker.setIcon(droneIcon);
        marker.setPopupContent(popupHtml);
      }
    });
  }, [vehicles, activeVehicleId]);

  // ─── 3. Waypoint markers & path ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current = [];

    waypoints.forEach((wp, index) => {
      const isSelected = index === selectedWpIndex;
      let color = "#8b5cf6";
      let label = `${index + 1}`;
      if (wp.command === "TAKEOFF") { color = "#10b981"; label = "🛫"; }
      else if (wp.command === "RTL") { color = "#ef4444"; label = "🏡"; }
      else if (wp.command === "LAND") { color = "#f59e0b"; label = "🛬"; }
      else if (wp.command === "LOITER") { color = "#ec4899"; label = "🔄"; }

      const wpIcon = L.divIcon({
        html: `
          <div style="
            background:${color}; border:2px solid ${isSelected ? "#fff" : "rgba(255,255,255,0.6)"};
            box-shadow:${isSelected ? `0 0 12px 3px ${color}` : "0 2px 4px rgba(0,0,0,0.4)"};
            color:white; border-radius:50%; width:26px; height:26px;
            display:flex; align-items:center; justify-content:center;
            font-weight:800; font-size:10px; font-family:monospace; cursor:pointer;
            transform:${isSelected ? "scale(1.25)" : "scale(1)"};
            transition:transform 0.2s, box-shadow 0.2s;
          ">${label}</div>
        `,
        className: "wp-marker-div",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marker = L.marker([wp.latitude, wp.longitude], {
        icon: wpIcon,
        draggable: wp.command !== "RTL",
      }).addTo(map);

      marker.on("click", (e) => { L.DomEvent.stopPropagation(e); onSelectWp(index); });
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        const updated = [...wpsStateRef.current];
        updated[index] = {
          ...updated[index],
          latitude: parseFloat(ll.lat.toFixed(6)),
          longitude: parseFloat(ll.lng.toFixed(6)),
        };
        onWaypointsChange(updated);
      });

      wpMarkersRef.current.push(marker);
    });

    // Draw polyline
    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    if (waypoints.length > 0) {
      const coords = waypoints.map((wp) => [wp.latitude, wp.longitude] as [number, number]);
      if (waypoints[waypoints.length - 1].command === "RTL" && coords.length > 1) {
        coords.push(coords[0]);
      }
      polylineRef.current = L.polyline(coords, {
        color: "#a855f7",
        weight: 2.5,
        opacity: 0.8,
        dashArray: "6, 8",
        lineJoin: "round",
      }).addTo(map);
    }
  }, [waypoints, selectedWpIndex]);

  // ─── 3.1 Survey area & grid paths ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing survey boundary markers
    surveyMarkersRef.current.forEach((m) => m.remove());
    surveyMarkersRef.current = [];

    // Clear existing polygon
    if (surveyPolygonRef.current) {
      surveyPolygonRef.current.remove();
      surveyPolygonRef.current = null;
    }

    // Clear existing grid lines
    if (surveyGridPolylineRef.current) {
      surveyGridPolylineRef.current.remove();
      surveyGridPolylineRef.current = null;
    }

    // 1. Draw boundary polygon & handles if points exist
    if (surveyPolygonPoints.length > 0) {
      const latlngs = surveyPolygonPoints.map(p => [p.latitude, p.longitude] as [number, number]);
      
      // Draw Polygon
      if (surveyPolygonPoints.length >= 3) {
        surveyPolygonRef.current = L.polygon(latlngs, {
          color: "#c084fc",
          fillColor: "#c084fc",
          fillOpacity: 0.15,
          weight: 2,
          dashArray: "4, 6"
        }).addTo(map);
      }

      // Draw boundary drag markers (only if not in Fly View)
      if (!isFlyView) {
        surveyPolygonPoints.forEach((pt, index) => {
          // Custom small circle icon for boundary handles
          const handleIcon = L.divIcon({
            html: `
              <div style="
                width: 12px; height: 12px;
                background-color: #3b82f6;
                border: 2px solid white;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0,0,0,0.5);
                cursor: pointer;
              "></div>
            `,
            className: "survey-handle-div",
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          });

          const marker = L.marker([pt.latitude, pt.longitude], {
            icon: handleIcon,
            draggable: true
          }).addTo(map);

          // Click on point to remove
          marker.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            const updated = [...surveyPointsRef.current];
            updated.splice(index, 1);
            onSurveyPointsChangeRef.current?.(updated);
          });

          marker.on("dragend", () => {
            const ll = marker.getLatLng();
            const updated = [...surveyPointsRef.current];
            updated[index] = {
              latitude: parseFloat(ll.lat.toFixed(6)),
              longitude: parseFloat(ll.lng.toFixed(6))
            };
            onSurveyPointsChangeRef.current?.(updated);
          });

          surveyMarkersRef.current.push(marker);
        });
      }
    }

    // 2. Draw generated sweep lines (surveyGridPoints)
    if (surveyGridPoints && surveyGridPoints.length > 0) {
      const gridCoords = surveyGridPoints.map(p => [p.latitude, p.longitude] as [number, number]);
      surveyGridPolylineRef.current = L.polyline(gridCoords, {
        color: "#22c55e", // Bright green
        weight: 3,
        opacity: 0.9,
        lineJoin: "round"
      }).addTo(map);
    }
  }, [surveyPolygonPoints, surveyGridPoints, isFlyView]);

  // ─── 4. Center when active vehicle changes ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null) return;
    const drone = vehicles[activeVehicleId];
    if (drone) {
      map.setView([drone.latitude, drone.longitude], map.getZoom(), {
        animate: true,
        duration: 0.8,
      });
    }
  }, [activeVehicleId]);

  // ─── 5. Throttled auto-follow ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null || !isFollowing) return;
    const drone = vehicles[activeVehicleId];
    if (!drone) return;
    const now = Date.now();
    if (now - lastCenterTimeRef.current > 1500) {
      map.panTo([drone.latitude, drone.longitude], { animate: true, duration: 0.8 });
      lastCenterTimeRef.current = now;
    }
  }, [vehicles, activeVehicleId, isFollowing]);

  // ─── 6. Flight Trajectory Drawing ──────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(vehicles).forEach((v) => {
      const vId = v.id;
      const latLng = { lat: v.latitude, lng: v.longitude };

      if (!v.latitude || !v.longitude || (v.latitude === 0 && v.longitude === 0)) {
        return;
      }

      const wasArmed = prevArmedRef.current[vId] || false;
      const isArmed = v.armed;

      // Detect rising edge of arm: when vehicle transitions from disarmed -> armed
      if (isArmed && !wasArmed) {
        // Clear existing trajectory coordinates for this vehicle
        trajectoriesRef.current[vId] = [];

        // Remove existing polyline from map
        if (trajectoryPolylinesRef.current[vId]) {
          trajectoryPolylinesRef.current[vId].remove();
          delete trajectoryPolylinesRef.current[vId];
        }

        console.log(`🛸 Vehicle #${vId} Armed. Trajectory cleared.`);
      }

      // If currently armed, append position to trajectory
      if (isArmed) {
        if (!trajectoriesRef.current[vId]) {
          trajectoriesRef.current[vId] = [];
        }

        const path = trajectoriesRef.current[vId];
        const last = path[path.length - 1];
        if (!last || last.lat !== latLng.lat || last.lng !== latLng.lng) {
          path.push(latLng);

          // Update or create the polyline on the map
          if (trajectoryPolylinesRef.current[vId]) {
            trajectoryPolylinesRef.current[vId].setLatLngs(path);
          } else {
            trajectoryPolylinesRef.current[vId] = L.polyline(path, {
              color: "#38bdf8", // Sky blue/cyan
              weight: 3,
              opacity: 0.85,
              dashArray: "5, 5",
            }).addTo(map);
          }
        }
      }

      prevArmedRef.current[vId] = isArmed;
    });
  }, [vehicles]);

  // Clean up all trajectory polylines on unmount
  useEffect(() => {
    return () => {
      Object.values(trajectoryPolylinesRef.current).forEach((polyline) => {
        polyline.remove();
      });
      trajectoryPolylinesRef.current = {};
    };
  }, []);

  // ─── Handlers ─────────────────────────────────────────────
  const locateActiveDrone = () => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null) return;
    const drone = vehicles[activeVehicleId];
    if (drone) {
      map.setView([drone.latitude, drone.longitude], map.getZoom(), {
        animate: true,
        duration: 0.8,
      });
      setIsFollowing(true);
    }
  };

  const fitFlightBounds = () => {
    const map = mapRef.current;
    if (!map) return;
    const points: L.LatLngExpression[] = [];
    Object.values(vehicles).forEach((v) => points.push([v.latitude, v.longitude]));
    waypoints.forEach((wp) => points.push([wp.latitude, wp.longitude]));
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [80, 80] });
    }
  };

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="fullscreen-map-container">
      {/* Leaflet target div */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Map floating controls (left column 2, side-by-side with fly-tools panel) */}
      <div
        style={{
          position: "absolute",
          top: "calc(var(--topbar-h, 40px) + 12px)",
          left: 80,
          zIndex: 400,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: 56,
        }}
      >
        <button
          onClick={() => {
            setIsFollowing((prev) => {
              const next = !prev;
              if (next && activeVehicleId !== null && mapRef.current) {
                const drone = vehicles[activeVehicleId];
                if (drone)
                  mapRef.current.setView(
                    [drone.latitude, drone.longitude],
                    mapRef.current.getZoom(),
                    { animate: true, duration: 0.8 }
                  );
              }
              return next;
            });
          }}
          disabled={activeVehicleId === null}
          className={`btn-map-control ${isFollowing ? "btn-following-active" : ""}`}
          style={{ flexDirection: "column", gap: 2, padding: "5px 4px", fontSize: 8, height: 48, justifyContent: "center", width: "100%" }}
          title={isFollowing ? "Following active drone" : "Auto-follow disabled"}
        >
          {isFollowing ? "🔒" : "🔓"}
          <span style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" }}>
            {isFollowing ? "Follow" : "Manual"}
          </span>
        </button>

        <button
          onClick={locateActiveDrone}
          disabled={activeVehicleId === null}
          className="btn-map-control"
          style={{ flexDirection: "column", gap: 2, padding: "5px 4px", fontSize: 8, height: 48, justifyContent: "center", width: "100%" }}
          title="Center map on active drone"
        >
          🎯
          <span style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" }}>Center</span>
        </button>

        <button
          onClick={fitFlightBounds}
          className="btn-map-control"
          style={{ flexDirection: "column", gap: 2, padding: "5px 4px", fontSize: 8, height: 48, justifyContent: "center", width: "100%" }}
          title="Fit all vehicles and waypoints"
        >
          🔍
          <span style={{ fontSize: 7, fontWeight: 700, textTransform: "uppercase" }}>Fit All</span>
        </button>
      </div>

      {/* Hint label bottom-left */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 76,
          zIndex: 400,
          background: "rgba(8,12,24,0.75)",
          color: "#4a5e78",
          fontFamily: "monospace",
          fontSize: 9,
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid rgba(50,65,90,0.5)",
          backdropFilter: "blur(6px)",
          pointerEvents: "none",
        }}
      >
        Double-click map → add waypoint (Plan mode) • Click drone marker → details
      </div>
    </div>
  );
};
