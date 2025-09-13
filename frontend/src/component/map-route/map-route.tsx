import React from 'react'
const readTripId = (): number | null => {
  const raw = localStorage.getItem("TripID");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

// ใช้
const tripId = readTripId();

const MapRoute = () => {
  return (
    <div>MapRoute</div>
  )
}

export default MapRoute