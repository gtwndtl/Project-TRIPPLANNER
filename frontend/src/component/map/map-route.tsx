// src/components/MapRoute.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  GetAllShortestPaths,
  GetAccommodationById,
  GetLandmarkById,
  GetRestaurantById,
} from "../../services/https";

import { Button, Tag, Space, Empty } from "antd";
import {
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";

import "./map-route.css";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";


// ===== Types (guest local) =====
type GuestActivity = {
  day: number;
  startTime: string;
  endTime: string;
  description: string;
};
type RouteData = {
  start_name?: string;
  accommodation?: { id?: string; [k: string]: any };
  trip_plan_by_day?: Array<{ day: number; plan: Array<any> }>;
  paths?: Array<{ from: string; to: string; distance_km?: number }>;
  [k: string]: any;
};

const LOCAL_GUEST_ROUTE_DATA = "guest_route_data";
const LOCAL_GUEST_ACTIVITIES = "guest_activities";

type PlacePoint = {
  code: string;
  kind: "A" | "P" | "R";
  idNum: number;
  day: number;
  name: string;
  lat: number;
  lon: number;
  readonly?: boolean;
};

declare global {
  interface Window {
    longdo?: any;
  }
}

const LONGDO_API_KEY = "f278aaef2d456a4e85e80715f7f32ef9";

// ===== Helpers =====
const readTripId = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("TripID");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

function loadLongdoScript(apiKey: string): Promise<void> {
  if (window.longdo) return Promise.resolve();
  const id = "longdo-map-js";
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve, reject) => {
      if ((existing as any)._loaded) resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load longdo failed")));
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = id;
    s.src = `https://api.longdo.com/map/?key=${encodeURIComponent(apiKey)}`;
    (s as any)._loaded = false;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      (s as any)._loaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error("load longdo failed"));
    document.head.appendChild(s);
  });
}

const parseIdFromCode = (code: string): number | null => {
  const m = /^[APRapr](\d+)$/.exec((code || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const parseWktPoint = (wkt?: string | null): { lat: number; lon: number } | null => {
  if (typeof wkt !== "string") return null;
  const m = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(wkt);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

const pickLatLon = (obj: any): { lat: number; lon: number } | null => {
  if (!obj || typeof obj !== "object") return null;
  const wktTry = parseWktPoint(obj.location || obj.Location || obj.WKT || obj.wkt);
  if (wktTry) return wktTry;

  const latTop =
    obj.lat ?? obj.latitude ?? obj.Lat ?? obj.Latitude ?? obj.latitudes ?? obj.Latitudes ?? null;
  const lonTop =
    obj.lon ??
    obj.lng ??
    obj.longitude ??
    obj.Lon ??
    obj.Longitude ??
    obj.long ??
    obj.Long ??
    null;
  if (typeof latTop === "number" && typeof lonTop === "number") return { lat: latTop, lon: lonTop };

  const candidates = ["accommodation", "landmark", "restaurant", "place", "data", "Location", "loc", "geo"];
  for (const key of candidates) {
    const child = obj[key];
    if (child && typeof child === "object") {
      const byChild = pickLatLon(child);
      if (byChild) return byChild;
    }
  }
  return null;
};

/** --- SMART name resolver (รองรับหลายคีย์ + ซ้อนลึก) --- */
const nameOf = (obj: any): string => {
  const fields = [
    "Name","name","title","Title","placeName","PlaceName","displayName","DisplayName",
    "label","Label","NameTH","thName","THName","shortName","ShortName"
  ];
  const getDirect = (o: any): string | null => {
    if (!o || typeof o !== "object") return null;
    for (const k of fields) {
      const v = o?.[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  };

  const direct = getDirect(obj);
  if (direct) return direct;

  const likelyChildren = [
    "data","detail","place","accommodation","landmark","restaurant",
    "Location","loc","geo","info","meta"
  ];
  for (const key of likelyChildren) {
    const got = getDirect(obj?.[key]);
    if (got) return got;
  }

  // depth-limited DFS
  const dfs = (o: any, depth = 0): string | null => {
    if (!o || typeof o !== "object" || depth > 3) return null;
    const d = getDirect(o);
    if (d) return d;
    for (const k of Object.keys(o)) {
      const r = dfs(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  };

  return dfs(obj) ?? "-";
};

// ===== reconstruct ToCode ตาม activities (guest) =====
function reconstructGuestSps(activities: GuestActivity[], routeData: RouteData | null) {
  if (!routeData) return [] as Array<{ Day: number; ToCode: string }>;
  const accCode = routeData.accommodation?.id || "A1";
  const out: Array<{ Day: number; ToCode: string }> = [];
  const dayPlanIndices: Record<number, number> = {};

  for (const act of activities) {
    const dayPlan = routeData.trip_plan_by_day?.find((d: any) => d.day === act.day);
    const currentIndex = dayPlanIndices[act.day] ?? 0;

    const isCheckIn = /เช็คอิน/.test(act.description);
    const isCheckout = /เช็คเอาท์/.test(act.description);
    const isRest = /พักผ่อน/.test(act.description);

    let toCode = accCode;
    if (isCheckIn) toCode = accCode;
    else if (isCheckout || isRest) toCode = accCode;
    else {
      if (dayPlan && dayPlan.plan && dayPlan.plan.length > 0) {
        if (currentIndex === 0) toCode = dayPlan.plan[0].id;
        else if (currentIndex > 0 && currentIndex < dayPlan.plan.length) toCode = dayPlan.plan[currentIndex].id;
        else toCode = accCode;
      } else toCode = accCode;
    }

    out.push({ Day: act.day, ToCode: toCode });
    if (!isCheckIn && !isCheckout) {
      if (dayPlan && currentIndex + 1 < (dayPlan.plan?.length || 0)) dayPlanIndices[act.day] = currentIndex + 1;
    }
  }
  return out;
}

// ===== หา lat/lon จาก routeData ที่ "มีอยู่แล้ว" (ไม่ยิง API) =====
function findPlaceObjInPlans(routeData: RouteData, code: string): any | null {
  const plans = routeData.trip_plan_by_day || [];
  for (const d of plans) {
    const item = d?.plan?.find((p: any) => {
      const id = p?.id ?? p?.code ?? p?.Code;
      return typeof id === "string" && id.trim().toUpperCase() === code;
    });
    if (item) return item;
  }
  return null;
}
function deepSearchByCode(root: any, code: string, depth = 0, seen = new Set<any>()): any | null {
  if (!root || typeof root !== "object" || depth > 4) return null;
  if (seen.has(root)) return null;
  seen.add(root);
  const idVal = root.id ?? root.ID ?? root.code ?? root.Code;
  if (typeof idVal === "string" && idVal.trim().toUpperCase() === code) return root;
  if (Array.isArray(root)) {
    for (const it of root) {
      const r = deepSearchByCode(it, code, depth + 1, seen);
      if (r) return r;
    }
  } else {
    for (const k of Object.keys(root)) {
      const r = deepSearchByCode(root[k], code, depth + 1, seen);
      if (r) return r;
    }
  }
  return null;
}
function findLatLonNameForCode(routeData: RouteData, rawCode: string): { lat: number; lon: number; name: string } | null {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) return null;

  if (routeData.accommodation?.id && String(routeData.accommodation.id).trim().toUpperCase() === code) {
    const obj = routeData.accommodation;
    const ll = pickLatLon(obj);
    if (ll) return { ...ll, name: nameOf(obj) || code };
  }

  const inPlan = findPlaceObjInPlans(routeData, code);
  if (inPlan) {
    const ll =
      pickLatLon(inPlan) ||
      pickLatLon(inPlan.place) ||
      pickLatLon(inPlan.data) ||
      pickLatLon(inPlan.detail) ||
      null;
    const nm =
      nameOf(inPlan) ||
      nameOf(inPlan.place) ||
      nameOf(inPlan.data) ||
      nameOf(inPlan.detail) ||
      code;
    if (ll) return { ...ll, name: nm };
  }

  const maps = [
    routeData.places_by_code,
    routeData.lookup,
    routeData.nodes,
    routeData.entities,
    routeData.index,
    routeData.coords_map,
    routeData.places,
  ];
  for (const m of maps) {
    if (m && typeof m === "object" && code in m) {
      const obj = (m as any)[code];
      const ll = pickLatLon(obj);
      if (ll) return { ...ll, name: nameOf(obj) || code };
    }
  }

  const found = deepSearchByCode(routeData, code);
  if (found) {
    const ll = pickLatLon(found);
    if (ll) return { ...ll, name: nameOf(found) || code };
  }
  return null;
}

const MapRoute: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const [loading, setLoading] = useState(false);
  const [pointsByDay, setPointsByDay] = useState<Record<number, PlacePoint[]>>({});
  const [days, setDays] = useState<number[]>([]);
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ใช้ index เป็นตัวอ้างอิง selection เสมอ (กันรายการซ้ำ)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const markersRef = useRef<Map<string, any>>(new Map());
  const listRef = useRef<HTMLUListElement | null>(null);

  // race guard
  const reqIdRef = useRef(0);

  const openGoogleRoute = useCallback((pts: PlacePoint[]) => {
    if (!pts.length) return;
    const latlon = (p: PlacePoint) => `${p.lat},${p.lon}`;
    if (pts.length === 1) {
      const u = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latlon(pts[0]))}`;
      window.open(u, "_blank", "noopener,noreferrer");
      return;
    }
    const origin = latlon(pts[0]);
    const destination = latlon(pts[pts.length - 1]);
    const middle = pts.slice(1, -1).slice(0, 23).map(latlon).join("|");
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    if (middle) url += `&waypoints=${encodeURIComponent(middle)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // ===== ดึงข้อมูล (API ก่อน, ล้มเหลวค่อย fallback local) =====
  useEffect(() => {
    let mounted = true;
    const myReq = ++reqIdRef.current;

    const run = async () => {
      setLoading(true);
      setError(null);
      setSelectedIdx(null);

      try {
        const id = readTripId();

        if (id) {
          const allResp: any = await GetAllShortestPaths();
          const all: ShortestpathInterface[] = Array.isArray(allResp) ? allResp : allResp?.data ?? [];
          const rows = (all || []).filter((r) => Number(r.TripID) === Number(id) && r.ToCode);

          // buildPointsViaApi (inline)
          const resultByDay: Record<number, PlacePoint[]> = {};
          const cache = new Map<string, PlacePoint>();
          for (const r of rows) {
            const d = Number(r.Day ?? 0);
            const rawCode = (r.ToCode || "").trim().toUpperCase();
            if (!/^[APR]\d+$/.test(rawCode)) continue;
            if (!resultByDay[d]) resultByDay[d] = [];
            if (cache.has(rawCode)) {
              const reused = { ...cache.get(rawCode)!, day: d, readonly: true as const };
              resultByDay[d].push(reused);
              continue;
            }
            const kindChar = rawCode[0] as "A" | "P" | "R";
            const idNum = parseIdFromCode(rawCode);
            if (!idNum) continue;
            let fetched: any = null;
            try {
              if (kindChar === "A") fetched = await GetAccommodationById(idNum);
              else if (kindChar === "P") fetched = await GetLandmarkById(idNum);
              else if (kindChar === "R") fetched = await GetRestaurantById(idNum);
            } catch {
              continue;
            }
            const ll = pickLatLon(fetched);
            if (!ll) continue;
            const p: PlacePoint = {
              code: rawCode,
              kind: kindChar,
              idNum,
              day: d,
              name: nameOf(fetched),           // ชื่อจาก API
              lat: ll.lat,
              lon: ll.lon,
              readonly: true,
            };
            cache.set(rawCode, p);
            resultByDay[d].push(p);
          }

          if (!mounted || myReq !== reqIdRef.current) return;
          const sorted = Object.keys(resultByDay).map(Number).sort((a, b) => a - b);
          setPointsByDay(resultByDay);
          setDays(sorted);
          if (sorted.length === 0) setDayFilter(null);
          else if (dayFilter == null || !sorted.includes(dayFilter)) setDayFilter(sorted[0]);
          return;
        }

        // guest local
        const routeRaw = localStorage.getItem(LOCAL_GUEST_ROUTE_DATA);
        const actsRaw = localStorage.getItem(LOCAL_GUEST_ACTIVITIES);
        const routeData: RouteData | null = routeRaw ? JSON.parse(routeRaw) : null;
        const activities: GuestActivity[] = actsRaw ? JSON.parse(actsRaw) : [];
        if (!routeData || !activities.length) throw new Error("ไม่พบข้อมูลทริป (guest) ในอุปกรณ์");

        const sps = reconstructGuestSps(activities, routeData);
        const dayMap = new Map<number, Array<{ ToCode: string }>>();
        sps.forEach((r) => {
          if (!r.ToCode) return;
          const d = Number(r.Day ?? 0);
          if (!dayMap.has(d)) dayMap.set(d, []);
          dayMap.get(d)!.push({ ToCode: r.ToCode });
        });

        const resultByDay: Record<number, PlacePoint[]> = {};
        for (const [d, arr] of Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0])) {
          const points: PlacePoint[] = [];
          for (const row of arr) {
            const code = (row.ToCode || "").trim().toUpperCase();
            if (!/^[APR]\d+$/.test(code)) continue;

            const info = findLatLonNameForCode(routeData, code);
            if (!info) continue;

            const kind = (code[0] as "A" | "P" | "R") ?? "P";
            const idNum = parseIdFromCode(code) ?? 0;

            points.push({
              code,
              kind,
              idNum,
              day: d,
              name: info.name || code,        // <<< ชื่อจาก guest (ผ่าน nameOf ที่อัปเกรดแล้ว)
              lat: info.lat,
              lon: info.lon,
              readonly: true,
            });
          }
          resultByDay[d] = points;
        }

        if (!mounted || myReq !== reqIdRef.current) return;
        const sorted = Object.keys(resultByDay).map(Number).sort((a, b) => a - b);
        setPointsByDay(resultByDay);
        setDays(sorted);
        if (sorted.length === 0) setDayFilter(null);
        else if (dayFilter == null || !sorted.includes(dayFilter)) setDayFilter(sorted[0]);
      } catch (e: any) {
        setPointsByDay({});
        setDays([]);
        setDayFilter(null);
        setError(e?.message || "โหลดข้อมูลไม่สำเร็จ (guest)");
      } finally {
        if (mounted && myReq === reqIdRef.current) setLoading(false);
      }
    };

    run();

    // อัปเดตเมื่อ TripID เปลี่ยนใน localStorage
    const refreshOnStorage = (e: StorageEvent) => {
      if (e.key === "TripID") run();
    };
    window.addEventListener("storage", refreshOnStorage);

    return () => {
      mounted = false;
      window.removeEventListener("storage", refreshOnStorage);
    };
  }, [dayFilter]);

  // init map
  useEffect(() => {
    let cancelled = false;
    if (!LONGDO_API_KEY) {
      setError("โปรดตั้งค่า Longdo API Key");
      return;
    }
    loadLongdoScript(LONGDO_API_KEY)
      .then(() => {
        if (cancelled) return;
        if (!containerRef.current || !window.longdo) return;
        const map = new window.longdo.Map({ placeholder: containerRef.current });
        map.zoom(12, true);
        mapRef.current = map;
        setMapReady(true);
      })
      .catch((err) => setError(err?.message || "โหลด Longdo ไม่สำเร็จ"));
    return () => {
      cancelled = true;
    };
  }, []);

  // points for current day
  const getAllPointsForDay = useCallback(
    (day: number): PlacePoint[] => pointsByDay[day] ?? [],
    [pointsByDay]
  );
  const pointsToday = useMemo(
    () => (dayFilter == null ? [] : getAllPointsForDay(dayFilter)),
    [dayFilter, getAllPointsForDay]
  );

  // ==== fit helpers ====
  const fitMapToPoints = useCallback((pts: PlacePoint[]) => {
    const map = mapRef.current;
    if (!map || !pts?.length) return;
    if (pts.length === 1) {
      map.location({ lon: pts[0].lon, lat: pts[0].lat }, true);
      map.zoom(16, true);
      return;
    }
    try {
      if (typeof map.bound === "function") {
        map.bound(pts.map((p) => ({ lon: p.lon, lat: p.lat })), { animate: true, padding: 56 });
        return;
      }
    } catch {}
    // fallback
    const project = (lon: number, lat: number) => {
      const s = Math.sin((lat * Math.PI) / 180);
      const x = ((lon + 180) / 360) * 256;
      const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256;
      return [x, y] as const;
    };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    pts.forEach((p) => {
      const [x, y] = project(p.lon, p.lat);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    });
    const el = containerRef.current;
    const w = Math.max(el?.clientWidth ?? 640, 64);
    const h = Math.max(el?.clientHeight ?? 360, 64);
    const PAD = 56;
    const usableW = Math.max(w - PAD * 2, 64);
    const usableH = Math.max(h - PAD * 2, 64);
    const dx = Math.max(maxX - minX, 1e-6);
    const dy = Math.max(maxY - minY, 1e-6);
    const zx = Math.log2(usableW / dx);
    const zy = Math.log2(usableH / dy);
    let z = Math.min(zx, zy);
    if (!Number.isFinite(z)) z = 14;
    z = Math.max(3, Math.min(18, Math.floor(z)));
    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;
    map.location({ lon: centerLon, lat: centerLat }, true);
    map.zoom(z, true);
  }, []);

  /** เลือกเฉพาะรายการตาม index (กันกรณี code/day ซ้ำ) */
  const handleSelectByIndex = useCallback(
    (idx: number) => {
      const p = pointsToday[idx];
      if (!p) return;

      setSelectedIdx(idx);

      // scroll ให้เห็นรายการที่เลือก
      const li = listRef.current?.querySelector<HTMLLIElement>(
        `li[data-key="${p.code}-${p.day}-${idx}"]`
      );
      li?.scrollIntoView({ block: "nearest", behavior: "smooth" });

      // โฟกัส marker + popup เฉพาะตัวเดียว
      try {
        const map = mapRef.current;
        if (map) {
          map.location({ lon: p.lon, lat: p.lat }, true);
          map.zoom(16, true);
        }
        const key = `${p.code}-${p.day}-${idx}`;
        const marker = markersRef.current.get(key);
        if (marker && window.longdo?.Event?.trigger) {
          window.longdo.Event.trigger(marker, "click");
        }
      } catch {}
    },
    [pointsToday]
  );

  // วาด marker (ล้างและวาดใหม่)
  const applyMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.longdo) return;

    markersRef.current.clear();
    map.Overlays.clear();

    if (!pointsToday.length) return;

    pointsToday.forEach((p, i) => {
      const marker = new window.longdo.Marker(
        { lon: p.lon, lat: p.lat },
        {
          title: `${i + 1}. ${p.name || p.code}`,
          clickable: true,
          popup: {
            html: `<div style="padding:6px 8px;max-width:240px;">
                     <div style="font-weight:700;margin-bottom:2px;">${p.name || p.code}</div>
                     <div style="color:#64748b;font-size:12px;">${p.code} • Day ${p.day}</div>
                   </div>`,
          },
        }
      );
      markersRef.current.set(`${p.code}-${p.day}-${i}`, marker);
      map.Overlays.add(marker);

      // คลิก marker → เลือกเฉพาะตัวเดียว
      window.longdo.Event.bind(marker, "click", () => handleSelectByIndex(i));
    });

    // fit หลังวางหมุดครบ
    fitMapToPoints(pointsToday);
  }, [pointsToday, fitMapToPoints, handleSelectByIndex]);

  useEffect(() => {
    if (mapReady) applyMarkers();
  }, [mapReady, applyMarkers]);

  // day nav
  const canPrev = dayFilter != null && days.indexOf(dayFilter) > 0;
  const canNext = dayFilter != null && days.indexOf(dayFilter) < days.length - 1;

  const goPrev = useCallback(() => {
    if (!canPrev || dayFilter == null) return;
    setDayFilter(days[days.indexOf(dayFilter) - 1]);
  }, [canPrev, dayFilter, days]);

  const goNext = useCallback(() => {
    if (!canNext || dayFilter == null) return;
    setDayFilter(days[days.indexOf(dayFilter) + 1]);
  }, [canNext, dayFilter, days]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  // เข้า/เปลี่ยนวัน/จำนวนหมุดเปลี่ยน → fit อีกครั้ง
  useEffect(() => {
    if (!mapReady) return;
    const t = setTimeout(() => fitMapToPoints(pointsToday), 120);
    return () => clearTimeout(t);
  }, [mapReady, dayFilter, pointsToday.length, fitMapToPoints]);

  // เมื่อเปลี่ยนวัน → รีเซ็ต selection และเลื่อนลิสต์ไปบนสุด
  useEffect(() => {
    setSelectedIdx(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [dayFilter]);

  // ลิสต์ & ปุ่มเส้นทาง
  const listPoints = pointsToday;
  const canOpenRoute = pointsToday.length > 0;

  const selectedPin = selectedIdx != null ? pointsToday[selectedIdx] : null;

  return (
    <div className="mr-root">
      <div className="mr-layout">
        {/* ซ้าย: Map 80% */}
        <div className="mr-map">
          {/* Top-center Day Switch */}
          <div className="mr-topbar">
            <Space align="center" size={8}>
              <Button size="small" shape="circle" icon={<LeftOutlined />} onClick={goPrev} disabled={!canPrev} />
              <Tag className="mr-day-pill">{dayFilter == null ? "วันที่ —" : `วันที่ ${dayFilter}`}</Tag>
              <Button size="small" shape="circle" icon={<RightOutlined />} onClick={goNext} disabled={!canNext} />
            </Space>
          </div>

          <div ref={containerRef} className="mr-map-canvas" aria-busy={loading} />
          {error && (
            <div className="mr-error">
              <small>⚠ {error}</small>
            </div>
          )}

          {selectedPin && (
            <div className="mr-detail">
              <div className="mr-detail-title">{selectedPin.name || selectedPin.code}</div>
              <div className="mr-detail-row">
                <span className="mr-detail-key">รหัส:</span>
                <span className="mr-detail-val">{selectedPin.code}</span>
              </div>
              <div className="mr-detail-row">
                <span className="mr-detail-key">ประเภท:</span>
                <span className="mr-detail-val">
                  {selectedPin.kind === "A" ? "ที่พัก" : selectedPin.kind === "R" ? "ร้านอาหาร" : "แลนด์มาร์ก"}
                </span>
              </div>
              <div className="mr-detail-row">
                <span className="mr-detail-key">พิกัด:</span>
                <span className="mr-detail-val">
                  {selectedPin.lat.toFixed(6)}, {selectedPin.lon.toFixed(6)}
                </span>
              </div>
              <div className="mr-detail-actions">
                <Button size="small" onClick={() => openGoogleRoute([selectedPin])}>
                  เปิดใน Google Maps
                </Button>
                {!selectedPin.readonly && (
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    ลบหมุด
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ขวา: List 20% */}
        <aside className="mr-sidepanel">
          <div className="mr-sidepanel-body">
            {listPoints.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีหมุดสำหรับวันนี้" />
            ) : (
              <ul className="mr-pin-list" ref={listRef}>
                {listPoints.map((p, idx) => (
                  <li
                    key={`${p.code}-${p.day}-${idx}`}
                    data-key={`${p.code}-${p.day}-${idx}`}
                    className={`mr-pin-item ${selectedIdx === idx ? "is-active" : ""}`}
                    onClick={() => handleSelectByIndex(idx)}
                    role="button"
                  >
                    <div className="mr-pin-item-main">
                      <span className="mr-pin-index">{idx + 1}</span>
                      <div className="mr-pin-text">
                        <div className="mr-pin-name">{p.name}</div>
                        <div className="mr-pin-sub">
                          {p.kind === "A" ? "ที่พัก" : p.kind === "R" ? "ร้านอาหาร" : "สถานที่ท่องเที่ยว"}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mr-sidepanel-footer">
            <Button
              type="primary"
              block
              icon={<EnvironmentOutlined />}
              onClick={() => openGoogleRoute(pointsToday)}
              disabled={!canOpenRoute}
            >
              เปิดเส้นทางวันนี้ใน Google Maps
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default MapRoute;
