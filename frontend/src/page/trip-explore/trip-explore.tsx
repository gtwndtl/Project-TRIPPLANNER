// src/component/trip-recommendations/TripRecommendations.tsx
import React, { useEffect, useState, useCallback } from "react";
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

type EnrichedReview = {
  review: ReviewInterface;
  trip: TripInterface | null;
  condition: ConditionInterface | null;
  user: UserInterface | null;
};

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

const TripExplore: React.FC = () => {
  const [msgApi, contextHolder] = message.useMessage();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<EnrichedReview[]>([]);
  const [lmkThumbs, setLmkThumbs] = useState<Map<string, string>>(new Map());
  const [visibleCount, setVisibleCount] = useState(6); // ✅ โหลดครั้งแรก 8
  const navigate = useNavigate();

  const toNum = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  // ===== Helpers =====
  const normalizeKey = (s?: string) =>
    (s || "").toString().trim().toLowerCase();

  const buildLandmarkThumbMap = (list: LandmarkInterface[]) => {
    const m = new Map<string, string>();
    for (const lm of list || []) {
      const name = (lm as any).Name ?? (lm as any).Title;
      const url =
        (lm as any).ThumbnailURL ??
        (lm as any).ImageURL ??
        (lm as any).thumbnail;
      if (name && url) {
        m.set(normalizeKey(name), String(url));
      }
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
    condition: ConditionInterface | null
  ): string => {
    const tImg = pickString(trip, ["Cover", "ImageURL"]);
    if (tImg) return tImg;
    const cImg = pickString(condition, ["Thumbnail", "ImageURL"]);
    if (cImg) return cImg;
    const name =
      pickString(trip, ["Name"]) || pickString(condition, ["Landmark"]);
    if (name) {
      const url = lmkThumbs.get(normalizeKey(name));
      if (url) return url;
    }
    return FALLBACK_THUMB_URL;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const landmarks = (await GetAllLandmarks()) as LandmarkInterface[];
      setLmkThumbs(buildLandmarkThumbMap(landmarks));

      const reviews = (await GetAllReviews()) as ReviewInterface[];
      if (!Array.isArray(reviews) || reviews.length === 0) {
        setItems([]);
        return;
      }

      // trips
      const tripIds = Array.from(
        new Set(reviews.map((r) => Number(r.TripID)))
      );
      const tripsArr = (await Promise.all(
        tripIds.map((id) => GetTripById(id))
      )) as TripInterface[];
      const tripMap = new Map(tripsArr.map((t: any) => [Number(t.ID), t]));

      // conditions
      const conIds = Array.from(
        new Set(tripsArr.map((t: any) => Number(t.Con_id)).filter(Boolean))
      );
      const consArr = (await Promise.all(
        conIds.map((id) => GetConditionById(id))
      )) as ConditionInterface[];
      const conMap = new Map(consArr.map((c: any) => [Number(c.ID), c]));

      // users
      const usersArr = (await GetAllUsers()) as UserInterface[];
      const userMap = new Map(usersArr.map((u: any) => [Number(u.ID), u]));

      // enrich
      let enriched = reviews
        .map<EnrichedReview>((rev) => {
          const trip = tripMap.get(Number(rev.TripID)) || null;
          const condition =
            trip && (trip as any).Con_id
              ? conMap.get(Number((trip as any).Con_id)) || null
              : null;

          const userId = Number((rev as any).User_id);
          const user = userMap.get(userId) || null;

          return { review: rev, trip, condition, user };
        })
        .filter((x) => !!x.trip);

      // เรียงตาม rate มากไปน้อย
      enriched.sort((a, b) => toNum(b.review.Rate) - toNum(a.review.Rate));
      setItems(enriched);
    } catch (e: any) {
      console.error("TripExplore load error:", e);
      msgApi.error(e?.message || "โหลดรีวิวไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [msgApi]);

  useEffect(() => {
    void load();
  }, [load]);

  // ===== Render =====
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
            {items.slice(0, visibleCount).map(({ review, trip, condition, user }, idx) => {
              const tripId = (trip as any)?.ID;
              const days = toNum(trip?.Days);
              const daysText =
                Number.isFinite(days) && days > 0 ? `${days} Days` : "— Days";
              const title = (trip as any)?.Name?.toString?.() || "-";

              const thumbUrl = getThumbUrl(trip, condition);

              const userId = (review as any)?.User_id;
              const userName =
                user && (user.Firstname || user.Lastname)
                  ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
                  : `User ${userId}`;

              return (
                <div
                  key={idx}
                  className="trip-explore-card"
                  onClick={() => navigate(`/itinerary/recommend/${tripId}`)}
                >
                  <img
                    src={thumbUrl}
                    alt={title}
                    className="trip-explore-card-img"
                    loading="lazy"
                    decoding="async"
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
            })}
          </div>

          {/* ✅ ปุ่ม Load more */}
          {visibleCount < items.length && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Button
                type="primary"
                onClick={() => setVisibleCount((prev) => prev + 6)}
              >
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
