// src/component/trip-recommendations/TripExplore.tsx
import React, { useEffect, useState, useCallback, memo } from "react";
import { message, Spin, Empty, Avatar, Tooltip, Button } from "antd";
import { UserOutlined, StarFilled } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import type { ReviewInterface } from "../../interfaces/review";
import type { TripInterface } from "../../interfaces/Trips";
import type { ConditionInterface } from "../../interfaces/Condition";
import type { LandmarkInterface } from "../../interfaces/Landmark";
import type { UserInterface } from "../../interfaces/User";

import {
  GetAllReviews,
  GetTripById,
  GetConditionById,
  GetAllLandmarks,
  GetAllUsers,
} from "../../services/https";

import "./trip-explore.css";

/** ====== Types ====== */
type EnrichedReview = {
  review: ReviewInterface;
  trip: TripInterface | null;
  condition: ConditionInterface | null;
  user: UserInterface | null;
  thumb: string; // ✅ คำนวณไว้เลย เพื่อลดงานตอน render
};

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

/** ====== Cache config (Memory + localStorage) ====== */
type CacheShape = {
  items: EnrichedReview[];
  savedAt: number;
};
const CACHE_KEY = "TripExploreCache:v2";
const TTL_MS = 10 * 60 * 1000; // 10 นาที

// memo ระดับโมดูล (อยู่จนออกจากแอป)
const MEMO: { data?: CacheShape; inflight?: Promise<CacheShape> } = {};

/** ====== Utils ====== */
const toNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const normalizeKey = (s?: string) => (s || "").toString().trim().toLowerCase();

const buildLandmarkThumbMap = (list: LandmarkInterface[]) => {
  const m = new Map<string, string>();
  for (const lm of list || []) {
    const name = (lm as any).Name ?? (lm as any).Title;
    const url =
      (lm as any).ThumbnailURL ?? (lm as any).ImageURL ?? (lm as any).thumbnail;
    if (name && url) m.set(normalizeKey(name), String(url));
  }
  return m;
};

const pickString = (obj: any, fields: string[]) => {
  for (const f of fields) {
    const val = obj?.[f];
    if (typeof val === "string" && val.trim()) return val;
  }
  return undefined;
};

const getThumbUrl = (
  trip: TripInterface | null,
  condition: ConditionInterface | null,
  lmkThumbs: Map<string, string>
): string => {
  const tImg = pickString(trip, ["Cover", "ImageURL"]);
  if (tImg) return tImg;
  const cImg = pickString(condition, ["Thumbnail", "ImageURL"]);
  if (cImg) return cImg;
  const name = pickString(trip, ["Name"]) || pickString(condition, ["Landmark"]);
  if (name) {
    const url = lmkThumbs.get(normalizeKey(name));
    if (url) return url;
  }
  return FALLBACK_THUMB_URL;
};

// พรีโหลดรูป (ไม่บล็อก UI)
const preloadImages = (urls: string[], limit = 8) => {
  urls.slice(0, limit).forEach((u) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = u;
  });
};

/** ====== Card (memo เพื่อลด re-render) ====== */
const TripCard: React.FC<{
  data: EnrichedReview;
  onOpen: (tripId: number | string) => void;
  index: number;
}> = memo(({ data, onOpen, index }) => {
  const { review, trip, user, thumb } = data;
  const tripId = (trip as any)?.ID;
  const title = (trip as any)?.Name?.toString?.() || "-";
  const days = toNum(trip?.Days);
  const daysText = Number.isFinite(days) && days > 0 ? `${days} Days` : "— Days";
  const userId = (review as any)?.User_id;
  const userName =
    user && (user.Firstname || user.Lastname)
      ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
      : `User ${userId}`;

  const onImgErr: React.ReactEventHandler<HTMLImageElement> = (e) => {
    (e.currentTarget as HTMLImageElement).src = FALLBACK_THUMB_URL;
  };

  return (
    <div className="trip-explore-card" onClick={() => onOpen(tripId)}>
      <img
        className="trip-explore-card-img"
        src={thumb}
        srcSet={`${thumb}&w=360 360w, ${thumb}&w=600 600w, ${thumb}&w=900 900w`}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
        alt={title}
        width={360}
        height={220}
        loading={index < 2 ? "eager" : "lazy"}
        fetchPriority={index < 2 ? "high" : "low"}
        decoding="async"
        onError={onImgErr}
      />

      <div className="trip-explore-card-body">
        <h3 className="trip-explore-card-title">
          {title} • {daysText}
        </h3>
        <p className="trip-explore-card-comment">
          {review.Comment || "No comment"}
        </p>
        <div className="trip-explore-card-footer">
          <Avatar size="small" icon={<UserOutlined />} />
          <span className="user">{userName}</span>
          <Tooltip title={`${review.Rate}/5`}>
            <StarFilled style={{ color: "#f59e0b", marginLeft: 8, marginRight: 4 }} />
          </Tooltip>
          <span>{review.Rate}</span>
        </div>
      </div>
    </div>
  );
});
TripCard.displayName = "TripCard";

/** ====== Main ====== */
const TripExplore: React.FC = () => {
  const [msgApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EnrichedReview[]>([]);
  const [visibleCount, setVisibleCount] = useState(6);
  const navigate = useNavigate();

  const saveCache = (c: CacheShape) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
      MEMO.data = c;
    } catch {
      /* ignore */
    }
  };
  const readCache = (): CacheShape | null => {
    if (MEMO.data) return MEMO.data;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.items) && typeof p.savedAt === "number") {
        MEMO.data = p;
        return p;
      }
    } catch { /* ignore */ }
    return null;
  };
  const isFresh = (t: number) => Date.now() - t < TTL_MS;

  // โหลดจริง (รวม de-dupe inflight)
  const fetchData = useCallback(async (): Promise<CacheShape> => {
    if (MEMO.inflight) return MEMO.inflight;

    const p = (async () => {
      const [landmarks, reviews, users] = await Promise.all([
        GetAllLandmarks() as Promise<LandmarkInterface[]>,
        GetAllReviews() as Promise<ReviewInterface[]>,
        GetAllUsers() as Promise<UserInterface[]>,
      ]);

      const lmkMap = buildLandmarkThumbMap(landmarks || []);
      const userMap = new Map(users.map((u: any) => [Number(u.ID), u]));

      if (!Array.isArray(reviews) || reviews.length === 0) {
        return { items: [], savedAt: Date.now() };
      }

      const tripIds = Array.from(new Set(reviews.map((r) => Number(r.TripID)).filter(Boolean)));
      const tripsArr = (await Promise.all(tripIds.map((id) => GetTripById(id)))) as TripInterface[];
      const tripMap = new Map(tripsArr.map((t: any) => [Number(t.ID), t]));

      const conIds = Array.from(new Set(tripsArr.map((t: any) => Number(t.Con_id)).filter(Boolean)));
      const consArr = (await Promise.all(conIds.map((id) => GetConditionById(id)))) as ConditionInterface[];
      const conMap = new Map(consArr.map((c: any) => [Number(c.ID), c]));

      let enriched: EnrichedReview[] = reviews
        .map((review) => {
          const trip = tripMap.get(Number(review.TripID)) || null;
          if (!trip) return null;
          const condition = trip?.Con_id ? conMap.get(Number((trip as any).Con_id)) || null : null;
          const user = userMap.get(Number((review as any).User_id)) || null;
          const thumb = getThumbUrl(trip, condition, lmkMap);
          return { review, trip, condition, user, thumb };
        })
        .filter(Boolean) as EnrichedReview[];

      // เรียง rate มาก→น้อย
      enriched.sort((a, b) => toNum(b.review.Rate) - toNum(a.review.Rate));

      const cache: CacheShape = { items: enriched, savedAt: Date.now() };
      saveCache(cache);
      // พรีโหลดรูปชุดแรก
      preloadImages(enriched.slice(0, 8).map((x) => x.thumb));
      return cache;
    })();

    MEMO.inflight = p;
    try {
      const out = await p;
      return out;
    } finally {
      MEMO.inflight = undefined;
    }
  }, []);

  // เสิร์ฟจากแคชก่อน แล้วค่อยรีเฟรชถ้าหมดอายุ
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setItems(cached.items);
      setLoading(false);
      // พรีโหลดรูปจากแคช (รอบแรกกลับมาหน้าจะไว)
      preloadImages(cached.items.slice(0, 8).map((x) => x.thumb));
      if (isFresh(cached.savedAt)) return; // สดพอ ไม่ต้องโหลดซ้ำ
    }
    let mounted = true;
    (async () => {
      try {
        const data = await fetchData();
        if (!mounted) return;
        setItems(data.items);
      } catch (e: any) {
        console.error("TripExplore load error:", e);
        msgApi.error(e?.message || "โหลดรีวิวไม่สำเร็จ");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [fetchData, msgApi]);

  const openTrip = (tripId: number | string) => {
    // แอบพรีโหลดรูปในหน้าถัดไปได้ถ้ารู้ URL รูป แต่เอาแค่ไปหน้าเลยพอ
    navigate(`/itinerary/recommend/${tripId}`);
  };

  return (
    <div className="trip-explore-page">
      {contextHolder}
      <h2 className="trip-explore-title">Trip Explore</h2>
      <p className="trip-explore-sub">
        Find trips created by other users and get inspired for your next trip!
      </p>

      {loading && <div className="trip-explore-state"><Spin /></div>}

      {!loading && items.length === 0 && (
        <div className="trip-explore-state">
          <Empty description="ยังไม่มีรีวิวทริป" />
        </div>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="trip-explore-grid">
            {items.slice(0, visibleCount).map((data, idx) => (
              <TripCard key={`${(data.trip as any)?.ID}-${idx}`} data={data} onOpen={openTrip} index={idx} />
            ))}
          </div>

          {visibleCount < items.length && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Button type="primary" onClick={() => setVisibleCount((p) => p + 6)}>
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TripExplore;
