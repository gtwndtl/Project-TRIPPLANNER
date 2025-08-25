// src/hooks/usePlaceNamesHybrid.ts
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GetAllLandmarks,
  GetAllAccommodations,
  GetAllRestaurants,
} from "../services/https";

type Kind = "accommodation" | "landmark" | "restaurant";

const TTL = 24 * 60 * 60 * 1000; // cache 1 วัน
const LC_KEY = {
  accommodation: "placenames_acc_v2",
  landmark: "placenames_landmark_v2",
  restaurant: "placenames_restaurant_v2",
};

const norm = (v?: string | null) => (v ?? "").trim();
const U = (v?: string | null) => norm(v).toUpperCase();

const now = () => Date.now();
function load(kind: Kind): Record<string, string> {
  try {
    const raw = localStorage.getItem(LC_KEY[kind]);
    if (!raw) return {};
    const { t, data } = JSON.parse(raw);
    if (!data || typeof data !== "object" || now() - (t || 0) > TTL) return {};
    return data;
  } catch {
    return {};
  }
}
function save(kind: Kind, data: Record<string, string>) {
  try {
    localStorage.setItem(LC_KEY[kind], JSON.stringify({ t: now(), data }));
  } catch {}
}

// ดึง id / name ให้ทนทานต่อชื่อ field ที่ต่างกัน
const pickId = (x: any): string => {
  const cand =
    x?.ID ?? x?.Id ?? x?.id ??
    x?.AccID ?? x?.AccommodationID ?? x?.LandmarkID ?? x?.RestaurantID ??
    x?.PlaceID ?? x?.place_id ?? x?.restaurant_id ?? x?.accommodation_id ??
    x?.Code?.replace(/^\D+/, "") ?? x?.code?.replace(/^\D+/, "");
  return String(cand ?? "").trim();
};
const pickName = (x: any, fallbackPrefix: string): string => {
  const n = x?.Name ?? x?.name ?? x?.Title ?? x?.title;
  return String(n ?? `${fallbackPrefix} ${pickId(x)}`).trim();
};

// คืนชื่อจาก cache โดยรองรับทั้ง code แบบมี prefix และเลขล้วน
function lookupName(
  code: string,
  caches: { accommodation: Record<string, string>; landmark: Record<string, string>; restaurant: Record<string, string> }
): string | undefined {
  const c = U(code);
  // 1) ลองหาแบบตรงตัวก่อน
  const direct =
    caches.accommodation[c] ?? caches.landmark[c] ?? caches.restaurant[c];
  if (direct) return direct;

  // 2) ถ้ามี prefix ให้แยก id แล้วลองหาในชนิดที่ถูกต้อง (สำรองรองรับ key แบบเลขล้วน)
  const m = c.match(/^([APR])(\d+)$/);
  if (m) {
    const [, p, id] = m;
    if (p === "A") return caches.accommodation[`A${id}`] ?? caches.accommodation[id];
    if (p === "P") return caches.landmark[`P${id}`] ?? caches.landmark[id];
    if (p === "R") return caches.restaurant[`R${id}`] ?? caches.restaurant[id];
  }

  // 3) ถ้าเป็นเลขล้วน ให้ลองกับทุกชนิด (กันข้อมูลที่มาผิดรูป)
  if (/^\d+$/.test(c)) {
    return caches.accommodation[c] ?? caches.landmark[c] ?? caches.restaurant[c];
  }
  return undefined;
}

export function usePlaceNamesHybrid(codes: string[]) {
  // รวม code ที่จะใช้ map (เช่น A69, P14, R447 หรือบางระบบส่ง 69/14/447 มา)
  const need = useMemo(
    () => Array.from(new Set(codes.map((c) => U(c)).filter(Boolean))),
    [codes]
  );

  const [map, setMap] = useState<Record<string, string>>({});
  const cacheRef = useRef<Record<Kind, Record<string, string>>>({
    accommodation: {},
    landmark: {},
    restaurant: {},
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // โหลด cache เดิม
      (["accommodation", "landmark", "restaurant"] as Kind[]).forEach((k) => {
        if (Object.keys(cacheRef.current[k]).length === 0) {
          cacheRef.current[k] = load(k);
        }
      });

      // ดึงทั้งหมดแล้วเก็บเป็น key แบบ "A<ID>"/"P<ID>"/"R<ID>"
      if (Object.keys(cacheRef.current.accommodation).length === 0) {
        const all = await GetAllAccommodations();
        const into: Record<string, string> = {};
        for (const x of all ?? []) {
          const id = pickId(x);
          if (!id) continue;
          into[`A${id}`] = pickName(x, "ที่พัก");
          // เผื่อระบบอื่นส่งเลขล้วนเข้ามา
          into[id] = into[`A${id}`];
        }
        cacheRef.current.accommodation = into;
        save("accommodation", into);
      }

      if (Object.keys(cacheRef.current.landmark).length === 0) {
        const all = await GetAllLandmarks();
        const into: Record<string, string> = {};
        for (const x of all ?? []) {
          const id = pickId(x);
          if (!id) continue;
          into[`P${id}`] = pickName(x, "สถานที่");
          into[id] = into[`P${id}`]; // สำรองเลขล้วน
        }
        cacheRef.current.landmark = into;
        save("landmark", into);
      }

      if (Object.keys(cacheRef.current.restaurant).length === 0) {
        const all = await GetAllRestaurants();
        const into: Record<string, string> = {};
        for (const x of all ?? []) {
          const id = pickId(x);
          if (!id) continue;
          into[`R${id}`] = pickName(x, "ร้านอาหาร");
          into[id] = into[`R${id}`]; // สำรองเลขล้วน
        }
        cacheRef.current.restaurant = into;
        save("restaurant", into);
      }

      if (cancelled) return;

      // สร้าง map สำหรับโค้ดที่ต้องใช้ในหน้าจอปัจจุบัน
      const out: Record<string, string> = {};
      need.forEach((code) => {
        out[code] = lookupName(code, cacheRef.current) ?? code;
      });
      setMap(out);
    };

    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [need.join("|")]);

  return map;
}
