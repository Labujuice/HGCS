import { useState, useEffect, useRef } from "react";
import { PFD } from "./components/PFD";
import { FlightMap } from "./components/Map";
import type { Waypoint } from "./components/Map";
import { 
  Play, 
  Square, 
  Upload, 
  Trash2, 
  Layers, 
  Radio, 
  TrendingUp, 
  Battery, 
  Compass, 
  Navigation,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Cpu
} from "lucide-react";
import "./App.css";

// Generate a random unique mission UUID
const generateUUID = () => {
  return "mission_uuid_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
};

function App() {
  // Telemetry state
  const [telemetry, setTelemetry] = useState({
    timestamp: Date.now(),
    vehicle_id: 1,
    status: {
      armed: false,
      mode: "DISCONNECTED",
      battery_percent: 0,
      battery_voltage: 0.0,
      gps_satellites: 0,
      gps_fix_type: 0
    },
    pose: {
      roll: 0.0,
      pitch: 0.0,
      yaw: 0.0,
      heading: 0
    },
    navigation: {
      latitude: 24.7746,
      longitude: 121.0446,
      relative_altitude: 0.0,
      airspeed: 0.0,
      groundspeed: 0.0
    }
  });

  // Waypoints state
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [selectedWpIndex, setSelectedWpIndex] = useState<number | null>(null);

  // Connection settings
  const [wsUrl, setWsUrl] = useState("ws://127.0.0.1:8080");
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  // Mission upload status
  const [missionStatus, setMissionStatus] = useState({
    mission_id: "",
    state: "IDLE", // IDLE, UPLOADING, SUCCESS, ERROR
    progress: 0,
    message: "No mission uploaded yet"
  });

  const wsRef = useRef<WebSocket | null>(null);
  const simTimerRef = useRef<number | null>(null);

  // --- 1. LOCAL TELEMETRY SIMULATOR (FRONTEND MOCK) ---
  const startLocalSimulator = () => {
    if (isConnected) {
      alert("Please disconnect from Gateway first.");
      return;
    }
    
    setIsSimulating(true);
    let tick = 0;
    let lat = 24.7746;
    let lon = 121.0446;
    let alt = 0.0;
    let yaw = 90.0;
    let armed = false;
    let mode = "HOLD";
    let batteryVolts = 25.2;
    
    let targetWpIndex = 0;
    let flying = false;

    // Use mutable refs inside the interval
    const getWaypoints = () => {
      // Fetch latest waypoints from document/state
      return wpsRef.current;
    };

    if (simTimerRef.current) clearInterval(simTimerRef.current);

    simTimerRef.current = window.setInterval(() => {
      const activeWps = getWaypoints();
      
      // Handle commands/mode changes
      const currentSimArmed = simControlRef.current.armed;
      const currentSimMode = simControlRef.current.mode;
      
      if (armed !== currentSimArmed) {
        armed = currentSimArmed;
        if (!armed) {
          flying = false;
          alt = 0.0;
        }
      }
      
      if (mode !== currentSimMode) {
        mode = currentSimMode;
        if (mode === "MISSION" && armed && activeWps.length > 0) {
          flying = true;
          targetWpIndex = 0;
        }
      }

      let groundspeed = 0.0;
      let airspeed = 0.0;
      let pitch = 0.0;
      let roll = 0.0;

      if (flying && activeWps.length > 0 && targetWpIndex < activeWps.length) {
        const wp = activeWps[targetWpIndex];
        const wpLat = wp.latitude;
        const wpLon = wp.longitude;
        const wpAlt = wp.altitude;
        
        let targetLat = wpLat;
        let targetLon = wpLon;
        let targetAlt = wpAlt;

        if (wp.command === "RTL") {
          targetLat = 24.7746;
          targetLon = 121.0446;
          targetAlt = 0.0;
        }

        // Calculate heading & move drone
        const dy = targetLat - lat;
        const dx = targetLon - lon;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist > 0.00005) {
          groundspeed = 12.0;
          airspeed = 12.0;
          const step = 0.00001; // Movement increment
          lat += (dy / dist) * step;
          lon += (dx / dist) * step;
          yaw = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

          const dAlt = targetAlt - alt;
          if (Math.abs(dAlt) > 0.5) {
            alt += Math.sign(dAlt) * 0.2;
            pitch = dAlt > 0 ? 6.0 : -6.0;
          } else {
            pitch = 0.0;
          }
          roll = 2.5 * Math.sin(tick * 0.1);
        } else {
          // Arrived
          if (wp.command === "RTL" && alt < 0.5) {
            flying = false;
            armed = false;
            simControlRef.current.armed = false;
            simControlRef.current.mode = "HOLD";
            mode = "HOLD";
            alt = 0.0;
          } else {
            targetWpIndex++;
            if (targetWpIndex >= activeWps.length) {
              flying = false;
              simControlRef.current.mode = "HOLD";
              mode = "HOLD";
            }
          }
        }
      } else {
        roll = 0.6 * Math.sin(tick * 0.05);
        pitch = 0.4 * Math.cos(tick * 0.08);
      }

      // Battery level depletion
      if (armed) {
        batteryVolts = Math.max(18.0, batteryVolts - (flying ? 0.001 : 0.0002));
      }
      const batteryPercent = Math.round(((batteryVolts - 18.0) / (25.2 - 18.0)) * 100);

      tick++;

      setTelemetry({
        timestamp: Date.now(),
        vehicle_id: 1,
        status: {
          armed,
          mode,
          battery_percent: batteryPercent,
          battery_voltage: parseFloat(batteryVolts.toFixed(2)),
          gps_satellites: armed ? 18 : 12,
          gps_fix_type: 4
        },
        pose: {
          roll,
          pitch,
          yaw,
          heading: Math.round(yaw)
        },
        navigation: {
          latitude: lat,
          longitude: lon,
          relative_altitude: parseFloat(alt.toFixed(1)),
          airspeed,
          groundspeed
        }
      });
    }, 50); // 20Hz
  };

  const stopLocalSimulator = () => {
    setIsSimulating(false);
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setTelemetry(t => ({
      ...t,
      status: { ...t.status, mode: "DISCONNECTED", armed: false }
    }));
  };

  // Keep references to access inside simulator timer callback
  const wpsRef = useRef<Waypoint[]>(waypoints);
  useEffect(() => {
    wpsRef.current = waypoints;
  }, [waypoints]);

  const simControlRef = useRef({ armed: false, mode: "HOLD" });

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
            setTelemetry(payload.data);
          } else if (payload.type === "mission_status") {
            setMissionStatus(payload.data);
          }
        } catch (err) {
          console.warn("[WS] Error decoding message: ", err);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
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

  // --- 3. COMMAND TRANSMITTERS ---
  const sendArmCommand = (arm: boolean) => {
    if (isSimulating) {
      simControlRef.current.armed = arm;
      // Force instant feedback in status
      setTelemetry(prev => ({
        ...prev,
        status: { ...prev.status, armed: arm }
      }));
      return;
    }

    if (!isConnected || !wsRef.current) {
      alert("Gateway not connected!");
      return;
    }

    wsRef.current.send(JSON.stringify({
      action: "arm",
      data: { armed: arm }
    }));
  };

  const sendModeCommand = (mode: "HOLD" | "MISSION" | "RTL") => {
    if (isSimulating) {
      simControlRef.current.mode = mode;
      setTelemetry(prev => ({
        ...prev,
        status: { ...prev.status, mode: mode }
      }));
      return;
    }

    if (!isConnected || !wsRef.current) {
      alert("Gateway not connected!");
      return;
    }

    wsRef.current.send(JSON.stringify({
      action: "set_mode",
      data: { mode }
    }));
  };

  const sendMissionUpload = () => {
    if (waypoints.length === 0) {
      alert("Please plan some waypoints first.");
      return;
    }

    const mId = generateUUID();
    setMissionStatus({
      mission_id: mId,
      state: "UPLOADING",
      progress: 0,
      message: "Initiating upload..."
    });

    if (isSimulating) {
      // Simulate client-side upload steps
      let prog = 0;
      const interval = setInterval(() => {
        prog += 20;
        if (prog < 100) {
          setMissionStatus({
            mission_id: mId,
            state: "UPLOADING",
            progress: prog,
            message: `Uploading waypoint count: ${waypoints.length}`
          });
        } else {
          clearInterval(interval);
          setMissionStatus({
            mission_id: mId,
            state: "SUCCESS",
            progress: 100,
            message: "Mission loaded in simulator successfully"
          });
          
          // Feed waypoints to simulator
          if (isSimulating) {
            // Simulator listens to wpsRef already, let's reset flight target index
            simControlRef.current.mode = "HOLD";
          }
        }
      }, 300);
      return;
    }

    if (!isConnected || !wsRef.current) {
      alert("Gateway not connected! Unable to upload mission.");
      setMissionStatus({
        mission_id: mId,
        state: "ERROR",
        progress: 0,
        message: "Gateway connection missing"
      });
      return;
    }

    wsRef.current.send(JSON.stringify({
      action: "upload_mission",
      data: {
        vehicle_id: telemetry.vehicle_id,
        mission_id: mId,
        waypoints: waypoints
      }
    }));
  };

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, []);

  // --- 4. WAYPOINT OPERATIONS ---
  const handleWaypointChange = (newWps: Waypoint[]) => {
    setWaypoints(newWps);
  };

  const handleSelectWp = (idx: number | null) => {
    setSelectedWpIndex(idx);
  };

  const loadSampleMission = () => {
    // Standard Pixhawk/PX4 flight pattern: Takeoff, 3 standard path targets, RTL return
    const demoWaypoints: Waypoint[] = [
      { command: "TAKEOFF", latitude: 24.7748, longitude: 121.0446, altitude: 30.0 },
      { command: "WAYPOINT", latitude: 24.7760, longitude: 121.0460, altitude: 40.0, hold_time: 5 },
      { command: "WAYPOINT", latitude: 24.7770, longitude: 121.0440, altitude: 50.0, hold_time: 10 },
      { command: "WAYPOINT", latitude: 24.7750, longitude: 121.0430, altitude: 35.0, hold_time: 5 },
      { command: "RTL", latitude: 24.7746, longitude: 121.0446, altitude: 0.0 }
    ];
    setWaypoints(demoWaypoints);
    setSelectedWpIndex(0);
  };

  const clearWaypoints = () => {
    setWaypoints([]);
    setSelectedWpIndex(null);
  };

  const updateSelectedWpField = (field: keyof Waypoint, value: any) => {
    if (selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated[selectedWpIndex] = {
      ...updated[selectedWpIndex],
      [field]: value
    };
    setWaypoints(updated);
  };

  const removeSelectedWp = () => {
    if (selectedWpIndex === null) return;
    const updated = [...waypoints];
    updated.splice(selectedWpIndex, 1);
    setWaypoints(updated);
    setSelectedWpIndex(null);
  };

  const moveSelectedWp = (direction: "up" | "down") => {
    if (selectedWpIndex === null) return;
    const targetIdx = direction === "up" ? selectedWpIndex - 1 : selectedWpIndex + 1;
    if (targetIdx < 0 || targetIdx >= waypoints.length) return;
    
    const updated = [...waypoints];
    const temp = updated[selectedWpIndex];
    updated[selectedWpIndex] = updated[targetIdx];
    updated[targetIdx] = temp;
    
    setWaypoints(updated);
    setSelectedWpIndex(targetIdx);
  };

  const selectedWp = selectedWpIndex !== null ? waypoints[selectedWpIndex] : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans">
      {/* Top Header Section */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex flex-wrap justify-between items-center gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-sky-500-10 border border-sky-500-30 p-2 rounded-lg text-sky-400">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white m-0">HGCS</h1>
            <p className="text-xs text-gray-400 font-mono m-0">HTML Ground Control Station • V1.0</p>
          </div>
        </div>

        {/* Link status and controls */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-950 p-2 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${isConnected ? "text-emerald-500 animate-pulse" : "text-gray-500"}`} />
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              disabled={isConnected}
              className="bg-gray-900 border border-gray-700 text-xs px-2-5 py-1 rounded w-48 text-gray-200 focus:outline-none focus:border-sky-500 font-mono disabled-opacity-50"
            />
          </div>

          <div className="flex gap-2">
            {!isConnected ? (
              <button
                onClick={connectToGateway}
                disabled={isSimulating}
                className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs px-3 py-1-5 rounded transition disabled-opacity-40"
              >
                Connect
              </button>
            ) : (
              <button
                onClick={disconnectFromGateway}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold text-xs px-3 py-1-5 rounded transition"
              >
                Disconnect
              </button>
            )}

            {!isSimulating ? (
              <button
                onClick={startLocalSimulator}
                disabled={isConnected}
                className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs px-3 py-1-5 rounded transition disabled-opacity-40"
              >
                Start Sim
              </button>
            ) : (
              <button
                onClick={stopLocalSimulator}
                className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs px-3 py-1-5 rounded transition"
              >
                Stop Sim
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container Dashboard */}
      <main className="flex-1 grid grid-cols-1 lg-col-12 gap-5 p-5 max-w-1400 mx-auto w-full box-border">
        
        {/* LEFT COLUMN: PFD and Drone Status Parameters (Col 4) */}
        <section className="lg-col-4 flex flex-col gap-5">
          {/* PFD Component */}
          <PFD
            roll={telemetry.pose.roll}
            pitch={telemetry.pose.pitch}
            heading={telemetry.pose.heading}
            altitude={telemetry.navigation.relative_altitude}
            airspeed={telemetry.navigation.airspeed}
            groundspeed={telemetry.navigation.groundspeed}
          />

          {/* Quick HUD Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 shadow flex items-center gap-3">
              <Battery className="w-8 h-8 text-yellow-500" />
              <div>
                <div className="text-xxs uppercase font-mono text-gray-500">Power</div>
                <div className="text-sm font-bold text-white font-mono">
                  {telemetry.status.battery_percent}%
                </div>
                <div className="text-xxs text-gray-400 font-mono">
                  {telemetry.status.battery_voltage.toFixed(1)} V
                </div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 shadow flex items-center gap-3">
              <Compass className="w-8 h-8 text-sky-400" />
              <div>
                <div className="text-xxs uppercase font-mono text-gray-500">Heading</div>
                <div className="text-sm font-bold text-white font-mono">
                  {telemetry.pose.heading}°
                </div>
                <div className="text-xxs text-gray-400 font-mono">
                  YAW: {telemetry.pose.yaw.toFixed(0)}°
                </div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 shadow flex items-center gap-3">
              <Navigation className="w-8 h-8 text-emerald-500" />
              <div>
                <div className="text-xxs uppercase font-mono text-gray-500">Altitude</div>
                <div className="text-sm font-bold text-white font-mono">
                  {telemetry.navigation.relative_altitude.toFixed(1)} m
                </div>
                <div className="text-xxs text-gray-400 font-mono">Rel to Launch</div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 shadow flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-purple-400" />
              <div>
                <div className="text-xxs uppercase font-mono text-gray-500">Speed</div>
                <div className="text-sm font-bold text-white font-mono">
                  {telemetry.navigation.groundspeed.toFixed(1)} m/s
                </div>
                <div className="text-xxs text-gray-400 font-mono">
                  AIR: {telemetry.navigation.airspeed.toFixed(1)}
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Status Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow">
            <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 mb-3 border-b border-gray-800 pb-2">
              🚨 Telemetry Metrics
            </h3>
            <div className="grid grid-cols-2 gap-y-2 text-xs font-mono">
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
        </section>

        {/* MIDDLE COLUMN: MAP component (Col 5) */}
        <section className="lg-col-5 flex flex-col gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 m-0">
                🌍 Navigation Plotter Map
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={loadSampleMission}
                  className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 text-xs px-2-5 py-1 rounded transition"
                >
                  Load Demo
                </button>
                <button
                  onClick={clearWaypoints}
                  className="bg-gray-800 hover:bg-rose-950-40 text-rose-400 border border-gray-700 text-xs px-2-5 py-1 rounded transition"
                >
                  Clear Map
                </button>
              </div>
            </div>

            <FlightMap
              droneLat={telemetry.navigation.latitude}
              droneLon={telemetry.navigation.longitude}
              droneHeading={telemetry.pose.heading}
              waypoints={waypoints}
              selectedWpIndex={selectedWpIndex}
              onWaypointsChange={handleWaypointChange}
              onSelectWp={handleSelectWp}
            />
          </div>

          {/* Action Operations Control Board */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow">
            <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 mb-3 border-b border-gray-800 pb-2">
              ⚙️ Flight Control Command Deck
            </h3>
            
            <div className="flex flex-col gap-4">
              {/* Arm/Disarm Row */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-mono text-gray-400">PROPULSION MOTORS:</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => sendArmCommand(true)}
                    className={`flex items-center gap-1 text-xs px-4 py-2 rounded font-bold transition ${
                      telemetry.status.armed 
                        ? "bg-emerald-600-30 text-emerald-400 border border-emerald-500-30 cursor-default"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    <Play className="w-3-5 h-3-5" /> Arm Motors
                  </button>
                  <button
                    onClick={() => sendArmCommand(false)}
                    className={`flex items-center gap-1 text-xs px-4 py-2 rounded font-bold transition ${
                      !telemetry.status.armed 
                        ? "bg-rose-600-30 text-rose-400 border border-rose-500-30 cursor-default"
                        : "bg-rose-600 hover:bg-rose-500 text-white"
                    }`}
                  >
                    <Square className="w-3-5 h-3-5" /> Disarm
                  </button>
                </div>
              </div>

              {/* Mode Switching Row */}
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-mono text-gray-400">FLIGHT OPERATIONS:</span>
                <div className="flex gap-1-5">
                  <button
                    onClick={() => sendModeCommand("HOLD")}
                    className={`text-xs px-3 py-1-5 rounded font-mono font-semibold transition border ${
                      telemetry.status.mode === "HOLD"
                        ? "bg-sky-600-20 text-sky-400 border-sky-500"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700"
                    }`}
                  >
                    Hold / Loiter
                  </button>
                  <button
                    onClick={() => sendModeCommand("MISSION")}
                    className={`text-xs px-3 py-1-5 rounded font-mono font-semibold transition border ${
                      telemetry.status.mode === "MISSION"
                        ? "bg-sky-600-20 text-sky-400 border-sky-500"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700"
                    }`}
                  >
                    Mission Auto
                  </button>
                  <button
                    onClick={() => sendModeCommand("RTL")}
                    className={`text-xs px-3 py-1-5 rounded font-mono font-semibold transition border ${
                      telemetry.status.mode === "RTL"
                        ? "bg-sky-600-20 text-sky-400 border-sky-500"
                        : "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700"
                    }`}
                  >
                    Return Home
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Mission & Waypoint Editor (Col 3) */}
        <section className="lg-col-3 flex flex-col gap-4">
          
          {/* Waypoint Editor Form */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow flex-1 flex flex-col min-h-300">
            <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 mb-3 border-b border-gray-800 pb-2">
              📋 Waypoint Editor
            </h3>

            {selectedWp && selectedWpIndex !== null ? (
              <div className="flex flex-col gap-4 flex-1">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-gray-400 font-bold">Selected Item:</span>
                  <span className="bg-purple-900-60 border border-purple-700 px-2 py-0.5 rounded text-purple-200">
                    Index {selectedWpIndex + 1}
                  </span>
                </div>

                <div>
                  <label className="block text-xxs uppercase font-mono text-gray-500 mb-1">
                    Command Action
                  </label>
                  <select
                    value={selectedWp.command}
                    onChange={(e) => updateSelectedWpField("command", e.target.value)}
                    className="w-full bg-gray-950 border border-gray-700 rounded text-xs p-2 text-white font-mono focus:outline-none focus:border-sky-500"
                  >
                    <option value="TAKEOFF">TAKEOFF (🚀)</option>
                    <option value="WAYPOINT">WAYPOINT (📍)</option>
                    <option value="RTL">RTL Return (🏠)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xxs uppercase font-mono text-gray-500 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={selectedWp.latitude}
                      onChange={(e) => updateSelectedWpField("latitude", parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-950 border border-gray-700 rounded text-xs p-2 text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xxs uppercase font-mono text-gray-500 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={selectedWp.longitude}
                      onChange={(e) => updateSelectedWpField("longitude", parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-950 border border-gray-700 rounded text-xs p-2 text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xxs uppercase font-mono text-gray-500 mb-1">
                      Altitude (m)
                    </label>
                    <input
                      type="number"
                      value={selectedWp.altitude}
                      onChange={(e) => updateSelectedWpField("altitude", parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-950 border border-gray-700 rounded text-xs p-2 text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xxs uppercase font-mono text-gray-500 mb-1">
                      Hold Time (s)
                    </label>
                    <input
                      type="number"
                      value={selectedWp.hold_time || 0}
                      disabled={selectedWp.command !== "WAYPOINT"}
                      onChange={(e) => updateSelectedWpField("hold_time", parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-950 border border-gray-700 rounded text-xs p-2 text-white font-mono focus:outline-none focus:border-sky-500 disabled-opacity-40"
                    />
                  </div>
                </div>

                <div className="flex gap-2 mt-auto">
                  <button
                    onClick={() => moveSelectedWp("up")}
                    disabled={selectedWpIndex === 0}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xxs p-2 rounded transition disabled-opacity-30"
                  >
                    ▲ Move Up
                  </button>
                  <button
                    onClick={() => moveSelectedWp("down")}
                    disabled={selectedWpIndex === waypoints.length - 1}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xxs p-2 rounded transition disabled-opacity-30"
                  >
                    ▼ Move Down
                  </button>
                </div>

                <button
                  onClick={removeSelectedWp}
                  className="w-full bg-rose-950-40 hover:bg-rose-900 border border-rose-800-40 hover:border-rose-700 text-rose-300 font-bold text-xs p-2 rounded transition flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3-5 h-3-5" /> Remove Waypoint
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center items-center text-center text-gray-500 text-xs p-4 border border-dashed border-gray-800 rounded-lg">
                <Layers className="w-8 h-8 mb-2 opacity-30" />
                No waypoint selected.<br />
                Click an existing point on the map or double-click to add a new flight target.
              </div>
            )}
          </div>

          {/* Mission Transmission Panel */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 shadow">
            <h3 className="text-xs uppercase font-mono tracking-wider text-gray-400 mb-3 border-b border-gray-800 pb-2">
              🛫 Mission Sync Operations
            </h3>

            <div className="flex flex-col gap-3">
              <button
                onClick={sendMissionUpload}
                disabled={waypoints.length === 0}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm py-2-5 px-4 rounded shadow transition disabled-opacity-40 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" /> Upload Mission
              </button>

              {/* Upload Status Card */}
              {missionStatus.state !== "IDLE" && (
                <div className="bg-gray-950 border border-gray-800 rounded p-3 font-mono text-xs">
                  <div className="flex justify-between items-center mb-1-5">
                    <span className="text-gray-500 text-xxs">STATUS:</span>
                    <span className={`font-bold uppercase flex items-center gap-1 ${
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
                    <div className="w-full bg-gray-900 rounded-full h-1-5 mb-2 overflow-hidden">
                      <div 
                        className="bg-sky-500 h-1-5 rounded-full transition-all duration-300"
                        style={{ width: `${missionStatus.progress}%` }}
                      />
                    </div>
                  )}

                  <div className="text-xxs text-gray-400 leading-normal break-words">
                    {missionStatus.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* Footer System Status Banner */}
      <footer className="bg-gray-900 border-t border-gray-800 px-6 py-2 flex justify-between items-center font-mono text-xxs text-gray-500 mt-auto">
        <div>COMS: {isConnected ? "CONNECTED" : isSimulating ? "MOCK TELEMETRY ACTIVE" : "DISCONNECTED"}</div>
        <div>HGCS PROXY NODE: v1.0.0</div>
      </footer>
    </div>
  );
}

export default App;
