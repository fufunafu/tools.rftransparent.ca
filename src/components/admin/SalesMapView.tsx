"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface SalePoint {
  lat: number;
  lng: number;
  city: string;
  province: string;
  country: string;
  amount: number;
  currency: string;
  order: string;
  date: string;
}

function fmt(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Scale dot radius based on order amount
function radius(amount: number): number {
  if (amount < 100) return 5;
  if (amount < 500) return 7;
  if (amount < 2000) return 9;
  if (amount < 5000) return 11;
  return 14;
}

// Color gradient: light rose → deep red based on order amount
function dotColor(amount: number): string {
  if (amount < 100) return "#fda4af";   // rose-300
  if (amount < 500) return "#fb7185";   // rose-400
  if (amount < 2000) return "#f43f5e";  // rose-500
  if (amount < 5000) return "#e11d48";  // rose-600
  return "#be123c";                      // rose-700
}

export default function SalesMapView({ points }: { points: SalePoint[] }) {
  // Calculate center from points, default to North America
  const center: [number, number] = points.length > 0
    ? [
        points.reduce((s, p) => s + p.lat, 0) / points.length,
        points.reduce((s, p) => s + p.lng, 0) / points.length,
      ]
    : [45.5, -73.6];

  return (
    <MapContainer
      center={center}
      zoom={points.length > 50 ? 4 : 5}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      {points.map((point, i) => (
        <CircleMarker
          key={`${point.order}-${i}`}
          center={[point.lat, point.lng]}
          radius={radius(point.amount)}
          fillColor={dotColor(point.amount)}
          fillOpacity={0.35}
          stroke={true}
          color={dotColor(point.amount)}
          weight={1.5}
          opacity={0.5}
        >
          <Popup>
            <div className="text-xs space-y-1 min-w-[140px]">
              <p className="font-semibold">{point.order}</p>
              <p>{point.city}, {point.province}</p>
              <p>{point.country}</p>
              <p className="font-semibold">{fmt(point.amount, point.currency)}</p>
              <p className="text-gray-500">{point.date}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
