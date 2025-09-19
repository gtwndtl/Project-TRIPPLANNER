// src/component/trip-recommendations/TripExplore.tsx
import React, { useEffect, useState, useCallback, memo } from "react";
import { message, Empty, Avatar, Tooltip, Button, Skeleton } from "antd";
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
  thumb: string;
};

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

/** ====== Cache config ====== */
type CacheShape = { items: EnrichedReview[]; savedAt: number };
const CACHE_KEY = "TripExploreCache:v2";
const TTL_MS = 10 * 60 * 1000;

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

// พรีโหลดรูป (เงียบ ๆ)
const preloadImages = (urls: string[], limit = 8) => {
  urls.slice(0, limit).forEach((u) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = u;
  });
};

// Avatar: สีสุ่ม “ต่อการ์ด” ให้หลากหลายแม้เป็น user เดิม
const colorFromIndex = (i: number) => `hsl(${(i * 47) % 360} 72% 46%)`;
const initials = (name?: string) => {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
};

/** ====== Card (minimal) ====== */
const TripCard: React.FC<{
  data: EnrichedReview;
  onOpen: (tripId: number | string) => void;
  index: number;
}> = memo(({ data, onOpen, index }) => {
  const { review, trip, user, thumb } = data;
  const tripId = (trip as any)?.ID;
  const title = (trip as any)?.Name?.toString?.() || "-";
  const days = toNum(trip?.Days);
  const daysText = Number.isFinite(days) && days > 0 ? `${days} วัน` : "— วัน";
  const userId = (review as any)?.User_id;
  const userName =
    user && (user.Firstname || user.Lastname)
      ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
      : `User ${userId}`;

  const onImgErr: React.ReactEventHandler<HTMLImageElement> = (e) => {
    (e.currentTarget as HTMLImageElement).src = FALLBACK_THUMB_URL;
  };

  return (
    <article className="tx-card" onClick={() => onOpen(tripId)} tabIndex={0}>
      <div className="tx-media">
        <img
          className="tx-img"
          src={thumb}
          alt={title}
          loading={index < 2 ? "eager" : "lazy"}
          fetchPriority={index < 2 ? "high" : "low"}
          decoding="async"
          onError={onImgErr}
        />
      </div>

      <div className="tx-body">
        <h3 className="tx-title">{title}</h3>

        <div className="tx-meta">
          <Tooltip title={`${review.Rate}/5`}>
            <span className="tx-chip">
              <StarFilled />
              {review.Rate}
            </span>
          </Tooltip>
          <span className="tx-dot" />
          <span className="tx-subtle">{daysText}</span>
        </div>

        {review.Comment ? (
          <p className="tx-comment">{review.Comment}</p>
        ) : (
          <p className="tx-comment tx-muted">ไม่มีคำบรรยาย</p>
        )}
      </div>

      <div className="tx-footer" onClick={(e) => e.stopPropagation()}>
        <Avatar
          size={26}
          style={{ backgroundColor: colorFromIndex(index), color: "#fff" }}
          icon={!userName ? <UserOutlined /> : undefined}
        >
          {userName ? initials(userName) : null}
        </Avatar>
        <span className="tx-user">{userName}</span>
        <span className="tx-spacer" />
        <Button type="text" className="tx-cta" onClick={() => onOpen(tripId)}>
          ดูรายละเอียด
        </Button>
      </div>
    </article>
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
    } catch { }
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
    } catch { }
    return null;
  };
  const isFresh = (t: number) => Date.now() - t < TTL_MS;

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

      enriched.sort((a, b) => toNum(b.review.Rate) - toNum(a.review.Rate));

      const cache: CacheShape = { items: enriched, savedAt: Date.now() };
      saveCache(cache);
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

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setItems(cached.items);
      setLoading(false);
      preloadImages(cached.items.slice(0, 8).map((x) => x.thumb));
      if (isFresh(cached.savedAt)) return;
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
    return () => {
      mounted = false;
    };
  }, [fetchData, msgApi]);

  const openTrip = (tripId: number | string) => {
    navigate(`/itinerary/recommend/${tripId}`);
  };

  // ===== Skeleton Loader (shimmer) =====
  const SkeletonTripGrid: React.FC<{ count?: number }> = ({ count = 6 }) => {
    return (
      <div className="tx-grid">
        {Array.from({ length: count }).map((_, i) => (
          <article className="tx-card tx-skel-card" key={i} aria-hidden="true">
            {/* รูป */}
            <div className="tx-media">
              <div className="tx-skel-block tx-skel-media" />
            </div>

            {/* เนื้อหา */}
            <div className="tx-body">
              {/* ชื่อทริป 2 บรรทัด */}
              <div className="tx-skel-line tx-skel-line-lg" />
              <div className="tx-skel-line tx-skel-line-md" />

              {/* meta: เรตติ้ง • วัน */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span className="tx-skel-chip" />
                <span className="tx-dot" />
                <span className="tx-skel-dotline" />
              </div>

              {/* คอมเมนต์ 2 บรรทัด */}
              <div className="tx-skel-line" />
              <div className="tx-skel-line tx-skel-line-sm" />
            </div>

            {/* ฟุทเตอร์: avatar + ชื่อ + ปุ่ม */}
            <div className="tx-footer">
              <span className="tx-skel-avatar" />
              <span className="tx-skel-line tx-skel-user" />
              <span className="tx-spacer" />
              <span className="tx-skel-btn" />
            </div>
          </article>
        ))}
      </div>
    );
  };


  return (
    <div className="tx-page">
      {contextHolder}

      <header className="tx-header">
        <h1 className="tx-title-text">Trip Explore</h1>
        <p className="tx-sub">สำรวจแผนทริปจริงจากผู้ใช้ พร้อมคะแนนและรีวิว</p>
      </header>

      {loading && <SkeletonTripGrid count={6} />}


      {!loading && items.length === 0 && (
        <div className="tx-empty">
          <Empty description="ยังไม่มีรีวิวทริป" />
        </div>
      )}

      {!loading && items.length > 0 && (
        <>
          <div className="tx-grid">
            {items.slice(0, visibleCount).map((data, idx) => (
              <TripCard
                key={`${(data.trip as any)?.ID}-${idx}`}
                data={data}
                index={idx}
                onOpen={openTrip}
              />
            ))}
          </div>

          {visibleCount < items.length && (
            <div className="tx-more">
              <Button onClick={() => setVisibleCount((p) => p + 6)} className="tx-more-btn">
                ดูเพิ่มเติม
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TripExplore;
