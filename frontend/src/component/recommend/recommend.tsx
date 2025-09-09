// src/component/trip-recommendations/TripRecommendations.tsx
import React, { useEffect, useState, useCallback, memo } from "react";
import { message, Spin, Empty, Tooltip } from "antd";
import { StarFilled } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import type { ReviewInterface } from "../../interfaces/review";
import type { TripInterface } from "../../interfaces/Trips";
import type { ConditionInterface } from "../../interfaces/Condition";
import type { LandmarkInterface } from "../../interfaces/Landmark";

import {
  GetAllReviews,
  GetTripById,
  GetConditionById,
  GetAllLandmarks,
} from "../../services/https";
import "./recommend.css";

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=60&w=800&auto=format&fit=crop";

/** แก้ URL ภาพให้มีขนาด/คุณภาพตามต้องการ (รองรับ Unsplash; ถ้าโดเมนอื่นจะคืนค่าเดิม) */
const tuneImageUrl = (url: string, w: number, q = 70) => {
  try {
    const u = new URL(url);
    // unsplash / images.unsplash.com
    if (u.hostname.includes("unsplash.com")) {
      u.searchParams.set("w", String(w));
      u.searchParams.set("q", String(q));
      u.searchParams.set("auto", "format");
      u.searchParams.set("fit", "crop");
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
};

type EnrichedReview = {
  review: ReviewInterface;
  trip: TripInterface | null;
  condition: ConditionInterface | null;
};

const TripRecommendations: React.FC = () => {
  // ====== Cache (SWR) ======
  type CacheShape = { items: EnrichedReview[]; lmkThumbsEntries: [string, string][]; savedAt: number };
  const CACHE_KEY = "recoCache:v1";
  const TTL_MS = 10 * 60 * 1000;
  const MEMO: { data?: CacheShape } = (TripRecommendations as any).__memo__ ?? {};
  (TripRecommendations as any).__memo__ = MEMO;

  const saveCache = (c: CacheShape) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); MEMO.data = c; } catch { }
  };
  const readCache = (): CacheShape | null => {
    if (MEMO.data) return MEMO.data;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (Array.isArray(p.items) && Array.isArray(p.lmkThumbsEntries) && typeof p.savedAt === "number") {
        MEMO.data = p; return p;
      }
    } catch { }
    return null;
  };
  const isFresh = (t: number) => Date.now() - t < TTL_MS;

  const unique = <T,>(arr: T[]) => Array.from(new Set(arr));
  const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

  const mapFromArray = <T, K extends string | number>(arr: T[], key: (x: T) => K | null | undefined) => {
    const m = new Map<K, T>();
    for (const it of arr) { const k = key(it); if (k !== null && k !== undefined) m.set(k, it); }
    return m;
  };

  const pickString = (obj: unknown, fields: string[]): string | undefined => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    for (const f of fields) { const val = rec[f]; if (typeof val === "string" && val.trim()) return val; }
    return;
  };

  const getThumbUrlFromTripOrCondition = (
    trip: TripInterface | null,
    condition: ConditionInterface | null
  ) =>
    pickString(trip, ["Cover", "CoverUrl", "CoverURL", "Image", "ImageURL", "Photo"]) ||
    pickString(condition, ["Cover", "Image", "ImageURL", "Thumbnail", "Photo"]) ||
    FALLBACK_THUMB_URL;

  const normalizeKey = (s?: string) =>
    (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");

  const buildLandmarkThumbMap = (list: LandmarkInterface[]) => {
    const m = new Map<string, string>();
    for (const lm of list || []) {
      const name = (lm as any).Name ?? (lm as any).name ?? (lm as any).Title ?? (lm as any).title;
      const url =
        (lm as any).ThumbnailURL ?? (lm as any).ThumbnailUrl ?? (lm as any).thumbnail ??
        (lm as any).ImageURL ?? (lm as any).imageURL;
      const key = normalizeKey(name);
      if (key && typeof url === "string" && url.trim()) m.set(key, String(url));
    }
    return m;
  };

  const getNameCandidates = (trip: TripInterface | null, condition: ConditionInterface | null): string[] => {
    const primary = pickString(trip, ["Name", "City", "Title"]) ||
      pickString(condition, ["Landmark", "City", "Place"]) || "";
    const extras = [pickString(trip, ["City"]), pickString(condition, ["City"]), pickString(condition, ["Landmark"])]
      .filter(Boolean) as string[];
    return [primary, ...extras];
  };

  const getLandmarkThumbUrl = (
    lmkThumbs: Map<string, string>, trip: TripInterface | null, condition: ConditionInterface | null
  ) => {
    const candidates = getNameCandidates(trip, condition);
    for (const c of candidates) { const hit = lmkThumbs.get(normalizeKey(c)); if (hit) return hit; }
    for (const c of candidates) {
      const key = normalizeKey(c); if (!key) continue;
      for (const [k, url] of lmkThumbs) { if (k.includes(key) || key.includes(k)) return url; }
    }
    return undefined;
  };

  const pickRandomN = <T,>(arr: T[], n: number) => {
    const a = [...arr]; const m = Math.min(n, a.length);
    for (let i = 0; i < m; i++) { const j = i + Math.floor(Math.random() * (a.length - i));[a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, m);
  };


  const ReviewCard: React.FC<{
    item: EnrichedReview;
    thumbUrl: string;
    eager?: boolean; // โหลดเร็วเป็นพิเศษสำหรับการ์ดแรก ๆ
  }> = memo(({ item, thumbUrl, eager }) => {
    const { review, trip, condition } = item;
    const days = toNum(trip?.Days);
    const daysText = Number.isFinite(days) && days > 0 ? `${days} วัน` : "— วัน";
    const title = (trip as any)?.Name?.toString?.() || (condition as any)?.Landmark?.toString?.() || "-";
    const navigate = useNavigate();

    const handleClick = () => {
      if (trip && (trip as any).ID) {
        const tripId = (trip as any).ID;
        localStorage.setItem("recommendTripID", String(tripId));
        navigate(`/itinerary/recommend/${tripId}`);
      }
    };
    const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); }
    };
    const onImgErr: React.ReactEventHandler<HTMLImageElement> = (e) => {
      (e.currentTarget as HTMLImageElement).src = FALLBACK_THUMB_URL;
    };

    // ✅ ใช้รูปเล็กมากสำหรับพื้นหลังเบลอ เพื่อลดโหลด
    const bgUrl = tuneImageUrl(thumbUrl, 80, 30);
    // ✅ รูปจริงขนาดพอดี
    const img240 = tuneImageUrl(thumbUrl, 240, 70);
    const img480 = tuneImageUrl(thumbUrl, 480, 70);

    const cardStyle: React.CSSProperties = { ["--reco-bg" as any]: `url("${bgUrl}")` };

    return (
      <div
        className="trip-recommendation"
        style={cardStyle}
        onClick={handleClick}
        onKeyDown={handleKey}
        role="button"
        tabIndex={0}
        aria-label={`ดูรายละเอียดทริป: ${title}`}
      >
        <div className="trip-reco-media">
          <img
            className="trip-reco-thumb"
            src={img240}
            srcSet={`${img240} 240w, ${img480} 480w`}
            sizes="(max-width: 420px) 100px, 120px"
            width={120}
            height={120}
            loading={eager ? "eager" : "lazy"}
            // @ts-ignore (เฉพาะบราวเซอร์ที่รองรับ)
            fetchpriority={eager ? "high" : "auto"}
            decoding="async"
            onError={onImgErr}
            alt="trip thumbnail"
          />
          <span className="trip-reco-badge">{daysText}</span>
        </div>

        <div className="trip-reco-text">
          <p className="trip-reco-title" title={title}>{title}</p>
          <div className="trip-reco-meta">
            <Tooltip title={`${review.Rate}/5`}>
              <span className="inspire-chip-recommend"><StarFilled /> {review.Rate}</span>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  });
  ReviewCard.displayName = "ReviewCard";

  const [msgApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EnrichedReview[]>([]);
  const [lmkThumbs, setLmkThumbs] = useState<Map<string, string>>(new Map());

  // ===== loader (เขียน cache) =====
  const load = useCallback(async (signal?: AbortSignal) => {
    const aborted = () => signal?.aborted === true;
    if (!aborted()) setLoading(true);
    try {
      const landmarks = (await GetAllLandmarks()) as LandmarkInterface[];
      if (aborted()) return;
      const lmkMap = buildLandmarkThumbMap(Array.isArray(landmarks) ? landmarks : []);
      setLmkThumbs(lmkMap);

      const reviews = (await GetAllReviews()) as ReviewInterface[];
      if (aborted()) return;

      if (!Array.isArray(reviews) || reviews.length === 0) {
        setItems([]); saveCache({ items: [], lmkThumbsEntries: Array.from(lmkMap.entries()), savedAt: Date.now() }); return;
      }

      const tripIds = unique(reviews.map((r) => toNum(r.TripID)).filter((n) => Number.isFinite(n))) as number[];
      const tripsArr = (await Promise.all(tripIds.map((id) => GetTripById(id)))) as TripInterface[];
      if (aborted()) return;

      const tripMap = mapFromArray(tripsArr.filter(Boolean), (t) => toNum((t as any).ID) as number);

      const conIds = unique(
        tripsArr.map((t) => toNum((t as any).Con_id)).filter((n) => Number.isFinite(n) && n > 0)
      ) as number[];
      const consArr = (await Promise.all(conIds.map((cid) => GetConditionById(cid)))) as ConditionInterface[];
      if (aborted()) return;

      const conMap = mapFromArray(consArr.filter(Boolean), (c) => toNum((c as any).ID) as number);

      let enriched = reviews
        .map<EnrichedReview>((rev) => {
          const trip = tripMap.get(toNum(rev.TripID) as number) || null;
          const condition = trip && (trip as any).Con_id ? conMap.get(toNum((trip as any).Con_id) as number) || null : null;
          return { review: rev, trip, condition };
        })
        .filter((x) => !!x.trip);

      if (enriched.length === 0) {
        setItems([]); saveCache({ items: [], lmkThumbsEntries: Array.from(lmkMap.entries()), savedAt: Date.now() }); return;
      }

      const highRated = enriched.filter((e) => toNum(e.review.Rate) >= 4);
      const randomFour = highRated.length > 0 ? pickRandomN(highRated, 4) : [];
      randomFour.sort((a, b) => Number(toNum(b.review.Rate)) - Number(toNum(a.review.Rate)));

      if (aborted()) return;
      setItems(randomFour);
      saveCache({ items: randomFour, lmkThumbsEntries: Array.from(lmkMap.entries()), savedAt: Date.now() });
    } catch (e: any) {
      console.error("TripRecommendations load error:", e);
      msgApi.error(e?.message || "โหลดรีวิวไม่สำเร็จ");
    } finally {
      if (!aborted()) setLoading(false);
    }
  }, [msgApi]);

  // mount: ใช้ cache ก่อน แล้วค่อย revalidate หากหมดอายุ
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setItems(cached.items || []);
      setLmkThumbs(new Map(cached.lmkThumbsEntries || []));
      setLoading(false);
      if (isFresh(cached.savedAt)) return;
      const controller = new AbortController(); load(controller.signal); return () => controller.abort();
    }
    const controller = new AbortController(); load(controller.signal); return () => controller.abort();
  }, [load]);

  return (
    <aside className="trip-sidebar">
      {contextHolder}
      {loading && <div className="reco-state"><Spin /></div>}

      {!loading && items.length === 0 && (
        <div className="reco-state"><Empty description="ยังไม่มีรีวิวทริป" /></div>
      )}

      {!loading && items.length > 0 &&
        items.map((item, idx) => {
          const lmkUrl = getLandmarkThumbUrl(lmkThumbs, item.trip, item.condition);
          const thumbUrl = lmkUrl || getThumbUrlFromTripOrCondition(item.trip, item.condition);
          return (
            <ReviewCard
              key={String((item.review as any)?.ID ?? `${(item.review as any)?.TripID}-${(item.review as any)?.Day}-${idx}`)}
              item={item}
              thumbUrl={thumbUrl}
              eager={idx < 2} // ภาพบนสุด 2 ใบโหลดเร็วเป็นพิเศษ
            />
          );
        })}
    </aside>
  );
};

export default TripRecommendations;
