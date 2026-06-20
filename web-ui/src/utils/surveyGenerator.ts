interface Point {
  latitude: number;
  longitude: number;
}

interface XY {
  x: number;
  y: number;
}

const R = 6378137; // Earth radius in meters

export function generateLawnmowerPath(
  points: Point[],
  spacing: number, // in meters
  angleDeg: number, // in degrees
  reverseStart: boolean = false
): Point[] {
  if (points.length < 3) return [];

  // 1. Establish origin at the first point
  const origin = points[0];
  const originLat = origin.latitude;
  const originLon = origin.longitude;

  // Convert all polygon points to local XY coordinates (meters)
  const xyPoints: XY[] = points.map((p) => {
    const y = (p.latitude - originLat) * (Math.PI / 180) * R;
    const x = (p.longitude - originLon) * (Math.PI / 180) * R * Math.cos(originLat * Math.PI / 180);
    return { x, y };
  });

  // 2. Rotate points by -angle (counter-clockwise) to align scan lines horizontally
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);

  const rotatedPoints: XY[] = xyPoints.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));

  // 3. Find bounding box of rotated polygon
  let minY = rotatedPoints[0].y;
  let maxY = rotatedPoints[0].y;
  for (let i = 1; i < rotatedPoints.length; i++) {
    if (rotatedPoints[i].y < minY) minY = rotatedPoints[i].y;
    if (rotatedPoints[i].y > maxY) maxY = rotatedPoints[i].y;
  }

  // Generate grid paths in rotated space
  const pathRotated: XY[] = [];
  let isReverse = reverseStart;

  // Scan from minY + spacing/2 up to maxY
  // If polygon height is less than spacing/2, scan at center
  const height = maxY - minY;
  let yStart = minY + spacing / 2;
  if (height < spacing) {
    yStart = minY + height / 2;
  }

  for (let yScan = yStart; yScan <= maxY; yScan += spacing) {
    // Find all intersections of horizontal line y = yScan with rotated polygon edges
    const xIntersections: number[] = [];

    for (let i = 0; i < rotatedPoints.length; i++) {
      const p1 = rotatedPoints[i];
      const p2 = rotatedPoints[(i + 1) % rotatedPoints.length];

      // Check if line segment intersects the sweep line
      if ((p1.y <= yScan && p2.y > yScan) || (p2.y <= yScan && p1.y > yScan)) {
        const t = (yScan - p1.y) / (p2.y - p1.y);
        const xIntersect = p1.x + t * (p2.x - p1.x);
        xIntersections.push(xIntersect);
      }
    }

    // Sort intersections from left to right
    xIntersections.sort((a, b) => a - b);

    // Group in pairs (intervals inside the polygon)
    const lineSegments: Array<[number, number]> = [];
    for (let i = 0; i < xIntersections.length - 1; i += 2) {
      lineSegments.push([xIntersections[i], xIntersections[i + 1]]);
    }

    if (lineSegments.length === 0) continue;

    // Connect segments in a S-curve/boustrophedon fashion
    if (isReverse) {
      // Traverse segments from right to left, and within segment from right to left
      for (let i = lineSegments.length - 1; i >= 0; i--) {
        const seg = lineSegments[i];
        pathRotated.push({ x: seg[1], y: yScan });
        pathRotated.push({ x: seg[0], y: yScan });
      }
    } else {
      // Traverse segments from left to right, and within segment from left to right
      for (let i = 0; i < lineSegments.length; i++) {
        const seg = lineSegments[i];
        pathRotated.push({ x: seg[0], y: yScan });
        pathRotated.push({ x: seg[1], y: yScan });
      }
    }

    // Toggle direction for the next sweep line
    isReverse = !isReverse;
  }

  // 4. Rotate points back and convert to Lat/Lon
  const cosBack = Math.cos(angleRad);
  const sinBack = Math.sin(angleRad);

  const finalPoints: Point[] = pathRotated.map((p) => {
    // Rotate back
    const x = p.x * cosBack - p.y * sinBack;
    const y = p.x * sinBack + p.y * cosBack;

    // Convert back to Lat/Lon
    const latitude = originLat + (y / R) * (180 / Math.PI);
    const longitude = originLon + (x / (R * Math.cos(originLat * Math.PI / 180))) * (180 / Math.PI);

    return {
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6)),
    };
  });

  return finalPoints;
}
