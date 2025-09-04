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

  return (
    <div className="print-sheet">
      {/* หัวข้อสำหรับหน้าพิมพ์ */}
      <div className="print-header">
        <div className="print-title">
          {trip?.Name || "—"} {trip?.Days ? `(${trip.Days} วัน)` : ""}
        </div>
        {trip?.Days ? (
          <div className="print-meta">แผนการเดินทางทั้งหมด {trip.Days} วัน</div>
        ) : null}
      </div>

      {/* ส่วนสรุป */}
      <div className="print-card">
        <div className="print-summary-grid">
          <div className="print-summary-item">
            <div className="label">ระยะเวลา</div>
            <div className="value">{trip?.Days ? `${trip.Days} วัน` : "—"}</div>
          </div>
          <div className="print-summary-item">
            <div className="label">สถานที่หลัก</div>
            <div className="value">{trip?.Name || "—"}</div>
          </div>
          <div className="print-summary-item">
            <div className="label">สไตล์การเที่ยว</div>
            <div className="value">{condition?.Style ?? "—"}</div>
          </div>
          <div className="print-summary-item">
            <div className="label">งบประมาณ</div>
            <div className="value">
              {condition?.Price ? `${formatNumber(condition.Price)} บาท` : "—"}
            </div>
          </div>
        </div>

        {/* ตารางกิจกรรมรายวัน */}
        {Object.entries(groupedByDay).map(([dayKey, activities]) => {
          const dayNum = Number(dayKey);
          return (
            <div className="print-day" key={`print-${dayKey}`}>
              <h3 className="print-day-title">{getDayHeaderText(dayNum)}</h3>
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
                    return (
                      <tr key={`print-row-${dayKey}-${idx}`}>
                        <td className="time-cell">
                          {record.StartTime} – {record.EndTime}
                        </td>
                        <td className="place-cell">
                          {displayName(record.ToCode)}
                        </td>
                        <td>
                          <span dangerouslySetInnerHTML={{ __html: html }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="print-footer">
        สร้างด้วย Trip Planner • {new Date().getFullYear()}
      </div>
    </div>
  );
};

export default TripItineraryPrintSheet;
