// src/components/MapRoute.tsx
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  GetAllShortestPaths,
  GetAccommodationById,
  GetLandmarkById,
  GetRestaurantById,
} from "../../services/https";
import { useUserId } from "../../hooks/useUserId";

import { Button, Tag, Space } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";

import "./map-route.css";

// ===== Types (backend) =====
type ShortestPath = {
  ID?: number | string;
  TripID?: number | string;
  Day?: number;
  ToCode?: string | null;
};

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
  // อาจมี map/lookup อื่นๆ ที่เก็บ info ของสถานที่
  [k: string]: any;
};

// ===== LocalStorage keys (guest) =====
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

const nameOf = (obj: any): string =>
  obj?.name ?? obj?.Name ?? obj?.title ?? obj?.Title ?? obj?.placeName ?? "-";

const hideAllUi = (map: any) => {
  try {
    const ui = map?.Ui || {};
    const tryHide = (x: any) => {
      if (!x) return;
      if (typeof x.visible === "function") {
        try {
          x.visible(false);
        } catch {}
      }
      if (typeof x.display === "function") {
        try {
          x.display(false);
        } catch {}
      }
      if (typeof x.enable === "function") {
        try {
          x.enable(false);
        } catch {}
      }
    };
    Object.keys(ui).forEach((k) => tryHide(ui[k]));
    tryHide(map?.Ref?.Location);
    tryHide(map?.Ref?.Scale);
    tryHide(map?.Ref?.UTMGrid);
    tryHide(map?.Ref?.Graticule);
  } catch {}
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

    let toCode = accCode; // default

    if (isCheckIn) {
      toCode = accCode;
    } else if (isCheckout || isRest) {
      toCode = accCode;
    } else {
      if (dayPlan && dayPlan.plan && dayPlan.plan.length > 0) {
        if (currentIndex === 0) {
          toCode = dayPlan.plan[0].id;
        } else if (currentIndex > 0 && currentIndex < dayPlan.plan.length) {
          toCode = dayPlan.plan[currentIndex].id;
        } else {
          toCode = accCode;
        }
      } else {
        toCode = accCode;
      }
    }

    out.push({ Day: act.day, ToCode: toCode });

    // ขยับ index เฉพาะกิจกรรมปกติ
    if (!isCheckIn && !isCheckout) {
      if (dayPlan && currentIndex + 1 < (dayPlan.plan?.length || 0)) {
        dayPlanIndices[act.day] = currentIndex + 1;
      }
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

  // 1) ถ้าเป็นที่พัก
  if (routeData.accommodation?.id && String(routeData.accommodation.id).trim().toUpperCase() === code) {
    const obj = routeData.accommodation;
    const ll = pickLatLon(obj);
    if (ll) return { ...ll, name: nameOf(obj) || "ที่พัก" };
  }

  // 2) หาใน trip_plan_by_day
  const inPlan = findPlaceObjInPlans(routeData, code);
  if (inPlan) {
    const ll =
      pickLatLon(inPlan) ||
      pickLatLon(inPlan.place) ||
      pickLatLon(inPlan.data) ||
      pickLatLon(inPlan.detail) ||
      null;
    const nm = nameOf(inPlan) || nameOf(inPlan.place) || nameOf(inPlan.data) || nameOf(inPlan.detail) || code;
    if (ll) return { ...ll, name: nm };
  }

  // 3) หาใน map/lookup ยอดนิยม
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

  // 4) deep search ทั่ว routeData (จำกัดความลึก)
  const found = deepSearchByCode(routeData, code);
  if (found) {
    const ll = pickLatLon(found);
    if (ll) return { ...ll, name: nameOf(found) || code };
  }

  // ไม่พบ
  return null;
}

const MapRoute: React.FC = () => {
  const userIdNum = useUserId();
  const isPreviewOnly = !userIdNum;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const [tripId, setTripId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pointsByDay, setPointsByDay] = useState<Record<number, PlacePoint[]>>({});
  const [days, setDays] = useState<number[]>([]);
  const [dayFilter, setDayFilter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------- เปิด Google Maps เส้นทางของวัน ----------
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

    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(
      origin
    )}&destination=${encodeURIComponent(destination)}`;
    if (middle) url += `&waypoints=${encodeURIComponent(middle)}`;

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  // กันเปิดตอนลาก: จับตำแหน่งกด/ปล่อย
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!downRef.current) return;
      const { x, y, t } = downRef.current;
      downRef.current = null;
      const dx = Math.abs(e.clientX - x);
      const dy = Math.abs(e.clientY - y);
      const dt = Date.now() - t;
      const isClick = dx < 6 && dy < 6 && dt < 600;
      if (!isClick) return;

      const pts = dayFilter == null ? [] : pointsByDay[dayFilter] || [];
      if (pts.length) openGoogleRoute(pts);
    },
    [dayFilter, pointsByDay, openGoogleRoute]
  );

  // sync TripID (เฉพาะโหมดล็อกอิน)
  useEffect(() => {
    if (isPreviewOnly) return;
    const refreshTripId = () => setTripId(readTripId());
    refreshTripId();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "TripID") refreshTripId();
    };
    const onTripIdChanged = () => refreshTripId();
    const onFocus = () => refreshTripId();
    window.addEventListener("storage", onStorage);
    window.addEventListener("TripIDChanged", onTripIdChanged as EventListener);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("TripIDChanged", onTripIdChanged as EventListener);
      window.removeEventListener("focus", onFocus);
    };
  }, [isPreviewOnly]);

  // ===== Fetch points (แยก guest / login) =====
  useEffect(() => {
    let mounted = true;

    const fetchForLoggedIn = async () => {
      const id = readTripId();
      if (!id) {
        setError("ไม่พบ TripID ใน localStorage");
        setPointsByDay({});
        setDays([]);
        setDayFilter(null);
        return;
      }
      setTripId(id);
      setLoading(true);
      setError(null);
      try {
        const allResp: any = await GetAllShortestPaths();
        const all: ShortestPath[] = Array.isArray(allResp) ? allResp : allResp?.data ?? [];
        const rows = (all || []).filter((r) => Number(r.TripID) === Number(id) && r.ToCode);

        const dayMap = new Map<number, ShortestPath[]>();
        rows.forEach((r) => {
          const d = Number(r.Day ?? 0);
          if (!dayMap.has(d)) dayMap.set(d, []);
          dayMap.get(d)!.push(r);
        });

        const resultByDay: Record<number, PlacePoint[]> = {};
        const cache = new Map<string, PlacePoint>();

        for (const [d, arr] of Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0])) {
          const points: PlacePoint[] = [];
          for (const sp of arr) {
            const code = (sp.ToCode || "").trim().toUpperCase();
            if (!/^[APR]\d+$/.test(code)) continue;

            if (cache.has(code)) {
              points.push(cache.get(code)!);
              continue;
            }

            // โหมดล็อกอิน: ยังต้อง fetch รายละเอียดเพื่อได้ lat/lon
            const kind = code[0] as "A" | "P" | "R";
            const idNum = parseIdFromCode(code);
            if (!idNum) continue;

            let fetched: any = null;
            try {
              if (kind === "A") fetched = await GetAccommodationById(idNum);
              else if (kind === "P") fetched = await GetLandmarkById(idNum);
              else if (kind === "R") fetched = await GetRestaurantById(idNum);
            } catch {}

            const ll = pickLatLon(fetched);
            if (!ll) continue;

            const p: PlacePoint = {
              code,
              kind,
              idNum,
              day: d,
              name: nameOf(fetched),
              lat: ll.lat,
              lon: ll.lon,
            };
            cache.set(code, p);
            points.push(p);
          }
          resultByDay[d] = points;
        }

        if (!mounted) return;
        const sortedDays = Object.keys(resultByDay)
          .map(Number)
          .sort((a, b) => a - b);
        setPointsByDay(resultByDay);
        setDays(sortedDays);
        if (sortedDays.length === 0) setDayFilter(null);
        else if (dayFilter == null || !sortedDays.includes(dayFilter)) setDayFilter(sortedDays[0]);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    const fetchForGuest = async () => {
      setLoading(true);
      setError(null);
      try {
        const routeRaw = localStorage.getItem(LOCAL_GUEST_ROUTE_DATA);
        const actsRaw = localStorage.getItem(LOCAL_GUEST_ACTIVITIES);

        const routeData: RouteData | null = routeRaw ? JSON.parse(routeRaw) : null;
        const activities: GuestActivity[] = actsRaw ? JSON.parse(actsRaw) : [];

        if (!routeData || !activities.length) {
          setPointsByDay({});
          setDays([]);
          setDayFilter(null);
          setError("ไม่พบข้อมูลทริป (guest) ในอุปกรณ์");
          return;
        }

        // 1) สร้างลำดับ ToCode ตามกิจกรรม
        const sps = reconstructGuestSps(activities, routeData); // [{ Day, ToCode }]

        // 2) group by day
        const dayMap = new Map<number, Array<{ ToCode: string }>>();
        sps.forEach((r) => {
          if (!r.ToCode) return;
          const d = Number(r.Day ?? 0);
          if (!dayMap.has(d)) dayMap.set(d, []);
          dayMap.get(d)!.push({ ToCode: r.ToCode });
        });

        // 3) แปลง ToCode -> lat/lon โดย "ไม่ยิง API" ใช้ข้อมูลที่มีอยู่แล้วใน routeData
        const resultByDay: Record<number, PlacePoint[]> = {};

        for (const [d, arr] of Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0])) {
          const points: PlacePoint[] = [];
          for (const row of arr) {
            const code = (row.ToCode || "").trim().toUpperCase();
            if (!/^[APR]\d+$/.test(code)) continue;

            const info = findLatLonNameForCode(routeData, code);
            if (!info) continue; // ถ้าไม่มี lat/lon ในข้อมูล -> ข้าม (ไม่ fetch)

            const kind = (code[0] as "A" | "P" | "R") ?? "P";
            const idNum = parseIdFromCode(code) ?? 0;

            points.push({
              code,
              kind,
              idNum,
              day: d,
              name: info.name || code,
              lat: info.lat,
              lon: info.lon,
            });
          }
          resultByDay[d] = points;
        }

        if (!mounted) return;
        const sortedDays = Object.keys(resultByDay)
          .map(Number)
          .sort((a, b) => a - b);
        setPointsByDay(resultByDay);
        setDays(sortedDays);
        if (sortedDays.length === 0) setDayFilter(null);
        else if (dayFilter == null || !sortedDays.includes(dayFilter)) setDayFilter(sortedDays[0]);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || "โหลดข้อมูลไม่สำเร็จ (guest)");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    if (isPreviewOnly) {
      fetchForGuest();
    } else {
      fetchForLoggedIn();
    }

    return () => {
      mounted = false;
    };
  }, [isPreviewOnly, dayFilter]);

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
        hideAllUi(map);
        map.zoom(12, true);
        mapRef.current = map;
        setMapReady(true);
      })
      .catch((err) => setError(err?.message || "โหลด Longdo ไม่สำเร็จ"));
    return () => {
      cancelled = true;
    };
  }, []);

  // fit view
  const safeFitToPoints = (map: any, points: PlacePoint[]) => {
    if (!points.length) return;
    try {
      if (typeof map.bound === "function") {
        map.bound(
          points.map((p) => ({ lon: p.lon, lat: p.lat })),
          { animate: true, padding: 56 }
        );
        return;
      }
    } catch {}
    const el = containerRef.current;
    const width = Math.max(el?.clientWidth ?? 640, 64);
    const height = Math.max(el?.clientHeight ?? 360, 64);
    const PADDING = 56;

    const project = (lon: number, lat: number) => {
      const sin = Math.sin((lat * Math.PI) / 180);
      const x0 = ((lon + 180) / 360) * 256;
      const y0 = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256;
      return [x0, y0] as const;
    };

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    let minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;

    for (const p of points) {
      const [x0, y0] = project(p.lon, p.lat);
      if (x0 < minX) minX = x0;
      if (x0 > maxX) maxX = x0;
      if (y0 < minY) minY = y0;
      if (y0 > maxY) maxY = y0;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }

    const dx0 = Math.max(maxX - minX, 1e-6);
    const dy0 = Math.max(maxY - minY, 1e-6);

    const usableW = Math.max(width - PADDING * 2, 64);
    const usableH = Math.max(height - PADDING * 2, 64);

    const zx = Math.log2(usableW / dx0);
    const zy = Math.log2(usableH / dy0);
    let z = Math.min(zx, zy);
    if (!Number.isFinite(z)) z = 14;
    z = Math.max(3, Math.min(18, Math.floor(z)));

    const centerLon = (minLon + maxLon) / 2;
    const centerLat = (minLat + maxLat) / 2;

    map.location({ lon: centerLon, lat: centerLat }, true);
    map.zoom(z, true);
  };

  // render markers
  const applyMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.longdo) return;

    map.Overlays.clear();

    const pts = dayFilter == null ? [] : pointsByDay[dayFilter] || [];
    if (pts.length === 0) return;

    pts.forEach((p, i) => {
      const marker = new window.longdo.Marker(
        { lon: p.lon, lat: p.lat },
        {
          title: `${i + 1}. ${p.name || p.code}`,
          popup: {
            html: `<div style="padding:6px 8px;max-width:220px;">
              <div style="font-weight:700;margin-bottom:2px;">${p.name || p.code}</div>
              <div style="color:#64748b;font-size:12px;">${p.code} • Day ${p.day}</div>
            </div>`,
          },
        }
      );
      map.Overlays.add(marker);
    });

    safeFitToPoints(map, pts);
  }, [pointsByDay, dayFilter]);

  useEffect(() => {
    if (mapReady) applyMarkers();
  }, [mapReady, dayFilter, pointsByDay, applyMarkers]);

  // day nav + keyboard
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

  return (
    <div className="map-route">
      <div className="map-toolbar">
        <Space align="center" size={6}>
          <Button
            size="small"
            shape="circle"
            icon={<LeftOutlined />}
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="วันก่อนหน้า"
          />
          <Tag className="day-pill">{dayFilter == null ? "วันที่ —" : `วันที่ ${dayFilter}`}</Tag>
          <Button
            size="small"
            shape="circle"
            icon={<RightOutlined />}
            onClick={goNext}
            disabled={!canNext}
            aria-label="วันถัดไป"
          />
        </Space>
      </div>

      {error && (
        <div className="map-error">
          <small>⚠ {error}</small>
        </div>
      )}

      {/* wrapper ครอบ map เพื่อใส่ overlay ตอน hover */}
      <div
        className="map-wrapper"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        title="คลิกเพื่อเปิดเส้นทางใน Google Maps"
        role="button"
        aria-label="คลิกเพื่อเปิดเส้นทางใน Google Maps"
      >
        <div ref={containerRef} id="longdo-map" className="map-canvas" aria-busy={loading} />
        <div className="map-hover-overlay" aria-hidden="true">
          <div className="overlay-label">เปิดเส้นทางใน Google Maps</div>
        </div>
      </div>
    </div>
  );
};

export default MapRoute;
