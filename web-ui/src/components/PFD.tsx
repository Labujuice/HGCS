import React, { useState, useEffect, useRef } from "react";

interface PFDProps {
  roll: number;       // degrees
  pitch: number;      // degrees
  heading: number;    // degrees (0-360)
  altitude: number;   // meters
  airspeed: number;   // m/s
  groundspeed: number;// m/s
}

export const PFD: React.FC<PFDProps> = ({
  roll,
  pitch,
  heading,
  altitude,
  airspeed,
  groundspeed
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [position, setPosition] = useState({ x: window.innerWidth - 350, y: 52 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".pfd-header")) {
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      posStart.current = { ...position };
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 100, posStart.current.x + dx)),
        y: Math.max(10, Math.min(window.innerHeight - 100, posStart.current.y + dy)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Keep inside window bounds on resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const maxX = window.innerWidth - 200;
        const maxY = window.innerHeight - 150;
        return {
          x: Math.max(10, Math.min(prev.x, maxX)),
          y: Math.max(10, Math.min(prev.y, maxY)),
        };
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Adjust canvas resolution dynamically to match the container size
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      // Ensure height allows room for the 24px header and padding
      canvas.width = Math.max(180, Math.round(rect.width - 10));
      canvas.height = Math.max(120, Math.round(rect.height - 38));
    }

    // Set dimensions
    const width = canvas.width;
    const height = canvas.height;
    const cx = width / 2;
    const cy = height / 2;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // 1. Draw Sky and Ground (Horizon)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-roll * Math.PI) / 180);

    // Pitch conversion: 1 degree = 3 pixels
    const pitchOffset = pitch * 3.5;
    ctx.translate(0, pitchOffset);

    // Sky background (top half)
    ctx.fillStyle = "#1e3a8a"; // deep blue
    ctx.fillRect(-width * 2, -height * 2, width * 4, height * 2);

    // Ground background (bottom half)
    ctx.fillStyle = "#78350f"; // deep brown
    ctx.fillRect(-width * 2, 0, width * 4, height * 2);

    // Horizon line
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-width * 1.5, 0);
    ctx.lineTo(width * 1.5, 0);
    ctx.stroke();

    // 2. Draw Pitch Ladder (marks every 5 degrees)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1.5;

    for (let p = -30; p <= 30; p += 5) {
      if (p === 0) continue;
      
      const py = -p * 3.5; // pitch line y position relative to horizon
      const isPositive = p > 0;
      const lineLen = Math.abs(p) % 10 === 0 ? 50 : 25;

      ctx.beginPath();
      if (isPositive) {
        // Solid line for positive pitch
        ctx.moveTo(-lineLen, py);
        ctx.lineTo(lineLen, py);
        
        // Tick marks at ends
        ctx.moveTo(-lineLen, py);
        ctx.lineTo(-lineLen, py + 5);
        ctx.moveTo(lineLen, py);
        ctx.lineTo(lineLen, py + 5);
      } else {
        // Dashed line for negative pitch
        ctx.setLineDash([4, 4]);
        ctx.moveTo(-lineLen, py);
        ctx.lineTo(lineLen, py);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Tick marks at ends pointing up
        ctx.beginPath();
        ctx.moveTo(-lineLen, py);
        ctx.lineTo(-lineLen, py - 5);
        ctx.moveTo(lineLen, py);
        ctx.lineTo(lineLen, py - 5);
      }
      ctx.stroke();

      // Labels
      if (Math.abs(p) % 10 === 0) {
        ctx.fillText(p.toString(), -lineLen - 12, py);
        ctx.fillText(p.toString(), lineLen + 12, py);
      }
    }

    ctx.restore();

    // 3. Roll Indicator (Arc at top)
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 100, Math.PI + 0.3, Math.PI * 2 - 0.3); // partial circle arc
    ctx.stroke();

    // Roll ticks
    const rollAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
    ctx.fillStyle = "#ffffff";
    rollAngles.forEach((angle) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const startRadius = 100;
      const endRadius = angle % 30 === 0 ? 110 : 105;
      const x1 = cx + startRadius * Math.cos(rad);
      const y1 = cy + startRadius * Math.sin(rad);
      const x2 = cx + endRadius * Math.cos(rad);
      const y2 = cy + endRadius * Math.sin(rad);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });

    // Roll pointer (draws current roll on arc)
    ctx.translate(cx, cy);
    ctx.rotate((roll * Math.PI) / 180);
    ctx.fillStyle = "#facc15"; // yellow pointer
    ctx.beginPath();
    ctx.moveTo(0, -100);
    ctx.lineTo(-6, -90);
    ctx.lineTo(6, -90);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 4. Draw Static Aircraft Symbol (Center)
    ctx.strokeStyle = "#facc15"; // bright yellow
    ctx.fillStyle = "#facc15";
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    // Center square/dot
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Left wing
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy);
    ctx.lineTo(cx - 20, cy);
    ctx.lineTo(cx - 20, cy + 10);
    ctx.stroke();

    // Right wing
    ctx.beginPath();
    ctx.moveTo(cx + 50, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.lineTo(cx + 20, cy + 10);
    ctx.stroke();
    
    // Center gull-wings marker
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 5);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 10, cy + 5);
    ctx.stroke();

    // 5. Airspeed Tape (Left overlay)
    const tapeWidth = 45;
    const tapeHeight = 160;
    const tapeX = 15;
    const tapeY = cy - tapeHeight / 2;

    // Semi-transparent panel background
    ctx.fillStyle = "rgba(17, 24, 39, 0.75)";
    ctx.fillRect(tapeX, tapeY, tapeWidth, tapeHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.strokeRect(tapeX, tapeY, tapeWidth, tapeHeight);

    // Speed marks
    ctx.save();
    ctx.beginPath();
    ctx.rect(tapeX, tapeY, tapeWidth, tapeHeight);
    ctx.clip(); // restrict speed rendering within tape boundary

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.font = "10px monospace";
    
    const speedRange = 15; // show +/- 15 units
    const minS = Math.max(0, Math.floor(airspeed - speedRange));
    const maxS = Math.floor(airspeed + speedRange);
    const speedPixelPerUnit = tapeHeight / (speedRange * 2);

    for (let s = minS; s <= maxS; s++) {
      if (s % 2 === 0) {
        // Position on tape
        const dy = cy - (s - airspeed) * speedPixelPerUnit;
        ctx.beginPath();
        ctx.moveTo(tapeX + tapeWidth, dy);
        ctx.lineTo(tapeX + tapeWidth - 10, dy);
        ctx.stroke();
        
        ctx.fillText(s.toString(), tapeX + tapeWidth - 14, dy + 3);
      }
    }
    ctx.restore();

    // Current Airspeed Indicator Box
    ctx.fillStyle = "#0284c7"; // blue pointer box
    ctx.beginPath();
    ctx.moveTo(tapeX + tapeWidth, cy);
    ctx.lineTo(tapeX + tapeWidth - 6, cy - 8);
    ctx.lineTo(tapeX, cy - 8);
    ctx.lineTo(tapeX, cy + 8);
    ctx.lineTo(tapeX + tapeWidth - 6, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(airspeed.toFixed(1), tapeX + tapeWidth / 2 - 2, cy + 3);

    // 6. Altitude Tape (Right overlay)
    const altX = width - tapeWidth - 15;
    const altY = cy - tapeHeight / 2;

    ctx.fillStyle = "rgba(17, 24, 39, 0.75)";
    ctx.fillRect(altX, altY, tapeWidth, tapeHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.strokeRect(altX, altY, tapeWidth, tapeHeight);

    // Altitude marks
    ctx.save();
    ctx.beginPath();
    ctx.rect(altX, altY, tapeWidth, tapeHeight);
    ctx.clip();

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.font = "10px monospace";

    const altRange = 30; // show +/- 30m
    const minA = Math.floor(altitude - altRange);
    const maxA = Math.floor(altitude + altRange);
    const altPixelPerUnit = tapeHeight / (altRange * 2);

    for (let a = minA; a <= maxA; a++) {
      if (a % 5 === 0) {
        const dy = cy - (a - altitude) * altPixelPerUnit;
        ctx.beginPath();
        ctx.moveTo(altX, dy);
        ctx.lineTo(altX + 10, dy);
        ctx.stroke();

        ctx.fillText(a.toString(), altX + 14, dy + 3);
      }
    }
    ctx.restore();

    // Current Altitude Indicator Box
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.moveTo(altX, cy);
    ctx.lineTo(altX + 6, cy - 8);
    ctx.lineTo(altX + tapeWidth, cy - 8);
    ctx.lineTo(altX + tapeWidth, cy + 8);
    ctx.lineTo(altX + 6, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(altitude.toFixed(1), altX + tapeWidth / 2 + 2, cy + 3);

    // 7. Heading Tape (Top overlay)
    const hdgWidth = width - 80;
    const hdgHeight = 25;
    const hdgX = cx - hdgWidth / 2;
    const hdgY = 10;

    ctx.fillStyle = "rgba(17, 24, 39, 0.85)";
    ctx.fillRect(hdgX, hdgY, hdgWidth, hdgHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.strokeRect(hdgX, hdgY, hdgWidth, hdgHeight);

    // Heading marks
    ctx.save();
    ctx.beginPath();
    ctx.rect(hdgX, hdgY, hdgWidth, hdgHeight);
    ctx.clip();

    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";

    const hdgRange = 30; // +/- 30 degrees visible
    const hdgPixelPerDegree = hdgWidth / (hdgRange * 2);

    for (let h = Math.floor(heading - hdgRange); h <= heading + hdgRange; h++) {
      const normalizedH = (h + 360) % 360;
      const dx = cx + (h - heading) * hdgPixelPerDegree;

      if (normalizedH % 5 === 0) {
        ctx.beginPath();
        ctx.moveTo(dx, hdgY + hdgHeight);
        const tickLen = normalizedH % 10 === 0 ? 8 : 4;
        ctx.lineTo(dx, hdgY + hdgHeight - tickLen);
        ctx.stroke();

        if (normalizedH % 10 === 0) {
          let label = (normalizedH / 10).toString();
          if (normalizedH === 0) label = "N";
          else if (normalizedH === 90) label = "E";
          else if (normalizedH === 180) label = "S";
          else if (normalizedH === 270) label = "W";
          ctx.fillText(label, dx, hdgY + 12);
        }
      }
    }
    ctx.restore();

    // Center Heading Pointer
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(cx, hdgY + hdgHeight);
    ctx.lineTo(cx - 5, hdgY + hdgHeight + 6);
    ctx.lineTo(cx + 5, hdgY + hdgHeight + 6);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(cx, hdgY);
    ctx.lineTo(cx, hdgY + hdgHeight);
    ctx.stroke();

    // Text details (roll, pitch values, groundspeed)
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(15, height - 25, width - 30, 20);
    
    ctx.fillStyle = "#a3a3a3";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`ROLL: ${roll.toFixed(1)}°`, 22, height - 12);
    ctx.fillText(`PITCH: ${pitch.toFixed(1)}°`, cx - 35, height - 12);
    ctx.textAlign = "right";
    ctx.fillText(`GND_SPD: ${groundspeed.toFixed(1)}m/s`, width - 22, height - 12);

  }, [roll, pitch, heading, altitude, airspeed, groundspeed]);

  return (
    <div
      ref={containerRef}
      className="pfd-hud-container"
      style={{
        position: "absolute",
        left: `${position.x}px`,
        top: `${position.y}px`,
        resize: "both",
        overflow: "hidden",
        minWidth: "240px",
        minHeight: "200px",
        width: "320px", // Initial default width
        height: "280px", // Initial default height
        display: "flex",
        flexDirection: "column",
        padding: "4px",
        boxSizing: "border-box",
        zIndex: 400
      }}
    >
      <div 
        className="pfd-header"
        onMouseDown={handleMouseDown}
        style={{
          height: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#1f2937",
          color: "#d1d5db",
          paddingLeft: "8px",
          paddingRight: "8px",
          userSelect: "none",
          cursor: "move",
          fontFamily: "monospace",
          fontSize: "11px",
          fontWeight: "bold",
          borderBottom: "1px solid #374151",
          borderTopLeftRadius: "4px",
          borderTopRightRadius: "4px"
        }}
      >
        <span>PRIMARY FLIGHT DISPLAY</span>
        <span style={{ opacity: 0.6 }}>⋮⋮</span>
      </div>
      <div style={{
        flexGrow: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        borderBottomLeftRadius: "4px",
        borderBottomRightRadius: "4px",
        position: "relative",
        overflow: "hidden",
        marginTop: "4px"
      }}>
        <canvas
          ref={canvasRef}
          style={{ imageRendering: "pixelated", display: "block" }}
        />
      </div>
    </div>
  );
};
