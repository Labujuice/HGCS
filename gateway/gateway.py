#!/usr/bin/env python3
import asyncio
import json
import time
import math
import sys
import argparse
import threading
import queue
from typing import Dict, List, Any, Optional, Set

# Try to import pymavlink and serial
try:
    from pymavlink import mavutil
    import serial
    MAVLINK_AVAILABLE = True
except ImportError:
    MAVLINK_AVAILABLE = False

class Gateway:
    def __init__(self, ws_host: str, ws_port: int, use_mock: bool):
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.use_mock = use_mock or not MAVLINK_AVAILABLE
        
        # UI & Auto-shutdown settings
        self.serve_ui = False
        self.ui_dir = ""
        self.ui_port = 8082
        self.open_browser = False
        self.auto_shutdown = False
        self.shutdown_timeout = 5.0
        self.has_connected = False
        self.shutdown_task = None
        
        # Connection records
        # connection_string -> Master object
        self.active_links: Dict[str, Any] = {}
        # vehicle_id -> Master object
        self.vehicle_masters: Dict[int, Any] = {}
        # vehicle_id -> connection_string
        self.vehicle_link_mapping: Dict[int, str] = {}
        
        self.client_sockets = set()
        
        # Threading queues
        self.to_ws_queue = queue.Queue()
        self.to_drone_queue = queue.Queue()
        
        # Telemetries for multiple vehicles: vehicle_id -> telemetry dict
        self.telemetries: Dict[int, Dict[str, Any]] = {}
        self.telemetry_lock = threading.Lock()
        
        # Mission status: vehicle_id -> mission status dict
        self.mission_statuses: Dict[int, Dict[str, Any]] = {}
        self.mission_lock = threading.Lock()
        
        # Autopilot types for connected vehicles: vehicle_id -> MAV_AUTOPILOT enum value (e.g. 12 is MAV_AUTOPILOT_PX4)
        self.vehicle_autopilots: Dict[int, int] = {
            1: 12, # Pre-fill mock vehicles with PX4
            2: 12
        }
        
        # Active threads list
        self.threads = []
        self.running = True
        
        # For Mock Multi-Drone Simulation
        self.mock_vehicles_state = {
            1: {
                "lat": 24.7746, "lon": 121.0446, "alt": 0.0, "yaw": 90.0,
                "pitch": 0.0, "roll": 0.0, "armed": False, "mode": "HOLD",
                "battery_volts": 25.2, "target_wp_idx": 0, "waypoints": [], "flying": False,
                "target_speed": 11.5
            },
            2: {
                "lat": 24.7760, "lon": 121.0465, "alt": 0.0, "yaw": 180.0,
                "pitch": 0.0, "roll": 0.0, "armed": False, "mode": "HOLD",
                "battery_volts": 24.8, "target_wp_idx": 0, "waypoints": [], "flying": False,
                "target_speed": 9.5
            }
        }

    def start(self):
        print(f"🚀 Starting HGCS Multi-Vehicle Gateway...")
        
        if self.use_mock:
            print("⚠️ Running in MOCK mode (Simulating 2 Vehicles dynamically).")
            self.threads.append(threading.Thread(target=self._mock_telemetry_loop, daemon=True))
        else:
            # We will start default SITL MAVLink UDP connection
            default_conn = "udp:127.0.0.1:14540"
            print(f"🔌 Initializing default MAVLink connection on: {default_conn}")
            self.add_connection(default_conn)
            
        self.threads.append(threading.Thread(target=self._mission_worker_loop, daemon=True))
        
        # Start UI Static Server if enabled
        if self.serve_ui:
            import os
            if os.path.exists(self.ui_dir):
                http_thread = threading.Thread(
                    target=self._run_http_server,
                    args=(self.ui_dir, self.ui_port),
                    daemon=True
                )
                http_thread.start()
                self.threads.append(http_thread)
                
                if self.open_browser:
                    threading.Thread(
                        target=self._open_browser_delayed,
                        args=(f"http://127.0.0.1:{self.ui_port}",),
                        daemon=True
                    ).start()
            else:
                print(f"❌ Cannot serve UI: Directory '{self.ui_dir}' does not exist.")
        
        for t in self.threads:
            if not t.is_alive():
                t.start()
            
        # Start WebSocket server in main thread (asyncio)
        try:
            asyncio.run(self._ws_server_main())
        except KeyboardInterrupt:
            print("\nShutting down Gateway...")
        finally:
            self.running = False

    def add_connection(self, connection_string: str):
        """Spawns a new telemetry loop thread for a given MAVLink connection string."""
        if connection_string in self.active_links:
            print(f"⚠️ Connection link {connection_string} is already active.")
            return True
            
        t = threading.Thread(
            target=self._mavlink_reader_loop, 
            args=(connection_string,), 
            name=f"MAVLink-{connection_string}", 
            daemon=True
        )
        t.start()
        self.threads.append(t)
        return True

    # --- MAVLINK READER THREAD (ONE PER CONNECTION LINK) ---
    def _mavlink_reader_loop(self, connection_string: str):
        print(f"📡 Launching link loop for: {connection_string}")
        master = None
        
        while self.running:
            try:
                master = mavutil.mavlink_connection(connection_string)
                self.active_links[connection_string] = master
                print(f"✅ MAVLink Link established: {connection_string}")
                break
            except Exception as e:
                print(f"❌ Connection error on {connection_string}: {e}. Retrying in 4s...")
                time.sleep(4)
                
        last_telem_send = 0
        gps_satellites = 0
        gps_fix_type = 0
        battery_voltage = 0.0
        battery_percent = 0
        roll = 0.0
        pitch = 0.0
        yaw = 0.0
        heading = 0
        lat = 0.0
        lon = 0.0
        alt = 0.0
        msl_alt = 0.0
        groundspeed = 0.0
        airspeed = 0.0
        armed = False
        mode_str = "UNKNOWN"
        vehicle_id = None
        
        while self.running:
            try:
                # Read incoming MAVLink packets
                msg = master.recv_match(blocking=True, timeout=0.05)
                if msg is None:
                    time.sleep(0.01)
                    continue
                    
                msg_type = msg.get_type()
                src_system = msg.get_srcSystem()
                
                # Ignore invalid system IDs (0 is broadcast/invalid, >=255 are GCS/controllers)
                if src_system <= 0 or src_system >= 255:
                    continue
                    
                if vehicle_id is None or vehicle_id != src_system:
                    vehicle_id = src_system
                    # Bind this vehicle ID to this master interface and connection string
                    self.vehicle_masters[vehicle_id] = master
                    self.vehicle_link_mapping[vehicle_id] = connection_string
                    print(f"🛸 Discovered new Vehicle System ID #{vehicle_id} on {connection_string}")
                
                # Check for heartbeat to get armed state and flight mode
                if msg_type == 'HEARTBEAT':
                    self.vehicle_autopilots[vehicle_id] = msg.autopilot
                    armed = (msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED) > 0
                    custom_mode = msg.custom_mode
                    type_drone = msg.type
                    
                    is_px4 = msg.autopilot == 12
                    if is_px4:
                        # main_mode is byte 3 of custom_mode, sub_mode is byte 4
                        main_mode = (custom_mode >> 8) & 0xFF
                        sub_mode = (custom_mode >> 16) & 0xFF
                        
                        if type_drone in [mavutil.mavlink.MAV_TYPE_QUADROTOR, mavutil.mavlink.MAV_TYPE_HEXAROTOR, 
                                          mavutil.mavlink.MAV_TYPE_FIXED_WING, mavutil.mavlink.MAV_TYPE_OCTOROTOR]:
                            if main_mode == 1:
                                mode_str = "MANUAL"
                            elif main_mode == 2:
                                mode_str = "ALTCTL"
                            elif main_mode == 3:
                                mode_str = "POSCTL"
                            elif main_mode == 4: # Auto
                                if sub_mode == 2:
                                    mode_str = "TAKEOFF"
                                elif sub_mode == 3:
                                    mode_str = "HOLD"
                                elif sub_mode == 4:
                                    mode_str = "MISSION"
                                elif sub_mode == 5:
                                    mode_str = "RTL"
                                elif sub_mode == 6:
                                    mode_str = "LAND"
                                else:
                                    mode_str = f"AUTO_{sub_mode}"
                            elif main_mode == 5:
                                mode_str = "ACRO"
                            elif main_mode == 6:
                                mode_str = "OFFBOARD"
                            elif main_mode == 7:
                                mode_str = "STABILIZED"
                            else:
                                mode_str = f"PX4_MODE_{main_mode}_{sub_mode}"
                        else:
                            mode_str = f"MODE_{custom_mode}"
                    else:
                        # ArduPilot Copter/Sub/etc.
                        apm_modes = {
                            0: "STABILIZE",
                            1: "ACRO",
                            2: "ALT_HOLD",
                            3: "MISSION",  # Map AUTO to MISSION
                            4: "GUIDED",
                            5: "HOLD",     # Map LOITER to HOLD
                            6: "RTL",
                            7: "CIRCLE",
                            9: "LAND",
                            11: "DRIFT",
                            16: "POSHOLD",
                            17: "BRAKE"
                        }
                        mode_str = apm_modes.get(custom_mode, f"APM_MODE_{custom_mode}")
                        
                elif msg_type == 'ATTITUDE':
                    roll = math.degrees(msg.roll)
                    pitch = math.degrees(msg.pitch)
                    yaw = math.degrees(msg.yaw) % 360
                    heading = int(yaw)
                    
                elif msg_type == 'GLOBAL_POSITION_INT':
                    lat = msg.lat / 1e7
                    lon = msg.lon / 1e7
                    alt = msg.relative_alt / 1000.0 # relative to ground/home in meters
                    msl_alt = msg.alt / 1000.0 # absolute altitude above MSL in meters
                    vx = msg.vx / 100.0
                    vy = msg.vy / 100.0
                    groundspeed = math.sqrt(vx*vx + vy*vy)
                    
                elif msg_type == 'VFR_HUD':
                    airspeed = msg.airspeed
                    heading = msg.heading
                    
                elif msg_type == 'SYS_STATUS':
                    battery_voltage = msg.voltage_battery / 1000.0
                    battery_percent = msg.battery_remaining
                    
                elif msg_type == 'GPS_RAW_INT':
                    gps_satellites = msg.satellites_visible
                    gps_fix_type = msg.fix_type
                    
            except Exception as e:
                print(f"⚠️ Error reading MAVLink packet on {connection_string}: {e}")
                time.sleep(0.1)
                
            # Throttle output stream to Web UI at 20Hz
            now = time.time()
            if now - last_telem_send >= 0.050 and vehicle_id is not None:
                last_telem_send = now
                with self.telemetry_lock:
                    self.telemetries[vehicle_id] = {
                        "timestamp": int(now * 1000),
                        "vehicle_id": vehicle_id,
                        "status": {
                            "armed": armed,
                            "mode": mode_str,
                            "battery_percent": battery_percent,
                            "battery_voltage": round(battery_voltage, 2),
                            "gps_satellites": gps_satellites,
                            "gps_fix_type": gps_fix_type,
                            "autopilot": "PX4" if self.vehicle_autopilots.get(vehicle_id, 12) == 12 else "ArduPilot"
                        },
                        "pose": {
                            "roll": round(roll, 2),
                            "pitch": round(pitch, 2),
                            "yaw": round(yaw, 2),
                            "heading": heading
                        },
                        "navigation": {
                            "latitude": round(lat, 6),
                            "longitude": round(lon, 6),
                            "relative_altitude": round(alt, 1),
                            "msl_altitude": round(msl_alt, 1),
                            "airspeed": round(airspeed, 1),
                            "groundspeed": round(groundspeed, 1)
                        }
                    }
                self._queue_telemetry_broadcast(vehicle_id)

    # --- MOCK SIMULATOR ---
    def _mock_telemetry_loop(self):
        """Generates realistic telemetry for 2 mock vehicles at 20Hz."""
        tick = 0
        
        while self.running:
            start_time = time.time()
            
            # Check for incoming controls
            try:
                while not self.to_drone_queue.empty():
                    cmd = self.to_drone_queue.get_nowait()
                    cmd_type = cmd.get("type")
                    vehicle_id = cmd.get("vehicle_id", 1)
                    
                    if vehicle_id in self.mock_vehicles_state:
                        state = self.mock_vehicles_state[vehicle_id]
                        if cmd_type == "arm":
                            state["armed"] = cmd.get("armed", False)
                            if not state["armed"]:
                                state["flying"] = False
                                state["alt"] = 0.0
                            print(f"[Mock #{vehicle_id}] Vehicle armed state set to: {state['armed']}")
                        elif cmd_type == "set_mode":
                            new_mode = cmd.get("mode", "HOLD")
                            state["mode"] = new_mode
                            if state["mode"] == "MISSION" and state["armed"] and state["waypoints"]:
                                state["flying"] = True
                                state["target_wp_idx"] = 0
                            print(f"[Mock #{vehicle_id}] Flight mode set to: {state['mode']}")
                        elif cmd_type == "upload_mission":
                            state["waypoints"] = cmd.get("waypoints", [])
                            print(f"[Mock #{vehicle_id}] Received {len(state['waypoints'])} waypoints.")
                        elif cmd_type == "takeoff":
                            state["armed"] = True
                            state["flying"] = True
                            state["mode"] = "TAKEOFF"
                            state["target_alt"] = cmd.get("altitude", 10.0)
                            print(f"[Mock #{vehicle_id}] Guided Takeoff requested. Target alt: {state['target_alt']}m")
                        elif cmd_type == "change_speed":
                            state["target_speed"] = cmd.get("speed", 10.0)
                            print(f"[Mock #{vehicle_id}] Target speed set to: {state['target_speed']} m/s")
                        elif cmd_type == "land":
                            state["mode"] = "LAND"
                            print(f"[Mock #{vehicle_id}] Guided Land requested.")
                        elif cmd_type == "rtl":
                            state["mode"] = "RTL"
                            state["flying"] = True
                            print(f"[Mock #{vehicle_id}] Guided RTL requested.")
                        elif cmd_type == "pause":
                            state["mode"] = "HOLD"
                            state["flying"] = False
                            print(f"[Mock #{vehicle_id}] Guided Pause requested.")
                        elif cmd_type == "go_to":
                            state["mode"] = "GO_TO"
                            state["flying"] = True
                            state["target_lat"] = cmd.get("latitude")
                            state["target_lon"] = cmd.get("longitude")
                            state["target_alt"] = cmd.get("altitude", state["alt"])
                            print(f"[Mock #{vehicle_id}] Guided Go To requested. Lat/Lon: {state['target_lat']},{state['target_lon']}")
                        elif cmd_type == "orbit":
                            state["mode"] = "ORBIT"
                            state["flying"] = True
                            state["target_lat"] = cmd.get("latitude")
                            state["target_lon"] = cmd.get("longitude")
                            state["target_alt"] = cmd.get("altitude", state["alt"])
                            state["orbit_radius"] = cmd.get("radius", 20.0)
                            state["orbit_angle"] = 0.0
                            print(f"[Mock #{vehicle_id}] Guided Orbit requested. Center Lat/Lon: {state['target_lat']},{state['target_lon']}, Radius: {state['orbit_radius']}m")
            except queue.Empty:
                pass
                
            # Simulate flight dynamics for each vehicle
            for vid, state in self.mock_vehicles_state.items():
                groundspeed = 0.0
                airspeed = 0.0
                roll = state["roll"]
                pitch = state["pitch"]
                yaw = state["yaw"]
                lat = state["lat"]
                lon = state["lon"]
                alt = state["alt"]
                flying = state["flying"]
                waypoints = state["waypoints"]
                target_wp_idx = state["target_wp_idx"]
                armed = state["armed"]
                mode = state["mode"]
                battery_volts = state["battery_volts"]
                
                if flying and mode == "TAKEOFF":
                    # Climb altitude
                    target_alt = state.get("target_alt", 10.0)
                    d_alt = target_alt - alt
                    if d_alt > 0.1:
                        alt += 0.3
                        pitch = 7.0
                        groundspeed = 1.0
                    else:
                        pitch = 0.0
                        mode = "HOLD" # Hover after takeoff
                        state["mode"] = "HOLD"
                        print(f"[Mock #{vid}] Takeoff completed. Hovering.")
                        
                elif flying and mode == "LAND":
                    # Descend
                    if alt > 0.1:
                        alt -= 0.2
                        pitch = -7.0
                        groundspeed = 0.5
                    else:
                        alt = 0.0
                        pitch = 0.0
                        flying = False
                        armed = False
                        mode = "HOLD"
                        state["mode"] = "HOLD"
                        print(f"[Mock #{vid}] Land completed. Disarmed.")
                        
                elif flying and mode == "RTL":
                    # Return to launch home coordinates
                    home_lat = 24.7746 if vid == 1 else 24.7760
                    home_lon = 121.0446 if vid == 1 else 121.0465
                    dy = home_lat - lat
                    dx = home_lon - lon
                    dist = math.sqrt(dx*dx + dy*dy)
                    
                    if dist > 0.00005:
                        groundspeed = state.get("target_speed", 11.5 if vid == 1 else 9.5)
                        airspeed = groundspeed
                        step_size = 0.00001
                        lat += (dy / dist) * step_size
                        lon += (dx / dist) * step_size
                        yaw = math.degrees(math.atan2(dx, dy)) % 360
                        
                        # Set altitude to a safe return alt (e.g. 15m)
                        d_alt = 15.0 - alt
                        if abs(d_alt) > 0.5:
                            alt += math.copysign(0.2, d_alt)
                            pitch = 5.0 if d_alt > 0 else -5.0
                        else:
                            pitch = 0.0
                        roll = 2.0 * math.sin(tick * 0.1)
                    else:
                        # Close enough, land
                        mode = "LAND"
                        state["mode"] = "LAND"
                        print(f"[Mock #{vid}] RTL arrived at Home. Landing...")
                        
                elif flying and mode == "GO_TO":
                    # Guided Reposition
                    target_lat = state.get("target_lat", lat)
                    target_lon = state.get("target_lon", lon)
                    target_alt = state.get("target_alt", alt)
                    
                    dy = target_lat - lat
                    dx = target_lon - lon
                    dist = math.sqrt(dx*dx + dy*dy)
                    
                    if dist > 0.00005:
                        groundspeed = state.get("target_speed", 11.5 if vid == 1 else 9.5)
                        airspeed = groundspeed
                        step_size = 0.00001
                        lat += (dy / dist) * step_size
                        lon += (dx / dist) * step_size
                        yaw = math.degrees(math.atan2(dx, dy)) % 360
                        
                        d_alt = target_alt - alt
                        if abs(d_alt) > 0.5:
                            alt += math.copysign(0.2, d_alt)
                            pitch = 5.0 if d_alt > 0 else -5.0
                        else:
                            pitch = 0.0
                        roll = 2.0 * math.sin(tick * 0.1)
                    else:
                        groundspeed = 0.0
                        pitch = 0.0
                        mode = "HOLD"
                        state["mode"] = "HOLD"
                        print(f"[Mock #{vid}] Guided Go To destination reached. Hovering.")
                        
                elif flying and mode == "ORBIT":
                    # Guided Orbit Center
                    center_lat = state.get("target_lat", lat)
                    center_lon = state.get("target_lon", lon)
                    target_alt = state.get("target_alt", alt)
                    orbit_radius = state.get("orbit_radius", 20.0)
                    angle = state.get("orbit_angle", 0.0)
                    
                    # Convert meters to degrees
                    r_lat_deg = orbit_radius * 0.000009
                    r_lon_deg = orbit_radius * 0.000010
                    
                    # Target point on the circle edge
                    target_lat = center_lat + r_lat_deg * math.cos(angle)
                    target_lon = center_lon + r_lon_deg * math.sin(angle)
                    
                    dy = target_lat - lat
                    dx = target_lon - lon
                    dist = math.sqrt(dx*dx + dy*dy)
                    
                    if dist > 0.00005:
                        # Fly to orbit perimeter first
                        groundspeed = state.get("target_speed", 11.5 if vid == 1 else 9.5)
                        airspeed = groundspeed
                        step_size = 0.00001
                        lat += (dy / dist) * step_size
                        lon += (dx / dist) * step_size
                        yaw = math.degrees(math.atan2(dx, dy)) % 360
                        roll = 2.0 * math.sin(tick * 0.1)
                    else:
                        # Close enough, circle!
                        groundspeed = 5.0
                        airspeed = groundspeed
                        angle += 0.05
                        state["orbit_angle"] = angle
                        lat = center_lat + r_lat_deg * math.cos(angle)
                        lon = center_lon + r_lon_deg * math.sin(angle)
                        # Heading is tangent to circle
                        yaw = math.degrees(angle + math.pi/2) % 360
                        roll = 8.0 # Bank inwards
                        
                    d_alt = target_alt - alt
                    if abs(d_alt) > 0.5:
                        alt += math.copysign(0.2, d_alt)
                        pitch = 5.0 if d_alt > 0 else -5.0
                    else:
                        pitch = 0.0
                        
                elif flying and mode == "MISSION" and waypoints and target_wp_idx < len(waypoints):
                    wp = waypoints[target_wp_idx]
                    wp_lat = wp.get("latitude")
                    wp_lon = wp.get("longitude")
                    wp_alt = wp.get("altitude", 0.0)
                    cmd_name = wp.get("command")
                    
                    if cmd_name == "RTL":
                        wp_lat = 24.7746 if vid == 1 else 24.7760
                        wp_lon = 121.0446 if vid == 1 else 121.0465
                        wp_alt = 0.0
                    
                    # Move drone
                    if wp_lat is not None and wp_lon is not None:
                        dy = wp_lat - lat
                        dx = wp_lon - lon
                        dist = math.sqrt(dx*dx + dy*dy)
                        
                        if dist > 0.00005:
                            groundspeed = state.get("target_speed", 11.5 if vid == 1 else 9.5)
                            airspeed = groundspeed
                            step_size = 0.00001
                            lat += (dy / dist) * step_size
                            lon += (dx / dist) * step_size
                            yaw = math.degrees(math.atan2(dx, dy)) % 360
                            
                            d_alt = wp_alt - alt
                            if abs(d_alt) > 0.5:
                                alt += math.copysign(0.2, d_alt)
                                pitch = 5.0 if d_alt > 0 else -5.0
                            else:
                                pitch = 0.0
                            roll = 2.0 * math.sin(tick * 0.1)
                        else:
                            print(f"[Mock #{vid}] Arrived at WP {target_wp_idx}: {cmd_name}")
                            if cmd_name == "RTL" and alt < 1.0:
                                flying = False
                                armed = False
                                mode = "HOLD"
                                state["mode"] = "HOLD"
                                alt = 0.0
                            else:
                                target_wp_idx += 1
                                if target_wp_idx >= len(waypoints):
                                    flying = False
                                    mode = "HOLD"
                                    state["mode"] = "HOLD"
                    else:
                        if cmd_name == "TAKEOFF":
                            d_alt = wp_alt - alt
                            if d_alt > 0.5:
                                alt += 0.3
                                pitch = 7.0
                                groundspeed = 1.0
                            else:
                                pitch = 0.0
                                target_wp_idx += 1
                        elif cmd_name == "RTL":
                            if alt > 0.5:
                                alt -= 0.3
                                pitch = -7.0
                                groundspeed = 1.0
                            else:
                                alt = 0.0
                                pitch = 0.0
                                flying = False
                                armed = False
                                mode = "HOLD"
                                state["mode"] = "HOLD"
                else:
                    roll = 0.5 * math.sin(tick * 0.05 + vid)
                    pitch = 0.3 * math.cos(tick * 0.07 - vid)
                    
                if armed:
                    battery_volts = max(18.0, battery_volts - (0.002 if flying else 0.0004))
                battery_pct = int(((battery_volts - 18.0) / (25.2 - 18.0)) * 100)
                
                # Update state dict
                state["lat"] = lat
                state["lon"] = lon
                state["alt"] = alt
                state["yaw"] = yaw
                state["pitch"] = pitch
                state["roll"] = roll
                state["armed"] = armed
                state["mode"] = mode
                state["battery_volts"] = battery_volts
                state["target_wp_idx"] = target_wp_idx
                state["flying"] = flying
                
                with self.telemetry_lock:
                    self.telemetries[vid] = {
                        "timestamp": int(time.time() * 1000),
                        "vehicle_id": vid,
                        "status": {
                            "armed": armed,
                            "mode": mode,
                            "battery_percent": battery_pct,
                            "battery_voltage": round(battery_volts, 1),
                            "gps_satellites": 16 if vid == 1 else 14,
                            "gps_fix_type": 4,
                            "autopilot": "PX4"
                        },
                        "pose": {
                            "roll": round(roll, 1),
                            "pitch": round(pitch, 1),
                            "yaw": round(yaw, 1),
                            "heading": int(yaw)
                        },
                        "navigation": {
                            "latitude": round(lat, 6),
                            "longitude": round(lon, 6),
                            "relative_altitude": round(alt, 1),
                            "msl_altitude": round(alt, 1),
                            "airspeed": round(airspeed, 1),
                            "groundspeed": round(groundspeed, 1)
                        }
                    }
                self._queue_telemetry_broadcast(vid)
                
            tick += 1
            elapsed = time.time() - start_time
            time.sleep(max(0.001, 0.050 - elapsed))

    def _queue_telemetry_broadcast(self, vehicle_id: int):
        with self.telemetry_lock:
            telem_data = json.dumps({
                "type": "telemetry",
                "vehicle_id": vehicle_id,
                "data": self.telemetries[vehicle_id]
            })
        self.to_ws_queue.put(telem_data)

    # --- DYNAMIC COMMAND / MISSION ROUTER ---
    def _mission_worker_loop(self):
        while self.running:
            try:
                task = self.to_drone_queue.get(timeout=0.5)
                task_type = task.get("type")
                vehicle_id = task.get("vehicle_id", 1)
                
                if task_type == "upload_mission":
                    self._handle_upload_mission(task)
                elif not self.use_mock:
                    if task_type == "arm":
                        self._handle_arm_disarm(vehicle_id, task.get("armed", False))
                    elif task_type == "set_mode":
                        self._handle_change_mode(vehicle_id, task.get("mode", "HOLD"))
                    elif task_type == "takeoff":
                        self._handle_takeoff(vehicle_id, task.get("altitude", 10.0))
                    elif task_type == "land":
                        self._handle_land(vehicle_id)
                    elif task_type == "rtl":
                        self._handle_rtl(vehicle_id)
                    elif task_type == "pause":
                        self._handle_pause(vehicle_id)
                    elif task_type == "go_to":
                        self._handle_go_to(vehicle_id, task.get("latitude"), task.get("longitude"), task.get("altitude"))
                    elif task_type == "orbit":
                        self._handle_orbit(vehicle_id, task.get("latitude"), task.get("longitude"), task.get("altitude"), task.get("radius", 20.0))
                    elif task_type == "change_speed":
                        self._handle_change_speed(vehicle_id, task.get("speed", 10.0))
                    
            except queue.Empty:
                pass
            except Exception as e:
                print(f"❌ Error in mission worker: {e}")

    def _update_mission_status(self, vehicle_id: int, mission_id: str, state: str, progress: int, message: str):
        with self.mission_lock:
            self.mission_statuses[vehicle_id] = {
                "mission_id": mission_id,
                "state": state,
                "progress": progress,
                "message": message
            }
        msg = json.dumps({
            "type": "mission_status",
            "vehicle_id": vehicle_id,
            "data": self.mission_statuses[vehicle_id]
        })
        self.to_ws_queue.put(msg)
        print(f"📋 Vehicle #{vehicle_id} Mission [{state}] progress: {progress}% - {message}")

    def _handle_upload_mission(self, task: Dict[str, Any]):
        mission_id = task.get("mission_id", "")
        waypoints = task.get("waypoints", [])
        vehicle_id = task.get("vehicle_id", 1)
        
        if not waypoints:
            self._update_mission_status(vehicle_id, mission_id, "ERROR", 0, "No waypoints provided")
            return
            
        self._update_mission_status(vehicle_id, mission_id, "UPLOADING", 10, "Starting mission upload...")
        
        if self.use_mock:
            total = len(waypoints)
            for i in range(total):
                time.sleep(0.3)
                pct = int(10 + (i / total) * 80)
                self._update_mission_status(vehicle_id, mission_id, "UPLOADING", pct, f"Sending waypoint {i+1} of {total}")
            time.sleep(0.3)
            self._update_mission_status(vehicle_id, mission_id, "SUCCESS", 100, "Mission uploaded successfully")
            return

        # Real MAVLink Mission Protocol Upload
        try:
            master = self.vehicle_masters.get(vehicle_id)
            if not master:
                self._update_mission_status(vehicle_id, mission_id, "ERROR", 0, f"Vehicle #{vehicle_id} not connected")
                return

            target_sys = vehicle_id
            target_comp = 1
            
            self._update_mission_status(vehicle_id, mission_id, "UPLOADING", 15, "Preparing waypoints...")
            
            # Map waypoints
            mav_items = []
            
            # Determine if we should prepend home point at seq 0.
            # PX4 does not use seq 0 as Home; it treats seq 0 as the first mission item.
            # ArduPilot uses seq 0 as Home.
            is_px4 = self.vehicle_autopilots.get(vehicle_id, 12) == 12 # 12 is MAV_AUTOPILOT_PX4
            
            if not is_px4:
                home_lat = waypoints[0].get("latitude", 0.0)
                home_lon = waypoints[0].get("longitude", 0.0)
                home_alt = 0.0
                # Add home pos at seq 0 for non-PX4 autopilots
                mav_items.append({
                    "seq": 0,
                    "command": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                    "frame": 0,
                    "current": 0,
                    "autocontinue": 1,
                    "p1": 0, "p2": 0, "p3": 0, "p4": 0,
                    "x": int(home_lat * 1e7), "y": int(home_lon * 1e7), "z": float(home_alt)
                })
            
            for wp in waypoints:
                cmd_str = wp.get("command", "WAYPOINT")
                lat = wp.get("latitude", 0.0)
                lon = wp.get("longitude", 0.0)
                alt = wp.get("altitude", 10.0)
                hold_time = wp.get("hold_time", 0.0)
                loiter_radius = wp.get("radius", 20.0) if cmd_str == "LOITER" else 0.0
                
                if cmd_str == "TAKEOFF":
                    cmd = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
                elif cmd_str == "RTL":
                    if is_px4:
                        # PX4 internal mission navigator does not support RTL inside mission sequence.
                        # Map RTL to LAND (21) at home/takeoff coordinates.
                        cmd = mavutil.mavlink.MAV_CMD_NAV_LAND
                        home_lat = 0.0
                        home_lon = 0.0
                        if vehicle_id in self.telemetries:
                            nav = self.telemetries[vehicle_id].get("navigation", {})
                            home_lat = nav.get("latitude", 0.0)
                            home_lon = nav.get("longitude", 0.0)
                        
                        if home_lat == 0.0 or home_lon == 0.0:
                            home_lat = waypoints[0].get("latitude", 0.0)
                            home_lon = waypoints[0].get("longitude", 0.0)
                        
                        lat = home_lat
                        lon = home_lon
                        alt = 0.0
                    else:
                        cmd = mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH
                elif cmd_str == "LAND":
                    cmd = mavutil.mavlink.MAV_CMD_NAV_LAND
                elif cmd_str == "LOITER":
                    cmd = mavutil.mavlink.MAV_CMD_NAV_LOITER_UNLIM
                else:
                    cmd = mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
                    
                mav_items.append({
                    "seq": len(mav_items),
                    "command": cmd,
                    "frame": mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    "current": 0,
                    "autocontinue": 1,
                    "p1": float(hold_time),
                    "p2": 2.0, 
                    "p3": float(loiter_radius), 
                    "p4": 0.0,
                    "x": int(lat * 1e7), "y": int(lon * 1e7), "z": float(alt)
                })
                
            print(f"📋 Compiled MAVLink mission items to send to Vehicle #{vehicle_id}:")
            for item in mav_items:
                print(f"  Seq: {item['seq']}, Cmd: {item['command']}, Frame: {item['frame']}, x: {item['x']}, y: {item['y']}, z: {item['z']}, p1: {item['p1']}, p2: {item['p2']}, p3: {item['p3']}, p4: {item['p4']}")
                
            count = len(mav_items)
            master.mav.mission_count_send(target_sys, target_comp, count)
            
            retries = 5
            last_request_time = time.time()
            ack_msg = None
            
            while True:
                msg = master.recv_match(type=['MISSION_REQUEST', 'MISSION_REQUEST_INT', 'MISSION_ACK'], blocking=True, timeout=1.0)
                if not msg:
                    if time.time() - last_request_time > 2.0:
                        retries -= 1
                        if retries <= 0:
                            raise TimeoutError("Timeout waiting for MISSION_REQUEST or MISSION_ACK")
                        print(f"⚠️ Resending mission count to #{vehicle_id} (Retries left: {retries})")
                        master.mav.mission_count_send(target_sys, target_comp, count)
                        last_request_time = time.time()
                    continue
                    
                retries = 5
                last_request_time = time.time()
                
                if msg.get_type() == 'MISSION_ACK':
                    ack_msg = msg
                    break
                    
                seq = msg.seq
                if seq >= count:
                    print(f"⚠️ Received request for seq {seq} >= count {count}, ignoring")
                    continue
                    
                item = mav_items[seq]
                pct = int(20 + (seq / count) * 70)
                self._update_mission_status(vehicle_id, mission_id, "UPLOADING", pct, f"Sending waypoint {seq} of {count-1}")
                
                if msg.get_type() == 'MISSION_REQUEST':
                    # Legacy float MISSION_ITEM: Map INT frames to FLOAT frames
                    frame = item["frame"]
                    if frame == 11:
                        frame = 3
                    elif frame == 5:
                        frame = 0
                    
                    master.mav.mission_item_send(
                        target_sys, target_comp,
                        item["seq"], frame, item["command"],
                        item["current"], item["autocontinue"],
                        item["p1"], item["p2"], item["p3"], item["p4"],
                        float(item["x"]) / 1e7, float(item["y"]) / 1e7, item["z"]
                    )
                else:
                    # MISSION_ITEM_INT: Map FLOAT frames to INT frames
                    frame = item["frame"]
                    if frame == 3:
                        frame = 11
                    elif frame == 0:
                        frame = 5
                        
                    master.mav.mission_item_int_send(
                        target_sys, target_comp,
                        item["seq"], frame, item["command"],
                        item["current"], item["autocontinue"],
                        item["p1"], item["p2"], item["p3"], item["p4"],
                        item["x"], item["y"], item["z"]
                    )
            if ack_msg:
                if ack_msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                    self._update_mission_status(vehicle_id, mission_id, "SUCCESS", 100, "Mission uploaded successfully")
                else:
                    self._update_mission_status(
                        vehicle_id, mission_id, "ERROR", 100, 
                        f"Mission upload rejected by flight controller. Code: {ack_msg.type}"
                    )
            else:
                self._update_mission_status(vehicle_id, mission_id, "ERROR", 100, "Timeout waiting for MISSION_ACK from autopilot")
                
        except Exception as e:
            self._update_mission_status(vehicle_id, mission_id, "ERROR", 0, f"Upload error: {str(e)}")

    def _handle_arm_disarm(self, vehicle_id: int, arm: bool):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        cmd = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
        master.mav.command_long_send(
            vehicle_id, 1, cmd, 0,
            1.0 if arm else 0.0, 0, 0, 0, 0, 0, 0
        )
        print(f"⚙️ MAVLink arm command sent to Vehicle #{vehicle_id}: {arm}")

    def _handle_change_mode(self, vehicle_id: int, mode: str):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
            
        is_px4 = self.vehicle_autopilots.get(vehicle_id, 12) == 12 # 12 is MAV_AUTOPILOT_PX4
        
        if is_px4:
            PX4_CUSTOM_MAIN_MODE_AUTO = 4
            mode_mapping = {
                "HOLD": (PX4_CUSTOM_MAIN_MODE_AUTO, 3),
                "MISSION": (PX4_CUSTOM_MAIN_MODE_AUTO, 4),
                "RTL": (PX4_CUSTOM_MAIN_MODE_AUTO, 5),
            }
            if mode in mode_mapping:
                main_mode, sub_mode = mode_mapping[mode]
                custom_mode = (sub_mode << 16) | (main_mode << 8)
                master.mav.set_mode_send(
                    vehicle_id,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    custom_mode
                )
                print(f"⚙️ MAVLink mode set for Vehicle #{vehicle_id}: PX4 {mode} (main {main_mode}, sub {sub_mode})")
        else:
            # ArduPilot Copter custom modes
            # AUTO = 3, LOITER = 5, RTL = 6, LAND = 9
            mode_mapping = {
                "HOLD": 5,     # LOITER
                "MISSION": 3,  # AUTO
                "RTL": 6,      # RTL
                "LAND": 9      # LAND
            }
            if mode in mode_mapping:
                custom_mode = mode_mapping[mode]
                master.mav.set_mode_send(
                    vehicle_id,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    custom_mode
                )
                print(f"⚙️ MAVLink mode set for Vehicle #{vehicle_id}: ArduPilot {mode} ({custom_mode})")

    def _handle_takeoff(self, vehicle_id: int, altitude: float):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        # Arm first
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0,
            1.0, 0, 0, 0, 0, 0, 0
        )
        time.sleep(0.5)
        
        # Read vehicle's current Lat, Lon, MSL altitude and relative altitude from telemetry
        lat = float('nan')
        lon = float('nan')
        msl_alt = 0.0
        rel_alt = 0.0
        with self.telemetry_lock:
            if vehicle_id in self.telemetries:
                nav = self.telemetries[vehicle_id].get("navigation", {})
                lat = nav.get("latitude", float('nan'))
                lon = nav.get("longitude", float('nan'))
                msl_alt = nav.get("msl_altitude", 0.0)
                rel_alt = nav.get("relative_altitude", 0.0)
                
                # Check for invalid coordinates
                if lat == 0.0:
                    lat = float('nan')
                if lon == 0.0:
                    lon = float('nan')
        
        # Calculate takeoff point MSL elevation: Home MSL = Current MSL - Current Relative
        home_msl = msl_alt - rel_alt
        
        # Calculate target absolute MSL altitude if we have a valid MSL altitude.
        target_alt = float(altitude)
        if msl_alt != 0.0:
            target_alt += home_msl

        # Takeoff command with correct coordinates (param5=lat, param6=lon) and absolute MSL height (param7)
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0,
            0.0, 0.0, 0.0, 0.0, lat, lon, target_alt
        )
        print(f"⚙️ MAVLink takeoff command sent to Vehicle #{vehicle_id} target_alt={target_alt} (rel={altitude}, home_msl={home_msl}) lat={lat} lon={lon}")

    def _handle_land(self, vehicle_id: int):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_NAV_LAND, 0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        )
        print(f"⚙️ MAVLink land command sent to Vehicle #{vehicle_id}")

    def _handle_rtl(self, vehicle_id: int):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        )
        print(f"⚙️ MAVLink RTL command sent to Vehicle #{vehicle_id}")

    def _handle_pause(self, vehicle_id: int):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_DO_PAUSE, 0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
        )
        print(f"⚙️ MAVLink pause command sent to Vehicle #{vehicle_id}")

    def _handle_go_to(self, vehicle_id: int, lat: float, lon: float, alt: float):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        
        # Read current MSL altitude and relative altitude from telemetry
        # to calculate the home point (takeoff ground) elevation as baseline.
        msl_alt = 0.0
        rel_alt = 0.0
        with self.telemetry_lock:
            if vehicle_id in self.telemetries:
                nav = self.telemetries[vehicle_id].get("navigation", {})
                msl_alt = nav.get("msl_altitude", 0.0)
                rel_alt = nav.get("relative_altitude", 0.0)
                
        # Calculate takeoff point MSL elevation: Home MSL = Current MSL - Current Relative
        home_msl = msl_alt - rel_alt
        
        target_alt = float(alt)
        if msl_alt != 0.0:
            target_alt += home_msl

        # Use command_int_send with MAV_FRAME_GLOBAL_RELATIVE_ALT to prevent precision issues (causing negative notify)
        master.mav.command_int_send(
            vehicle_id, 1,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            mavutil.mavlink.MAV_CMD_DO_REPOSITION,
            0, 0,
            -1.0, 0.0, 0.0, float('nan'),
            int(float(lat) * 1e7), int(float(lon) * 1e7), target_alt
        )
        print(f"⚙️ MAVLink reposition (Go To) sent to Vehicle #{vehicle_id}: lat={lat}, lon={lon}, target_alt={target_alt} (rel={alt}, home_msl={home_msl})")

    def _handle_orbit(self, vehicle_id: int, lat: float, lon: float, alt: float, radius: float):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
            
        # Read current MSL altitude and relative altitude from telemetry
        # to calculate the home point (takeoff ground) elevation as baseline.
        msl_alt = 0.0
        rel_alt = 0.0
        with self.telemetry_lock:
            if vehicle_id in self.telemetries:
                nav = self.telemetries[vehicle_id].get("navigation", {})
                msl_alt = nav.get("msl_altitude", 0.0)
                rel_alt = nav.get("relative_altitude", 0.0)
                
        # Calculate takeoff point MSL elevation: Home MSL = Current MSL - Current Relative
        home_msl = msl_alt - rel_alt
        
        target_alt = float(alt)
        if msl_alt != 0.0:
            target_alt += home_msl

        # Use command_int_send with MAV_FRAME_GLOBAL_RELATIVE_ALT to prevent coordinate error and negative notify
        master.mav.command_int_send(
            vehicle_id, 1,
            mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
            mavutil.mavlink.MAV_CMD_DO_ORBIT,
            0, 0,
            float(radius), float('nan'), 0.0, 0.0,
            int(float(lat) * 1e7), int(float(lon) * 1e7), target_alt
        )
        print(f"⚙️ MAVLink DO_ORBIT command sent to Vehicle #{vehicle_id}: center={lat},{lon}, target_alt={target_alt} (rel={alt}, home_msl={home_msl}), radius={radius}")

    def _handle_change_speed(self, vehicle_id: int, speed: float):
        master = self.vehicle_masters.get(vehicle_id)
        if not master:
            return
        # MAV_CMD_DO_CHANGE_SPEED: param1=1 (Groundspeed), param2=speed, param3=-1, param4=0
        master.mav.command_long_send(
            vehicle_id, 1, mavutil.mavlink.MAV_CMD_DO_CHANGE_SPEED, 0,
            1.0, float(speed), -1.0, 0.0, 0.0, 0.0, 0.0
        )
        print(f"⚙️ MAVLink DO_CHANGE_SPEED command sent to Vehicle #{vehicle_id}: speed={speed} m/s")

    # --- STATIC HTTP SERVER & AUTO-SHUTDOWN UTILITIES ---
    def _run_http_server(self, directory: str, port: int):
        import http.server
        import socketserver
        
        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=directory, **kwargs)
            def log_message(self, format, *args):
                pass # Suppress standard HTTP logs to keep stdout clean
                
        socketserver.TCPServer.allow_reuse_address = True
        try:
            with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
                print(f"📁 Web UI static server serving at http://127.0.0.1:{port}")
                httpd.serve_forever()
        except Exception as e:
            print(f"⚠️ HTTP static server failed to start on port {port}: {e}")

    def _open_browser_delayed(self, url: str):
        time.sleep(1.0)
        import webbrowser
        print(f"🌐 Opening default web browser to {url}...")
        webbrowser.open(url)

    async def _auto_shutdown_countdown(self):
        try:
            await asyncio.sleep(self.shutdown_timeout)
            if len(self.client_sockets) == 0:
                print(f"⏳ Auto-shutdown timer expired ({self.shutdown_timeout}s). No clients connected. Shutting down Gateway...")
                self.running = False
                import os
                os._exit(0)
        except asyncio.CancelledError:
            pass

    # --- WEBSOCKET COMMUNICATION (ASYNCIO) ---
    async def _ws_broadcast_loop(self):
        """Pops telemetry/status messages and broadcasts to all Web UI clients."""
        while self.running:
            try:
                messages = []
                while not self.to_ws_queue.empty() and len(messages) < 100:
                    messages.append(self.to_ws_queue.get_nowait())
                
                if messages and self.client_sockets:
                    # Filter and broadcast updates
                    for client in list(self.client_sockets):
                        for m_to_send in messages:
                            try:
                                await client.send(m_to_send)
                            except Exception:
                                self.client_sockets.remove(client)
            except Exception as e:
                pass
                
            await asyncio.sleep(0.01)

    async def _ws_handler(self, websocket):
        print(f"🔌 Web UI Client connected: {websocket.remote_address}")
        self.client_sockets.add(websocket)
        self.has_connected = True
        
        # Cancel any pending shutdown countdown if a new client connects
        if self.shutdown_task and not self.shutdown_task.done():
            self.shutdown_task.cancel()
            print("🕒 Auto-shutdown countdown cancelled (client reconnected).")
            
        # Immediately notify the list of active links
        await websocket.send(json.dumps({
            "type": "links_list",
            "data": list(self.active_links.keys())
        }))
        
        # Send system info (such as mock mode status)
        await websocket.send(json.dumps({
            "type": "system_info",
            "data": {
                "use_mock": self.use_mock
            }
        }))
        
        try:
            async for message in websocket:
                try:
                    payload = json.loads(message)
                    action = payload.get("action")
                    data = payload.get("data", {})
                    vehicle_id = data.get("vehicle_id", 1)
                    
                    if action == "add_connection":
                        conn_type = data.get("type", "udp")
                        role = data.get("role", "server") # "server" or "client"
                        conn_str = ""
                        
                        if conn_type == "udp":
                            port = data.get("port", 14540)
                            if role == "server":
                                # Bind locally to receive telemetry (udpin)
                                host = data.get("host", "0.0.0.0")
                                conn_str = f"udpin:{host}:{port}"
                            else:
                                # Send out packets to a target IP (udpout)
                                host = data.get("host", "127.0.0.1")
                                conn_str = f"udpout:{host}:{port}"
                        elif conn_type == "tcp":
                            host = data.get("host", "127.0.0.1")
                            port = data.get("port", 5760)
                            if role == "server":
                                # Bind locally and listen for incoming client (tcpin)
                                host_ip = data.get("host", "0.0.0.0")
                                conn_str = f"tcpin:{host_ip}:{port}"
                            else:
                                # Connect to a remote tcp server (tcp client)
                                conn_str = f"tcp:{host}:{port}"
                        elif conn_type == "serial":
                            port_path = data.get("port", "/dev/ttyUSB0")
                            baud = data.get("baud", 57600)
                            conn_str = f"{port_path}:{baud}"
                            
                        if conn_str:
                            print(f"🔌 WebSocket requested to add connection: {conn_str}")
                            self.add_connection(conn_str)
                            
                            # Reply with updated links list
                            await websocket.send(json.dumps({
                                "type": "links_list",
                                "data": list(self.active_links.keys())
                            }))
                            
                    elif action == "arm":
                        armed = data.get("armed", False)
                        self.to_drone_queue.put({"type": "arm", "vehicle_id": vehicle_id, "armed": armed})
                    elif action == "set_mode":
                        mode = data.get("mode", "HOLD")
                        self.to_drone_queue.put({"type": "set_mode", "vehicle_id": vehicle_id, "mode": mode})
                    elif action == "takeoff":
                        alt = data.get("altitude", 10.0)
                        self.to_drone_queue.put({"type": "takeoff", "vehicle_id": vehicle_id, "altitude": alt})
                    elif action == "land":
                        self.to_drone_queue.put({"type": "land", "vehicle_id": vehicle_id})
                    elif action == "rtl":
                        self.to_drone_queue.put({"type": "rtl", "vehicle_id": vehicle_id})
                    elif action == "pause":
                        self.to_drone_queue.put({"type": "pause", "vehicle_id": vehicle_id})
                    elif action == "go_to":
                        lat = data.get("latitude")
                        lon = data.get("longitude")
                        alt = data.get("altitude")
                        self.to_drone_queue.put({
                            "type": "go_to", 
                            "vehicle_id": vehicle_id, 
                            "latitude": lat, 
                            "longitude": lon, 
                            "altitude": alt
                        })
                    elif action == "orbit":
                        lat = data.get("latitude")
                        lon = data.get("longitude")
                        alt = data.get("altitude")
                        radius = data.get("radius", 20.0)
                        self.to_drone_queue.put({
                            "type": "orbit", 
                            "vehicle_id": vehicle_id, 
                            "latitude": lat, 
                            "longitude": lon, 
                            "altitude": alt,
                            "radius": radius
                        })
                    elif action == "upload_mission":
                        waypoints = data.get("waypoints", [])
                        mission_id = data.get("mission_id", "mission")
                        self.to_drone_queue.put({
                            "type": "upload_mission",
                            "vehicle_id": vehicle_id,
                            "mission_id": mission_id,
                            "waypoints": waypoints
                        })
                    elif action == "change_speed":
                        speed = data.get("speed", 10.0)
                        self.to_drone_queue.put({
                            "type": "change_speed",
                            "vehicle_id": vehicle_id,
                            "speed": speed
                        })
                    else:
                        print(f"❓ Unknown action: {action}")
                except Exception as e:
                    print(f"⚠️ Error parsing payload: {e}")
        except Exception:
            pass
        finally:
            print(f"🔌 Web UI Client disconnected: {websocket.remote_address}")
            if websocket in self.client_sockets:
                self.client_sockets.remove(websocket)
            
            # If auto-shutdown is enabled and no active sockets are left, trigger shutdown timer
            if self.auto_shutdown and len(self.client_sockets) == 0:
                print(f"🕒 No clients connected. Initiating {self.shutdown_timeout}s auto-shutdown countdown...")
                self.shutdown_task = asyncio.create_task(self._auto_shutdown_countdown())

    async def _ws_server_main(self):
        import websockets
        async with websockets.serve(self._ws_handler, self.ws_host, self.ws_port):
            print(f"🌐 WebSocket Server running on ws://{self.ws_host}:{self.ws_port}")
            await self._ws_broadcast_loop()

if __name__ == "__main__":
    import os
    parser = argparse.ArgumentParser(description="HGCS Multi-Vehicle Gateway")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="WebSocket host")
    parser.add_argument("--port", type=int, default=8080, help="WebSocket port")
    parser.add_argument("--mock", action="store_true", help="Force multi-drone mock telemetry")
    
    # Static serving arguments
    parser.add_argument("--no-serve", dest="serve", action="store_false", help="Do not serve web UI static files")
    parser.add_argument("--serve-dir", type=str, default="", help="Path to static UI directory (default: relative to gateway file ../web-ui/dist)")
    parser.add_argument("--serve-port", type=int, default=8082, help="Port to serve web UI on")
    parser.add_argument("--no-open", dest="open", action="store_false", help="Do not automatically open default browser")
    parser.add_argument("--no-shutdown", dest="auto_shutdown", action="store_false", help="Do not auto-shutdown when web UI is closed")
    parser.add_argument("--shutdown-timeout", type=float, default=5.0, help="Seconds to wait before shutting down after client disconnects")
    parser.set_defaults(serve=True, open=True, auto_shutdown=True)
    
    args = parser.parse_args()
    
    # Resolve default UI directory relative to this script
    base_dir = os.path.dirname(os.path.abspath(__file__))
    default_ui_dir = os.path.abspath(os.path.join(base_dir, "../web-ui/dist"))
    ui_dir = args.serve_dir if args.serve_dir else default_ui_dir
    
    gateway = Gateway(
        ws_host=args.host,
        ws_port=args.port,
        use_mock=args.mock
    )
    
    gateway.serve_ui = args.serve
    gateway.ui_dir = ui_dir
    gateway.ui_port = args.serve_port
    gateway.open_browser = args.open
    gateway.auto_shutdown = args.auto_shutdown
    gateway.shutdown_timeout = args.shutdown_timeout
    
    gateway.start()
