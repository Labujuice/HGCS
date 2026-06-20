#!/usr/bin/env python3
import asyncio
import json
import time
import math
import sys
import argparse
import threading
import queue
from typing import Dict, List, Any, Optional

# Try to import pymavlink and serial
try:
    from pymavlink import mavutil
    import serial
    MAVLINK_AVAILABLE = True
except ImportError:
    MAVLINK_AVAILABLE = False

class Gateway:
    def __init__(self, connection_string: str, ws_host: str, ws_port: int, use_mock: bool):
        self.connection_string = connection_string
        self.ws_host = ws_host
        self.ws_port = ws_port
        self.use_mock = use_mock or not MAVLINK_AVAILABLE
        
        # Connection state
        self.master = None
        self.vehicle_id = 1
        self.client_sockets = set()
        
        # Threading queues
        self.to_ws_queue = queue.Queue()
        self.to_drone_queue = queue.Queue()
        
        # Telemetry Cache
        self.telemetry = {
            "timestamp": 0,
            "vehicle_id": 1,
            "status": {
                "armed": False,
                "mode": "DISCONNECTED",
                "battery_percent": 0,
                "battery_voltage": 0.0,
                "gps_satellites": 0,
                "gps_fix_type": 0
            },
            "pose": {
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "heading": 0
            },
            "navigation": {
                "latitude": 24.7746,
                "longitude": 121.0446,
                "relative_altitude": 0.0,
                "airspeed": 0.0,
                "groundspeed": 0.0
            }
        }
        
        # Lock for telemetry access
        self.telemetry_lock = threading.Lock()
        
        # Mission state
        self.mission_status = {
            "mission_id": "",
            "state": "IDLE",
            "progress": 0,
            "message": ""
        }
        self.mission_lock = threading.Lock()
        
        # Active threads
        self.threads = []
        self.running = True

    def start(self):
        print(f"🚀 Starting HGCS Gateway...")
        if self.use_mock:
            print("⚠️ Running in MOCK mode (No MAVLink physical connection).")
            self.threads.append(threading.Thread(target=self._mock_telemetry_loop, daemon=True))
        else:
            print(f"🔌 Connecting to MAVLink device: {self.connection_string}")
            self.threads.append(threading.Thread(target=self._mavlink_loop, daemon=True))
            
        self.threads.append(threading.Thread(target=self._mission_worker_loop, daemon=True))
        
        for t in self.threads:
            t.start()
            
        # Start WebSocket server in main thread (asyncio)
        try:
            asyncio.run(self._ws_server_main())
        except KeyboardInterrupt:
            print("\nShutting down Gateway...")
        finally:
            self.running = False

    # --- MOCK SIMULATOR ---
    def _mock_telemetry_loop(self):
        """Generates realistic telemetry at 20Hz."""
        tick = 0
        lat, lon = 24.7746, 121.0446
        alt = 0.0
        yaw = 90.0
        pitch = 0.0
        roll = 0.0
        armed = False
        mode = "HOLD"
        battery_pct = 100
        battery_volts = 25.2
        
        # For mock flight path
        target_wp_idx = 0
        waypoints = []
        flying = False
        
        while self.running:
            start_time = time.time()
            
            # Check for control commands from WebSocket
            try:
                while not self.to_drone_queue.empty():
                    cmd = self.to_drone_queue.get_nowait()
                    cmd_type = cmd.get("type")
                    if cmd_type == "arm":
                        armed = cmd.get("armed", False)
                        if armed:
                            mode = "HOLD"
                        else:
                            mode = "HOLD"
                            flying = False
                            alt = 0.0
                        print(f"[Mock] Vehicle armed state set to: {armed}")
                    elif cmd_type == "set_mode":
                        new_mode = cmd.get("mode", "HOLD")
                        mode = new_mode
                        if mode == "MISSION" and armed and waypoints:
                            flying = True
                            target_wp_idx = 0
                        print(f"[Mock] Flight mode set to: {mode}")
                    elif cmd_type == "upload_mission":
                        waypoints = cmd.get("waypoints", [])
                        print(f"[Mock] Received {len(waypoints)} waypoints for simulation.")
            except queue.Empty:
                pass
                
            # Simulate flight dynamics if flying
            groundspeed = 0.0
            airspeed = 0.0
            if flying and waypoints and target_wp_idx < len(waypoints):
                wp = waypoints[target_wp_idx]
                wp_lat = wp.get("latitude")
                wp_lon = wp.get("longitude")
                wp_alt = wp.get("altitude", 0.0)
                cmd_name = wp.get("command")
                
                if cmd_name == "RTL":
                    # RTL returns to home (first takeoff point or start point)
                    wp_lat = 24.7746
                    wp_lon = 121.0446
                    wp_alt = 0.0
                
                # Move drone towards waypoint
                if wp_lat is not None and wp_lon is not None:
                    dy = wp_lat - lat
                    dx = wp_lon - lon
                    dist = math.sqrt(dx*dx + dy*dy)
                    
                    if dist > 0.00005: # Not yet arrived
                        groundspeed = 10.0 # 10 m/s
                        airspeed = 10.0
                        step_size = 0.00001 # approx 1m step at 20Hz
                        lat += (dy / dist) * step_size
                        lon += (dx / dist) * step_size
                        yaw = math.degrees(math.atan2(dx, dy)) % 360
                        
                        # Climb/descend
                        d_alt = wp_alt - alt
                        if abs(d_alt) > 0.5:
                            alt += math.copysign(0.2, d_alt)
                            pitch = 5.0 if d_alt > 0 else -5.0
                        else:
                            pitch = 0.0
                        roll = 2.0 * math.sin(tick * 0.1) # slight banking
                    else:
                        # Arrived at waypoint
                        print(f"[Mock] Arrived at waypoint {target_wp_idx}: {cmd_name}")
                        hold_time = wp.get("hold_time", 0)
                        if hold_time > 0:
                            # Wait hold time (mocked simply by advancing index next tick)
                            pass
                        
                        if cmd_name == "RTL" and alt < 1.0:
                            flying = False
                            armed = False
                            mode = "HOLD"
                            print("[Mock] RTL completed. Drone landed and disarmed.")
                        else:
                            target_wp_idx += 1
                            if target_wp_idx >= len(waypoints):
                                # If finished all and no RTL, hold
                                flying = False
                                mode = "HOLD"
                                print("[Mock] Finished all waypoints. Holding position.")
                else:
                    # e.g. TAKEOFF or RTL with no specific lat/lon
                    if cmd_name == "TAKEOFF":
                        d_alt = wp_alt - alt
                        if d_alt > 0.5:
                            alt += 0.3
                            pitch = 8.0
                            groundspeed = 1.0
                        else:
                            pitch = 0.0
                            target_wp_idx += 1
                    elif cmd_name == "RTL":
                        # Descend to ground
                        if alt > 0.5:
                            alt -= 0.3
                            pitch = -8.0
                            groundspeed = 1.0
                        else:
                            alt = 0.0
                            pitch = 0.0
                            flying = False
                            armed = False
                            mode = "HOLD"
                            print("[Mock] RTL completed. Landed and disarmed.")
            
            # Oscillate attitude slightly to look alive
            if not flying:
                roll = 0.5 * math.sin(tick * 0.05)
                pitch = 0.3 * math.cos(tick * 0.07)
                groundspeed = 0.0
                airspeed = 0.0
                if armed:
                    # Slowly drain battery when armed
                    battery_volts = max(18.0, battery_volts - 0.0005)
                    battery_pct = int(((battery_volts - 18.0) / (25.2 - 18.0)) * 100)
            else:
                battery_volts = max(18.0, battery_volts - 0.002)
                battery_pct = int(((battery_volts - 18.0) / (25.2 - 18.0)) * 100)
                
            tick += 1
            
            with self.telemetry_lock:
                self.telemetry = {
                    "timestamp": int(time.time() * 1000),
                    "vehicle_id": self.vehicle_id,
                    "status": {
                        "armed": armed,
                        "mode": mode,
                        "battery_percent": battery_pct,
                        "battery_voltage": round(battery_volts, 2),
                        "gps_satellites": 18 if armed else 12,
                        "gps_fix_type": 4 # 3D RTK Fix
                    },
                    "pose": {
                        "roll": round(roll, 2),
                        "pitch": round(pitch, 2),
                        "yaw": round(yaw, 2),
                        "heading": int(yaw)
                    },
                    "navigation": {
                        "latitude": round(lat, 6),
                        "longitude": round(lon, 6),
                        "relative_altitude": round(alt, 1),
                        "airspeed": round(airspeed, 1),
                        "groundspeed": round(groundspeed, 1)
                    }
                }
                
            # Broadcast telemetry to websocket queue
            self._queue_telemetry_broadcast()
            
            # 20Hz -> 50ms period
            elapsed = time.time() - start_time
            sleep_time = max(0.001, 0.050 - elapsed)
            time.sleep(sleep_time)

    # --- MAVLINK TELEMETRY LOOP ---
    def _mavlink_loop(self):
        """Reads MAVLink packets and parses them into telemetry."""
        while self.running:
            try:
                self.master = mavutil.mavlink_connection(self.connection_string)
                print(f"📡 MAVLink Connection established on {self.connection_string}")
                break
            except Exception as e:
                print(f"❌ Failed to connect MAVLink: {e}. Retrying in 3 seconds...")
                time.sleep(3)
                
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
        groundspeed = 0.0
        airspeed = 0.0
        armed = False
        mode_str = "UNKNOWN"
        
        # Track active telemetry inputs
        while self.running:
            try:
                # Non-blocking receive
                msg = self.master.recv_match(blocking=True, timeout=0.05)
                if msg is None:
                    # Check for read timeout, continue loop
                    time.sleep(0.01)
                    continue
                    
                msg_type = msg.get_type()
                
                # Check for heartbeat to get armed state and flight mode
                if msg_type == 'HEARTBEAT':
                    self.vehicle_id = msg.get_srcSystem()
                    
                    # Decode Armed
                    armed = (msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED) > 0
                    
                    # Decode PX4/ArduPilot Mode
                    custom_mode = msg.custom_mode
                    type_drone = msg.type
                    
                    # PX4 Custom Mode Parsing
                    # main_mode is byte 3 of custom_mode, sub_mode is byte 4
                    main_mode = (custom_mode >> 8) & 0xFF
                    sub_mode = (custom_mode >> 16) & 0xFF
                    
                    if type_drone in [mavutil.mavlink.MAV_TYPE_QUADROTOR, mavutil.mavlink.MAV_TYPE_HEXAROTOR, 
                                      mavutil.mavlink.MAV_TYPE_FIXED_WING, mavutil.mavlink.MAV_TYPE_OCTOROTOR]:
                        # Typical PX4 autopilot
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
                        # Fallback mode mapping
                        mode_str = f"MODE_{custom_mode}"
                        
                elif msg_type == 'ATTITUDE':
                    roll = math.degrees(msg.roll)
                    pitch = math.degrees(msg.pitch)
                    yaw = math.degrees(msg.yaw) % 360
                    heading = int(yaw)
                    
                elif msg_type == 'GLOBAL_POSITION_INT':
                    lat = msg.lat / 1e7
                    lon = msg.lon / 1e7
                    alt = msg.relative_alt / 1000.0 # relative to ground/home in meters
                    # velocity in cm/s -> convert to m/s
                    vx = msg.vx / 100.0
                    vy = msg.vy / 100.0
                    vz = msg.vz / 100.0
                    groundspeed = math.sqrt(vx*vx + vy*vy)
                    
                elif msg_type == 'VFR_HUD':
                    airspeed = msg.airspeed
                    heading = msg.heading
                    
                elif msg_type == 'SYS_STATUS':
                    battery_voltage = msg.voltage_battery / 1000.0 # mV -> V
                    battery_percent = msg.battery_remaining # percentage 0-100
                    
                elif msg_type == 'GPS_RAW_INT':
                    gps_satellites = msg.satellites_visible
                    gps_fix_type = msg.fix_type
                    
            except Exception as e:
                print(f"⚠️ Error reading MAVLink packet: {e}")
                time.sleep(0.1)
                
            # Throttle output stream to Web UI at 20Hz
            now = time.time()
            if now - last_telem_send >= 0.050:
                last_telem_send = now
                with self.telemetry_lock:
                    self.telemetry = {
                        "timestamp": int(now * 1000),
                        "vehicle_id": self.vehicle_id,
                        "status": {
                            "armed": armed,
                            "mode": mode_str,
                            "battery_percent": battery_percent,
                            "battery_voltage": round(battery_voltage, 2),
                            "gps_satellites": gps_satellites,
                            "gps_fix_type": gps_fix_type
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
                            "airspeed": round(airspeed, 1),
                            "groundspeed": round(groundspeed, 1)
                        }
                    }
                self._queue_telemetry_broadcast()

    def _queue_telemetry_broadcast(self):
        """Pushes telemetry dictionary to the websocket message queue."""
        with self.telemetry_lock:
            telem_data = json.dumps({
                "type": "telemetry",
                "data": self.telemetry
            })
        self.to_ws_queue.put(telem_data)

    # --- MISSION WORKER PROTOCOL STATE MACHINE ---
    def _mission_worker_loop(self):
        """Processes mission upload tasks from the UI queue."""
        while self.running:
            try:
                task = self.to_drone_queue.get(timeout=0.5)
                task_type = task.get("type")
                
                if task_type == "upload_mission":
                    self._handle_upload_mission(task)
                elif task_type == "arm" and not self.use_mock:
                    self._handle_arm_disarm(task.get("armed", False))
                elif task_type == "set_mode" and not self.use_mock:
                    self._handle_change_mode(task.get("mode", "HOLD"))
                    
            except queue.Empty:
                pass
            except Exception as e:
                print(f"❌ Error in mission worker: {e}")

    def _update_mission_status(self, mission_id: str, state: str, progress: int, message: str):
        with self.mission_lock:
            self.mission_status = {
                "mission_id": mission_id,
                "state": state,
                "progress": progress,
                "message": message
            }
        # Push to WS broadcast queue immediately
        msg = json.dumps({
            "type": "mission_status",
            "data": self.mission_status
        })
        self.to_ws_queue.put(msg)
        print(f"📋 Mission [{state}] progress: {progress}% - {message}")

    def _handle_upload_mission(self, task: Dict[str, Any]):
        mission_id = task.get("mission_id", "")
        waypoints = task.get("waypoints", [])
        
        if not waypoints:
            self._update_mission_status(mission_id, "ERROR", 0, "No waypoints provided")
            return
            
        self._update_mission_status(mission_id, "UPLOADING", 10, "Starting mission upload...")
        
        if self.use_mock:
            # Simulate uploading steps
            total = len(waypoints)
            for i in range(total):
                time.sleep(0.4) # Simulate network lag
                pct = int(10 + (i / total) * 80)
                self._update_mission_status(mission_id, "UPLOADING", pct, f"Sending waypoint {i+1} of {total}")
                
            time.sleep(0.5)
            self._update_mission_status(mission_id, "SUCCESS", 100, "Mission uploaded successfully")
            return

        # REAL MAVLink Mission Protocol Upload
        try:
            if not self.master:
                self._update_mission_status(mission_id, "ERROR", 0, "Drone not connected")
                return

            target_sys = self.vehicle_id
            target_comp = 1 # autopilot
            
            # 1. Clear existing mission items
            self._update_mission_status(mission_id, "UPLOADING", 15, "Clearing old mission...")
            self.master.mav.mission_clear_all_send(target_sys, target_comp)
            
            # Wait for ACK on mission clear
            ack = self.master.recv_match(type='MISSION_ACK', blocking=True, timeout=1.5)
            if not ack:
                print("⚠️ Clear mission warning: Timeout waiting for MISSION_ACK, proceeding anyway.")
            
            # 2. Send Mission Count
            # MAVLink needs waypoint 0 to represent Home.
            # We'll prepend a Home position if the first item is not waypoint 0.
            # Actually, standard way is to set index 0 as Home location, and 1..N as waypoint items.
            # Let's map waypoints.
            mav_items = []
            
            # Waypoint 0 (Home position)
            # We can use the current latitude/longitude/altitude or the takeoff point
            home_lat = waypoints[0].get("latitude", 0.0)
            home_lon = waypoints[0].get("longitude", 0.0)
            home_alt = 0.0
            
            # Append home as sequence 0
            mav_items.append({
                "seq": 0,
                "command": mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
                "frame": 0, # MAV_FRAME_MISSION (0) or global
                "current": 0,
                "autocontinue": 1,
                "p1": 0, "p2": 0, "p3": 0, "p4": 0,
                "x": int(home_lat * 1e7), "y": int(home_lon * 1e7), "z": float(home_alt)
            })
            
            for idx, wp in enumerate(waypoints):
                cmd_str = wp.get("command", "WAYPOINT")
                lat = wp.get("latitude", 0.0)
                lon = wp.get("longitude", 0.0)
                alt = wp.get("altitude", 10.0)
                hold_time = wp.get("hold_time", 0.0)
                
                # MAVLink commands
                if cmd_str == "TAKEOFF":
                    cmd = mavutil.mavlink.MAV_CMD_NAV_TAKEOFF
                elif cmd_str == "RTL":
                    cmd = mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH
                else:
                    cmd = mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
                    
                mav_items.append({
                    "seq": len(mav_items),
                    "command": cmd,
                    "frame": mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    "current": 0,
                    "autocontinue": 1,
                    "p1": float(hold_time), # param 1 hold time
                    "p2": 2.0,              # param 2 acceptance radius
                    "p3": 0.0,              # param 3 pass radius
                    "p4": 0.0,              # param 4 yaw
                    "x": int(lat * 1e7),
                    "y": int(lon * 1e7),
                    "z": float(alt)
                })
                
            count = len(mav_items)
            print(f"📦 Prepared {count} MAVLink mission items (including Home). uploading...")
            
            # Send MISSION_COUNT
            self.master.mav.mission_count_send(target_sys, target_comp, count)
            
            retries = 3
            last_request_time = time.time()
            
            # 3. Receive request loop
            while True:
                # Wait for request
                msg = self.master.recv_match(type=['MISSION_REQUEST', 'MISSION_REQUEST_INT'], blocking=True, timeout=1.0)
                
                if not msg:
                    if time.time() - last_request_time > 2.0:
                        retries -= 1
                        if retries <= 0:
                            raise TimeoutError("Timeout waiting for MISSION_REQUEST")
                        print(f"⚠️ Timeout waiting for waypoint request, re-sending count... (Retries left: {retries})")
                        self.master.mav.mission_count_send(target_sys, target_comp, count)
                        last_request_time = time.time()
                    continue
                    
                # Reset retries on message received
                retries = 3
                last_request_time = time.time()
                
                seq = msg.seq
                if seq >= count:
                    print(f"❌ Drone requested sequence {seq} which is out of bounds (count {count})")
                    break
                    
                # Upload item
                item = mav_items[seq]
                pct = int(20 + (seq / count) * 70)
                self._update_mission_status(mission_id, "UPLOADING", pct, f"Sending waypoint {seq} of {count-1}")
                
                # Send MISSION_ITEM_INT
                self.master.mav.mission_item_int_send(
                    target_sys, target_comp,
                    item["seq"],
                    item["frame"],
                    item["command"],
                    item["current"],
                    item["autocontinue"],
                    item["p1"], item["p2"], item["p3"], item["p4"],
                    item["x"], item["y"], item["z"]
                )
                
                # If we just sent the last item, we wait for MISSION_ACK
                if seq == count - 1:
                    break
                    
            # 4. Wait for MISSION_ACK
            ack_msg = self.master.recv_match(type='MISSION_ACK', blocking=True, timeout=2.0)
            if ack_msg:
                if ack_msg.type == mavutil.mavlink.MAV_MISSION_ACCEPTED:
                    self._update_mission_status(mission_id, "SUCCESS", 100, "Mission uploaded successfully")
                else:
                    self._update_mission_status(
                        mission_id, "ERROR", 100, 
                        f"Mission upload rejected by flight controller. Code: {ack_msg.type}"
                    )
            else:
                self._update_mission_status(mission_id, "ERROR", 100, "Timeout waiting for MISSION_ACK from autopilot")
                
        except Exception as e:
            self._update_mission_status(mission_id, "ERROR", 0, f"Upload error: {str(e)}")

    def _handle_arm_disarm(self, arm: bool):
        if not self.master:
            return
        cmd = mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM
        self.master.mav.command_long_send(
            self.vehicle_id, 1, cmd, 0,
            1.0 if arm else 0.0, 0, 0, 0, 0, 0, 0
        )
        print(f"⚙️ MAVLink arm command sent: {arm}")

    def _handle_change_mode(self, mode: str):
        if not self.master:
            return
            
        # We need to map target modes to custom PX4 modes
        # PX4 AUTO submodes
        PX4_CUSTOM_MAIN_MODE_AUTO = 4
        
        mode_mapping = {
            "HOLD": (PX4_CUSTOM_MAIN_MODE_AUTO, 3), # AUTO_LOITER
            "MISSION": (PX4_CUSTOM_MAIN_MODE_AUTO, 4), # AUTO_MISSION
            "RTL": (PX4_CUSTOM_MAIN_MODE_AUTO, 5), # AUTO_RTL
        }
        
        if mode in mode_mapping:
            main_mode, sub_mode = mode_mapping[mode]
            custom_mode = (sub_mode << 16) | (main_mode << 8)
            # base_mode has MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (1)
            self.master.mav.set_mode_send(
                self.vehicle_id,
                mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                custom_mode
            )
            print(f"⚙️ MAVLink mode command sent: PX4 {mode} (main {main_mode}, sub {sub_mode})")
        else:
            print(f"⚠️ Unsupported flight mode for command: {mode}")

    # --- WEBSOCKET SERVER WORKER (ASYNCIO) ---
    async def _ws_broadcast_loop(self):
        """Pops telemetry/status messages and broadcasts to all Web UI clients."""
        while self.running:
            # Check queue inside async loop using asyncio.sleep to be non-blocking
            try:
                # We consume up to 100 items from queue at once to prevent delay
                messages = []
                while not self.to_ws_queue.empty() and len(messages) < 100:
                    messages.append(self.to_ws_queue.get_nowait())
                
                if messages and self.client_sockets:
                    # We only broadcast the last telemetry message to avoid flooding, but send all mission status changes
                    telem_msg = None
                    other_msgs = []
                    for m in messages:
                        try:
                            parsed = json.loads(m)
                            if parsed.get("type") == "telemetry":
                                telem_msg = m # keep only latest
                            else:
                                other_msgs.append(m)
                        except Exception:
                            other_msgs.append(m)
                            
                    to_send = other_msgs
                    if telem_msg:
                        to_send.append(telem_msg)
                        
                    for client in list(self.client_sockets):
                        for m_to_send in to_send:
                            try:
                                await client.send(m_to_send)
                            except Exception:
                                self.client_sockets.remove(client)
            except Exception as e:
                print(f"⚠️ WebSocket broadcast error: {e}")
                
            await asyncio.sleep(0.01)

    async def _ws_handler(self, websocket):
        """Handles incoming messages from client WebSocket connections."""
        print(f"🔌 Web UI Client connected: {websocket.remote_address}")
        self.client_sockets.add(websocket)
        
        try:
            async for message in websocket:
                try:
                    payload = json.loads(message)
                    action = payload.get("action")
                    
                    if action == "arm":
                        armed = payload.get("data", {}).get("armed", False)
                        self.to_drone_queue.put({"type": "arm", "armed": armed})
                    elif action == "set_mode":
                        mode = payload.get("data", {}).get("mode", "HOLD")
                        self.to_drone_queue.put({"type": "set_mode", "mode": mode})
                    elif action == "upload_mission":
                        waypoints = payload.get("data", {}).get("waypoints", [])
                        mission_id = payload.get("data", {}).get("mission_id", "mission")
                        self.to_drone_queue.put({
                            "type": "upload_mission",
                            "mission_id": mission_id,
                            "waypoints": waypoints
                        })
                    else:
                        print(f"❓ Unknown WebSocket message action received: {action}")
                except Exception as e:
                    print(f"⚠️ Error parsing client message: {e}")
        except Exception as e:
            pass
        finally:
            print(f"🔌 Web UI Client disconnected: {websocket.remote_address}")
            if websocket in self.client_sockets:
                self.client_sockets.remove(websocket)

    async def _ws_server_main(self):
        import websockets
        async with websockets.serve(self._ws_handler, self.ws_host, self.ws_port):
            print(f"🌐 WebSocket Server running on ws://{self.ws_host}:{self.ws_port}")
            # Spawn the broadcast background loop
            await self._ws_broadcast_loop()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HGCS Gateway - Bridge between MAVLink and Web UI")
    parser.add_argument("--conn", type=str, default="udp:127.0.0.1:14540", help="MAVLink connection string (e.g. udp:127.0.0.1:14540, /dev/ttyACM0:115200)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="WebSocket host")
    parser.add_argument("--port", type=int, default=8080, help="WebSocket port")
    parser.add_argument("--mock", action="store_true", help="Force mock telemetry generation")
    
    args = parser.parse_args()
    
    gateway = Gateway(
        connection_string=args.conn,
        ws_host=args.host,
        ws_port=args.port,
        use_mock=args.mock
    )
    gateway.start()
