import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  RestOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import { GetTripById, GetConditionById, GetAllReviews } from "../../services/https";

import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";
import type { ReviewInterface } from "../../interfaces/review";
import { Button, Empty, Spin, Tabs, message, Tooltip } from "antd"; // 👈 เพิ่ม Tooltip ตรงนี้
import { usePlaceNamesHybrid } from "../../hooks/usePlaceNamesAuto";

import "./itinerary-print.css";
import TripItineraryPrintSheet from "../../component/itinerary-print/itinerary-print";

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
  const navigate = useNavigate();
  const activeTripId = Number(tripId);

  const [trip, setTrip] = useState<TripInterface | null>(null);
  const [condition, setCondition] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const checkReview = async () => {
      try {
        const reviews = (await GetAllReviews()) as ReviewInterface[];
        const found = reviews.some((r) => Number(r.TripID) === activeTripId);
        if (!found) {
          msg.warning("ทริปนี้ยังไม่มีรีวิว → กลับไปหน้า Trip Chat");
          navigate("/trip-chat", { replace: true });
        }
      } catch {
        msg.error("ตรวจสอบรีวิวล้มเหลว");
      }
    };
    if (Number.isFinite(activeTripId) && activeTripId > 0) void checkReview();
  }, [activeTripId, msg, navigate]);

  const refreshTrip = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        const tripRes = await GetTripById(id);
        setTrip(tripRes || null);
        const conId = Number(tripRes?.Con_id);
        if (conId) setCondition((await GetConditionById(conId)) || null);
        else setCondition(null);
      } catch {
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

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="itin-root">
      {contextHolder}
      <div className="itin-container">
        <aside className="itin-summary">
          <div
            className="itin-title-row"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
          >
            <p className="itin-page-title">
              {trip?.Name || "Trip"} {trip?.Days ? `(${trip.Days} วัน)` : ""}
            </p>
          </div>

          <div className="itin-tabs no-print">
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

          {!loading && trip && Object.entries(groupedByDay).map(([dayKey, activities]) => {
            const dayNum = Number(dayKey);
            return (
              <section key={dayKey} className="no-print">
                <div className="itin-day-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 className="itin-section-title" style={{ margin: 0 }}>{getDayHeaderText(dayNum)}</h2>
                </div>
                {activities.map((record, idx) => {
                  const key = `${dayNum}:${idx}`;
                  return (
                    <div className="itin-cardrow" key={record.ID ?? key}>
                      <div className="itin-cardrow-icon"><ItemIcon code={record.ToCode} /></div>
                      <div className="itin-cardrow-text">
                        <p
                          className="title-itin"
                          dangerouslySetInnerHTML={{
                            __html: (record.ActivityDescription || "-").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                          }}
                        />
                        <p className="sub">{displayName(record.ToCode)}</p>
                        <p className="sub">{record.StartTime} - {record.EndTime}</p>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}

          {trip && (
            <TripItineraryPrintSheet
              trip={trip}
              condition={condition}
              groupedByDay={groupedByDay}
              displayName={displayName}
              getDayHeaderText={getDayHeaderText}
            />
          )}
        </main>
      </div>
      <div className="fab-print no-print" aria-hidden={false}>
        <Tooltip title="พิมพ์เป็น PDF" placement="left">
          <Button
            type="primary"
            shape="circle"
            size="large"
            icon={<PrinterOutlined />}
            aria-label="พิมพ์ PDF"
            onClick={handlePrint}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default TripItineraryRecommend;
