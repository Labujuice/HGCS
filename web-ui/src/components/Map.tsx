import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icon asset paths
// Since Vite changes asset hashes, Leaflet's default marker image URLs can break.
// We override them or use custom div icons.
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

interface MapProps {
  droneLat: number;
  droneLon: number;
  droneHeading: number;
  waypoints: Waypoint[];
  selectedWpIndex: number | null;
  onWaypointsChange: (wps: Waypoint[]) => void;
  onSelectWp: (idx: number | null) => void;
}

export const FlightMap: React.FC<MapProps> = ({
  droneLat,
  droneLon,
  droneHeading,
  waypoints,
  selectedWpIndex,
  onWaypointsChange,
  onSelectWp
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  
  // Keep mutable references of leaflet layers to avoid full redraws on small updates
  const droneMarkerRef = useRef<L.Marker | null>(null);
  const wpMarkersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  
  // Prevent state loop by storing latest props in refs for event handlers
  const wpsStateRef = useRef<Waypoint[]>(waypoints);
  wpsStateRef.current = waypoints;

  // 1. Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Create Leaflet Map
    const map = L.map(mapContainerRef.current, {
      center: [24.7746, 121.0446],
      zoom: 16,
      zoomControl: true,
      doubleClickZoom: false // disable double-click zoom so we can use double-click for adding waypoints
    });

    // Load OpenStreetMap tiles (Service Worker will cache them if online, or read from cache if offline)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Click handler to select nothing when clicking on map background
    map.on("click", () => {
      onSelectWp(null);
    });

    // Double-click handler to add waypoint
    map.on("dblclick", (e) => {
      const { lat, lng } = e.latlng;
      const currentWps = [...wpsStateRef.current];
      
      // Determine command: if first WP, make it TAKEOFF. If RTL exists, insert before RTL.
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
      // If there is an RTL at the end, insert before it
      if (currentWps.length > 0 && currentWps[currentWps.length - 1].command === "RTL") {
        nextWps.splice(currentWps.length - 1, 0, newWp);
      } else {
        nextWps.push(newWp);
      }

      onWaypointsChange(nextWps);
      onSelectWp(nextWps.length - 1);
    });

    mapRef.current = map;

    // Cleanup
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Update Drone Marker Position & Orientation
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const droneIcon = L.divIcon({
      html: `
        <div style="transform: rotate(${droneHeading}deg); display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.5));">
          <!-- Premium glowing drone pointer -->
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L4 22L12 17L20 22L12 2Z" fill="#10B981" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="12" cy="11" r="2.5" fill="#ffffff" />
          </svg>
        </div>
      `,
      className: "drone-marker-div",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (!droneMarkerRef.current) {
      droneMarkerRef.current = L.marker([droneLat, droneLon], { icon: droneIcon }).addTo(map);
      // Auto-pan to drone first time
      map.setView([droneLat, droneLon], map.getZoom());
    } else {
      droneMarkerRef.current.setLatLng([droneLat, droneLon]);
      droneMarkerRef.current.setIcon(droneIcon);
    }
  }, [droneLat, droneLon, droneHeading]);

  // 3. Update Waypoints on the Map (Markers and Polyline)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old waypoint markers
    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current = [];

    // Create new waypoint markers
    waypoints.forEach((wp, index) => {
      const isSelected = index === selectedWpIndex;
      
      // Determine colors based on command type
      let markerColor = "#a855f7"; // purple (WAYPOINT)
      let labelText = (index + 1).toString();
      if (wp.command === "TAKEOFF") {
        markerColor = "#10b981"; // green
        labelText = "🚀";
      } else if (wp.command === "RTL") {
        markerColor = "#ef4444"; // red
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
        draggable: wp.command !== "RTL" // RTL target is typically auto-calculated as home by autopilot, or just placeable
      }).addTo(map);

      // Selected waypoint index click
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e); // prevent map background click from clearing selection
        onSelectWp(index);
      });

      // Drag event handlers
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

    // Draw Polyline connecting waypoints
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    if (waypoints.length > 0) {
      // Connect all waypoints with lines
      const coords = waypoints.map((wp) => [wp.latitude, wp.longitude] as [number, number]);
      
      // If the last waypoint is RTL, we draw line back to the takeoff point (which is usually the home position / waypoint 0)
      if (waypoints[waypoints.length - 1].command === "RTL" && coords.length > 1) {
        coords.push(coords[0]); // connect back to takeoff
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

  // Handle auto-fit bounds button
  const fitFlightBounds = () => {
    const map = mapRef.current;
    if (!map) return;

    const points: L.LatLngExpression[] = [[droneLat, droneLon]];
    waypoints.forEach((wp) => {
      points.push([wp.latitude, wp.longitude]);
    });

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50] });
  };

  return (
    <div className="relative w-full h-400 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden shadow-lg">
      {/* Map Element */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Map overlay controls */}
      <div className="absolute top-2 right-2 z-400 flex flex-col gap-2">
        <button
          onClick={fitFlightBounds}
          className="bg-gray-800 hover:bg-gray-700 text-white font-semibold py-1-5 px-3 rounded shadow text-xs border border-gray-600 transition flex items-center gap-1"
          title="Zoom to Fit Mission"
        >
          🔍 Fit Flight
        </button>
      </div>

      <div className="absolute bottom-2 left-2 z-400 bg-gray-900-90 text-gray-400 font-mono text-xxs p-1-5 rounded border border-gray-700 backdrop-blur-sm pointer-events-none">
        💡 Double-click Map to Add Waypoint • Drag items to move
      </div>
    </div>
  );
};
