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

const TripRecommendations: React.FC = () => {
  type EnrichedReview = {
    review: ReviewInterface;
    trip: TripInterface | null;
    condition: ConditionInterface | null;
  };

  const navigate = useNavigate();
  const FALLBACK_THUMB_URL =
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

  const unique = <T,>(arr: T[]) => Array.from(new Set(arr));
  const safeDateLabel = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "-");
  const toNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const mapFromArray = <T, K extends string | number>(
    arr: T[],
    keySelector: (x: T) => K | null | undefined
  ) => {
    const m = new Map<K, T>();
    for (const it of arr) {
      const k = keySelector(it);
      if (k !== null && k !== undefined) m.set(k, it);
    }
    return m;
  };

  const pickString = (obj: unknown, fields: string[]): string | undefined => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    for (const f of fields) {
      const val = rec[f];
      if (typeof val === "string" && val.trim()) return val;
    }
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
      const name =
        (lm as any).Name ?? (lm as any).name ?? (lm as any).Title ?? (lm as any).title;
      const url =
        (lm as any).ThumbnailURL ??
        (lm as any).ThumbnailUrl ??
        (lm as any).thumbnail ??
        (lm as any).ImageURL ??
        (lm as any).imageURL;
      const key = normalizeKey(name);
      if (key && typeof url === "string" && url.trim()) {
        m.set(key, String(url));
      }
    }
    return m;
  };

  const getNameCandidates = (
    trip: TripInterface | null,
    condition: ConditionInterface | null
  ): string[] => {
    const primary =
      pickString(trip, ["Name", "City", "Title"]) ||
      pickString(condition, ["Landmark", "City", "Place"]) ||
      "";
    const extras = [
      pickString(trip, ["City"]),
      pickString(condition, ["City"]),
      pickString(condition, ["Landmark"]),
    ].filter(Boolean) as string[];
    return [primary, ...extras];
  };

  const getLandmarkThumbUrl = (
    lmkThumbs: Map<string, string>,
    trip: TripInterface | null,
    condition: ConditionInterface | null
  ): string | undefined => {
    const candidates = getNameCandidates(trip, condition);
    for (const c of candidates) {
      const hit = lmkThumbs.get(normalizeKey(c));
      if (hit) return hit;
    }
    for (const c of candidates) {
      const key = normalizeKey(c);
      if (!key) continue;
      for (const [k, url] of lmkThumbs) {
        if (k.includes(key) || key.includes(k)) return url;
      }
    }
    return undefined;
  };

  const pickRandomN = <T,>(arr: T[], n: number) => {
    const a = [...arr];
    const m = Math.min(n, a.length);
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, m);
  };

  const StarRating: React.FC<{ rate: number; outOf?: number }> = ({ rate, outOf = 5 }) => {
    const filled = Math.max(0, Math.min(outOf, Math.round(rate)));
    return (
      <div className="reco-stars" aria-label={`Rating: ${filled} stars`}>
        {Array.from({ length: outOf }).map((_, i) => (
          <StarFilled key={i} className={`reco-star ${i < filled ? "is-active" : ""}`} />
        ))}
      </div>
    );
  };

  const ReviewCard: React.FC<{
    item: EnrichedReview;
    thumbUrl: string;
  }> = memo(({ item, thumbUrl }) => {
    const { review, trip, condition } = item;

    const days = toNum(trip?.Days);
    const daysText = Number.isFinite(days) && days > 0 ? `${days} วัน` : "— วัน";
    const title =
      (trip as any)?.Name?.toString?.() || (condition as any)?.Landmark?.toString?.() || "-";
    const whenText = safeDateLabel(review.Day);

    const handleClick = () => {
      if (trip && (trip as any).ID) {
        const tripId = (trip as any).ID;
        localStorage.setItem("recommendTripID", String(tripId));
        navigate(`/itinerary/recommend/${tripId}`);
      }
    };

    return (
      <div className="trip-recommendation" onClick={handleClick} style={{ cursor: "pointer" }}>
        <div className="trip-reco-text">
          <p className="trip-reco-title">
            {daysText} - {title}
          </p>

          <div className="trip-reco-rating">
            <Tooltip title={`${review.Rate}/5`}>
              <StarRating rate={toNum(review.Rate)} />
            </Tooltip>
          </div>

          <p className="trip-reco-date">{whenText}</p>
        </div>
        <img
          className="trip-reco-thumb"
          src={thumbUrl}
          alt="trip thumbnail"
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  });
  ReviewCard.displayName = "ReviewCard";

  const [msgApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EnrichedReview[]>([]);
  const [lmkThumbs, setLmkThumbs] = useState<Map<string, string>>(new Map());

  /**
   * Load data with abort support so we don't set state after unmount.
   */
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const aborted = () => signal?.aborted === true;

      if (!aborted()) setLoading(true);
      try {
        const landmarks = (await GetAllLandmarks()) as LandmarkInterface[];
        if (aborted()) return;
        setLmkThumbs(buildLandmarkThumbMap(Array.isArray(landmarks) ? landmarks : []));

        const reviews = (await GetAllReviews()) as ReviewInterface[];
        if (aborted()) return;

        if (!Array.isArray(reviews) || reviews.length === 0) {
          setItems([]);
          return;
        }

        const tripIds = unique(
          reviews.map((r) => toNum(r.TripID)).filter((n) => Number.isFinite(n))
        ) as number[];

        const tripsArr = (await Promise.all(tripIds.map((id) => GetTripById(id)))) as TripInterface[];
        if (aborted()) return;

        const tripMap = mapFromArray(
          tripsArr.filter(Boolean),
          (t) => toNum((t as any).ID) as number
        );

        const conIds = unique(
          tripsArr
            .map((t) => toNum((t as any).Con_id))
            .filter((n) => Number.isFinite(n) && n > 0)
        ) as number[];

        const consArr = (await Promise.all(
          conIds.map((cid) => GetConditionById(cid))
        )) as ConditionInterface[];
        if (aborted()) return;

        const conMap = mapFromArray(
          consArr.filter(Boolean),
          (c) => toNum((c as any).ID) as number
        );

        let enriched = reviews
          .map<EnrichedReview>((rev) => {
            const trip = tripMap.get(toNum(rev.TripID) as number) || null;
            const condition =
              trip && (trip as any).Con_id
                ? conMap.get(toNum((trip as any).Con_id) as number) || null
                : null;
            return { review: rev, trip, condition };
          })
          .filter((x) => !!x.trip);

        if (enriched.length === 0) {
          setItems([]);
          return;
        }

        const highRated = enriched.filter((e) => toNum(e.review.Rate) >= 4);
        if (highRated.length === 0) {
          setItems([]);
          return;
        }

        const randomFour = pickRandomN(highRated, 4);
        randomFour.sort((a, b) => {
          const ra = toNum(a.review.Rate);
          const rb = toNum(b.review.Rate);
          return rb - ra;
        });

        if (aborted()) return;
        setItems(randomFour);
      } catch (e: unknown) {
        const err = e as { message?: string };
        console.error("TripRecommendations load error:", e);
        msgApi.error(err?.message || "โหลดรีวิวไม่สำเร็จ");
      } finally {
        if (!aborted()) setLoading(false);
      }
    },
    [msgApi]
  );

  useEffect(() => {
    const controller = new AbortController();
    // fire and forget; cleanup is handled by aborting
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <aside className="trip-sidebar">
      {contextHolder}
      <h2 className="trip-sidebar-title">Recommendations</h2>

      {loading && (
        <div className="reco-state">
          <Spin />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="reco-state">
          <Empty description="ยังไม่มีรีวิวทริป" />
        </div>
      )}

      {!loading &&
        items.length > 0 &&
        items.map((item) => {
          const lmkUrl = getLandmarkThumbUrl(lmkThumbs, item.trip, item.condition);
          const thumbUrl = lmkUrl || getThumbUrlFromTripOrCondition(item.trip, item.condition);
          return (
            <ReviewCard
              key={String(
                (item.review as any)?.ID ??
                  `${(item.review as any)?.TripID}-${(item.review as any)?.Day}`
              )}
              item={item}
              thumbUrl={thumbUrl}
            />
          );
        })}
    </aside>
  );
};

export default TripRecommendations;
