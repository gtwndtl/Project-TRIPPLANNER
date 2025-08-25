// src/page/trip-itinerary/TripItineraryRecommend.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  RestOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";   // 👈 เพิ่ม useNavigate
import {
  GetTripById,
  GetConditionById,
  GetAllReviews,          // 👈 ดึงมาเช็ค
} from "../../services/https";

import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";
import type { ReviewInterface } from "../../interfaces/review"; // 👈 ใช้ type review
import { Empty, Spin, Tabs, message } from "antd";
import { usePlaceNamesHybrid } from "../../hooks/usePlaceNamesAuto";

type PlaceKind = "landmark" | "restaurant" | "accommodation";

const inferKind = (code?: string): PlaceKind => {
  const ch = code?.[0]?.toUpperCase();
  if (ch === "R") return "restaurant";
  if (ch === "A") return "accommodation";
  return "landmark";
};

const ItemIcon: React.FC<{ code?: string }> = ({ code }) => {
  const kind = inferKind(code);
  if (kind === "accommodation") return <HomeOutlined className="icon" />;
  if (kind === "restaurant") return <RestOutlined className="icon" />;
  return <EnvironmentOutlined className="icon" />;
};

const SummaryIcon: React.FC<{ name: "calendar" | "pin" | "compass" | "wallet" }> = ({ name }) => {
  if (name === "calendar") return <CalendarOutlined className="icon" />;
  if (name === "compass") return <EnvironmentOutlined className="icon" />;
  if (name === "wallet") return <CalendarOutlined className="icon" />;
  return <EnvironmentOutlined className="icon" />;
};

const TripItineraryRecommend: React.FC = () => {
  const [msg, contextHolder] = message.useMessage();
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();                          // 👈 ใช้สำหรับ redirect
  const activeTripId = Number(tripId);

  const [trip, setTrip] = useState<TripInterface | null>(null);
  const [condition, setCondition] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // ===== ตรวจสอบว่ามี review ของ tripId นี้ไหม =====
  useEffect(() => {
    const checkReview = async () => {
      try {
        const reviews = (await GetAllReviews()) as ReviewInterface[];
        const found = reviews.some((r) => Number(r.TripID) === activeTripId);

        if (!found) {
          msg.warning("ทริปนี้ยังไม่มีรีวิว → กลับไปหน้า Trip Chat");
          navigate("/trip-chat", { replace: true });
        }
      } catch (err) {
        console.error("Error checking reviews:", err);
        msg.error("ตรวจสอบรีวิวล้มเหลว");
      }
    };

    if (Number.isFinite(activeTripId) && activeTripId > 0) {
      void checkReview();
    }
  }, [activeTripId, msg, navigate]);

  // ===== Fetch trip + condition =====
  const refreshTrip = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        const tripRes = await GetTripById(id);
        setTrip(tripRes || null);

        const conId = Number(tripRes?.Con_id);
        if (conId) {
          const conRes = await GetConditionById(conId);
          setCondition(conRes || null);
        } else {
          setCondition(null);
        }
      } catch (err) {
        console.error("Error refreshing trip:", err);
        msg.error("โหลดข้อมูลทริปล้มเหลว");
      } finally {
        setLoading(false);
      }
    },
    [msg]
  );

  useEffect(() => {
    if (!Number.isFinite(activeTripId) || activeTripId <= 0) {
      msg.warning("ลิงก์ไม่ถูกต้อง: ไม่พบ tripId");
      return;
    }
    void refreshTrip(activeTripId);
  }, [activeTripId, refreshTrip, msg]);

  // ===== Group by day =====
  const groupedByDay = useMemo(() => {
    return (
      trip?.ShortestPaths?.reduce((acc, curr) => {
        const day = curr.Day ?? 0;
        if (!acc[day]) acc[day] = [];
        acc[day].push(curr);
        return acc;
      }, {} as Record<number, ShortestpathInterface[]>) ?? {}
    );
  }, [trip]);

  const codes = useMemo(
    () =>
      (Object.values(groupedByDay).flatMap((rows) =>
        rows.flatMap((sp) => [sp.FromCode, sp.ToCode])
      ) as (string | undefined | null)[])
        .filter(Boolean) as string[],
    [groupedByDay]
  );

  const placeNameMap = usePlaceNamesHybrid(codes);
  const displayName = (code?: string | null) =>
    (code && placeNameMap[code.toUpperCase()]) || code || "-";

  const getDayHeaderText = (dayIndex: number): string => `วันที่ ${dayIndex}`;

  const tabItems = useMemo(() => {
    const summary = [
      { icon: "calendar" as const, title: trip?.Days ? `${trip.Days} วัน` : "—", subtitle: "Duration" },
      { icon: "pin" as const, title: trip?.Name || "—", subtitle: "Destination" },
      { icon: "compass" as const, title: "Style", subtitle: condition?.Style ?? "—" },
      { icon: "wallet" as const, title: "Budget", subtitle: condition?.Price ? `${condition.Price}` : "—" },
    ];

    return [
      {
        key: "details",
        label: "Details",
        children: (
          <>
            {summary.map((s, i) => (
              <div className="itin-cardrow" key={i}>
                <div className="itin-cardrow-icon">
                  <SummaryIcon name={s.icon} />
                </div>
                <div className="itin-cardrow-text">
                  <p className="title">{s.title}</p>
                  <p className="sub">{s.subtitle}</p>
                </div>
              </div>
            ))}
          </>
        ),
      },
    ];
  }, [trip, condition]);

  return (
    <div className="itin-root">
      {contextHolder}
      <div className="itin-container">
        <aside className="itin-summary">
          <div className="itin-title-row">
            <p className="itin-page-title">
              {trip?.Name || "Trip"} {trip?.Days ? `(${trip.Days} วัน)` : ""}
            </p>
          </div>
          <div className="itin-tabs">
            <Tabs activeKey={"details"} items={tabItems} />
          </div>
        </aside>

        <main className="itin-content">
          {loading && <div className="itin-loading"><Spin /></div>}

          {!loading && !trip && (
            <div style={{ padding: 16 }}>
              <Empty description="ไม่พบข้อมูลทริปจาก tripId ในลิงก์" />
            </div>
          )}

          {!loading &&
            trip &&
            Object.entries(groupedByDay).map(([dayKey, activities]) => {
              const dayNum = Number(dayKey);

              return (
                <section key={dayKey}>
                  <div
                    className="itin-day-header"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <h2 className="itin-section-title" style={{ margin: 0 }}>
                      {getDayHeaderText(dayNum)}
                    </h2>
                  </div>

                  {activities.map((record, idx) => {
                    const key = `${dayNum}:${idx}`;
                    return (
                      <div className="itin-cardrow" key={record.ID ?? key}>
                        <div className="itin-cardrow-icon">
                          <ItemIcon code={record.ToCode} />
                        </div>

                        <div className="itin-cardrow-text">
                          <p
                            className="title-itin"
                            dangerouslySetInnerHTML={{
                              __html: (record.ActivityDescription || "-").replace(
                                /\*\*(.*?)\*\*/g,
                                "<strong>$1</strong>"
                              ),
                            }}
                          />
                          <p className="sub">{displayName(record.ToCode)}</p>
                          <p className="sub">
                            {record.StartTime} - {record.EndTime}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
        </main>
      </div>
    </div>
  );
};

export default TripItineraryRecommend;
