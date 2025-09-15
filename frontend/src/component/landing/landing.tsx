import "./landing.css";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Carousel, Spin, Empty, Tooltip, Avatar } from "antd";
import { CompassOutlined, BranchesOutlined, ScheduleOutlined, StarFilled, UserOutlined } from "@ant-design/icons";
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
   Avatar Color (Best Practice)
   - สีแตกต่างกัน “ต่อการ์ด” แม้ user เดิม
   - คงที่ภายในหนึ่ง session (ไม่กระพริบ)
   - เปลี่ยนได้ข้าม session (สุ่มใหม่)
   ========================================================= */

// แพเลตสีโทน Ant Design / Modern
const AVATAR_COLORS = [
  "#1677ff", "#13c2c2", "#52c41a", "#fa8c16",
  "#f5222d", "#722ed1", "#eb2f96", "#2f54eb",
  "#a0d911", "#faad14", "#1890ff", "#9254de",
];

// FNV-1a 32-bit hash (เสถียร เร็ว สั้น)
const fnv1a = (str: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619 (ใช้บิทชิฟต์เลียนแบบเพื่อความเร็ว)
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
};

// salt ต่อ session — ทำให้ seed ต่างกันเมื่อเปิดใช้งานรอบใหม่
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
    // กรณี SSR/ไม่ใช้ sessionStorage
    return "nosession";
  }
})();

const pickColorFromSeed = (seed: string) => {
  const h = fnv1a(`${seed}:${SESSION_SALT}`);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

// seed ต่อ “การ์ด” (instance) — คงที่ต่อใบ
const seedForCard = (args: { tripId?: any; review?: any; index: number }) => {
  const reviewKey = args.review?.ID ?? args.review?.Day ?? "r";
  return `t-${String(args.tripId ?? "t")}|r-${String(reviewKey)}|i-${args.index}`;
};

// ชื่อย่อ
const initials = (name?: string) => {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
};

const Landing: React.FC = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(false);
  const [topTrips, setTopTrips] = useState<EnrichedReview[]>([]);

  // พรีโหลดรูป Hero หนึ่งครั้งต่อเซสชัน
  useEffect(() => {
    if (sessionStorage.getItem("HERO_PRELOADED_V1") !== "1") {
      preloadImages(HERO_IMAGES);
      sessionStorage.setItem("HERO_PRELOADED_V1", "1");
    }
  }, []);

  // preconnect ไป unsplash เพื่อให้ handshake เร็วขึ้น
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

      // พรีโหลดรูปท็อปทริป (สำหรับรอบถัดไป)
      preloadImages(top.map((t) => t.thumb));
    } catch (err) {
      console.error("loadTopTrips error:", err);
      setTopTrips([]);
      writeTopTripsCache([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // เสิร์ฟจากแคชก่อน แล้วค่อย revalidate แบบเงียบ ๆ
  useEffect(() => {
    const cached = readTopTripsCache();
    if (cached) {
      setTopTrips(cached);
      setLoading(false);
      // revalidate เบื้องหลังถ้าอยู่นอก TTL
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

  return (
    <>
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
                {HERO_IMAGES.map((img, idx) => (
                  <div key={idx}>
                    <div
                      className="landing-hero-slide"
                      style={{
                        backgroundImage: `linear-gradient(rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.40) 100%), url(${img})`,
                      }}
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

          {/* Journey Inspirations */}
          <section className="landing-inspire">
            <div className="landing-section-header">
              <h1 className="landing-section-title">Journey Inspirations from Travelers</h1>
              <p className="landing-section-description">
                สำรวจแผนการเดินทางสุดพิเศษ จากนักเดินทางของเราที่ได้แบ่งปันประสบการณ์และรีวิว
              </p>
            </div>

            {loading && <div className="landing-recs-state"><Spin /></div>}

            {!loading && topTrips.length === 0 && (
              <div className="landing-recs-state"><Empty description="ยังไม่มีทริปแนะนำ" /></div>
            )}

            {!loading && hasRecs && (
              <div className="inspire-flex alt-stagger">
                {topTrips.map(({ review, trip, user, thumb }, idx) => {
                  const tripId = (trip as any)?.ID;
                  const title = (trip as any)?.Name?.toString?.() || "-";
                  const rate = Number(review.Rate) || 0;

                  const userName =
                    user && (user.Firstname || user.Lastname)
                      ? `${user.Firstname ?? ""} ${user.Lastname ?? ""}`.trim()
                      : `User ${(review as any)?.User_id}`;

                  // ขนาด “สุ่ม” แบบ deterministic (ตามลำดับ)
                  const layoutIdx = idx % 4;
                  const sizeClass =
                    layoutIdx === 2 ? "is-tall" :
                    layoutIdx === 3 ? "is-short" : "is-regular";

                  // สี Avatar ต่อการ์ด (คงที่ใน session)
                  const seed = seedForCard({ tripId, review, index: idx });
                  const color = pickColorFromSeed(seed);

                  return (
                    <article
                      key={tripId ?? idx}
                      className={`inspire-card ${sizeClass}`}
                      onClick={() => navigate(`/itinerary/recommend/${tripId}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/itinerary/recommend/${tripId}`)}
                    >
                      <div className="inspire-cover">
                        <img
                          className="inspire-cover-img"
                          src={thumb}
                          alt=""
                          loading={idx === 0 ? "eager" : "lazy"}
                          decoding="async"
                          sizes="(min-width:1024px) 600px, 100vw"
                          fetchPriority={idx === 0 ? "high" : "low"}
                        />
                      </div>

                      <div className="inspire-info">
                        <div className="inspire-user">
                          <Avatar
                            size={28}
                            style={{ backgroundColor: color, color: "#fff" }}
                            icon={!userName ? <UserOutlined /> : undefined}
                          >
                            {userName ? initials(userName) : null}
                          </Avatar>
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
        </div>
      </div>

      <SiteFooter />
    </>
  );
};

export default Landing;
