import React, { useState, useEffect, useRef } from "react";
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
  altitude?: number; // Relative altitude in meters
}

interface MapProps {
  vehicles: { [id: number]: MapVehicle };
  activeVehicleId: number | null;
  waypoints: Waypoint[];
  selectedWpIndex: number | null;
  onWaypointsChange: (wps: Waypoint[]) => void;
  onSelectWp: (idx: number | null) => void;
  isFlyView: boolean;
  onMapGuidedAction?: (action: "go_to" | "orbit", lat: number, lon: number) => void;
}

export const FlightMap: React.FC<MapProps> = ({
  vehicles,
  activeVehicleId,
  waypoints,
  selectedWpIndex,
  onWaypointsChange,
  onSelectWp,
  isFlyView,
  onMapGuidedAction
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

  const isFlyViewRef = useRef(isFlyView);
  isFlyViewRef.current = isFlyView;

  const onMapGuidedActionRef = useRef(onMapGuidedAction);
  onMapGuidedActionRef.current = onMapGuidedAction;

  const [isFollowing, setIsFollowing] = useState(true);
  const lastCenterTimeRef = useRef<number>(0);

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

    // Disable auto-following if the user manually pans the map
    map.on("dragstart", () => {
      setIsFollowing(false);
    });

    // Window resize event handler to invalidate Leaflet map size and scale properly
    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", handleResize);

    map.on("click", (e) => {
      if (isFlyViewRef.current) {
        const { lat, lng } = e.latlng;
        const popupContent = document.createElement("div");
        popupContent.style.minWidth = "120px";
        popupContent.innerHTML = `
          <div style="font-family: monospace; font-size: 10px; font-weight: bold; margin-bottom: 6px; color: #a855f7; border-bottom: 1px solid #3f3f46; padding-bottom: 3px;">GUIDED ACTION</div>
          <button class="popup-btn go-to" style="display: block; width: 100%; text-align: left; background: #1e293b; color: #60a5fa; border: 1px solid #3b82f6; padding: 5px 8px; border-radius: 4px; margin-bottom: 5px; font-size: 10px; cursor: pointer; font-weight: bold;">📍 Go To Here</button>
          <button class="popup-btn orbit" style="display: block; width: 100%; text-align: left; background: #1e293b; color: #ec4899; border: 1px solid #db2777; padding: 5px 8px; border-radius: 4px; font-size: 10px; cursor: pointer; font-weight: bold;">🔄 Orbit Here</button>
        `;

        L.popup({ closeButton: false })
          .setLatLng(e.latlng)
          .setContent(popupContent)
          .openOn(map);

        popupContent.querySelector(".go-to")?.addEventListener("click", () => {
          onMapGuidedActionRef.current?.("go_to", lat, lng);
          map.closePopup();
        });
        popupContent.querySelector(".orbit")?.addEventListener("click", () => {
          onMapGuidedActionRef.current?.("orbit", lat, lng);
          map.closePopup();
        });
      } else {
        onSelectWp(null);
      }
    });

    map.on("dblclick", (e) => {
      if (isFlyViewRef.current) return;
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
      window.removeEventListener("resize", handleResize);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 1.1 Invalidate map size when tab changes to refresh tiles and display full-screen correctly
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 100);
    }
  }, [isFlyView]);

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

      // HTML template for the dynamic following popup
      const popupHtml = `
        <div style="font-family: monospace; font-size: 11px; padding: 4px; line-height: 1.4; color: #f3f4f6; min-width: 140px; background: rgba(15, 23, 42, 0.9); border-radius: 4px;">
          <div style="font-weight: bold; border-bottom: 1px solid #4b5563; padding-bottom: 4px; margin-bottom: 4px; color: ${isActive ? "#10B981" : "#9ca3af"}; display: flex; justify-content: space-between; gap: 8px;">
            <span>Drone #${id}</span>
            <span style="font-size: 10px; background: rgba(59, 130, 246, 0.2); padding: 1px 4px; border-radius: 3px; color: #60a5fa;">${vehicle.mode}</span>
          </div>
          <div>Alt: <span style="font-weight: bold; color: #38bdf8;">${(vehicle.altitude ?? 0.0).toFixed(1)} m</span></div>
          <div>Yaw: <span style="font-weight: bold; color: #fbbf24;">${vehicle.heading}°</span></div>
          <div style="font-size: 10px; color: #9ca3af; margin-top: 2px;">Pos: <span style="color: #a855f7;">${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}</span></div>
        </div>
      `;

      if (!droneMarkersRef.current[id]) {
        const marker = L.marker([vehicle.latitude, vehicle.longitude], { icon: droneIcon }).addTo(map);
        
        // Bind the dynamic popup. leaflet automatically shifts the popup when marker position changes
        marker.bindPopup(popupHtml, {
          closeButton: false,
          closeOnClick: false,
          autoClose: false,
          className: "drone-popup-follow",
          offset: [0, -10]
        });

        droneMarkersRef.current[id] = marker;
        
        // Auto-center map if it's the first time placing the active drone
        if (isActive) {
          map.setView([vehicle.latitude, vehicle.longitude], map.getZoom());
        }
      } else {
        const marker = droneMarkersRef.current[id];
        marker.setLatLng([vehicle.latitude, vehicle.longitude]);
        marker.setIcon(droneIcon);
        // Live update the open popup content
        marker.setPopupContent(popupHtml);
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

  // 4. Center map when active vehicle ID changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null) return;
    
    const activeDrone = vehicles[activeVehicleId];
    if (activeDrone) {
      map.setView([activeDrone.latitude, activeDrone.longitude], map.getZoom(), {
        animate: true,
        duration: 1.0
      });
    }
  }, [activeVehicleId]);

  // 5. Throttled auto-centering to follow active vehicle during flight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || activeVehicleId === null || !isFollowing) return;

    const activeDrone = vehicles[activeVehicleId];
    if (!activeDrone) return;

    const now = Date.now();
    // Throttle centering panTo commands to every 1500ms
    if (now - lastCenterTimeRef.current > 1500) {
      map.panTo([activeDrone.latitude, activeDrone.longitude], {
        animate: true,
        duration: 1.0
      });
      lastCenterTimeRef.current = now;
    }
  }, [vehicles, activeVehicleId, isFollowing]);

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
      // Re-enable following since they manually clicked to locate the drone
      setIsFollowing(true);
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
          onClick={() => {
            setIsFollowing((prev) => {
              const next = !prev;
              if (next && activeVehicleId !== null && mapRef.current) {
                const activeDrone = vehicles[activeVehicleId];
                if (activeDrone) {
                  mapRef.current.setView([activeDrone.latitude, activeDrone.longitude], mapRef.current.getZoom(), {
                    animate: true,
                    duration: 1.0
                  });
                }
              }
              return next;
            });
          }}
          disabled={activeVehicleId === null}
          className={`btn-map-control ${isFollowing ? "btn-following-active" : ""}`}
          title={isFollowing ? "Lock Map Center to Drone" : "Unlock Map Center"}
        >
          {isFollowing ? "🔒 Auto-Center" : "🔓 Manual Pan"}
        </button>
        <button
          onClick={locateActiveDrone}
          disabled={activeVehicleId === null}
          className="btn-map-control"
          title="Locate Active Drone"
        >
          🎯 Center Active
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
