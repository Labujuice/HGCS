import { useState, useEffect, useRef, useMemo } from "react";
import { PFD } from "./components/PFD";
import { FlightMap } from "./components/Map";
import type { Waypoint, MapVehicle } from "./components/Map";
import { generateLawnmowerPath } from "./utils/surveyGenerator";
import {
  Play,
  Square,
  Upload,
  Trash2,
  Layers,
  Battery,
  Satellite,
  Navigation,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Settings,
  Plus,
  Wifi,
  WifiOff,
  ChevronUp,
  ChevronDown,
  Target,
} from "lucide-react";
import "./App.css";

const generateUUID = () =>
  "mission_uuid_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();

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
  // ── Connection states ────────────────────────────────────────
  const [wsUrl, setWsUrl] = useState(() => {
    try {
      const loc = window.location;
      if (!loc.hostname || loc.hostname === "localhost") {
        return "ws://127.0.0.1:8080";
      }
      const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${loc.hostname}:8080`;
    } catch {
      return "ws://127.0.0.1:8080";
    }
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [useMock, setUseMock] = useState(false);

  // ── Guided Action parameters ───────────────────────────────
  const [guidedAltitude, setGuidedAltitude] = useState(10);
  const [guidedRadius, setGuidedRadius] = useState(20);

  // ── Active Flight controls ──────────────────────────────────
  const [activeTargetSpeed, setActiveTargetSpeed] = useState(10);
  const [activeTargetAlt, setActiveTargetAlt] = useState(30);

  // ── View mode: "fly" | "plan" ───────────────────────────────
  const [viewMode, setViewMode] = useState<"fly" | "plan">("fly");
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);

  // ── Slide-to-confirm ────────────────────────────────────────
  const [sliderAction, setSliderAction] = useState<{
    type: string;
    label: string;
    data?: any;
  } | null>(null);
  const [sliderValue, setSliderValue] = useState(0);

  // ── Connection settings form ─────────────────────────────────
  const [gatewayLinks, setGatewayLinks] = useState<string[]>([]);
  const [newLinkType, setNewLinkType] = useState<"udp" | "tcp" | "serial">("udp");
  const [newLinkRole, setNewLinkRole] = useState<"server" | "client">("server");
  const [newLinkHost, setNewLinkHost] = useState("127.0.0.1");
  const [udpPort, setUdpPort] = useState(14540);
  const [tcpPort, setTcpPort] = useState(5760);
  const [serialPort, setSerialPort] = useState("/dev/ttyUSB0");
  const [serialBaud, setSerialBaud] = useState(57600);

  // ── Telemetry derived states ─────────────────────────────────
  const [climbRate, setClimbRate] = useState(0);
  const lastAltRef = useRef(0);
  const lastAltTimeRef = useRef(Date.now());

  // ── Multi-Vehicle ─────────────────────────────────────────────
  const [activeVehicleId, setActiveVehicleId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<{
    [id: number]: MapVehicle & { fullData: VehicleTelemetry };
  }>({});

  // ── Waypoints (per vehicle) ───────────────────────────────────
  const [vehicleWaypoints, setVehicleWaypoints] = useState<{
    [id: number]: Waypoint[];
  }>({});
  const [selectedWpIndex, setSelectedWpIndex] = useState<number | null>(null);

  // ── Mission 3 Survey & Edit Modes ──────────────────────────────
  const [editMode, setEditMode] = useState<"none" | "waypoint" | "survey">("none");
  const [vehicleSurveyPoints, setVehicleSurveyPoints] = useState<{
    [id: number]: Array<{ latitude: number; longitude: number }>;
  }>({});
  const [surveySpacing, setSurveySpacing] = useState<number>(20); // in meters
  const [surveyAngle, setSurveyAngle] = useState<number>(0); // in degrees
  const [surveyAltitude, setSurveyAltitude] = useState<number>(50); // in meters
  const [surveyReverse, setSurveyReverse] = useState<boolean>(false);

  const surveyPolygonPoints = activeVehicleId !== null ? vehicleSurveyPoints[activeVehicleId] || [] : [];
  const handleSurveyPointsChange = (pts: Array<{ latitude: number; longitude: number }>) => {
    if (activeVehicleId !== null) {
      setVehicleSurveyPoints((prev) => ({ ...prev, [activeVehicleId]: pts }));
    }
  };

  const surveyGridPoints = useMemo(() => {
    return generateLawnmowerPath(
      surveyPolygonPoints,
      surveySpacing,
      surveyAngle,
      surveyReverse
    );
  }, [surveyPolygonPoints, surveySpacing, surveyAngle, surveyReverse]);

  // ── Mission upload statuses ───────────────────────────────────
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

  // Derived values
  const activeVehicle = activeVehicleId !== null ? vehicles[activeVehicleId] : null;
  const telemetry = activeVehicle
    ? activeVehicle.fullData
    : {
        timestamp: Date.now(),
        vehicle_id: 0,
        status: {
          armed: false,
          mode: "DISCONNECTED",
          battery_percent: 0,
          battery_voltage: 0.0,
          gps_satellites: 0,
          gps_fix_type: 0,
        },
        pose: { roll: 0.0, pitch: 0.0, yaw: 0.0, heading: 0 },
        navigation: {
          latitude: 24.7746,
          longitude: 121.0446,
          relative_altitude: 0.0,
          airspeed: 0.0,
          groundspeed: 0.0,
        },
      };

  const waypoints =
    (activeVehicleId !== null && vehicleWaypoints[activeVehicleId]) || [];
  const missionStatus =
    (activeVehicleId !== null && missionStatuses[activeVehicleId]) || {
      mission_id: "",
      state: "IDLE",
      progress: 0,
      message: "No mission uploaded yet",
    };

  // Keep waypoints ref for simulator
  const wpsRef = useRef<{ [id: number]: Waypoint[] }>({});
  useEffect(() => {
    wpsRef.current = vehicleWaypoints;
  }, [vehicleWaypoints]);

  // Auto-connect to websocket gateway on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      connectToGateway();
    }, 100);
    return () => {
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, []);

  // Sync targets on active vehicle selection
  useEffect(() => {
    if (activeVehicleId !== null && activeVehicle) {
      setActiveTargetAlt(Math.max(2, Math.round(activeVehicle.fullData.navigation.relative_altitude)));
      const gs = activeVehicle.fullData.navigation.groundspeed;
      setActiveTargetSpeed(gs > 0.5 ? Math.round(gs) : 10);
    }
  }, [activeVehicleId]);

  const applyActiveGuidedControls = () => {
    if (activeVehicleId === null || !activeVehicle) return;
    const vId = activeVehicleId;
    
    if (isSimulating) {
      const state = simControlsRef.current[vId];
      if (state) {
        state.targetSpeed = activeTargetSpeed;
        state.targetAlt = activeTargetAlt;
        state.mode = "GO_TO";
        state.targetLat = state.lat;
        state.targetLon = state.lon;
        state.flying = true;
      }
    } else if (isConnected && wsRef.current) {
      wsRef.current.send(JSON.stringify({
        action: "change_speed",
        data: {
          vehicle_id: vId,
          speed: activeTargetSpeed
        }
      }));
      wsRef.current.send(JSON.stringify({
        action: "go_to",
        data: {
          vehicle_id: vId,
          latitude: activeVehicle.latitude,
          longitude: activeVehicle.longitude,
          altitude: activeTargetAlt
        }
      }));
    }
  };

  // ── Vertical speed ────────────────────────────────────────────
  useEffect(() => {
    if (activeVehicleId !== null && activeVehicle) {
      const now = Date.now();
      const dt = (now - lastAltTimeRef.current) / 1000.0;
      if (dt > 0.05) {
        const currentAlt = activeVehicle.fullData.navigation.relative_altitude;
        const da = currentAlt - lastAltRef.current;
        const speed = da / dt;
        setClimbRate((prev) => (Math.abs(speed) < 0.05 ? 0 : prev * 0.7 + speed * 0.3));
        lastAltRef.current = currentAlt;
        lastAltTimeRef.current = now;
      }
    } else {
      setClimbRate(0);
    }
  }, [telemetry.navigation.relative_altitude, activeVehicleId]);

  // ── Simulator state ───────────────────────────────────────────
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
      targetSpeed?: number;
      orbitRadius?: number;
      orbitAngle?: number;
    };
  }>({
    1: {
      lat: 24.7746,
      lon: 121.0446,
      alt: 0.0,
      yaw: 90.0,
      armed: false,
      mode: "HOLD",
      batteryVolts: 25.2,
      targetWpIndex: 0,
      flying: false,
      targetSpeed: 11.5,
    },
    2: {
      lat: 24.776,
      lon: 121.0465,
      alt: 0.0,
      yaw: 180.0,
      armed: false,
      mode: "HOLD",
      batteryVolts: 24.8,
      targetWpIndex: 0,
      flying: false,
      targetSpeed: 9.5,
    },
  });

  // ═════════════════════════════════════════════════════════════
  // 1. LOCAL TELEMETRY SIMULATOR
  // ═════════════════════════════════════════════════════════════
  const createEmptyTelemetry = (
    vid: number,
    lat: number,
    lon: number
  ): VehicleTelemetry => ({
    timestamp: Date.now(),
    vehicle_id: vid,
    status: {
      armed: false,
      mode: "HOLD",
      battery_percent: 100,
      battery_voltage: 25.2,
      gps_satellites: 12,
      gps_fix_type: 4,
    },
    pose: { roll: 0.0, pitch: 0.0, yaw: 0.0, heading: 0 },
    navigation: {
      latitude: lat,
      longitude: lon,
      relative_altitude: 0.0,
      airspeed: 0.0,
      groundspeed: 0.0,
    },
  });

  const startLocalSimulator = () => {
    if (isConnected) {
      alert("Please disconnect from Gateway first.");
      return;
    }
    setIsSimulating(true);

    const initVehicles = {
      1: {
        id: 1,
        latitude: 24.7746,
        longitude: 121.0446,
        heading: 90,
        armed: false,
        mode: "HOLD",
        altitude: 0.0,
        fullData: createEmptyTelemetry(1, 24.7746, 121.0446),
      },
      2: {
        id: 2,
        latitude: 24.776,
        longitude: 121.0465,
        heading: 180,
        armed: false,
        mode: "HOLD",
        altitude: 0.0,
        fullData: createEmptyTelemetry(2, 24.776, 121.0465),
      },
    };
    setVehicles(initVehicles);
    setActiveVehicleId(1);
    setViewMode("fly");

    if (simTimerRef.current) clearInterval(simTimerRef.current);
    let tick = 0;

    simTimerRef.current = window.setInterval(() => {
      const activeWpsMap = wpsRef.current;
      const updatedVehicles = { ...initVehicles };

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
          const homeLat = vid === 1 ? 24.7746 : 24.776;
          const homeLon = vid === 1 ? 121.0446 : 121.0465;
          const dy = homeLat - state.lat;
          const dx = homeLon - state.lon;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.00005) {
            groundspeed = state.targetSpeed || (vid === 1 ? 11.5 : 9.5);
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
            const dAlt = 15.0 - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else pitch = 0.0;
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
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.00005) {
            groundspeed = state.targetSpeed || 11.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
            const dAlt = targetAlt - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else pitch = 0.0;
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
            state.mode = "HOLD";
          }
        } else if (state.flying && state.mode === "ORBIT") {
          const centerLat = state.targetLat || state.lat;
          const centerLon = state.targetLon || state.lon;
          const targetAlt = state.targetAlt || 10.0;
          const radius = state.orbitRadius || 20.0;
          let angle = state.orbitAngle || 0.0;
          const r_lat_deg = radius * 0.000009;
          const r_lon_deg = radius * 0.00001;
          const targetLatOnEdge = centerLat + r_lat_deg * Math.cos(angle);
          const targetLonOnEdge = centerLon + r_lon_deg * Math.sin(angle);
          const dy = targetLatOnEdge - state.lat;
          const dx = targetLonOnEdge - state.lon;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.00005) {
            groundspeed = state.targetSpeed || 11.5;
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
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
          } else pitch = 0.0;
        } else if (
          state.flying &&
          state.mode === "MISSION" &&
          activeWps.length > 0 &&
          state.targetWpIndex < activeWps.length
        ) {
          const wp = activeWps[state.targetWpIndex];
          let targetLat = wp.latitude;
          let targetLon = wp.longitude;
          let targetAlt = wp.altitude;
          if (wp.command === "RTL") {
            targetLat = vid === 1 ? 24.7746 : 24.776;
            targetLon = vid === 1 ? 121.0446 : 121.0465;
            targetAlt = 0.0;
          }
          const dy = targetLat - state.lat;
          const dx = targetLon - state.lon;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0.00005) {
            groundspeed = state.targetSpeed || (vid === 1 ? 11.5 : 9.5);
            airspeed = groundspeed;
            const step = 0.00001;
            state.lat += (dy / dist) * step;
            state.lon += (dx / dist) * step;
            state.yaw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
            const dAlt = targetAlt - state.alt;
            if (Math.abs(dAlt) > 0.5) {
              state.alt += Math.sign(dAlt) * 0.2;
              pitch = dAlt > 0 ? 5.5 : -5.5;
            } else pitch = 0.0;
            roll = 2.0 * Math.sin(tick * 0.1 + vid);
          } else {
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
          state.batteryVolts = Math.max(
            18.0,
            state.batteryVolts - (state.flying ? 0.001 : 0.0002)
          );
        }
        const batteryPercent = Math.round(
          ((state.batteryVolts - 18.0) / (25.2 - 18.0)) * 100
        );

        updatedVehicles[vid as 1 | 2] = {
          id: vid,
          latitude: state.lat,
          longitude: state.lon,
          heading: Math.round(state.yaw),
          armed: state.armed,
          mode: state.mode,
          altitude: parseFloat(state.alt.toFixed(1)),
          fullData: {
            timestamp: Date.now(),
            vehicle_id: vid,
            status: {
              armed: state.armed,
              mode: state.mode,
              battery_percent: batteryPercent,
              battery_voltage: parseFloat(state.batteryVolts.toFixed(1)),
              gps_satellites: state.armed ? 18 : 12,
              gps_fix_type: 4,
            },
            pose: { roll, pitch, yaw: state.yaw, heading: Math.round(state.yaw) },
            navigation: {
              latitude: state.lat,
              longitude: state.lon,
              relative_altitude: parseFloat(state.alt.toFixed(1)),
              airspeed,
              groundspeed,
            },
          },
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

  // ═════════════════════════════════════════════════════════════
  // 2. WEBSOCKET GATEWAY
  // ═════════════════════════════════════════════════════════════
  const connectToGateway = () => {
    if (isSimulating) {
      alert("Please stop the Local Simulator first.");
      return;
    }
    try {
      wsRef.current = new WebSocket(wsUrl);
      wsRef.current.onopen = () => {
        setIsConnected(true);
      };
      wsRef.current.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "telemetry") {
            const vId = payload.vehicle_id || 1;
            setVehicles((prev) => ({
              ...prev,
              [vId]: {
                id: vId,
                latitude: payload.data.navigation.latitude,
                longitude: payload.data.navigation.longitude,
                heading: payload.data.pose.heading,
                armed: payload.data.status.armed,
                mode: payload.data.status.mode,
                altitude: payload.data.navigation.relative_altitude,
                fullData: payload.data,
              },
            }));
            setActiveVehicleId((prev) => {
              if (prev === null) {
                setViewMode("fly");
                return vId;
              }
              return prev;
            });
          } else if (payload.type === "mission_status") {
            const vId = payload.vehicle_id || 1;
            setMissionStatuses((prev) => ({ ...prev, [vId]: payload.data }));
          } else if (payload.type === "links_list") {
            setGatewayLinks(payload.data || []);
          } else if (payload.type === "system_info") {
            setUseMock(payload.data.use_mock || false);
          }
        } catch (err) {
          console.warn("[WS] Error decoding message:", err);
        }
      };
      wsRef.current.onclose = () => {
        setIsConnected(false);
        setUseMock(false);
        wsRef.current = null;
        setVehicles({});
        setActiveVehicleId(null);
      };
      wsRef.current.onerror = () => setIsConnected(false);
    } catch (e) {
      alert("Failed to connect: " + e);
    }
  };

  const disconnectFromGateway = () => {
    wsRef.current?.close();
  };

  // ═════════════════════════════════════════════════════════════
  // 3. SLIDE TO CONFIRM ACTIONS
  // ═════════════════════════════════════════════════════════════
  const initiateSliderAction = (type: string, label: string, data?: any) => {
    setGuidedAltitude(type === "takeoff" ? 10 : 30); // Default takeoff to 10m, loiter/go_to to 30m
    setGuidedRadius(20);
    setSliderAction({ type, label, data });
    setSliderValue(0);
  };

  const executeSliderAction = (action: {
    type: string;
    label: string;
    data?: any;
  }) => {
    if (activeVehicleId === null) return;
    const vId = activeVehicleId;
    const { type } = action;
    const data = {
      ...(action.data || {}),
      altitude: guidedAltitude,
      radius: guidedRadius,
    };

    if (isSimulating) {
      const state = simControlsRef.current[vId];
      if (state) {
        if (type === "arm") {
          state.armed = data.armed;
          if (!data.armed) { state.flying = false; state.alt = 0.0; }
        } else if (type === "takeoff") {
          state.armed = true; state.flying = true; state.mode = "TAKEOFF"; state.targetAlt = data.altitude || 10.0;
        } else if (type === "land") {
          state.mode = "LAND";
        } else if (type === "rtl") {
          state.mode = "RTL"; state.flying = true;
        } else if (type === "pause") {
          state.mode = "HOLD"; state.flying = false;
        } else if (type === "go_to") {
          state.mode = "GO_TO"; state.flying = true;
          state.targetLat = data.latitude; state.targetLon = data.longitude;
          state.targetAlt = data.altitude || 10.0;
        } else if (type === "orbit") {
          state.mode = "ORBIT"; state.flying = true;
          state.targetLat = data.latitude; state.targetLon = data.longitude;
          state.targetAlt = data.altitude || 10.0;
          state.orbitRadius = data.radius || 20.0; state.orbitAngle = 0.0;
        } else if (type === "change_speed") {
          state.targetSpeed = data.speed;
        } else if (type === "set_mode") {
          state.mode = data.mode;
          if (data.mode === "MISSION" && state.armed) {
            state.flying = true; state.targetWpIndex = 0;
          }
        }
      }
      return;
    }

    if (!isConnected || !wsRef.current) { alert("Gateway not connected!"); return; }
    const actionMap: Record<string, any> = {
      arm: { action: "arm", data: { vehicle_id: vId, armed: data.armed } },
      takeoff: { action: "takeoff", data: { vehicle_id: vId, altitude: data.altitude || 10.0 } },
      land: { action: "land", data: { vehicle_id: vId } },
      rtl: { action: "rtl", data: { vehicle_id: vId } },
      pause: { action: "pause", data: { vehicle_id: vId } },
      go_to: { action: "go_to", data: { vehicle_id: vId, latitude: data.latitude, longitude: data.longitude, altitude: data.altitude || 10.0 } },
      orbit: { action: "orbit", data: { vehicle_id: vId, latitude: data.latitude, longitude: data.longitude, altitude: data.altitude || 10.0, radius: data.radius || 20.0 } },
      change_speed: { action: "change_speed", data: { vehicle_id: vId, speed: data.speed } },
      set_mode: { action: "set_mode", data: { vehicle_id: vId, mode: data.mode } },
    };
    if (actionMap[type]) wsRef.current.send(JSON.stringify(actionMap[type]));
  };

  // ═════════════════════════════════════════════════════════════
  // 4. DOWNSTREAM LINKS (MAVLink bridge)
  // ═════════════════════════════════════════════════════════════
  const addDownstreamLink = () => {
    if (!isConnected || !wsRef.current) {
      alert("Please connect WebSocket to Gateway first.");
      return;
    }
    const data: any = { type: newLinkType };
    if (newLinkType === "udp") {
      data.port = udpPort; data.role = newLinkRole; data.host = newLinkHost;
    } else if (newLinkType === "tcp") {
      data.host = newLinkHost; data.port = tcpPort; data.role = newLinkRole;
    } else if (newLinkType === "serial") {
      data.port = serialPort; data.baud = serialBaud;
    }
    wsRef.current.send(JSON.stringify({ action: "add_connection", data }));
    alert(`Requested Gateway to connect via ${newLinkType.toUpperCase()} (${newLinkRole.toUpperCase()})...`);
  };

  // ═════════════════════════════════════════════════════════════
  // 5. MISSION OPERATIONS
  // ═════════════════════════════════════════════════════════════
  const sendMissionUpload = () => {
    if (activeVehicleId === null) return;
    
    // Combine ordinary waypoints and generated survey path points
    let uploadWps = [...waypoints];
    if (surveyGridPoints.length > 0) {
      const surveyWps: Waypoint[] = surveyGridPoints.map((pt) => ({
        command: "WAYPOINT",
        latitude: pt.latitude,
        longitude: pt.longitude,
        altitude: surveyAltitude,
        hold_time: 0,
      }));

      if (uploadWps.length === 0) {
        const firstPt = surveyWps[0];
        uploadWps = [
          { command: "TAKEOFF", latitude: firstPt.latitude, longitude: firstPt.longitude, altitude: surveyAltitude },
          ...surveyWps,
          { command: "RTL", latitude: firstPt.latitude, longitude: firstPt.longitude, altitude: 0 }
        ];
      } else {
        const lastWp = uploadWps[uploadWps.length - 1];
        if (lastWp.command === "RTL" || lastWp.command === "LAND") {
          uploadWps.splice(uploadWps.length - 1, 0, ...surveyWps);
        } else {
          uploadWps.push(...surveyWps);
        }
      }
    }

    if (uploadWps.length === 0) {
      alert("Please plan some waypoints or a survey area first.");
      return;
    }

    const mId = generateUUID();
    setMissionStatuses((prev) => ({
      ...prev,
      [activeVehicleId]: { mission_id: mId, state: "UPLOADING", progress: 0, message: "Initiating upload..." },
    }));

    if (isSimulating) {
      let prog = 0;
      const interval = setInterval(() => {
        prog += 25;
        if (prog < 100) {
          setMissionStatuses((prev) => ({
            ...prev,
            [activeVehicleId]: { mission_id: mId, state: "UPLOADING", progress: prog, message: `Uploading waypoint count: ${uploadWps.length}` },
          }));
        } else {
          clearInterval(interval);
          setMissionStatuses((prev) => ({
            ...prev,
            [activeVehicleId]: { mission_id: mId, state: "SUCCESS", progress: 100, message: "Simulated load completed." },
          }));
          wpsRef.current[activeVehicleId] = uploadWps;
          const state = simControlsRef.current[activeVehicleId];
          if (state) state.targetWpIndex = 0;
        }
      }, 250);
      return;
    }

    if (!isConnected || !wsRef.current) { alert("Gateway not connected!"); return; }
    wsRef.current.send(JSON.stringify({ action: "upload_mission", data: { vehicle_id: activeVehicleId, mission_id: mId, waypoints: uploadWps } }));
  };

  // ═════════════════════════════════════════════════════════════
  // 6. WAYPOINT HELPERS
  // ═════════════════════════════════════════════════════════════
  const handleWaypointsChange = (newWps: Waypoint[]) => {
    if (activeVehicleId === null) return;
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: newWps }));
  };
  const handleSelectWp = (idx: number | null) => setSelectedWpIndex(idx);
  const loadSampleMission = () => {
    if (activeVehicleId === null) return;
    const baseLat = activeVehicleId === 1 ? 24.7746 : 24.776;
    const baseLon = activeVehicleId === 1 ? 121.0446 : 121.0465;
    const demoWaypoints: Waypoint[] = [
      { command: "TAKEOFF", latitude: baseLat + 0.0002, longitude: baseLon, altitude: 30.0 },
      { command: "WAYPOINT", latitude: baseLat + 0.0012, longitude: baseLon + 0.0012, altitude: 45.0, hold_time: 5 },
      { command: "WAYPOINT", latitude: baseLat + 0.0022, longitude: baseLon, altitude: 55.0, hold_time: 8 },
      { command: "WAYPOINT", latitude: baseLat + 0.0006, longitude: baseLon - 0.0012, altitude: 35.0, hold_time: 5 },
      { command: "RTL", latitude: baseLat, longitude: baseLon, altitude: 0.0 },
    ];
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: demoWaypoints }));
    setSelectedWpIndex(0);
  };
  const clearWaypoints = () => {
    if (activeVehicleId === null) return;
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: [] }));
    setSelectedWpIndex(null);
  };
  const updateSelectedWpField = (field: keyof Waypoint, value: any) => {
    if (activeVehicleId === null || selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated[selectedWpIndex] = { ...updated[selectedWpIndex], [field]: value };
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: updated }));
  };
  const removeSelectedWp = () => {
    if (activeVehicleId === null || selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated.splice(selectedWpIndex, 1);
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: updated }));
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
    setVehicleWaypoints((prev) => ({ ...prev, [activeVehicleId]: updated }));
    setSelectedWpIndex(targetIdx);
  };

  const selectedWp = selectedWpIndex !== null ? waypoints[selectedWpIndex] : null;
  const vehicleList = Object.keys(vehicles).map(Number);

  // ── Battery color helper ─────────────────────────────────────
  const battClass = (pct: number) =>
    pct > 50 ? "good" : pct > 20 ? "warn" : "danger";
  const gpsClass = (fix: number) =>
    fix >= 3 ? "good" : fix >= 2 ? "warn" : "danger";

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div className="app-container">

      {/* ── Background Full-Screen Map ─────────────────────── */}
      <FlightMap
        vehicles={vehicles}
        activeVehicleId={activeVehicleId}
        waypoints={waypoints}
        selectedWpIndex={selectedWpIndex}
        onWaypointsChange={handleWaypointsChange}
        onSelectWp={handleSelectWp}
        isFlyView={viewMode === "fly"}
        onMapGuidedAction={(action, lat, lng) =>
          initiateSliderAction(
            action,
            action === "go_to" ? "Guided Reposition (Go To)" : "Guided Orbit Center",
            { latitude: lat, longitude: lng }
          )
        }
        editMode={editMode}
        surveyPolygonPoints={surveyPolygonPoints}
        onSurveyPointsChange={handleSurveyPointsChange}
        surveyGridPoints={surveyGridPoints}
      />

      {/* ── All floating UI overlays ───────────────────────── */}
      <div className="floating-overlay-container">

        {/* ══════════════════════════════════════════════════ */}
        {/* TOP STATUS BAR (QGC style)                        */}
        {/* ══════════════════════════════════════════════════ */}
        <header className="header-overlay">

          {/* Brand */}
          <div className="brand-pill">
            <Cpu style={{ width: 14, height: 14, color: "var(--color-primary)" }} className="animate-pulse" />
            <h1>HGCS</h1>
          </div>

          {/* Ready/Armed status + mode */}
          {activeVehicleId !== null ? (
            <div
              className={`qgc-readiness ${
                telemetry.status.armed ? "armed" : "disarmed"
              }`}
            >
              {telemetry.status.armed ? "▶ ARMED" : "■ DISARMED"}{" "}
              — {telemetry.status.mode}
            </div>
          ) : (
            <div className="qgc-readiness disconnected">Not Connected</div>
          )}

          {/* Centre telemetry strip */}
          {activeVehicleId !== null && (
            <div className="topbar-tele-strip">
              {/* GPS */}
              <div className="tele-chip">
                <Satellite style={{ width: 10, height: 10 }} />
                <span className="tc-lbl">GPS</span>
                <span className={`tc-val ${gpsClass(telemetry.status.gps_fix_type)}`}>
                  {telemetry.status.gps_satellites} / Fix{telemetry.status.gps_fix_type}
                </span>
              </div>
              {/* Battery */}
              <div className="tele-chip">
                <Battery style={{ width: 10, height: 10 }} />
                <span className="tc-lbl">Batt</span>
                <span className={`tc-val ${battClass(telemetry.status.battery_percent)}`}>
                  {telemetry.status.battery_percent}% {telemetry.status.battery_voltage.toFixed(1)}V
                </span>
              </div>
              {/* Alt */}
              <div className="tele-chip">
                <span className="tc-lbl">Alt</span>
                <span className="tc-val">{telemetry.navigation.relative_altitude.toFixed(1)} m</span>
              </div>
              {/* Spd */}
              <div className="tele-chip">
                <span className="tc-lbl">GSpd</span>
                <span className="tc-val">{telemetry.navigation.groundspeed.toFixed(1)} m/s</span>
              </div>
              {/* Heading */}
              <div className="tele-chip">
                <Navigation style={{ width: 10, height: 10 }} />
                <span className="tc-lbl">Hdg</span>
                <span className="tc-val">{telemetry.pose.heading}°</span>
              </div>
            </div>
          )}

          {/* Right side */}
          <div className="topbar-right">
            {/* Vehicle switcher */}
            {vehicleList.length > 0 && (
              <div className="vehicle-switcher">
                <span style={{ color: "var(--text-muted)", fontSize: 8, textTransform: "uppercase" }}>UAV</span>
                <select
                  value={activeVehicleId || ""}
                  onChange={(e) => {
                    setActiveVehicleId(Number(e.target.value));
                    setSelectedWpIndex(null);
                  }}
                >
                  {vehicleList.map((id) => (
                    <option key={id} value={id}>#{id}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Connection status */}
            <div
              className={`conn-badge ${
                isConnected ? "connected" : isSimulating ? "simulating" : "disconnected"
              }`}
            >
              {isConnected ? "● LINK" : isSimulating ? "◎ SIM" : "○ OFFLINE"}
            </div>

            {/* Connection settings button */}
            <button
              id="btn-settings-toggle"
              className={`topbar-icon-btn ${showConnectionSettings ? "active" : ""}`}
              onClick={() => setShowConnectionSettings((p) => !p)}
            >
              <Settings style={{ width: 12, height: 12 }} />
              Comm Links
            </button>
          </div>
        </header>

        {/* ══════════════════════════════════════════════════ */}
        {/* CONNECTION SETTINGS DROPDOWN                      */}
        {/* ══════════════════════════════════════════════════ */}
        {showConnectionSettings && (
          <div className="float-connection-panel">
            <div className="flex justify-between items-center" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", fontWeight: 700 }}>
                ⚙ Comm Link Configuration
              </span>
              <button
                onClick={() => setShowConnectionSettings(false)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}
              >×</button>
            </div>

            {/* 1. Gateway WS */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>1. Gateway WebSocket</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={wsUrl}
                  onChange={(e) => setWsUrl(e.target.value)}
                  disabled={isConnected}
                  className="form-input flex-1"
                  placeholder="ws://127.0.0.1:8080"
                />
                {!isConnected ? (
                  <button onClick={connectToGateway} disabled={isSimulating} className="btn btn-primary" style={{ fontSize: 10 }}>
                    <Wifi style={{ width: 10, height: 10 }} /> Connect
                  </button>
                ) : (
                  <button onClick={disconnectFromGateway} className="btn btn-danger" style={{ fontSize: 10 }}>
                    <WifiOff style={{ width: 10, height: 10 }} /> Disconnect
                  </button>
                )}
              </div>
            </div>

            {/* 2. Local Sim */}
            {(!isConnected || useMock) && (
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>2. Multi-Vehicle Simulator</span>
                {!isSimulating ? (
                  <button onClick={startLocalSimulator} disabled={isConnected} className="btn btn-success w-full" style={{ fontSize: 10 }}>
                    ▶ Launch Local Sim (2 UAVs)
                  </button>
                ) : (
                  <button onClick={stopLocalSimulator} className="btn btn-danger w-full" style={{ fontSize: 10 }}>
                    ■ Stop Simulator
                  </button>
                )}
              </div>
            )}

            {/* 3. MAVLink Bridge */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>3. MAVLink Bridge (Downstream)</span>

              <div className="form-group">
                <label className="form-label">Protocol</label>
                <select value={newLinkType} onChange={(e) => setNewLinkType(e.target.value as any)} className="form-select">
                  <option value="udp">UDP Network</option>
                  <option value="tcp">TCP Network</option>
                  <option value="serial">Serial / Radio (COM)</option>
                </select>
              </div>

              {newLinkType !== "serial" && (
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select value={newLinkRole} onChange={(e) => setNewLinkRole(e.target.value as any)} className="form-select">
                    <option value="server">Server — listen for incoming</option>
                    <option value="client">Client — connect to remote</option>
                  </select>
                </div>
              )}

              {newLinkType !== "serial" && (
                <div className="form-group">
                  <label className="form-label">Host / IP</label>
                  <input type="text" value={newLinkHost} onChange={(e) => setNewLinkHost(e.target.value)}
                    placeholder={newLinkRole === "server" ? "0.0.0.0" : "192.168.1.1"}
                    className="form-input" />
                </div>
              )}

              {newLinkType === "udp" && (
                <div className="form-group">
                  <label className="form-label">UDP Port</label>
                  <input type="number" value={udpPort} onChange={(e) => setUdpPort(Number(e.target.value))} className="form-input" />
                </div>
              )}
              {newLinkType === "tcp" && (
                <div className="form-group">
                  <label className="form-label">TCP Port</label>
                  <input type="number" value={tcpPort} onChange={(e) => setTcpPort(Number(e.target.value))} className="form-input" />
                </div>
              )}
              {newLinkType === "serial" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="form-group">
                    <label className="form-label">Port Path</label>
                    <input type="text" value={serialPort} onChange={(e) => setSerialPort(e.target.value)} className="form-input" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Baud Rate</label>
                    <select value={serialBaud} onChange={(e) => setSerialBaud(Number(e.target.value))} className="form-select font-mono">
                      <option value={9600}>9600</option>
                      <option value={57600}>57600</option>
                      <option value={115200}>115200</option>
                      <option value={921600}>921600</option>
                    </select>
                  </div>
                </div>
              )}

              <button onClick={addDownstreamLink} disabled={!isConnected} className="btn btn-primary w-full" style={{ fontSize: 10 }}>
                <Plus style={{ width: 10, height: 10 }} /> Add Bridge
              </button>
            </div>

            {/* Active links */}
            {gatewayLinks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>Active Bridges:</span>
                {gatewayLinks.map((link, idx) => (
                  <div key={idx} style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 4, padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 9, color: "#10b981" }}>
                    ● {link}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* LEFT FLY TOOLS PANEL (QGC)                        */}
        {/* ══════════════════════════════════════════════════ */}
        <div className="fly-tools-panel">
          {/* Fly view toggle */}
          <button
            onClick={() => { setViewMode("fly"); setSelectedWpIndex(null); }}
            className={`fly-tool-btn ${viewMode === "fly" ? "active-fly" : ""}`}
            title="Fly View"
          >
            <Navigation style={{ width: 18, height: 18 }} />
            <span className="fly-tool-btn-label">Fly</span>
          </button>

          {/* Plan view toggle */}
          <button
            onClick={() => { setViewMode("plan"); setSelectedWpIndex(null); }}
            className={`fly-tool-btn ${viewMode === "plan" ? "active" : ""}`}
            title="Mission Plan"
          >
            <Layers style={{ width: 18, height: 18 }} />
            <span className="fly-tool-btn-label">Plan</span>
          </button>

          {/* Guided actions — only when vehicle connected and in Fly mode */}
          {viewMode === "fly" && activeVehicleId !== null && (
            <>
              <div className="fly-tool-separator" />

              {/* Arm / Disarm */}
              <button
                onClick={() =>
                  initiateSliderAction(
                    "arm",
                    telemetry.status.armed
                      ? "Disarm Propulsion"
                      : "Arm Propulsion",
                    { armed: !telemetry.status.armed }
                  )
                }
                className={`fly-tool-btn ${telemetry.status.armed ? "danger" : ""}`}
                title={telemetry.status.armed ? "Disarm Motors" : "Arm Motors"}
              >
                <Play
                  style={{
                    width: 18,
                    height: 18,
                    color: telemetry.status.armed
                      ? "var(--color-danger)"
                      : "var(--color-success)",
                    transform: telemetry.status.armed ? "rotate(90deg)" : undefined,
                  }}
                />
                <span className="fly-tool-btn-label">
                  {telemetry.status.armed ? "Disarm" : "Arm"}
                </span>
              </button>

              {/* Takeoff */}
              <button
                onClick={() => initiateSliderAction("takeoff", "Drone Takeoff", {})}
                disabled={telemetry.navigation.relative_altitude > 1.0}
                className="fly-tool-btn"
                title="Takeoff"
              >
                <Upload style={{ width: 18, height: 18, color: "var(--color-primary)" }} />
                <span className="fly-tool-btn-label">Takeoff</span>
              </button>

              {/* Land */}
              <button
                onClick={() => initiateSliderAction("land", "Land Here", {})}
                disabled={telemetry.navigation.relative_altitude <= 1.0}
                className="fly-tool-btn"
                title="Land"
              >
                <Square style={{ width: 18, height: 18, color: "var(--color-danger)" }} />
                <span className="fly-tool-btn-label">Land</span>
              </button>

              {/* RTL */}
              <button
                onClick={() => initiateSliderAction("rtl", "Return to Launch", {})}
                disabled={telemetry.navigation.relative_altitude <= 1.0}
                className="fly-tool-btn"
                title="Return to Home"
              >
                <RefreshCw style={{ width: 18, height: 18, color: "var(--color-warning)" }} />
                <span className="fly-tool-btn-label">RTL</span>
              </button>

              {/* Pause */}
              <button
                onClick={() => initiateSliderAction("pause", "Hold Position", {})}
                disabled={telemetry.navigation.relative_altitude <= 1.0}
                className="fly-tool-btn"
                title="Pause / Hold"
              >
                <Target style={{ width: 18, height: 18, color: "var(--color-accent)" }} />
                <span className="fly-tool-btn-label">Pause</span>
              </button>
            </>
          )}
        </div>

        {/* ══════════════════════════════════════════════════ */}
        {/* FLY VIEW — PFD + Bottom Telemetry Bar             */}
        {/* ══════════════════════════════════════════════════ */}
        {viewMode === "fly" && activeVehicleId !== null && (
          <>
            {/* Top-right PFD */}
            <PFD
              roll={telemetry.pose.roll}
              pitch={telemetry.pose.pitch}
              heading={telemetry.pose.heading}
              altitude={telemetry.navigation.relative_altitude}
              airspeed={telemetry.navigation.airspeed}
              groundspeed={telemetry.navigation.groundspeed}
            />

            {/* Bottom telemetry bar */}
            <div className="bottom-telemetry-overlay">
              <div className="telemetry-item">
                <span className="telemetry-label">Alt (Rel)</span>
                <span className="telemetry-value">{telemetry.navigation.relative_altitude.toFixed(1)} m</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="telemetry-label">Climb Rate</span>
                <span className="telemetry-value">{climbRate.toFixed(1)} m/s</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="telemetry-label">Ground Speed</span>
                <span className="telemetry-value">{telemetry.navigation.groundspeed.toFixed(1)} m/s</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="telemetry-label">Airspeed</span>
                <span className="telemetry-value">{telemetry.navigation.airspeed.toFixed(1)} m/s</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="telemetry-label">Heading</span>
                <span className="telemetry-value">{telemetry.pose.heading}°</span>
              </div>
            </div>

            {/* Active Guided Controls Floating Panel */}
            {activeVehicle && activeVehicle.armed && (
              <div 
                className="panel shadow"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "340px",
                  width: "180px",
                  zIndex: 390,
                  background: "var(--bg-panel)",
                  backdropFilter: "var(--blur-md)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px"
                }}
              >
                <h4 style={{ margin: 0, fontSize: "10px", fontFamily: "monospace", textTransform: "uppercase", color: "var(--color-primary)", fontWeight: 700, borderBottom: "1px solid var(--border-color)", paddingBottom: "4px" }}>
                  ⚡ Guided Tuning
                </h4>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontSize: "9px", fontFamily: "monospace", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>Target Speed</span>
                    <span style={{ color: "#fff" }}>{activeTargetSpeed} m/s</span>
                  </label>
                  <input 
                    type="range" min="1" max="20" step="0.5" 
                    value={activeTargetSpeed} 
                    onChange={(e) => setActiveTargetSpeed(Number(e.target.value))} 
                    style={{ width: "100%", accentColor: "var(--color-primary)" }} 
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <label style={{ fontSize: "9px", fontFamily: "monospace", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>Target Alt</span>
                    <span style={{ color: "#fff" }}>{activeTargetAlt} m</span>
                  </label>
                  <input 
                    type="range" min="2" max="100" step="1" 
                    value={activeTargetAlt} 
                    onChange={(e) => setActiveTargetAlt(Number(e.target.value))} 
                    style={{ width: "100%", accentColor: "var(--color-primary)" }} 
                  />
                </div>

                <button 
                  onClick={applyActiveGuidedControls} 
                  className="btn btn-primary w-full py-1 text-xxs"
                  style={{ fontWeight: 700 }}
                >
                  Apply Changes
                </button>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* PLAN VIEW — Right sidebar with waypoint editor    */}
        {/* ══════════════════════════════════════════════════ */}
        {viewMode === "plan" && (
          <aside className="sidebar-right">
            {/* Editor Mode Selector */}
            {activeVehicleId !== null && (
              <div className="panel shadow" style={{ padding: "10px", minHeight: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "8px", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                  ⚙ Editor Plan Mode
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => { setEditMode("waypoint"); setSelectedWpIndex(null); }}
                    className={`btn flex-1 py-1-5 text-xxs ${editMode === "waypoint" ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontWeight: 700 }}
                  >
                    📍 Waypoint
                  </button>
                  <button
                    onClick={() => { setEditMode("survey"); setSelectedWpIndex(null); }}
                    className={`btn flex-1 py-1-5 text-xxs ${editMode === "survey" ? "btn-primary" : "btn-secondary"}`}
                    style={{ fontWeight: 700 }}
                  >
                    🗺️ Survey
                  </button>
                  <button
                    onClick={() => { setEditMode("none"); setSelectedWpIndex(null); }}
                    className={`btn flex-0 px-2 py-1-5 text-xxs ${editMode === "none" ? "btn-primary" : "btn-secondary"}`}
                    title="Lock double click interaction"
                  >
                    🔒 Lock
                  </button>
                </div>
              </div>
            )}

            {/* 1. Waypoint Editor (only if waypoint mode selected) */}
            {activeVehicleId !== null && editMode !== "survey" && (
              <div className="panel shadow flex-1 min-h-300">
                <h3 className="panel-header">📋 Waypoint Editor</h3>

                {selectedWp && selectedWpIndex !== null ? (
                  <div className="flex flex-col gap-2-5 flex-1">
                    <div className="flex justify-between items-center text-xxs font-mono">
                      <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>Selected:</span>
                      <span style={{ background: "rgba(139,92,246,0.2)", border: "1px solid #6d28d9", padding: "1px 6px", borderRadius: 3, color: "#ddd6fe", fontSize: 9 }}>
                        WP #{selectedWpIndex + 1}
                      </span>
                    </div>

                     <div className="form-group">
                      <label className="form-label">Command</label>
                      <select value={selectedWp.command} onChange={(e) => updateSelectedWpField("command", e.target.value)} className="form-select">
                        <option value="TAKEOFF">TAKEOFF 🛫</option>
                        <option value="WAYPOINT">WAYPOINT 📍</option>
                        <option value="LOITER">LOITER (ORBIT) 🔄</option>
                        <option value="LAND">LAND 🛬</option>
                        <option value="RTL">RTL 🏡</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="form-group">
                        <label className="form-label">Latitude</label>
                        <input type="number" step="0.000001" value={selectedWp.latitude}
                          onChange={(e) => updateSelectedWpField("latitude", parseFloat(e.target.value) || 0)}
                          className="form-input" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Longitude</label>
                        <input type="number" step="0.000001" value={selectedWp.longitude}
                          onChange={(e) => updateSelectedWpField("longitude", parseFloat(e.target.value) || 0)}
                          className="form-input" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="form-group">
                        <label className="form-label">Altitude (m)</label>
                        <input type="number" value={selectedWp.altitude}
                          onChange={(e) => updateSelectedWpField("altitude", parseFloat(e.target.value) || 0)}
                          className="form-input" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Hold (s)</label>
                        <input type="number" value={selectedWp.hold_time || 0}
                          disabled={selectedWp.command !== "WAYPOINT" && selectedWp.command !== "LOITER"}
                          onChange={(e) => updateSelectedWpField("hold_time", parseInt(e.target.value) || 0)}
                          className="form-input" />
                      </div>
                    </div>

                    {selectedWp.command === "LOITER" && (
                      <div className="form-group">
                        <label className="form-label">Loiter Radius (m)</label>
                        <input type="number" value={selectedWp.radius || 20}
                          onChange={(e) => updateSelectedWpField("radius", parseFloat(e.target.value) || 0)}
                          className="form-input" />
                      </div>
                    )}

                    <div className="flex gap-2 mt-auto">
                      <button onClick={() => moveSelectedWp("up")} disabled={selectedWpIndex === 0} className="flex-1 btn btn-secondary text-xxs py-2">
                        <ChevronUp style={{ width: 12, height: 12 }} /> Up
                      </button>
                      <button onClick={() => moveSelectedWp("down")} disabled={selectedWpIndex === waypoints.length - 1} className="flex-1 btn btn-secondary text-xxs py-2">
                        <ChevronDown style={{ width: 12, height: 12 }} /> Down
                      </button>
                    </div>

                    <button onClick={removeSelectedWp} className="btn btn-outline-danger w-full py-2">
                      <Trash2 style={{ width: 12, height: 12 }} /> Remove Waypoint
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center text-xxs"
                    style={{ color: "var(--text-muted)", padding: 16, border: "1px dashed var(--border-color)", borderRadius: 6 }}>
                    <Layers style={{ width: 28, height: 28, marginBottom: 8, opacity: 0.3 }} />
                    No waypoint selected.<br />
                    Select "Waypoint" mode above and double-click map to add.
                  </div>
                )}
              </div>
            )}

            {/* 2. Survey Configurator (only if survey mode selected) */}
            {activeVehicleId !== null && editMode === "survey" && (
              <div className="panel shadow flex-1 min-h-300">
                <h3 className="panel-header">🗺️ Survey Configurator</h3>
                <div className="flex flex-col gap-2-5 flex-1">
                  
                  <div className="form-group">
                    <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Line Spacing (Spacing)</span>
                      <span style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{surveySpacing} m</span>
                    </label>
                    <input
                      type="range" min="10" max="100" step="5"
                      value={surveySpacing}
                      onChange={(e) => setSurveySpacing(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "var(--color-primary)" }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Survey Angle</span>
                      <span style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{surveyAngle}°</span>
                    </label>
                    <input
                      type="range" min="0" max="355" step="5"
                      value={surveyAngle}
                      onChange={(e) => setSurveyAngle(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "var(--color-primary)" }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Survey Altitude</span>
                      <span style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{surveyAltitude} m</span>
                    </label>
                    <input
                      type="range" min="10" max="120" step="5"
                      value={surveyAltitude}
                      onChange={(e) => setSurveyAltitude(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "var(--color-primary)" }}
                    />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                    <span className="form-label" style={{ margin: 0 }}>Reverse Direction</span>
                    <input
                      type="checkbox"
                      checked={surveyReverse}
                      onChange={(e) => setSurveyReverse(e.target.checked)}
                      style={{ accentColor: "var(--color-primary)", width: 14, height: 14 }}
                    />
                  </div>

                  {surveyPolygonPoints.length > 0 ? (
                    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ fontSize: "10px", fontFamily: "monospace", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                        <span>Area Vertices:</span>
                        <span style={{ color: "#fff" }}>{surveyPolygonPoints.length} points</span>
                      </div>
                      <div style={{ fontSize: "10px", fontFamily: "monospace", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                        <span>Generated Path:</span>
                        <span style={{ color: "#22c55e", fontWeight: "bold" }}>{surveyGridPoints.length} points</span>
                      </div>
                      <button
                        onClick={() => handleSurveyPointsChange([])}
                        className="btn btn-outline-danger w-full py-1.5 text-xxs"
                        style={{ marginTop: "4px" }}
                      >
                        <Trash2 style={{ width: 12, height: 12 }} /> Clear Survey Area
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-center items-center text-center text-xxs"
                      style={{ color: "var(--text-muted)", padding: 16, border: "1px dashed var(--border-color)", borderRadius: 6, marginTop: "10px" }}>
                      <Layers style={{ width: 28, height: 28, marginBottom: 8, opacity: 0.3 }} />
                      No boundary points.<br />
                      Double-click map to add survey polygon vertices (minimum 3 points).
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* Mission upload panel */}
            {activeVehicleId !== null && (
              <div className="panel shadow">
                <h3 className="panel-header">🛫 Mission Sync</h3>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2 w-full">
                    {(!isConnected || useMock || isSimulating) && (
                      <button onClick={loadSampleMission} className="btn btn-secondary flex-1 text-xxs">Sample</button>
                    )}
                    <button onClick={clearWaypoints} className="btn btn-outline-danger flex-1 text-xxs">Clear Map</button>
                  </div>
                  <button onClick={sendMissionUpload} disabled={waypoints.length === 0 && surveyGridPoints.length === 0} className="btn btn-primary w-full py-2 text-xs">
                    <Upload style={{ width: 14, height: 14 }} /> Upload to Drone #{activeVehicleId}
                  </button>

                  {missionStatus.state !== "IDLE" && (
                    <div className="mission-progress-box">
                      <div className="flex justify-between items-center">
                        <span style={{ color: "var(--text-muted)", fontSize: 8, textTransform: "uppercase", fontWeight: 700 }}>Status:</span>
                        <span className={`font-bold uppercase flex items-center gap-1 text-xxs ${
                          missionStatus.state === "SUCCESS" ? "text-emerald-400" :
                          missionStatus.state === "ERROR" ? "text-rose-400" : "text-sky-400"
                        }`}>
                          {missionStatus.state === "SUCCESS" && <CheckCircle style={{ width: 12, height: 12 }} />}
                          {missionStatus.state === "ERROR" && <AlertTriangle style={{ width: 12, height: 12 }} />}
                          {missionStatus.state === "UPLOADING" && <RefreshCw style={{ width: 12, height: 12 }} className="animate-spin" />}
                          {missionStatus.state}
                        </span>
                      </div>
                      {missionStatus.state === "UPLOADING" && (
                        <div className="progress-bar-container">
                          <div className="progress-bar-fill" style={{ width: `${missionStatus.progress}%` }} />
                        </div>
                      )}
                      <div style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 4 }}>
                        {missionStatus.message}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ══════════════════════════════════════════════════ */}
        {/* SLIDE TO CONFIRM OVERLAY                          */}
        {/* ══════════════════════════════════════════════════ */}
        {sliderAction && (
          <div className="slider-overlay-container" style={{ padding: "16px", minWidth: "260px" }}>
            <h4 className="slider-title" style={{ marginBottom: "12px" }}>Confirm: {sliderAction.label}</h4>
            
            {/* Takeoff Altitude Slider */}
            {sliderAction.type === "takeoff" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", marginBottom: 12, textAlign: "left" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>Takeoff Altitude: {guidedAltitude} m</span>
                <input type="range" min="2" max="50" step="1" value={guidedAltitude} onChange={(e) => setGuidedAltitude(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--color-primary)" }} />
              </div>
            )}

            {/* Go-To Altitude Slider */}
            {sliderAction.type === "go_to" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", marginBottom: 12, textAlign: "left" }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>Target Altitude: {guidedAltitude} m</span>
                <input type="range" min="2" max="100" step="1" value={guidedAltitude} onChange={(e) => setGuidedAltitude(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--color-primary)" }} />
              </div>
            )}

            {/* Orbit / Loiter Radius & Altitude Sliders */}
            {sliderAction.type === "orbit" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", marginBottom: 16, textAlign: "left" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>Orbit Radius: {guidedRadius} m</span>
                  <input type="range" min="5" max="100" step="1" value={guidedRadius} onChange={(e) => setGuidedRadius(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--color-primary)" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>Orbit Altitude: {guidedAltitude} m</span>
                  <input type="range" min="2" max="100" step="1" value={guidedAltitude} onChange={(e) => setGuidedAltitude(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--color-primary)" }} />
                </div>
              </div>
            )}

            <div className="slide-confirm-wrapper">
              <div className="slide-confirm-text">Slide to Confirm</div>
              <div className="slide-confirm-fill" style={{ width: `${sliderValue}%` }} />
              <div className="slide-confirm-handle" style={{ transform: `translateX(${sliderValue * 2.88}px)` }}>
                <Navigation style={{ width: 18, height: 18, transform: "rotate(90deg)" }} />
              </div>
              <input
                type="range" min="0" max="100" value={sliderValue}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSliderValue(val);
                  if (val >= 100) {
                    executeSliderAction(sliderAction);
                    setSliderAction(null);
                    setSliderValue(0);
                  }
                }}
                onMouseUp={() => { if (sliderValue < 100) setSliderValue(0); }}
                onTouchEnd={() => { if (sliderValue < 100) setSliderValue(0); }}
                className="slide-confirm-input"
              />
            </div>
            <button
              onClick={() => { setSliderAction(null); setSliderValue(0); }}
              className="slide-confirm-cancel"
            >
              Cancel
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;
