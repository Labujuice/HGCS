import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icon asset paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export interface Waypoint {
  command: "TAKEOFF" | "WAYPOINT" | "RTL";
  latitude: number;
  longitude: number;
  altitude: number;
  hold_time?: number; // seconds
}

export interface MapVehicle {
  id: number;
  latitude: number;
  longitude: number;
  heading: number;
  armed: boolean;
  mode: string;
}

interface MapProps {
  vehicles: { [id: number]: MapVehicle };
  activeVehicleId: number | null;
  waypoints: Waypoint[];
  selectedWpIndex: number | null;
  onWaypointsChange: (wps: Waypoint[]) => void;
  onSelectWp: (idx: number | null) => void;
}

export const FlightMap: React.FC<MapProps> = ({
  vehicles,
  activeVehicleId,
  waypoints,
  selectedWpIndex,
  onWaypointsChange,
  onSelectWp
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  
  // Track multiple vehicle markers: vehicleId -> L.Marker
  const droneMarkersRef = useRef<{ [id: number]: L.Marker }>({});
  const wpMarkersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  
  // Keep latest waypoints in ref to avoid effect loops
  const wpsStateRef = useRef<Waypoint[]>(waypoints);
  wpsStateRef.current = waypoints;

  // 1. Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [24.7746, 121.0446],
      zoom: 16,
      zoomControl: false, // Hide default zoom, we will put it in custom location
      doubleClickZoom: false
    });

    // Dark-themed tiles for premium QGC-like experience (CartoDB Dark Matter)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      attribution: '© OpenStreetMap contributors © CARTO'
    }).addTo(map);

    // Re-add Zoom control at custom position (bottom-right) to keep UI clean
    L.control.zoom({ position: "bottomright" }).addTo(map);

    map.on("click", () => {
      onSelectWp(null);
    });

    map.on("dblclick", (e) => {
      const { lat, lng } = e.latlng;
      const currentWps = [...wpsStateRef.current];
      
      let command: "TAKEOFF" | "WAYPOINT" | "RTL" = "WAYPOINT";
      if (currentWps.length === 0) {
        command = "TAKEOFF";
      }
      
      const newWp: Waypoint = {
        command,
        latitude: parseFloat(lat.toFixed(6)),
        longitude: parseFloat(lng.toFixed(6)),
        altitude: command === "TAKEOFF" ? 30.0 : 50.0,
        hold_time: command === "WAYPOINT" ? 5 : undefined
      };

      let nextWps = [...currentWps];
      if (currentWps.length > 0 && currentWps[currentWps.length - 1].command === "RTL") {
        nextWps.splice(currentWps.length - 1, 0, newWp);
      } else {
        nextWps.push(newWp);
      }

      onWaypointsChange(nextWps);
      onSelectWp(nextWps.length - 1);
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Render Drone Markers (Support Multiple Vehicles)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Get list of active ids in props
    const incomingIds = Object.keys(vehicles).map(Number);

    // Remove any markers of vehicles that no longer exist
    Object.keys(droneMarkersRef.current).forEach((idStr) => {
      const id = Number(idStr);
      if (!incomingIds.includes(id)) {
        droneMarkersRef.current[id].remove();
        delete droneMarkersRef.current[id];
      }
    });

    // Draw / update markers
    incomingIds.forEach((id) => {
      const vehicle = vehicles[id];
      const isActive = id === activeVehicleId;
      
      // Active drone glows emerald, inactive drone is steel blue
      const droneColor = isActive ? "#10B981" : "#6B7280";
      const glowStyle = isActive ? "filter: drop-shadow(0 0 8px #10B981);" : "";
      
      const droneIcon = L.divIcon({
        html: `
          <div style="transform: rotate(${vehicle.heading}deg); display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; ${glowStyle}">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L3 22L12 17L21 22L12 2Z" fill="${droneColor}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
              <circle cx="12" cy="11" r="2.5" fill="#ffffff" />
            </svg>
            <div style="
              position: absolute;
              top: -8px;
              background: ${droneColor};
              color: white;
              font-family: monospace;
              font-size: 8px;
              font-weight: bold;
              padding: 1px 3px;
              border-radius: 3px;
              border: 1px solid white;
              transform: rotate(${-vehicle.heading}deg);
            ">
              #${id}
            </div>
          </div>
        `,
        className: "drone-marker-div",
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      if (!droneMarkersRef.current[id]) {
        droneMarkersRef.current[id] = L.marker([vehicle.latitude, vehicle.longitude], { icon: droneIcon }).addTo(map);
        
        // Auto-center map if it's the first time placing the active drone
        if (isActive) {
          map.setView([vehicle.latitude, vehicle.longitude], map.getZoom());
        }
      } else {
        droneMarkersRef.current[id].setLatLng([vehicle.latitude, vehicle.longitude]);
        droneMarkersRef.current[id].setIcon(droneIcon);
      }
    });

  }, [vehicles, activeVehicleId]);

  // 3. Render Waypoint Markers & Paths
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current = [];

    waypoints.forEach((wp, index) => {
      const isSelected = index === selectedWpIndex;
      let markerColor = "#a855f7"; 
      let labelText = (index + 1).toString();
      
      if (wp.command === "TAKEOFF") {
        markerColor = "#10b981"; 
        labelText = "🚀";
      } else if (wp.command === "RTL") {
        markerColor = "#ef4444"; 
        labelText = "🏠";
      }

      const wpIcon = L.divIcon({
        html: `
          <div style="
            background: ${markerColor};
            border: 2px solid ${isSelected ? '#ffffff' : 'rgba(255,255,255,0.7)'};
            box-shadow: ${isSelected ? '0 0 10px 3px ' + markerColor : '0 2px 4px rgba(0,0,0,0.3)'};
            color: white;
            border-radius: 50%;
            width: 26px;
            height: 26px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 11px;
            font-family: monospace;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            transform: ${isSelected ? 'scale(1.2)' : 'scale(1)'};
          ">
            ${labelText}
          </div>
        `,
        className: "wp-marker-div",
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker([wp.latitude, wp.longitude], {
        icon: wpIcon,
        draggable: wp.command !== "RTL"
      }).addTo(map);

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectWp(index);
      });

      marker.on("dragend", () => {
        const newLatLng = marker.getLatLng();
        const updatedWps = [...wpsStateRef.current];
        updatedWps[index] = {
          ...updatedWps[index],
          latitude: parseFloat(newLatLng.lat.toFixed(6)),
          longitude: parseFloat(newLatLng.lng.toFixed(6))
        };
        onWaypointsChange(updatedWps);
      });

      wpMarkersRef.current.push(marker);
    });

    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    if (waypoints.length > 0) {
      const coords = waypoints.map((wp) => [wp.latitude, wp.longitude] as [number, number]);
      if (waypoints[waypoints.length - 1].command === "RTL" && coords.length > 1) {
        coords.push(coords[0]);
      }

      polylineRef.current = L.polyline(coords, {
        color: "#a855f7",
        weight: 3,
        opacity: 0.8,
        dashArray: "6, 8",
        lineJoin: "round"
      }).addTo(map);
    }
  }, [waypoints, selectedWpIndex]);

  // Center/Pan view to active drone
  const locateActiveDrone = () => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null) return;
    
    const activeDrone = vehicles[activeVehicleId];
    if (activeDrone) {
      map.setView([activeDrone.latitude, activeDrone.longitude], map.getZoom(), {
        animate: true,
        duration: 1.0
      });
    }
  };

  // Center/Pan view to fit all waypoints and drones
  const fitFlightBounds = () => {
    const map = mapRef.current;
    if (!map) return;

    const points: L.LatLngExpression[] = [];
    Object.values(vehicles).forEach((v) => {
      points.push([v.latitude, v.longitude]);
    });
    waypoints.forEach((wp) => {
      points.push([wp.latitude, wp.longitude]);
    });

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [80, 80] });
    }
  };

  return (
    <div className="fullscreen-map-container">
      {/* Map Target Container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Map Panel Controls (QGC Style) */}
      <div className="absolute top-24 left-4 z-400 flex flex-col gap-2.5">
        <button
          onClick={locateActiveDrone}
          disabled={activeVehicleId === null}
          className="btn-map-control"
          title="Locate Active Drone"
        >
          🎯 Locate Drone
        </button>
        <button
          onClick={fitFlightBounds}
          className="btn-map-control"
          title="Zoom to Fit Mission"
        >
          🔍 Fit Bounds
        </button>
      </div>

      <div className="absolute bottom-6 left-4 z-400 bg-gray-950-90 text-gray-400 font-mono text-xxs p-2 rounded border border-gray-800 backdrop-blur-sm pointer-events-none shadow-lg">
        💡 Double-click Map to Add Waypoint • Drag items to move • Selected Drone highlighted in Green
      </div>
    </div>
  );
};
