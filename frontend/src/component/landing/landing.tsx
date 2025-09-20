import "./landing.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Carousel, Empty, Tooltip, Avatar, Button } from "antd";
import { CompassOutlined, BranchesOutlined, ScheduleOutlined, StarFilled } from "@ant-design/icons";
import a1 from "../../assets/a.jpg";
import a2 from "../../assets/b.jpg";
import a3 from "../../assets/c.jpg";
import a4 from "../../assets/d.jpg";
import a5 from "../../assets/e.jpg";
import { useLocation, useNavigate } from "react-router-dom";

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
import SiteFooter from "../footer/footer";

const FALLBACK_THUMB_URL =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop";

type EnrichedReview = {
  review: ReviewInterface;
  trip: TripInterface | null;
  condition: ConditionInterface | null;
  user: UserInterface | null;
  thumb: string;
};

// ---------- helpers: preload / cache ----------
const preloadImages = (urls: string[]) => {
  urls.filter(Boolean).forEach((u) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = u;
  });
};

const CACHE_KEY = "landing:topTrips:v1";
const CACHE_TTL = 10 * 60 * 1000; // 10 นาที

const readTopTripsCache = (): EnrichedReview[] | null => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw) || {};
    if (!Array.isArray(data) || typeof savedAt !== "number") return null;
    if (Date.now() - savedAt > CACHE_TTL) return null;
    return data as EnrichedReview[];
  } catch {
    return null;
  }
};

const writeTopTripsCache = (items: EnrichedReview[]) => {
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), data: items })
    );
  } catch {
    /* ignore */
  }
};

const HERO_IMAGES = [a1, a2, a3, a4, a5];

/* =========================================================
   Avatar Color (เหมือนเดิม)
   ========================================================= */
const AVATAR_COLORS = [
  "#1677ff", "#13c2c2", "#52c41a", "#fa8c16",
  "#f5222d", "#722ed1", "#eb2f96", "#2f54eb",
  "#a0d911", "#faad14", "#1890ff", "#9254de",
];

const fnv1a = (str: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
};

const SESSION_SALT = (() => {
  try {
    const key = "AVATAR_SALT_V1";
    let s = sessionStorage.getItem(key);
    if (!s) {
      s = Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, s);
    }
    return s;
  } catch {
    return "nosession";
  }
})();

const pickColorFromSeed = (seed: string) => {
  const h = fnv1a(`${seed}:${SESSION_SALT}`);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const seedForCard = (args: { tripId?: any; review?: any; index: number }) => {
  const reviewKey = args.review?.ID ?? args.review?.Day ?? "r";
  return `t-${String(args.tripId ?? "t")}|r-${String(reviewKey)}|i-${args.index}`;
};

const initials = (name?: string) => {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
};

const Landing: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState<boolean>(false);
  const [topTrips, setTopTrips] = useState<EnrichedReview[]>([]);


  // ===== NEW: Skeleton for Journey Inspirations =====
  const SkeletonInspireMosaic: React.FC = () => {
    // ใช้ class mosaic-a,b,c,d เพื่อคงเลย์เอาต์เป๊ะกับของจริง
    const cards = ["mosaic-a", "mosaic-b", "mosaic-c", "mosaic-d"];
    return (
      <div className="inspire-mosaic">
        {cards.map((cls, i) => (
          <article key={i} className={`inspire-card ${cls} is-skeleton`}>
            {/* พื้นหลังสี่เหลี่ยมของภาพ */}
            <div className="skeleton-bg" />
            {/* ชิปเรตติ้งมุมขวาบน */}
            <div className="inspire-rating">
              <span className="inspire-chip skeleton-chip" />
            </div>
            {/* ผู้ใช้มุมบนซ้าย */}
            <div className="inspire-user fixed">
              <span className="skeleton-avatar" />
              <span className="skeleton-line skeleton-line--sm" />
            </div>
            {/* ชื่อทริปด้านล่าง */}
            <div className="inspire-info bottom">
              <div className="skeleton-line skeleton-line--lg" />
              <div className="skeleton-line skeleton-line--md" />
            </div>
          </article>
        ))}
      </div>
    );
  };

  // พรีโหลดรูป Hero หนึ่งครั้งต่อเซสชัน
  useEffect(() => {
    if (sessionStorage.getItem("HERO_PRELOADED_V1") !== "1") {
      preloadImages(HERO_IMAGES);
      sessionStorage.setItem("HERO_PRELOADED_V1", "1");
    }
  }, []);

  // preconnect ไป unsplash
  useEffect(() => {
    const hosts = ["https://images.unsplash.com", "https://plus.unsplash.com"];
    const links: HTMLLinkElement[] = [];
    hosts.forEach((h) => {
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = h;
      l.crossOrigin = "anonymous";
      document.head.appendChild(l);
      links.push(l);
    });
    return () => {
      links.forEach((l) => document.head.removeChild(l));
    };
  }, []);

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

  // ===== Load top 4 trips (with cache) =====
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
        writeTopTripsCache([]);
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
      const top = enriched.slice(0, 4);

      setTopTrips(top);
      writeTopTripsCache(top);

      // พรีโหลดรูปท็อปทริป
      preloadImages(top.map((t) => t.thumb));
    } catch (err) {
      console.error("loadTopTrips error:", err);
      setTopTrips([]);
      writeTopTripsCache([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // serve from cache then revalidate
  useEffect(() => {
    const cached = readTopTripsCache();
    if (cached) {
      setTopTrips(cached);
      setLoading(false);
      const raw = sessionStorage.getItem(CACHE_KEY);
      const stale =
        !raw ||
        (function () {
          try {
            const { savedAt } = JSON.parse(raw) || {};
            return Date.now() - (savedAt || 0) > CACHE_TTL;
          } catch {
            return true;
          }
        })();
      if (stale) void loadTopTrips();
    } else {
      void loadTopTrips();
    }
  }, [loadTopTrips]);

  const hasRecs = useMemo(() => topTrips.length > 0, [topTrips]);

  useEffect(() => {
    const want = location.hash === "#how-it-works" || (location.state as any)?.scrollTo === "how-it-works";
    if (want) {
      // รอให้ DOM วาดเสร็จสั้นๆ แล้วค่อยเลื่อน (กันภาพ/คอมโพเนนต์ยังโหลดไม่ครบ)
      requestAnimationFrame(() => {
        document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [location]);

  return (
    <>
      <div className="landing-container">
        <div className="landing-content-wrapper">
          {/* ===== Hero (modern/minimal) ===== */}
          <section className="landing-hero">
            <div className="landing-hero-stage">
              <Carousel
                className="landing-hero-carousel"
                autoplay
                autoplaySpeed={3600}
                dots
                draggable
                adaptiveHeight={false}
              >
                {HERO_IMAGES.map((img, idx) => (
                  <div key={idx}>
                    <div
                      className="landing-hero-slide"
                      style={{
                        backgroundImage: `linear-gradient(rgba(10,10,10,.12) 0%, rgba(0,0,0,.44) 100%), url(${img})`,
                      }}
                    />
                  </div>
                ))}
              </Carousel>

              <div className="landing-hero-overlay">
                <div className="hero-copy">
                  <h1 className="hero-title">Trip Planner</h1>
                  <p className="hero-subtitle">
                    วางแผนการเดินทางแบบมินิมอล ใช้งานง่าย ได้แผนที่พร้อมใช้จริง
                  </p>
                  <div className="hero-cta-row">
                    <Button
                      type="primary"
                      size="large"
                      shape="round"
                      className="hero-cta"
                      onClick={() => navigate("/trip-chat")}
                    >
                      เริ่มวางแผนตอนนี้
                    </Button>
                    <Button
                      size="large"
                      shape="round"
                      className="hero-cta ghost"
                      onClick={() => navigate("/itinerary/explore")}
                    >
                      สำรวจทริป
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===== How It Works (hero cards) ===== */}
          <section id="how-it-works" className="landing-how-it-works">
            <div className="landing-section-header">
              <h1 className="landing-section-title">How it works</h1>
              <p className="landing-section-description">
                เลือกปลายทาง ระบบคำนวณเส้นทาง-เวลาให้อัตโนมัติ แล้วนำไปใช้จริงหรือปรับแต่งตามใจคุณ
              </p>
            </div>

            <div className="how-grid">
              {/* Card 1 */}
              <article
                className="how-card"
                role="button"
                tabIndex={0}
                aria-label="เริ่มวางแผนทริปด้วยการบอกปลายทาง"
              >
                <div className="how-card-bg how-1" />
                <div className="how-badge">Step 1</div>
                <div className="how-icon">
                  <CompassOutlined />
                </div>
                <h3 className="how-title">Tell us your destination</h3>
                <p className="how-desc">บอกเราว่าคุณอยากไปที่ไหน · กี่วัน · สไตล์ · งบเท่าไหร่</p>
              </article>

              {/* Card 2 */}
              <article className="how-card" aria-label="ระบบช่วยวางแผนอัตโนมัติ">
                <div className="how-card-bg how-2" />
                <div className="how-badge">Step 2</div>
                <div className="how-icon">
                  <BranchesOutlined />
                </div>
                <h3 className="how-title">Algorithm plans for you</h3>
                <p className="how-desc">ระบบจัดลำดับสถานที่ · ที่พัก · ร้านอาหาร ครบ</p>
              </article>

              {/* Card 3 */}
              <article
                className="how-card"
                role="button"
                tabIndex={0}
                aria-label="ใช้งานแผนหรือปรับแต่งได้ทันที"
              >
                <div className="how-card-bg how-3" />
                <div className="how-badge">Step 3</div>
                <div className="how-icon">
                  <ScheduleOutlined />
                </div>
                <h3 className="how-title">Use Your Itinerary</h3>
                <p className="how-desc">นำแผนการเดินทางของคุณไปใช้ · พร้อมแผนที่จริง</p>
              </article>
            </div>
          </section>


          {/* ===== Journey Inspirations ===== */}
          <section id="journey-inspirations" className="landing-inspire">
            <div className="landing-section-header">
              <h1 className="landing-section-title">Journey Inspirations from Travelers</h1>
              <p className="landing-section-description">
                สำรวจแผนการเดินทางสุดพิเศษ จากนักเดินทางของเราที่ได้แบ่งปันประสบการณ์และรีวิว
              </p>
            </div>

            {/* ✅ ใช้ Skeleton แทน Spinner */}
            {loading && (
              <SkeletonInspireMosaic />
            )}

            {!loading && topTrips.length === 0 && (
              <div className="landing-recs-state"><Empty description="ยังไม่มีทริปแนะนำ" /></div>
            )}

            {!loading && hasRecs && (
              <div className="inspire-mosaic">
                {topTrips.slice(0, 4).map(({ review, trip, user, thumb }, idx) => {
                  const tripId = (trip as any)?.ID;
                  const title = (trip as any)?.Name?.toString?.() || "-";
                  const rate = Number(review.Rate) || 0;
                  const userName =
                    user && (user.Firstname || user.Lastname)
                      ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
                      : `User ${(review as any)?.User_id}`;

                  const seed = seedForCard({ tripId, review, index: idx });
                  const color = pickColorFromSeed(seed);
                  const mosaicClass = ["mosaic-a", "mosaic-b", "mosaic-c", "mosaic-d"][idx % 4];

                  return (
                    <article
                      key={tripId ?? idx}
                      className={`inspire-card ${mosaicClass}`}
                      onClick={() => navigate(`/itinerary/recommend/${tripId}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/itinerary/recommend/${tripId}`)}
                    >
                      <div className="inspire-cover">
                        <img className="inspire-cover-img" src={thumb} alt="" />
                      </div>
                      <div className="inspire-gradient" />
                      <div className="inspire-user fixed">
                        <Avatar size={28} style={{ backgroundColor: color, color: "#fff" }}>
                          {initials(userName)}
                        </Avatar>
                        <span className="inspire-username">{userName}</span>
                      </div>
                      <div className="inspire-rating">
                        <Tooltip title={`${rate}/5`}>
                          <span className="inspire-chip rating"><StarFilled /> {rate}</span>
                        </Tooltip>
                      </div>
                      <div className="inspire-info bottom">
                        <h3 className="inspire-title">{title}</h3>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <SiteFooter />
    </>
  );
};

export default Landing;
