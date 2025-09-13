// src/component/itinerary-print/itinerary-print.tsx
import React from "react";
import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";

type GroupedByDay = Record<number, ShortestpathInterface[]>;

interface Props {
  trip: TripInterface;
  condition: any;
  groupedByDay: GroupedByDay;
  displayName: (code?: string | null) => string;
  getDayHeaderText: (dayIndex: number) => string;
}

const TripItineraryPrintSheet: React.FC<Props> = ({
  trip,
  condition,
  groupedByDay,
  displayName,
  getDayHeaderText,
}) => {
  const formatNumber = (n: any) =>
    typeof n === "number" ? n.toLocaleString("th-TH") : n ?? "—";

  const dayEntries = React.useMemo(
    () =>
      Object.entries(groupedByDay)
        .map(([k, v]) => [Number(k), v] as [number, ShortestpathInterface[]])
        .sort((a, b) => a[0] - b[0]),
    [groupedByDay]
  );

  const hasAnyActivities = dayEntries.length > 0;

  // หน้าแรก 1 วัน, หน้าต่อ ๆ ไป 2 วัน/หน้า
  const pages = React.useMemo(() => {
    const result: Array<Array<[number, ShortestpathInterface[]]>> = [];
    if (!dayEntries.length) return result;
    result.push([dayEntries[0]]);
    for (let i = 1; i < dayEntries.length; i += 2) {
      result.push(dayEntries.slice(i, i + 2));
    }
    return result;
  }, [dayEntries]);

  const renderDay = (dayNum: number, activities: ShortestpathInterface[]) => (
    <section className="print-day" key={`day-${dayNum}`} aria-label={`Day ${dayNum}`}>
      {/* ห่อหัว+ตารางไว้ด้วยกันเพื่อกันแยกหน้า */}
      <div className="day-block">
        <div className="day-ribbon">
          <span className="ribbon-text">{getDayHeaderText(dayNum)}</span>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: "22%" }}>เวลา</th>
              <th style={{ width: "30%" }}>สถานที่</th>
              <th>กิจกรรม</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((record, idx) => {
              const html = (record.ActivityDescription || "-").replace(
                /\*\*(.*?)\*\*/g,
                "<strong>$1</strong>"
              );
              const to = (record.ToCode || "").toUpperCase();
              const dotClass = to.startsWith("A")
                ? "dot-hotel"
                : to.startsWith("R")
                ? "dot-food"
                : "dot-landmark";

              return (
                <tr key={`row-${dayNum}-${idx}`}>
                  <td className="time-cell">
                    {record.StartTime} – {record.EndTime}
                  </td>
                  <td className="place-cell">
                    <span className={`dot ${dotClass}`} />
                    {displayName(record.ToCode)}
                  </td>
                  <td>
                    <span
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="print-sheet">
      {/* Cover */}
      <header className="print-cover">
        <div className="cover-left">
          <h1 className="cover-title">{trip?.Name || "ทริปของฉัน"}</h1>
          <p className="cover-sub">
            แผนการเดินทาง {trip?.Days ? `${trip.Days} วัน` : "—"}
          </p>

          <div className="chip-row">
            <span className="chip">
              <span className="chip-label">สไตล์</span>
              <span className="chip-value">{condition?.Style ?? "—"}</span>
            </span>
            <span className="chip">
              <span className="chip-label">งบประมาณ</span>
              <span className="chip-value">
                {condition?.Price ? `${formatNumber(condition.Price)} บาท` : "—"}
              </span>
            </span>
            <span className="chip">
              <span className="chip-label">ปลายทาง</span>
              <span className="chip-value">{trip?.Name || "—"}</span>
            </span>
          </div>
        </div>

        <div className="cover-right">
          <div className="legend">
            <div className="legend-title">สัญลักษณ์</div>
            <ul>
              <li><span className="dot dot-landmark" /> สถานที่เที่ยว</li>
              <li><span className="dot dot-food" /> ร้านอาหาร</li>
              <li><span className="dot dot-hotel" /> ที่พัก</li>
            </ul>
          </div>
          <div className="note">
            <div className="note-title">หมายเหตุ</div>
            <div className="note-body">เวลาโดยประมาณ อาจปรับตามสภาพจราจร/สภาพอากาศ</div>
          </div>
        </div>
      </header>

      {/* Pages */}
      {hasAnyActivities ? (
        pages.map((daysInPage, pageIdx) => (
          <div className="print-page" key={`page-${pageIdx}`}>
            {daysInPage.map(([dayNum, acts]) => renderDay(dayNum, acts))}
          </div>
        ))
      ) : (
        <section className="print-day">
          <div className="empty-hint">ยังไม่มีรายการกิจกรรม</div>
        </section>
      )}
    </div>
  );
};

export default TripItineraryPrintSheet;
