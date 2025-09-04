import "./landing.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Carousel, Spin, Empty, Tooltip } from "antd";
import { CompassOutlined, BranchesOutlined, ScheduleOutlined, StarFilled } from "@ant-design/icons";
import a1 from "../../assets/a.jpg";
import a2 from "../../assets/b.jpg";
import a3 from "../../assets/c.jpg";
import a4 from "../../assets/d.jpg";
import a5 from "../../assets/e.jpg";
import { useNavigate } from "react-router-dom";

import {
  GetAllReviews,
  GetTripById,
  GetConditionById,
  GetAllLandmarks,
  GetAllUsers,
} from "../../services/https";

import type { ReviewInterface } from "../../interfaces/review";
import type { TripInterface } from "../../interfaces/Trips";
import type { ConditionInterface } from "../../interfaces/Condition";
import type { LandmarkInterface } from "../../interfaces/Landmark";
import type { UserInterface } from "../../interfaces/User";

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

type EnrichedReview = {
  review: ReviewInterface;
  trip: TripInterface | null;
  condition: ConditionInterface | null;
  user: UserInterface | null;
  thumb: string;
};

const Landing: React.FC = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(false);
  const [topTrips, setTopTrips] = useState<EnrichedReview[]>([]);

  // ===== Helpers =====
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
        (lm as any).ThumbnailURL ??
        (lm as any).ImageURL ??
        (lm as any).thumbnail;
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

  // ===== Load top 4 trips (by highest review rate) =====
  const loadTopTrips = useCallback(async () => {
    setLoading(true);
    try {
      const [landmarks, reviews, users] = await Promise.all([
        GetAllLandmarks() as Promise<LandmarkInterface[]>,
        GetAllReviews() as Promise<ReviewInterface[]>,
        GetAllUsers() as Promise<UserInterface[]>,
      ]);

      if (!Array.isArray(reviews) || reviews.length === 0) {
        setTopTrips([]);
        return;
      }

      const lmkMap = buildLandmarkThumbMap(landmarks);
      const userMap = new Map(users.map((u: any) => [Number(u.ID), u]));

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
      setTopTrips(enriched.slice(0, 4));
    } catch (err) {
      console.error("loadTopTrips error:", err);
      setTopTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTopTrips(); }, [loadTopTrips]);

  const hasRecs = useMemo(() => topTrips.length > 0, [topTrips]);

  return (
    <div className="landing-container">
      <div className="landing-content-wrapper">
        {/* Hero Section */}
        <section className="landing-hero">
          <div className="landing-hero-stage">
            <Carousel
              className="landing-hero-carousel"
              arrows
              autoplay
              autoplaySpeed={3000}
              dots
              draggable
            >
              {[a1, a2, a3, a4, a5].map((img, idx) => (
                <div key={idx}>
                  <div
                    className="landing-hero-slide"
                    style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.40) 100%), url(${img})` }}
                  />
                </div>
              ))}
            </Carousel>

            <div className="landing-hero-overlay">
              <div className="landing-hero-text">
                <h1 className="landing-hero-title">TRIP PLANNER</h1>
                <h2 className="landing-hero-subtitle">วางแผนการเดินทางโดยง่ายเพียงแค่ระบุสถานที่</h2>
              </div>

              <button className="button" onClick={() => navigate("/trip-chat")}>
                <span className="button_lg">
                  <span className="button_sl"></span>
                  <span className="button_text">เริ่มต้นการวางแผน</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="landing-how-it-works">
          <div className="landing-section-header">
            <h1 className="landing-section-title">How it works</h1>
            <p className="landing-section-description">
              เพียงไม่กี่ขั้นตอน ระบบก็สามารถสร้างแผนการเดินทางที่เหมาะสมและพร้อมใช้งานสำหรับคุณ
            </p>
          </div>

          <div className="landing-steps-grid">
            <div className="landing-step-card">
              <div className="landing-step-icon">
                <CompassOutlined style={{ fontSize: 28, color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Tell us your destination</h2>
                <p className="landing-step-description">แจ้งจุดหมายปลายทางที่คุณต้องการเดินทางไป</p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-icon">
                <BranchesOutlined style={{ fontSize: 28, color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Algorithm processes your trip</h2>
                <p className="landing-step-description">ระบบใช้อัลกอริทึมประมวลผลและสร้างแผนการเดินทางที่เหมาะสม</p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-icon">
                <ScheduleOutlined style={{ fontSize: 28, color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Use your itinerary</h2>
                <p className="landing-step-description">นำแผนการเดินทางไปใช้จริงหรือปรับแก้ตามความต้องการ</p>
              </div>
            </div>
          </div>
        </section>

        {/* Journey Inspirations (4 ใบ, จัดแพทเทิร์นและสลับฝั่งได้) */}
        <section className="landing-inspire">
          <div className="landing-section-header">
            <h1 className="landing-section-title">Journey Inspirations from Travelers</h1>
            <p className="landing-section-description">Dive into unique trip itineraries crafted by our global travelers.</p>
          </div>

          {loading && <div className="landing-recs-state"><Spin /></div>}

          {!loading && topTrips.length === 0 && (
            <div className="landing-recs-state"><Empty description="ยังไม่มีทริปแนะนำ" /></div>
          )}

          {!loading && hasRecs && (
            // เพิ่ม "swap" ถ้าต้องการสลับซ้าย/ขวา
            <div className="inspire-flex alt-stagger">
              {topTrips.map(({ review, trip, user, thumb }, idx) => {
                const tripId = (trip as any)?.ID;
                const title = (trip as any)?.Name?.toString?.() || "-";
                const rate = Number(review.Rate) || 0;
                const userName =
                  user && (user.Firstname || user.Lastname)
                    ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
                    : `User ${(review as any)?.User_id}`;

                // ขนาดตามแพทเทิร์น 4 ใบ
                const layoutIdx = idx % 4; // 0..3
                const sizeClass =
                  layoutIdx === 2 ? "is-tall" :
                    layoutIdx === 3 ? "is-short" : "is-regular";

                return (
                  <article
                    key={tripId ?? idx}
                    className={`inspire-card ${sizeClass}`}
                    onClick={() => navigate(`/itinerary/recommend/${tripId}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/itinerary/recommend/${tripId}`)}
                  >
                    <div className="inspire-cover" style={{ backgroundImage: `url(${thumb})` }} />
                    <div className="inspire-info">
                      <div className="inspire-user">
                        <span className="inspire-avatar" aria-hidden />
                        <span className="inspire-username">{userName}</span>
                      </div>
                      <h3 className="inspire-title">{title}</h3>
                      <div className="inspire-meta">
                        <Tooltip title={`${rate}/5`}>
                          <span className="inspire-chip"><StarFilled /> {rate}</span>
                        </Tooltip>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* ===== Footer ===== */}
        <footer className="site-footer">
          <div className="footer-inner">
            <div className="footer-grid">
              {/* Brand */}
              <div className="footer-col">
                <h3 className="footer-brand">TRIP PLANNER</h3>
              </div>

              {/* Quick Links */}
              <div className="footer-col">
                <h4 className="footer-title">Product</h4>
                <ul className="footer-links">
                  <li><a onClick={() => navigate("/trip-chat")}>Trip Chat</a></li>
                  <li><a onClick={() => navigate("/itinerary/explore")}>Explore Trips</a></li>
                </ul>
              </div>

              {/* Resources */}
              <div className="footer-col">
                <h4 className="footer-title">Resources</h4>
                <ul className="footer-links">
                  <li><a href="#faq">FAQ</a></li>
                  <li><a href="#how-it-works">How it works</a></li>
                  <li><a href="#contact">Support</a></li>
                </ul>
              </div>

              {/* Contact */}
              <div className="footer-col">
                <h4 className="footer-title">Contact</h4>
                <ul className="footer-links">
                  <li><a href="mailto:support@tripplanner.app">support@tripplanner.app</a></li>
                  <li><a href="#">Feedback</a></li>
                </ul>
              </div>
            </div>

            <div className="footer-bottom">
              <span>© {new Date().getFullYear()} Trip Planner</span>
              <nav className="footer-bottom-links">
                <a href="#">Privacy</a>
                <a href="#">Terms</a>
                <a href="#">Status</a>
              </nav>
            </div>
          </div>
        </footer>


      </div>
    </div>
  );
};

export default Landing;
