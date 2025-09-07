import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  RestOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";
import { Button, Empty, Spin, message, Tooltip } from "antd";
import { usePlaceNamesHybrid } from "../../hooks/usePlaceNamesAuto";

import TripItineraryPrintSheet from "../../component/itinerary-print/itinerary-print";

// ===== LocalStorage keys from guest mode =====
const LOCAL_GUEST_TRIP_PLAN_TEXT = "guest_trip_plan_text";
const LOCAL_GUEST_ROUTE_DATA = "guest_route_data";
const LOCAL_GUEST_ACTIVITIES = "guest_activities";
const LOCAL_GUEST_META = "guest_meta";

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

// ===== Types of the guest data we read back =====
type GuestActivity = {
  day: number;
  startTime: string;
  endTime: string;
  description: string;
};

type RouteData = {
  start_name?: string;
  accommodation?: { id?: string };
  trip_plan_by_day?: Array<{ day: number; plan: Array<{ id: string }> }>;
  paths?: Array<{ from: string; to: string; distance_km?: number }>;
};

type GuestMeta = {
  keyword?: string;
  days?: number;
  placeId?: number;
  placeName?: string;
  time?: string;
  guestCondition?: {
    day: string | number;
    price: number;
    accommodation: string;
    landmark: string;
    style: string;
  };
};

// ===== Helper: reconstruct ShortestPaths from guest activities + route plan =====
function reconstructShortestPaths(
  activities: GuestActivity[],
  routeData: RouteData | null
): ShortestpathInterface[] {
  if (!routeData) return [];

  const accCode = routeData.accommodation?.id || "A1";
  const sps: ShortestpathInterface[] = [];
  const dayPlanIndices: Record<number, number> = {}; // track position in each day's plan
  let PathIndex = 1;

  for (const act of activities) {
    const dayPlan = routeData.trip_plan_by_day?.find((d) => d.day === act.day);
    const currentIndex = dayPlanIndices[act.day] ?? 0;

    let fromCode = "";
    let toCode = "";

    const isCheckIn = /เช็คอิน/.test(act.description);
    const isCheckout = /เช็คเอาท์/.test(act.description);
    const isRest = /พักผ่อน/.test(act.description);

    if (isCheckIn) {
      fromCode = accCode;
      toCode = accCode;
    } else if (isCheckout || isRest) {
      if (dayPlan && dayPlan.plan && dayPlan.plan.length > 0) {
        fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
      } else {
        fromCode = accCode;
      }
      toCode = accCode;
    } else {
      if (dayPlan && dayPlan.plan && dayPlan.plan.length > 0) {
        if (currentIndex === 0) {
          fromCode = accCode;
          toCode = dayPlan.plan[0].id;
        } else if (currentIndex > 0 && currentIndex < dayPlan.plan.length) {
          fromCode = dayPlan.plan[currentIndex - 1].id;
          toCode = dayPlan.plan[currentIndex].id;
        } else {
          fromCode = accCode;
          toCode = accCode;
        }
      } else {
        fromCode = accCode;
        toCode = accCode;
      }
    }

    const distance = routeData.paths?.find(
      (p) => (p.from === fromCode && p.to === toCode) || (p.from === toCode && p.to === fromCode)
    )?.distance_km;

    sps.push({
      // the following fields satisfy ShortestpathInterface minimal needs
      ID: undefined as any,
      TripID: undefined as any,
      Day: act.day,
      PathIndex: PathIndex++,
      FromCode: fromCode,
      ToCode: toCode,
      Type: "Activity",
      Distance: typeof distance === "number" ? distance : 0,
      ActivityDescription: act.description,
      StartTime: act.startTime,
      EndTime: act.endTime,
      CreatedAt: undefined as any,
      UpdatedAt: undefined as any,
      DeletedAt: undefined as any,
    });

    // advance pointer only for normal activities
    if (!isCheckIn && !isCheckout) {
      if (dayPlan && currentIndex + 1 < (dayPlan.plan?.length || 0)) {
        dayPlanIndices[act.day] = currentIndex + 1;
      }
    }
  }

  return sps;
}

const GuestTripPreview: React.FC = () => {
  const [msg, contextHolder] = message.useMessage();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);

  // ===== Read guest data from localStorage once =====
  const meta: GuestMeta = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_GUEST_META) || "{}");
    } catch {
      return {};
    }
  }, []);

  const tripPlanText: string = useMemo(
    () => localStorage.getItem(LOCAL_GUEST_TRIP_PLAN_TEXT) || "",
    []
  );

  const routeData: RouteData | null = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_GUEST_ROUTE_DATA) || "null");
    } catch {
      return null;
    }
  }, []);

  const activities: GuestActivity[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_GUEST_ACTIVITIES) || "[]");
    } catch {
      return [];
    }
  }, []);

  // ===== Build pseudo trip (TripInterface-like) & groupedByDay =====
  const pseudoTrip: TripInterface | null = useMemo(() => {
    if (!routeData || activities.length === 0) return null;
    const shortestPaths = reconstructShortestPaths(activities, routeData);

    // minimal TripInterface-like object
    return {
      ID: 0 as any,
      Name: meta?.placeName || meta?.keyword || "Trip",
      Types: "custom",
      Days: (typeof meta?.days === "number" && meta.days) || undefined,
      Con_id: undefined as any,
      Acc_id: undefined as any,
      ShortestPaths: shortestPaths,
      CreatedAt: undefined as any,
      UpdatedAt: undefined as any,
      DeletedAt: undefined as any,
    };
  }, [routeData, activities, meta]);

  const groupedByDay = useMemo(() => {
    return (
      pseudoTrip?.ShortestPaths?.reduce((acc, curr) => {
        const day = curr.Day ?? 0;
        if (!acc[day]) acc[day] = [];
        acc[day].push(curr);
        return acc;
      }, {} as Record<number, ShortestpathInterface[]>) ?? {}
    );
  }, [pseudoTrip]);

  // ===== collect codes to resolve names =====
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

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // simulate loading to keep UX consistent with original page
  useEffect(() => {
    // ถ้าไม่มีข้อมูล guest ใดๆ ให้แจ้งและพากลับหน้า chat
    if (!tripPlanText && (!routeData || activities.length === 0)) {
      msg.warning("ไม่พบข้อมูลพรีวิวในอุปกรณ์นี้ → กลับไปหน้า Trip Chat");
      navigate("/trip-chat", { replace: true });
      return;
    }
    setLoading(false);
  }, [activities.length, msg, navigate, routeData, tripPlanText]);

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
              {(pseudoTrip?.Name || "Trip")} {pseudoTrip?.Days ? `(${pseudoTrip.Days} วัน)` : ""}
            </p>
          </div>

          {/* ใช้ UI เดิม แสดงสรุปจาก guest meta */}
          <div className="itin-details">
            {[
              { icon: "calendar" as const, title: pseudoTrip?.Days ? `${pseudoTrip.Days} วัน` : "—", subtitle: "ระยะเวลา" },
              { icon: "pin" as const, title: pseudoTrip?.Name || "—", subtitle: "ปลายทาง" },
              { icon: "compass" as const, title: meta?.guestCondition?.style ?? "—", subtitle: "สไตล์" },
              { icon: "wallet" as const, title: meta?.guestCondition?.price ?? "—", subtitle: "งบประมาณ" },
            ].map((s, i) => (
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
          </div>
        </aside>

        <main className="itin-content">
          {loading && (
            <div className="itin-loading">
              <Spin />
            </div>
          )}

          {!loading && !pseudoTrip && (
            <div style={{ padding: 16 }}>
              <Empty description="ไม่พบข้อมูลพรีวิวสำหรับแสดงผล" />
            </div>
          )}

          {!loading &&
            pseudoTrip &&
            Object.entries(groupedByDay).map(([dayKey, rows]) => {
              const dayNum = Number(dayKey);
              return (
                <section key={dayKey} className="no-print">
                  <div
                    className="itin-day-header"
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  >
                    <h2 className="itin-section-title" style={{ margin: 0 }}>
                      {getDayHeaderText(dayNum)}
                    </h2>
                  </div>

                  {rows.map((record, idx) => {
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

          {/* ใช้แผ่นพิมพ์เดิมได้เลย ด้วยข้อมูล pseudoTrip */}
          {pseudoTrip && (
            <TripItineraryPrintSheet
              trip={pseudoTrip}
              condition={
                meta?.guestCondition
                  ? {
                      ...meta.guestCondition,
                      Price: meta.guestCondition.price,
                      Style: meta.guestCondition.style,
                    }
                  : null
              }
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

export default GuestTripPreview;
