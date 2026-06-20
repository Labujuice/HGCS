import { useState, useEffect, useRef } from "react";
import { PFD } from "./components/PFD";
import { FlightMap } from "./components/Map";
import type { Waypoint, MapVehicle } from "./components/Map";
import { 
  Play, 
  Square, 
  Upload, 
  Trash2, 
  Layers, 
  TrendingUp, 
  Battery, 
  Compass, 
  Navigation,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Settings,
  Plus
} from "lucide-react";
import "./App.css";

// Generate a random unique mission UUID
const generateUUID = () => {
  return "mission_uuid_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
};

interface VehicleTelemetry {
  timestamp: number;
  vehicle_id: number;
  status: {
    armed: boolean;
    mode: string;
    battery_percent: number;
    battery_voltage: number;
    gps_satellites: number;
    gps_fix_type: number;
  };
  pose: {
    roll: number;
    pitch: number;
    yaw: number;
    heading: number;
  };
  navigation: {
    latitude: number;
    longitude: number;
    relative_altitude: number;
    airspeed: number;
    groundspeed: number;
  };
}

function App() {
  // Connection states
  const [wsUrl, setWsUrl] = useState("ws://127.0.0.1:8080");
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  
  // View mode tab state: "fly" | "plan" | "setup"
  const [viewMode, setViewMode] = useState<"fly" | "plan" | "setup">("fly");
  
  // Slide to confirm actions state
  const [sliderAction, setSliderAction] = useState<{ type: string; label: string; data?: any } | null>(null);
  const [sliderValue, setSliderValue] = useState(0);
  
  // Connection Settings dropdown state
  const [gatewayLinks, setGatewayLinks] = useState<string[]>([]);
  
  // Form state for adding downstream connection
  const [newLinkType, setNewLinkType] = useState<"udp" | "tcp" | "serial">("udp");
  const [udpPort, setUdpPort] = useState(14540);
  const [tcpHost, setTcpHost] = useState("127.0.0.1");
  const [tcpPort, setTcpPort] = useState(5760);
  const [serialPort, setSerialPort] = useState("/dev/ttyUSB0");
  const [serialBaud, setSerialBaud] = useState(57600);

  // Multi-Vehicle states
  const [activeVehicleId, setActiveVehicleId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<{ [id: number]: MapVehicle & { fullData: VehicleTelemetry } }>({});

  // Waypoints state (per vehicle)
  // We can track waypoints for all vehicles, indexed by vehicleId
  const [vehicleWaypoints, setVehicleWaypoints] = useState<{ [id: number]: Waypoint[] }>({});
  const [selectedWpIndex, setSelectedWpIndex] = useState<number | null>(null);

  // Mission upload status (per vehicle)
  const [missionStatuses, setMissionStatuses] = useState<{
    [id: number]: {
      mission_id: string;
      state: string;
      progress: number;
      message: string;
    };
  }>({});

  const wsRef = useRef<WebSocket | null>(null);
  const simTimerRef = useRef<number | null>(null);

  // Get active vehicle telemetry
  const activeVehicle = activeVehicleId !== null ? vehicles[activeVehicleId] : null;
  const telemetry = activeVehicle ? activeVehicle.fullData : {
    timestamp: Date.now(),
    vehicle_id: 0,
    status: { armed: false, mode: "DISCONNECTED", battery_percent: 0, battery_voltage: 0.0, gps_satellites: 0, gps_fix_type: 0 },
    pose: { roll: 0.0, pitch: 0.0, yaw: 0.0, heading: 0 },
    navigation: { latitude: 24.7746, longitude: 121.0446, relative_altitude: 0.0, airspeed: 0.0, groundspeed: 0.0 }
  };

  // Get active vehicle waypoints
  const waypoints = (activeVehicleId !== null && vehicleWaypoints[activeVehicleId]) || [];

  // Get active vehicle mission upload status
  const missionStatus = (activeVehicleId !== null && missionStatuses[activeVehicleId]) || {
    mission_id: "",
    state: "IDLE",
    progress: 0,
    message: "No mission uploaded yet"
  };

  // Keep references to access inside simulator timer callback
  const wpsRef = useRef<{ [id: number]: Waypoint[] }>({});
  useEffect(() => {
    wpsRef.current = vehicleWaypoints;
  }, [vehicleWaypoints]);

  // Keep references for simulator target control state
  const simControlsRef = useRef<{
    [id: number]: {
      lat: number;
      lon: number;
      alt: number;
      yaw: number;
      armed: boolean;
      mode: string;
      batteryVolts: number;
      targetWpIndex: number;
      flying: boolean;
      targetLat?: number;
      targetLon?: number;
      targetAlt?: number;
      orbitRadius?: number;
      orbitAngle?: number;
    };
  }>({
    1: { lat: 24.7746, lon: 121.0446, alt: 0.0, yaw: 90.0, armed: false, mode: "HOLD", batteryVolts: 25.2, targetWpIndex: 0, flying: false },
    2: { lat: 24.7760, lon: 121.0465, alt: 0.0, yaw: 180.0, armed: false, mode: "HOLD", batteryVolts: 24.8, targetWpIndex: 0, flying: false }
  });

  // --- 1. LOCAL TELEMETRY SIMULATOR (MOCK MULTI-DRONE) ---
  const startLocalSimulator = () => {
    if (isConnected) {
      alert("Please disconnect from Gateway first.");
      return;
    }
    
    setIsSimulating(true);
    
    // Auto-setup simulated vehicle structures
    const initVehicles = {
      1: { id: 1, latitude: 24.7746, longitude: 121.0446, heading: 90, armed: false, mode: "HOLD", fullData: createEmptyTelemetry(1, 24.7746, 121.0446) },
      2: { id: 2, latitude: 24.7760, longitude: 121.0465, heading: 180, armed: false, mode: "HOLD", fullData: createEmptyTelemetry(2, 24.7760, 121.0465) }
    };
    setVehicles(initVehicles);
    setActiveVehicleId(1);
    setViewMode("fly"); // Auto-switch to Fly tab when starting simulator

    if (simTimerRef.current) clearInterval(simTimerRef.current);
    let tick = 0;

    simTimerRef.current = window.setInterval(() => {
      const activeWpsMap = wpsRef.current;
      const updatedVehicles = { ...initVehicles };

      // Update both simulated drones
      [1, 2].forEach((vid) => {
        const state = simControlsRef.current[vid];
        const activeWps = activeWpsMap[vid] || [];
        
        let groundspeed = 0.0;
        let airspeed = 0.0;
        let pitch = 0.0;
        let roll = 0.0;

        if (state.flying && state.mode === "TAKEOFF") {
          const targetAlt = state.targetAlt || 10.0;
          const dAlt = targetAlt - state.alt;
          if (dAlt > 0.1) {
            state.alt += 0.3;
            pitch = 7.0;
            groundspeed = 1.0;
          } else {
            pitch = 0.0;
            state.mode = "HOLD";
          }
        } else if (state.flying && state.mode === "LAND") {
          if (state.alt > 0.1) {
            state.alt -= 0.2;
            pitch = -7.5;
            groundspeed = 0.5;
          } else {
            state.alt = 0.0;
            state.flying = false;
            state.armed = false;
            state.mode = "HOLD";
            pitch = 0.0;
          }
        } else if (state.flying && state.mode === "RTL") {
          const homeLat = vid === 1 ? 24.7746 : 24.7760;
          const homeLon = vid === 1 ? 121.0446 : 121.0465;
          const dy = homeLat - state.lat;
          const dx = homeLon - state.lon;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist > 0.00005) {
            groundspeed = vid === 1 ? 11.5 : 9.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
            
            const dAlt = 15.0 - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else {
              pitch = 0.0;
            }
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
            state.mode = "LAND";
          }
        } else if (state.flying && state.mode === "GO_TO") {
          const targetLat = state.targetLat || state.lat;
          const targetLon = state.targetLon || state.lon;
          const targetAlt = state.targetAlt || 10.0;
          const dy = targetLat - state.lat;
          const dx = targetLon - state.lon;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist > 0.00005) {
            groundspeed = vid === 1 ? 11.5 : 9.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
            
            const dAlt = targetAlt - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else {
              pitch = 0.0;
            }
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
            state.mode = "HOLD";
            groundspeed = 0.0;
            pitch = 0.0;
          }
        } else if (state.flying && state.mode === "ORBIT") {
          const centerLat = state.targetLat || state.lat;
          const centerLon = state.targetLon || state.lon;
          const targetAlt = state.targetAlt || 10.0;
          const radius = state.orbitRadius || 20.0;
          let angle = state.orbitAngle || 0.0;

          const r_lat_deg = radius * 0.000009;
          const r_lon_deg = radius * 0.000010;
          const targetLatOnEdge = centerLat + r_lat_deg * Math.cos(angle);
          const targetLonOnEdge = centerLon + r_lon_deg * Math.sin(angle);

          const dy = targetLatOnEdge - state.lat;
          const dx = targetLonOnEdge - state.lon;
          const dist = Math.sqrt(dx*dx + dy*dy);

          if (dist > 0.00005) {
            groundspeed = vid === 1 ? 11.5 : 9.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
            groundspeed = 5.0;
            airspeed = groundspeed;
            angle += 0.05;
            state.orbitAngle = angle;
            state.lat = centerLat + r_lat_deg * Math.cos(angle);
            state.lon = centerLon + r_lon_deg * Math.sin(angle);
            state.yaw = (angle * 180 / Math.PI + 90) % 360;
            roll = 8.0;
          }

          const dAlt = targetAlt - state.alt;
          if (Math.abs(dAlt) > 0.5) {
            state.alt += Math.sign(dAlt) * 0.2;
            pitch = dAlt > 0 ? 5.5 : -5.5;
          } else {
            pitch = 0.0;
          }
        } else if (state.flying && state.mode === "MISSION" && activeWps.length > 0 && state.targetWpIndex < activeWps.length) {
          const wp = activeWps[state.targetWpIndex];
          let targetLat = wp.latitude;
          let targetLon = wp.longitude;
          let targetAlt = wp.altitude;

          if (wp.command === "RTL") {
            targetLat = vid === 1 ? 24.7746 : 24.7760;
            targetLon = vid === 1 ? 121.0446 : 121.0465;
            targetAlt = 0.0;
          }

          const dy = targetLat - state.lat;
          const dx = targetLon - state.lon;
          const dist = Math.sqrt(dx*dx + dy*dy);

          if (dist > 0.00005) {
            groundspeed = vid === 1 ? 11.5 : 9.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

            const dAlt = targetAlt - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else {
              pitch = 0.0;
            }
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
            // Arrived at waypoint
            if (wp.command === "RTL" && state.alt < 0.5) {
              state.flying = false;
              state.armed = false;
              state.mode = "HOLD";
              state.alt = 0.0;
            } else {
              state.targetWpIndex++;
              if (state.targetWpIndex >= activeWps.length) {
                state.flying = false;
                state.mode = "HOLD";
              }
            }
          }
        } else {
          roll = 0.5 * Math.sin(tick * 0.05 + vid);
          pitch = 0.3 * Math.cos(tick * 0.07 - vid);
        }

        if (state.armed) {
          state.batteryVolts = Math.max(18.0, state.batteryVolts - (state.flying ? 0.001 : 0.0002));
        }
        const batteryPercent = Math.round(((state.batteryVolts - 18.0) / (25.2 - 18.0)) * 100);

        updatedVehicles[vid as 1 | 2] = {
          id: vid,
          latitude: state.lat,
          longitude: state.lon,
          heading: Math.round(state.yaw),
          armed: state.armed,
          mode: state.mode,
          fullData: {
            timestamp: Date.now(),
            vehicle_id: vid,
            status: {
              armed: state.armed,
              mode: state.mode,
              battery_percent: batteryPercent,
              battery_voltage: parseFloat(state.batteryVolts.toFixed(1)),
              gps_satellites: state.armed ? 18 : 12,
              gps_fix_type: 4
            },
            pose: {
              roll,
              pitch,
              yaw: state.yaw,
              heading: Math.round(state.yaw)
            },
            navigation: {
              latitude: state.lat,
              longitude: state.lon,
              relative_altitude: parseFloat(state.alt.toFixed(1)),
              airspeed,
              groundspeed
            }
          }
        };
      });

      tick++;
      setVehicles(updatedVehicles);
    }, 50); // 20Hz
  };

  const stopLocalSimulator = () => {
    setIsSimulating(false);
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setVehicles({});
    setActiveVehicleId(null);
  };

  const createEmptyTelemetry = (vid: number, lat: number, lon: number): VehicleTelemetry => {
    return {
      timestamp: Date.now(),
      vehicle_id: vid,
      status: { armed: false, mode: "HOLD", battery_percent: 100, battery_voltage: 25.2, gps_satellites: 12, gps_fix_type: 4 },
      pose: { roll: 0.0, pitch: 0.0, yaw: 0.0, heading: 0 },
      navigation: { latitude: lat, longitude: lon, relative_altitude: 0.0, airspeed: 0.0, groundspeed: 0.0 }
    };
  };

  // --- 2. WEBSOCKET GATEWAY INTERFACE ---
  const connectToGateway = () => {
    if (isSimulating) {
      alert("Please stop the Local Simulator first.");
      return;
    }

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log("[WS] Connected to HGCS Gateway");
      };

      wsRef.current.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          if (payload.type === "telemetry") {
            const vId = payload.vehicle_id || 1;
            setVehicles(prev => ({
              ...prev,
              [vId]: {
                id: vId,
                latitude: payload.data.navigation.latitude,
                longitude: payload.data.navigation.longitude,
                heading: payload.data.pose.heading,
                armed: payload.data.status.armed,
                mode: payload.data.status.mode,
                fullData: payload.data
              }
            }));
            
            // Auto-select first discovered vehicle and switch to fly mode
            setActiveVehicleId(prev => {
              if (prev === null) {
                setViewMode("fly");
                return vId;
              }
              return prev;
            });
            
          } else if (payload.type === "mission_status") {
            const vId = payload.vehicle_id || 1;
            setMissionStatuses(prev => ({
              ...prev,
              [vId]: payload.data
            }));
          } else if (payload.type === "links_list") {
            setGatewayLinks(payload.data || []);
          }
        } catch (err) {
          console.warn("[WS] Error decoding message: ", err);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        setVehicles({});
        setActiveVehicleId(null);
        console.log("[WS] Disconnected from HGCS Gateway");
      };

      wsRef.current.onerror = (err) => {
        console.error("[WS] Error: ", err);
        setIsConnected(false);
      };
    } catch (e) {
      alert("Failed to connect: " + e);
    }
  };

  const disconnectFromGateway = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // --- 3. COMMAND TRANSMITTERS WITH SLIDE TO CONFIRM ---
  const initiateSliderAction = (type: string, label: string, data?: any) => {
    setSliderAction({ type, label, data });
    setSliderValue(0);
  };

  const executeSliderAction = (action: { type: string; label: string; data?: any }) => {
    if (activeVehicleId === null) return;
    const vId = activeVehicleId;
    const { type, data } = action;

    if (isSimulating) {
      const state = simControlsRef.current[vId];
      if (state) {
        if (type === "arm") {
          state.armed = data.armed;
          if (!data.armed) {
            state.flying = false;
            state.alt = 0.0;
          }
        } else if (type === "takeoff") {
          state.armed = true;
          state.flying = true;
          state.mode = "TAKEOFF";
          state.targetAlt = 10.0;
        } else if (type === "land") {
          state.mode = "LAND";
        } else if (type === "rtl") {
          state.mode = "RTL";
          state.flying = true;
        } else if (type === "pause") {
          state.mode = "HOLD";
          state.flying = false;
        } else if (type === "go_to") {
          state.mode = "GO_TO";
          state.flying = true;
          state.targetLat = data.latitude;
          state.targetLon = data.longitude;
          state.targetAlt = state.alt > 1.0 ? state.alt : 10.0;
        } else if (type === "orbit") {
          state.mode = "ORBIT";
          state.flying = true;
          state.targetLat = data.latitude;
          state.targetLon = data.longitude;
          state.targetAlt = state.alt > 1.0 ? state.alt : 10.0;
          state.orbitRadius = 20.0;
          state.orbitAngle = 0.0;
        } else if (type === "set_mode") {
          state.mode = data.mode;
          if (data.mode === "MISSION" && state.armed) {
            state.flying = true;
            state.targetWpIndex = 0;
          }
        }
      }
      return;
    }

    if (!isConnected || !wsRef.current) {
      alert("Gateway not connected!");
      return;
    }

    if (type === "arm") {
      wsRef.current.send(JSON.stringify({
        action: "arm",
        data: { vehicle_id: vId, armed: data.armed }
      }));
    } else if (type === "takeoff") {
      wsRef.current.send(JSON.stringify({
        action: "takeoff",
        data: { vehicle_id: vId, altitude: 10.0 }
      }));
    } else if (type === "land") {
      wsRef.current.send(JSON.stringify({
        action: "land",
        data: { vehicle_id: vId }
      }));
    } else if (type === "rtl") {
      wsRef.current.send(JSON.stringify({
        action: "rtl",
        data: { vehicle_id: vId }
      }));
    } else if (type === "pause") {
      wsRef.current.send(JSON.stringify({
        action: "pause",
        data: { vehicle_id: vId }
      }));
    } else if (type === "go_to") {
      wsRef.current.send(JSON.stringify({
        action: "go_to",
        data: { vehicle_id: vId, latitude: data.latitude, longitude: data.longitude, altitude: telemetry.navigation.relative_altitude > 1.0 ? telemetry.navigation.relative_altitude : 10.0 }
      }));
    } else if (type === "orbit") {
      wsRef.current.send(JSON.stringify({
        action: "orbit",
        data: { vehicle_id: vId, latitude: data.latitude, longitude: data.longitude, altitude: telemetry.navigation.relative_altitude > 1.0 ? telemetry.navigation.relative_altitude : 10.0, radius: 20.0 }
      }));
    } else if (type === "set_mode") {
      wsRef.current.send(JSON.stringify({
        action: "set_mode",
        data: { vehicle_id: vId, mode: data.mode }
      }));
    }
  };

  const sendMissionUpload = () => {
    if (activeVehicleId === null) return;
    if (waypoints.length === 0) {
      alert("Please plan some waypoints first.");
      return;
    }

    const mId = generateUUID();
    setMissionStatuses(prev => ({
      ...prev,
      [activeVehicleId]: {
        mission_id: mId,
        state: "UPLOADING",
        progress: 0,
        message: "Initiating upload..."
      }
    }));

    if (isSimulating) {
      let prog = 0;
      const interval = setInterval(() => {
        prog += 25;
        if (prog < 100) {
          setMissionStatuses(prev => ({
            ...prev,
            [activeVehicleId]: {
              mission_id: mId,
              state: "UPLOADING",
              progress: prog,
              message: `Uploading waypoint count: ${waypoints.length}`
            }
          }));
        } else {
          clearInterval(interval);
          setMissionStatuses(prev => ({
            ...prev,
            [activeVehicleId]: {
              mission_id: mId,
              state: "SUCCESS",
              progress: 100,
              message: "Simulated load completed."
            }
          }));
          
          const state = simControlsRef.current[activeVehicleId];
          if (state) {
            state.targetWpIndex = 0;
          }
        }
      }, 250);
      return;
    }

    if (!isConnected || !wsRef.current) {
      alert("Gateway not connected!");
      return;
    }

    wsRef.current.send(JSON.stringify({
      action: "upload_mission",
      data: {
        vehicle_id: activeVehicleId,
        mission_id: mId,
        waypoints: waypoints
      }
    }));
  };

  // Add connections inside downstream gateway
  const addDownstreamLink = () => {
    if (!isConnected || !wsRef.current) {
      alert("Please connect WebSocket to Gateway first.");
      return;
    }

    const data: any = { type: newLinkType };
    if (newLinkType === "udp") {
      data.port = udpPort;
    } else if (newLinkType === "tcp") {
      data.host = tcpHost;
      data.port = tcpPort;
    } else if (newLinkType === "serial") {
      data.port = serialPort;
      data.baud = serialBaud;
    }

    wsRef.current.send(JSON.stringify({
      action: "add_connection",
      data
    }));

    alert(`Requested Gateway to connect via ${newLinkType.toUpperCase()}...`);
  };

  // --- 4. WAYPOINT OPERATIONS ---
  const handleWaypointsChange = (newWps: Waypoint[]) => {
    if (activeVehicleId === null) return;
    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: newWps
    }));
  };

  const handleSelectWp = (idx: number | null) => {
    setSelectedWpIndex(idx);
  };

  const loadSampleMission = () => {
    if (activeVehicleId === null) return;
    
    // Preset coordinates matching vehicle 1 or 2 starting points
    const baseLat = activeVehicleId === 1 ? 24.7746 : 24.7760;
    const baseLon = activeVehicleId === 1 ? 121.0446 : 121.0465;

    const demoWaypoints: Waypoint[] = [
      { command: "TAKEOFF", latitude: baseLat + 0.0002, longitude: baseLon, altitude: 30.0 },
      { command: "WAYPOINT", latitude: baseLat + 0.0012, longitude: baseLon + 0.0012, altitude: 45.0, hold_time: 5 },
      { command: "WAYPOINT", latitude: baseLat + 0.0022, longitude: baseLon, altitude: 55.0, hold_time: 8 },
      { command: "WAYPOINT", latitude: baseLat + 0.0006, longitude: baseLon - 0.0012, altitude: 35.0, hold_time: 5 },
      { command: "RTL", latitude: baseLat, longitude: baseLon, altitude: 0.0 }
    ];

    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: demoWaypoints
    }));
    setSelectedWpIndex(0);
  };

  const clearWaypoints = () => {
    if (activeVehicleId === null) return;
    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: []
    }));
    setSelectedWpIndex(null);
  };

  const updateSelectedWpField = (field: keyof Waypoint, value: any) => {
    if (activeVehicleId === null || selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated[selectedWpIndex] = {
      ...updated[selectedWpIndex],
      [field]: value
    };
    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: updated
    }));
  };

  const removeSelectedWp = () => {
    if (activeVehicleId === null || selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated.splice(selectedWpIndex, 1);
    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: updated
    }));
    setSelectedWpIndex(null);
  };

  const moveSelectedWp = (direction: "up" | "down") => {
    if (activeVehicleId === null || selectedWpIndex === null) return;
    const targetIdx = direction === "up" ? selectedWpIndex - 1 : selectedWpIndex + 1;
    if (targetIdx < 0 || targetIdx >= waypoints.length) return;
    
    const updated = [...waypoints];
    const temp = updated[selectedWpIndex];
    updated[selectedWpIndex] = updated[targetIdx];
    updated[targetIdx] = temp;
    
    setVehicleWaypoints(prev => ({
      ...prev,
      [activeVehicleId]: updated
    }));
    setSelectedWpIndex(targetIdx);
  };

  const selectedWp = selectedWpIndex !== null ? waypoints[selectedWpIndex] : null;
  const vehicleList = Object.keys(vehicles).map(Number);

  return (
    <div className="app-container">
      {/* 1. Immersive Fullscreen Background Map */}
      <FlightMap
        vehicles={vehicles}
        activeVehicleId={activeVehicleId}
        waypoints={waypoints}
        selectedWpIndex={selectedWpIndex}
        onWaypointsChange={handleWaypointsChange}
        onSelectWp={handleSelectWp}
        isFlyView={viewMode === "fly"}
        onMapGuidedAction={(action, lat, lng) => 
          initiateSliderAction(action, action === "go_to" ? "Guided Reposition (Go To)" : "Guided Orbit Center", { latitude: lat, longitude: lng })
        }
      />

      {/* 2. Floating Glassmorphic Overlay UI Elements */}
      <div className="floating-overlay-container">
        
        {/* Floating Header */}
        <header className="header-overlay">
          {/* Logo & Branding */}
          <div className="flex items-center gap-3">
            <div className="bg-sky-500-10 border border-sky-500-30 p-1-5 rounded-lg text-sky-400">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white m-0">HGCS</h1>
              <p className="text-xxs text-gray-400 font-mono m-0">HTML Ground Control Station</p>
            </div>
          </div>

          {/* View Toggles (FLY, PLAN, SETUP) */}
          <div className="view-toggles">
            <button
              onClick={() => {
                setViewMode("fly");
                setSelectedWpIndex(null);
              }}
              className={`view-toggle-btn ${viewMode === "fly" ? "active" : ""}`}
            >
              Fly
            </button>
            <button
              onClick={() => {
                setViewMode("plan");
                setSelectedWpIndex(null);
              }}
              className={`view-toggle-btn ${viewMode === "plan" ? "active" : ""}`}
            >
              Plan
            </button>
            <button
              onClick={() => {
                setViewMode("setup");
                setSelectedWpIndex(null);
              }}
              className={`view-toggle-btn ${viewMode === "setup" ? "active" : ""}`}
            >
              Setup
            </button>
          </div>

          {/* Active vehicle switcher and Settings deck */}
          <div className="flex items-center gap-4">
            
            {/* Vehicle Switcher dropdown */}
            {vehicleList.length > 0 && (
              <div className="flex items-center gap-2 bg-gray-950/70 px-3 py-1 rounded border border-gray-800">
                <span className="text-[9px] font-mono text-gray-500">VEHICLE:</span>
                <select
                  value={activeVehicleId || ""}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setActiveVehicleId(val);
                    setSelectedWpIndex(null);
                  }}
                  className="bg-gray-900 border border-gray-700 text-xs px-2 py-0.5 rounded text-emerald-400 font-mono font-bold focus:outline-none"
                >
                  {vehicleList.map((id) => (
                    <option key={id} value={id}>
                      #{id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* QGC Status Badges */}
            {activeVehicleId !== null && (
              <div className="header-badges-deck">
                {/* Armed state badge */}
                <div className="header-badge">
                  <span className="header-badge-label">Motor:</span>
                  <span className={`header-badge-val ${telemetry.status.armed ? "text-emerald-400" : "text-rose-500"}`}>
                    {telemetry.status.armed ? "ARMED" : "DISARMED"}
                  </span>
                </div>

                {/* Mode badge */}
                <div className="header-badge">
                  <span className="header-badge-label">Mode:</span>
                  <span className="header-badge-val text-sky-400">
                    {telemetry.status.mode}
                  </span>
                </div>

                {/* Battery badge */}
                <div className="header-badge">
                  <Battery className="w-3.5 h-3.5 text-yellow-500" />
                  <span className="header-badge-val">{telemetry.status.battery_percent}%</span>
                  <span className="text-[9px] text-gray-500 ml-1">({telemetry.status.battery_voltage.toFixed(1)}V)</span>
                </div>

                {/* GPS badge */}
                <div className="header-badge">
                  <Compass className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="header-badge-val">{telemetry.status.gps_satellites} Sats</span>
                  <span className="text-[9px] text-gray-500 ml-1">(Fix {telemetry.status.gps_fix_type})</span>
                </div>
              </div>
            )}

            {/* Quick Status indicators */}
            <div className="flex items-center gap-3">
              <span className={`status-badge ${isConnected ? "status-armed" : isSimulating ? "bg-purple-900-60 text-purple-200" : "status-disarmed"}`}>
                {isConnected ? "GATEWAY LINK" : isSimulating ? "SIMULATOR" : "DISCONNECTED"}
              </span>
            </div>

            {/* Setup Connections Menu Trigger */}
            <button
              onClick={() => setViewMode("setup")}
              className={`btn btn-secondary flex items-center gap-1.5 ${viewMode === "setup" ? "text-sky-400 border-sky-500 bg-sky-500-10" : ""}`}
              id="btn-settings-toggle"
            >
              <Settings className="w-4 h-4" /> Link Setup
            </button>
          </div>
        </header>

        {/* ================================================================= */}
        {/* 2.1 FLY VIEW LAYOUT                                              */}
        {/* ================================================================= */}
        {viewMode === "fly" && (
          <>
            {/* Left QGC-style Guided Fly Tools sidebar */}
            {activeVehicleId !== null && (
              <div className="fly-tools-panel">
                {/* Arm / Disarm Tool */}
                <button
                  onClick={() => initiateSliderAction("arm", telemetry.status.armed ? "Disarm Propulsion Motors" : "Arm Propulsion Motors", { armed: !telemetry.status.armed })}
                  className={`fly-tool-btn ${telemetry.status.armed ? "danger" : ""}`}
                  title="Arm/Disarm Motors"
                >
                  <Play className={`w-5 h-5 ${telemetry.status.armed ? "rotate-90 text-rose-500" : "text-emerald-400"}`} />
                  <span className="fly-tool-btn-label">{telemetry.status.armed ? "Disarm" : "Arm"}</span>
                </button>

                {/* Guided Takeoff Tool */}
                <button
                  onClick={() => initiateSliderAction("takeoff", "Drone Takeoff", {})}
                  disabled={telemetry.navigation.relative_altitude > 1.0}
                  className="fly-tool-btn"
                  title="Take Off"
                >
                  <Upload className="w-5 h-5 text-sky-400" />
                  <span className="fly-tool-btn-label">Takeoff</span>
                </button>

                {/* Guided Land Tool */}
                <button
                  onClick={() => initiateSliderAction("land", "Drone Land", {})}
                  disabled={telemetry.navigation.relative_altitude <= 1.0}
                  className="fly-tool-btn"
                  title="Land at current location"
                >
                  <Square className="w-5 h-5 text-rose-400" />
                  <span className="fly-tool-btn-label">Land</span>
                </button>

                {/* Guided RTL Tool */}
                <button
                  onClick={() => initiateSliderAction("rtl", "Return to Launch", {})}
                  disabled={telemetry.navigation.relative_altitude <= 1.0}
                  className="fly-tool-btn"
                  title="Safety return to Home coordinates"
                >
                  <RefreshCw className="w-5 h-5 text-yellow-500" />
                  <span className="fly-tool-btn-label">RTL</span>
                </button>

                {/* Guided Pause Tool */}
                <button
                  onClick={() => initiateSliderAction("pause", "Hold Hovering", {})}
                  disabled={telemetry.navigation.relative_altitude <= 1.0}
                  className="fly-tool-btn"
                  title="Pause flight and hover"
                >
                  <Square className="w-5 h-5 text-purple-400" />
                  <span className="fly-tool-btn-label">Pause</span>
                </button>
              </div>
            )}

            {/* Left PFD Display overlay */}
            {activeVehicleId !== null && (
              <aside className="sidebar-left" style={{ top: "450px" }}>
                <PFD
                  roll={telemetry.pose.roll}
                  pitch={telemetry.pose.pitch}
                  heading={telemetry.pose.heading}
                  altitude={telemetry.navigation.relative_altitude}
                  airspeed={telemetry.navigation.airspeed}
                  groundspeed={telemetry.navigation.groundspeed}
                />
              </aside>
            )}

            {/* Right Telemetry metrics and parameters */}
            {activeVehicleId !== null && (
              <aside className="sidebar-right">
                {/* Quick HUD Metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="hud-metric-card">
                    <Battery className="w-6 h-6 text-yellow-500" />
                    <div>
                      <div className="hud-metric-title">Power</div>
                      <div className="hud-metric-value">{telemetry.status.battery_percent}%</div>
                      <div className="hud-metric-sub">{telemetry.status.battery_voltage.toFixed(1)} V</div>
                    </div>
                  </div>

                  <div className="hud-metric-card">
                    <Compass className="w-6 h-6 text-sky-400" />
                    <div>
                      <div className="hud-metric-title">Heading</div>
                      <div className="hud-metric-value">{telemetry.pose.heading}°</div>
                      <div className="hud-metric-sub">YAW: {telemetry.pose.yaw.toFixed(0)}°</div>
                    </div>
                  </div>

                  <div className="hud-metric-card">
                    <Navigation className="w-6 h-6 text-emerald-500" />
                    <div>
                      <div className="hud-metric-title">Altitude</div>
                      <div className="hud-metric-value">{telemetry.navigation.relative_altitude.toFixed(1)} m</div>
                      <div className="hud-metric-sub">Relative</div>
                    </div>
                  </div>

                  <div className="hud-metric-card">
                    <TrendingUp className="w-6 h-6 text-purple-400" />
                    <div>
                      <div className="hud-metric-title">Speed</div>
                      <div className="hud-metric-value">{telemetry.navigation.groundspeed.toFixed(1)} m/s</div>
                      <div className="hud-metric-sub">AIR: {telemetry.navigation.airspeed.toFixed(0)}</div>
                    </div>
                  </div>
                </div>

                {/* Telemetry Details Panel */}
                <div className="panel shadow">
                  <h3 className="panel-header">
                    🛸 Telemetry Parameters (Drone #{activeVehicleId})
                  </h3>
                  <div className="grid grid-cols-2 gap-y-2 text-xxs font-mono">
                    <div className="text-gray-500">ARMED STATE:</div>
                    <div className={telemetry.status.armed ? "text-emerald-400 font-bold" : "text-rose-500 font-bold"}>
                      {telemetry.status.armed ? "ARMED" : "DISARMED"}
                    </div>

                    <div className="text-gray-500">FLIGHT MODE:</div>
                    <div className="text-sky-400 font-bold">{telemetry.status.mode}</div>

                    <div className="text-gray-500">GPS QUALITY:</div>
                    <div>
                      {telemetry.status.gps_satellites} Sats (Fix {telemetry.status.gps_fix_type})
                    </div>

                    <div className="text-gray-500">COORDINATES:</div>
                    <div className="text-xxs text-gray-300">
                      {telemetry.navigation.latitude.toFixed(6)}, <br />
                      {telemetry.navigation.longitude.toFixed(6)}
                    </div>
                  </div>
                </div>

                {/* Actions quick shortcuts */}
                <div className="panel shadow">
                  <h3 className="panel-header">
                    ⚙️ Flight Control Shortcuts
                  </h3>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => initiateSliderAction("set_mode", "Switch to MISSION Flight mode", { mode: "MISSION" })}
                      disabled={!telemetry.status.armed}
                      className="btn btn-primary text-xs w-full py-2 disabled-opacity-40"
                    >
                      🚀 Start Mission Flight
                    </button>
                    <button
                      onClick={() => initiateSliderAction("pause", "Hold Drone Position (Hover)", {})}
                      className="btn btn-secondary text-xs w-full py-2"
                    >
                      ⏸️ Pause & Hover Here
                    </button>
                  </div>
                </div>
              </aside>
            )}
          </>
        )}

        {/* ================================================================= */}
        {/* 2.2 PLAN VIEW LAYOUT                                              */}
        {/* ================================================================= */}
        {viewMode === "plan" && (
          <aside className="sidebar-right">
            {/* Waypoint list editor panel */}
            {activeVehicleId !== null && (
              <div className="panel shadow flex-1 min-h-300">
                <h3 className="panel-header">
                  📋 Waypoint Editor
                </h3>

                {selectedWp && selectedWpIndex !== null ? (
                  <div className="flex flex-col gap-3 flex-1">
                    <div className="flex items-center justify-between text-xxs font-mono">
                      <span className="text-gray-400 font-bold">Selected Target:</span>
                      <span className="bg-purple-900-60 border border-purple-700 px-2 py-0.5 rounded text-purple-200">
                        WP #{selectedWpIndex + 1}
                      </span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Command Type</label>
                      <select
                        value={selectedWp.command}
                        onChange={(e) => updateSelectedWpField("command", e.target.value)}
                        className="form-select"
                      >
                        <option value="TAKEOFF">TAKEOFF (🚀)</option>
                        <option value="WAYPOINT">WAYPOINT (📍)</option>
                        <option value="RTL">RTL (🏠)</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="form-group">
                        <label className="form-label">Latitude</label>
                        <input
                          type="number"
                          step="0.000001"
                          value={selectedWp.latitude}
                          onChange={(e) => updateSelectedWpField("latitude", parseFloat(e.target.value) || 0)}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Longitude</label>
                        <input
                          type="number"
                          step="0.000001"
                          value={selectedWp.longitude}
                          onChange={(e) => updateSelectedWpField("longitude", parseFloat(e.target.value) || 0)}
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="form-group">
                        <label className="form-label">Altitude (m)</label>
                        <input
                          type="number"
                          value={selectedWp.altitude}
                          onChange={(e) => updateSelectedWpField("altitude", parseFloat(e.target.value) || 0)}
                          className="form-input"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Hold Time (s)</label>
                        <input
                          type="number"
                          value={selectedWp.hold_time || 0}
                          disabled={selectedWp.command !== "WAYPOINT"}
                          onChange={(e) => updateSelectedWpField("hold_time", parseInt(e.target.value) || 0)}
                          className="form-input"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 mt-auto">
                      <button
                        onClick={() => moveSelectedWp("up")}
                        disabled={selectedWpIndex === 0}
                        className="flex-1 btn btn-secondary text-xxs py-2"
                      >
                        ▲ Up
                      </button>
                      <button
                        onClick={() => moveSelectedWp("down")}
                        disabled={selectedWpIndex === waypoints.length - 1}
                        className="flex-1 btn btn-secondary text-xxs py-2"
                      >
                        ▼ Down
                      </button>
                    </div>

                    <button
                      onClick={removeSelectedWp}
                      className="btn btn-outline-danger w-full py-2"
                    >
                      <Trash2 className="w-3-5 h-3-5" /> Remove Waypoint
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center text-gray-500 text-xxs p-4 border border-dashed border-gray-800 rounded-lg">
                    <Layers className="w-8 h-8 mb-2 opacity-30" />
                    No waypoint selected.<br />
                    Double-click map to add waypoints, or select an index marker to edit.
                  </div>
                )}
              </div>
            )}

            {/* Mission syncing progress and control */}
            {activeVehicleId !== null && (
              <div className="panel shadow">
                <h3 className="panel-header">
                  🛫 Mission Sync Deck
                </h3>
                <div className="flex flex-col gap-2.5">
                  
                  {/* Loader shortcuts */}
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={loadSampleMission}
                      className="btn btn-secondary flex-1 text-xxs"
                    >
                      Sample Mission
                    </button>
                    <button
                      onClick={clearWaypoints}
                      className="btn btn-outline-danger flex-1 text-xxs"
                    >
                      Clear Map
                    </button>
                  </div>

                  <button
                    onClick={sendMissionUpload}
                    disabled={waypoints.length === 0}
                    className="btn btn-primary w-full py-2 text-xs"
                  >
                    <Upload className="w-4 h-4" /> Upload to Drone #{activeVehicleId}
                  </button>

                  {/* Progress reporting status card */}
                  {missionStatus.state !== "IDLE" && (
                    <div className="mission-progress-box">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-500 text-[9px] uppercase font-bold">Upload Status:</span>
                        <span className={`font-bold uppercase flex items-center gap-1 text-xxs ${
                          missionStatus.state === "SUCCESS" ? "text-emerald-400" :
                          missionStatus.state === "ERROR" ? "text-rose-400" : "text-sky-400"
                        }`}>
                          {missionStatus.state === "SUCCESS" && <CheckCircle className="w-3-5 h-3-5" />}
                          {missionStatus.state === "ERROR" && <AlertTriangle className="w-3-5 h-3-5" />}
                          {missionStatus.state === "UPLOADING" && <RefreshCw className="w-3-5 h-3-5 animate-spin" />}
                          {missionStatus.state}
                        </span>
                      </div>

                      {missionStatus.state === "UPLOADING" && (
                        <div className="progress-bar-container">
                          <div 
                            className="progress-bar-fill"
                            style={{ width: `${missionStatus.progress}%` }}
                          />
                        </div>
                      )}

                      <div className="text-[9px] text-gray-400 leading-normal break-words mt-1">
                        {missionStatus.message}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ================================================================= */}
        {/* 2.3 SETUP VIEW LAYOUT                                             */}
        {/* ================================================================= */}
        {viewMode === "setup" && (
          <aside className="sidebar-right">
            <div className="dropdown-menu-card" style={{ display: "block", position: "relative", width: "100%", top: 0, right: 0 }}>
              <h3 className="text-xs uppercase font-mono tracking-wider text-gray-300 border-b border-gray-800 pb-2 mb-2">
                ⚙️ Link Configuration Deck
              </h3>

              {/* Step A: WebSocket Link to Gateway */}
              <div className="flex flex-col gap-2 bg-gray-900 p-2-5 rounded border border-gray-800 mb-3">
                <span className="text-xxs font-mono text-gray-400 font-bold">1. PROXY WEBSOCKET:</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={wsUrl}
                    onChange={(e) => setWsUrl(e.target.value)}
                    disabled={isConnected}
                    className="form-input flex-1"
                  />
                  {!isConnected ? (
                    <button
                      onClick={connectToGateway}
                      disabled={isSimulating}
                      className="btn btn-primary text-xs"
                    >
                      Connect
                    </button>
                  ) : (
                    <button
                      onClick={disconnectFromGateway}
                      className="btn btn-danger text-xs"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>

              {/* Step B: Sim controls shortcut */}
              <div className="flex flex-col gap-2 bg-gray-900 p-2-5 rounded border border-gray-800 mb-3">
                <span className="text-xxs font-mono text-gray-400 font-bold">2. MULTI-VEHICLE SIMULATOR:</span>
                {!isSimulating ? (
                  <button
                    onClick={startLocalSimulator}
                    disabled={isConnected}
                    className="btn btn-success w-full text-xs"
                  >
                    Launch Local Sim
                  </button>
                ) : (
                  <button
                    onClick={stopLocalSimulator}
                    className="btn btn-warning w-full text-xs"
                  >
                    Kill Simulator
                  </button>
                )}
              </div>

              {/* Step C: Setup MAVLink Downstream Connections (TCP/UDP/Serial) */}
              <div className="flex flex-col gap-2.5 bg-gray-900 p-2-5 rounded border border-gray-800 mb-3">
                <span className="text-xxs font-mono text-gray-400 font-bold">3. SPAWN MAVLINK BRIDGE (DOWNSTREAM):</span>
                
                <div className="form-group">
                  <label className="form-label">Protocol Type</label>
                  <select
                    value={newLinkType}
                    onChange={(e) => setNewLinkType(e.target.value as any)}
                    className="form-select"
                  >
                    <option value="udp">UDP Port Listener (QGC SIH)</option>
                    <option value="tcp">TCP Network Client</option>
                    <option value="serial">Serial Telemetry Radio (COM)</option>
                  </select>
                </div>

                {/* Contextual form inputs */}
                {newLinkType === "udp" && (
                  <div className="form-group">
                    <label className="form-label">Listening UDP Port</label>
                    <input
                      type="number"
                      value={udpPort}
                      onChange={(e) => setUdpPort(Number(e.target.value))}
                      className="form-input"
                    />
                  </div>
                )}

                {newLinkType === "tcp" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="form-group">
                      <label className="form-label">Host IP Address</label>
                      <input
                        type="text"
                        value={tcpHost}
                        onChange={(e) => setTcpHost(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Port</label>
                      <input
                        type="number"
                        value={tcpPort}
                        onChange={(e) => setTcpPort(Number(e.target.value))}
                        className="form-input"
                      />
                    </div>
                  </div>
                )}

                {newLinkType === "serial" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="form-group">
                      <label className="form-label">Port Path</label>
                      <input
                        type="text"
                        value={serialPort}
                        onChange={(e) => setSerialPort(e.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Baud Rate</label>
                      <select
                        value={serialBaud}
                        onChange={(e) => setSerialBaud(Number(e.target.value))}
                        className="form-select font-mono"
                      >
                        <option value={9600}>9600 bps</option>
                        <option value={57600}>57600 bps (Radio)</option>
                        <option value={115200}>115200 bps (Pixhawk)</option>
                        <option value={921600}>921600 bps (Companion)</option>
                      </select>
                    </div>
                  </div>
                )}

                <button
                  onClick={addDownstreamLink}
                  disabled={!isConnected}
                  className="btn btn-primary w-full text-xs flex items-center justify-center gap-1 mt-1"
                >
                  <Plus className="w-4 h-4" /> Add Bridge Connection
                </button>
              </div>

              {/* Active downstream links */}
              {gatewayLinks.length > 0 && (
                <div className="flex flex-col gap-1.5 font-mono text-xxs text-gray-400">
                  <span className="text-[9px] uppercase text-gray-500 font-bold">Active Gateway Links:</span>
                  {gatewayLinks.map((link, idx) => (
                    <div key={idx} className="bg-black/40 px-2 py-1 rounded border border-gray-800">
                      🟢 {link}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* ================================================================= */}
        {/* 2.4 SLIDE TO CONFIRM OVERLAY PANEL                                */}
        {/* ================================================================= */}
        {sliderAction && (
          <div className="slider-overlay-container">
            <h4 className="slider-title">Confirm Action: {sliderAction.label}</h4>
            <div className="slide-confirm-wrapper">
              <div className="slide-confirm-text">Slide to Confirm</div>
              <div className="slide-confirm-fill" style={{ width: `${sliderValue}%` }} />
              <div className="slide-confirm-handle" style={{ transform: `translateX(${sliderValue * 3.0}px)` }}>
                <Navigation className="w-5 h-5 rotate-90 text-white" />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={sliderValue}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSliderValue(val);
                  if (val >= 100) {
                    executeSliderAction(sliderAction);
                    setSliderAction(null);
                    setSliderValue(0);
                  }
                }}
                onMouseUp={() => {
                  if (sliderValue < 100) setSliderValue(0);
                }}
                onTouchEnd={() => {
                  if (sliderValue < 100) setSliderValue(0);
                }}
                className="slide-confirm-input"
              />
            </div>
            <button
              onClick={() => {
                setSliderAction(null);
                setSliderValue(0);
              }}
              className="slide-confirm-cancel"
            >
              Cancel Guided Action
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
