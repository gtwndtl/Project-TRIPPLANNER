// src/page/trip-itinerary/TripItinerary.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarOutlined,
  TeamOutlined,
  EnvironmentOutlined,
  HomeOutlined,
  RestOutlined,
  CompassOutlined,
  WalletOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  StarFilled,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import "./trip-itinerary.css";

import {
  GetTripById,
  GetLandmarksAndRestuarantforEdit,
  GetAccommodationSuggestionsForEdit,
  UpdateShortestPath,
  BulkUpdateAccommodation,
  GetUserById,
  GetConditionById,
  GetAllConditions,
  GetAllTrips,
  DeleteTrip,
  CreateReview,
} from "../../services/https";
import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";
import type { DefaultOptionType } from "antd/es/select";
import Select from "antd/es/select";
import { Button, Empty, message, Modal, Spin, Tabs } from "antd";
import { usePlaceNamesHybrid } from "../../hooks/usePlaceNamesAuto";
import type { ReviewInterface } from "../../interfaces/Review";
import RateReviewModal from "../../component/review/review";

type PlaceKind = "landmark" | "restaurant" | "accommodation";
const SP_TABLE_NAME = "shortestpaths"; // ✅ ตาม GORM struct Shortestpath (ไม่มี underscore)

// ===== Kind helpers =====
const inferKind = (code?: string): PlaceKind => {
  const ch = code?.[0]?.toUpperCase();
  if (ch === "R") return "restaurant";
  if (ch === "A") return "accommodation";
  return "landmark";
};

// ใช้บริบทเดา ถ้า current ว่าง (นำ logic จาก TripSummaryPage)
const inferKindSmart = (
  currentCode: string,
  prevCode: string,
  nextCode: string,
  record: ShortestpathInterface
): PlaceKind => {
  const byCurrent = inferKind(currentCode);
  if (currentCode) return byCurrent;

  const pick = (code?: string) => (code ? code[0]?.toUpperCase() : "");
  const p = pick(prevCode);
  const n = pick(nextCode);
  const f = pick(record.FromCode);
  const t = pick(record.ToCode);

  if ([p, n, f, t].includes("A")) return "accommodation";
  if ([p, n, f, t].includes("R")) return "restaurant";
  return "landmark";
};

const ItemIcon: React.FC<{ code?: string }> = ({ code }) => {
  const kind = inferKind(code);
  if (kind === "accommodation") return <HomeOutlined className="icon" />;
  if (kind === "restaurant") return <RestOutlined className="icon" />;
  return <EnvironmentOutlined className="icon" />;
};

const SummaryIcon: React.FC<{
  name: "calendar" | "users" | "pin" | "compass" | "wallet";
}> = ({ name }) => {
  if (name === "calendar") return <CalendarOutlined className="icon" />;
  if (name === "users") return <TeamOutlined className="icon" />;
  if (name === "compass") return <CompassOutlined className="icon" />;
  if (name === "wallet") return <WalletOutlined className="icon" />;
  return <EnvironmentOutlined className="icon" />;
};

const TripItinerary: React.FC = () => {
  const navigate = useNavigate();
  const [msg, contextHolder] = message.useMessage();

  // ===== LocalStorage state sync =====
  const [activeTripId, setActiveTripId] = useState<number | null>(() => {
    const id = localStorage.getItem("TripID");
    return id ? Number(id) : null;
  });
  const [isLogin, setIsLogin] = useState<boolean>(
    () => localStorage.getItem("isLogin") === "true"
  );

  const [tabKey, setTabKey] = useState<string>(() =>
    localStorage.getItem("isLogin") === "true" ? "overview" : "itinerary"
  );
  useEffect(() => {
    setTabKey(isLogin ? "overview" : "itinerary");
  }, [isLogin]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "TripID") {
        const id = localStorage.getItem("TripID");
        setActiveTripId(id ? Number(id) : null);
      }
      if (e.key === "isLogin") {
        setIsLogin(localStorage.getItem("isLogin") === "true");
      }
    };
    const onTripIdChanged = () => {
      const id = localStorage.getItem("TripID");
      setActiveTripId(id ? Number(id) : null);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("TripIDChanged", onTripIdChanged as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("TripIDChanged", onTripIdChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isLogin && !activeTripId) {
      navigate("/chat-trip", { replace: true });
    }
  }, [isLogin, activeTripId, navigate]);

  // ===== Data states =====
  const [trip, setTrip] = useState<TripInterface | null>(null);
  const [trips, setTrips] = useState<TripInterface[]>([]);
  const [userIdNum, setUserIdNum] = useState<number>(0);
  const [user, setUser] = useState<any>(null);
  const [userCondition, setUserCondition] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // ===== Per-day edit state =====
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editedData, setEditedData] = useState<Record<number, ShortestpathInterface[]>>({});

  // ===== Row options states =====
  const [rowOptions, setRowOptions] = useState<Record<string, DefaultOptionType[]>>({});
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [rowLoadedOnce, setRowLoadedOnce] = useState<Record<string, boolean>>({});

  // ===== User id =====
  useEffect(() => {
    const userIdStr = localStorage.getItem("user_id");
    const num = userIdStr ? parseInt(userIdStr, 10) : 0;
    setUserIdNum(num);
  }, []);

  const fetchTripsForUser = useCallback(async () => {
    if (!userIdNum || !isLogin) return;
    try {
      const allConditions = await GetAllConditions();
      const userConditions = allConditions.filter((c: any) => c.User_id === userIdNum);
      const conditionIds = userConditions.map((c: any) => c.ID);
      const allTrips = await GetAllTrips();
      const userTrips = allTrips.filter((t: any) => conditionIds.includes(t.Con_id));
      setTrips(userTrips);
    } catch (err) {
      console.error("Error fetching user trips:", err);
    }
  }, [userIdNum, isLogin]);

  useEffect(() => {
    fetchTripsForUser();
  }, [fetchTripsForUser]);

  const refreshAll = useCallback(
    async (tripId: number) => {
      setLoading(true);
      try {
        const [tripRes, userRes, condRes] = await Promise.all([
          GetTripById(tripId),
          (async () => {
            const rawId = localStorage.getItem("id");
            const id = rawId ? Number(rawId) : 0;
            return id ? GetUserById(id) : null;
          })(),
          GetConditionById(tripId),
        ]);
        setTrip(tripRes || null);
        if (userRes) setUser(userRes);
        setUserCondition(condRes || null);
      } catch (err) {
        console.error("Error refreshing data:", err);
        msg.error("โหลดข้อมูลทริปล้มเหลว");
      } finally {
        setLoading(false);
      }
    },
    [msg]
  );

  useEffect(() => {
    if (activeTripId) {
      refreshAll(activeTripId);
    }
  }, [activeTripId, refreshAll]);

  const handleViewTrip = useCallback(
    (tripId: number) => {
      setActiveTripId(tripId);
      localStorage.setItem("TripID", String(tripId));
      window.dispatchEvent(new Event("TripIDChanged"));
      refreshAll(tripId);
    },
    [refreshAll]
  );

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

  // ===== Edit toggle per day =====
  const startEditDay = (day: number) => {
    const base = groupedByDay[day] ?? [];
    setEditedData((prev) => ({ ...prev, [day]: JSON.parse(JSON.stringify(base)) }));
    setEditingDay(day);
  };
  const endEditDay = () => {
    setEditingDay(null);
    setEditedData({});
  };

  // ===== Helpers (Save) =====
  const getChangedRows = (
    original: ShortestpathInterface[],
    edited: ShortestpathInterface[]
  ) => {
    const origById = new Map<number, ShortestpathInterface>();
    original.forEach((o) => {
      if (o.ID != null) origById.set(o.ID as number, o);
    });
    return edited.filter((e) => {
      const o = e.ID != null ? origById.get(e.ID as number) : undefined;
      if (!o) return false;
      return (o.ToCode || "") !== (e.ToCode || "");
    });
  };

  const getNewAccommodationCode = (changed: ShortestpathInterface[]) => {
    const aCodes = Array.from(
      new Set(
        changed
          .map((r) => r.ToCode?.toUpperCase() || "")
          .filter((c) => c.startsWith("A"))
      )
    );
    if (aCodes.length === 0) return null;
    if (aCodes.length > 1) {
      msg.warning(`พบการแก้ที่พักหลายรหัส (${aCodes.join(", ")}) จะใช้ ${aCodes[0]} ทั้งทริป`);
    }
    return aCodes[0];
  };

  // ===== Edit / Save =====
  const handleLocationChange = (day: number, index: number, value: string) => {
    const updated = [...(editedData[day] || [])];
    updated[index] = { ...updated[index], ToCode: value };
    setEditedData((prev) => ({ ...prev, [day]: updated }));
  };

  const handleSaveDay = async (day: number) => {
    const TripIDLS = Number(localStorage.getItem("TripID") || 0);
    if (!TripIDLS) { msg.error("ไม่พบ TripID"); return; }

    const edited = editedData[day];
    if (!edited) { endEditDay(); return; }

    const original = (trip?.ShortestPaths ?? []).filter((sp) => sp.Day === day);
    const changed = getChangedRows(original, edited);

    if (changed.length === 0) {
      msg.info("ไม่มีการเปลี่ยนแปลง");
      endEditDay();
      return;
    }

    try {
      const newAcc = getNewAccommodationCode(changed);
      if (newAcc) {
        await BulkUpdateAccommodation({ trip_id: TripIDLS, acc_code: newAcc, scope: "both" });
        setTrip((prev) => {
          if (!prev) return prev;
          const updated = { ...prev } as TripInterface;
          updated.ShortestPaths = (prev.ShortestPaths ?? []).map((sp) => {
            const u = { ...sp } as ShortestpathInterface;
            if ((u.FromCode || "").toUpperCase().startsWith("A")) u.FromCode = newAcc;
            if ((u.ToCode || "").toUpperCase().startsWith("A")) u.ToCode = newAcc;
            return u;
          });
          return updated;
        });
      }

      const nonAccChanged = changed.filter((r) => !(r.ToCode || "").toUpperCase().startsWith("A"));
      if (nonAccChanged.length > 0) {
        await Promise.all(
          nonAccChanged.map((row) => {
            const payload: ShortestpathInterface = {
              ...row,
              TripID: row.TripID,
              Day: row.Day,
              PathIndex: row.PathIndex,
              FromCode: row.FromCode,
              ToCode: row.ToCode,
              Type: row.Type,
              Distance: row.Distance,
              ActivityDescription: row.ActivityDescription,
              StartTime: row.StartTime,
              EndTime: row.EndTime,
            } as any;
            return UpdateShortestPath(Number(row.ID), payload);
          })
        );
      }

      setTrip((prev) => {
        if (!prev) return prev;
        const updated = { ...prev } as TripInterface;
        updated.ShortestPaths = (prev.ShortestPaths ?? []).map((sp) =>
          sp.Day === day ? (edited.find((e) => Number(e.ID) === Number(sp.ID)) || sp) : sp
        );
        return updated;
      });

      msg.success(
        getNewAccommodationCode(changed)
          ? "บันทึกสำเร็จ (อัปเดตที่พักทั้งทริป และแก้รายการอื่นแล้ว)"
          : `บันทึกสำเร็จ ${changed.length} รายการ`
      );

      await refreshAll(TripIDLS);
    } catch (e: any) {
      msg.error(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      endEditDay();
    }
  };

  // ===== Suggestions =====
  const getPrevNext = (day: number, index: number, record: ShortestpathInterface) => {
    const arr = editedData[day] ?? groupedByDay[day] ?? [];
    const prevRow = index > 0 ? arr[index - 1] : undefined;
    const nextRow = index < arr.length - 1 ? arr[index + 1] : undefined;

    let prevCode = prevRow?.ToCode || prevRow?.FromCode || "";
    let nextCode = nextRow?.ToCode || nextRow?.FromCode || "";

    if (!prevCode) prevCode = record.FromCode || record.ToCode || "";
    if (!nextCode) nextCode = record.ToCode || record.FromCode || "";

    return { prevCode, nextCode };
  };

  const ensureRowOptions = async (
    day: number,
    index: number,
    record: ShortestpathInterface
  ) => {
    const key = `${day}:${index}`;

    const { prevCode, nextCode } = getPrevNext(day, index, record);
    const current = editedData[day]?.[index]?.ToCode || record.ToCode || "";
    const kind = inferKindSmart(current, prevCode, nextCode, record);

    try {
      setRowLoading((s) => ({ ...s, [key]: true }));

      if (kind === "accommodation") {
        const options = await GetAccommodationSuggestionsForEdit({
          trip_id: Number(activeTripId),
          day,
          strategy: "sum",
          radius_m: 3000,
          limit: 12,
          exclude: current || undefined,
          sp_table: SP_TABLE_NAME,
        });
        setRowOptions((s) => ({ ...s, [key]: options }));
        setRowLoadedOnce((s) => ({ ...s, [key]: true }));
        return;
      }

      if (!prevCode || !nextCode) {
        setRowLoadedOnce((s) => ({ ...s, [key]: true }));
        setRowOptions((s) => ({ ...s, [key]: [] }));
        return;
      }

      const options = await GetLandmarksAndRestuarantforEdit({
        type: kind === "restaurant" ? "restaurant" : "landmark",
        prev: prevCode,
        next: nextCode,
        radius_m: 3000,
        limit: 12,
        exclude: current || undefined,
      });

      setRowOptions((s) => ({ ...s, [key]: options }));
      setRowLoadedOnce((s) => ({ ...s, [key]: true }));
    } catch (e: any) {
      msg.error(e?.message || "โหลดรายการแนะนำไม่สำเร็จ");
      setRowLoadedOnce((s) => ({ ...s, [key]: true }));
      setRowOptions((s) => ({ ...s, [key]: [] }));
    } finally {
      setRowLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const renderNotFound = (key: string) => {
    if (rowLoading[key]) return <Spin size="small" />;
    if (rowLoadedOnce[key]) {
      return (
        <Empty description="ไม่มีตัวเลือกในรัศมี" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      );
    }
    return null;
  };

  // ===== Summary helpers =====
  const TH_MONTH_SHORT_SPOKEN = [
    "มกรา", "กุมภา", "มีนา", "เมษา", "พฤษภา", "มิถุนา",
    "กรกฎา", "สิงหา", "กันยา", "ตุลา", "พฤศจิกา", "ธันวา",
  ];
  const formatThaiSpoken = (d: Date) => `${d.getDate()} ${TH_MONTH_SHORT_SPOKEN[d.getMonth()]}`;
  const getTripDateRangeText = (days?: number, startDate?: Date) => {
    if (!days || days <= 0) return "—";
    const start = new Date(startDate ?? new Date());
    const end = new Date(start);
    end.setDate(start.getDate() + (days - 1));
    return `${formatThaiSpoken(start)}–${formatThaiSpoken(end)}`;
  };
  const getDayHeaderText = (dayIndex: number): string => {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (dayIndex - 1));
    return `วันที่ ${dayIndex} - ${targetDate.toLocaleDateString("th-TH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`;
  };

  const summary = useMemo(
    () => [
      { icon: "calendar" as const, title: getTripDateRangeText(trip?.Days), subtitle: `${trip?.Days ?? "—"} วัน` },
      { icon: "compass" as const, title: "Style", subtitle: userCondition?.Style ?? "—" },
      { icon: "wallet" as const, title: "Budget", subtitle: userCondition?.Price ? `${userCondition.Price}` : "—" },
      { icon: "users" as const, title: user ? `${user.Firstname} ${user.Lastname}` : "—", subtitle: "1 คน" },
      { icon: "pin" as const, title: "Destination", subtitle: trip?.Name || "—" },
    ],
    [trip, user, userCondition]
  );

  // ===== Modal confirm for delete =====
  const confirmDeleteTrip = (t: TripInterface) => {
    modal.confirm({
      title: "ลบทริปนี้?",
      content: `คุณต้องการลบ "${t.Name}" หรือไม่?`,
      okText: "ลบ",
      cancelText: "ยกเลิก",
      okButtonProps: { danger: true },
      centered: true,                           // 👈 จัดกึ่งกลางแนวตั้ง
      getContainer: () => document.body,        // 👈 ยึดกับ body ให้กึ่งกลางหน้าจอแน่ ๆ
      // zIndex: 2000,                          // (ตัวเลือก) ถ้าถูก UI อื่นบัง
      async onOk() {
        const loadingHide = message.loading("กำลังลบทริป...", 0);
        try {
          const nextCandidate = trips.find((x) => Number(x.ID) !== Number(t.ID));
          await DeleteTrip(Number(t.ID));
          loadingHide();
          msg.success("ลบทริปสำเร็จ");
          await fetchTripsForUser();
          if (Number(t.ID) === Number(activeTripId)) {
            if (nextCandidate) handleViewTrip(Number(nextCandidate.ID));
            else {
              localStorage.removeItem("TripID");
              window.dispatchEvent(new Event("TripIDChanged"));
              navigate("/trip-chat", { replace: true });
            }
          }
        } catch (err: any) {
          loadingHide();
          msg.error(err?.message || "ลบทริปล้มเหลว");
        }
      },
    });
  };

  // ===== Rate & Review =====
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const openRateModal = () => setReviewOpen(true);
  const closeRateModal = () => setReviewOpen(false);

  // YYYY-MM-DD แบบ local time
  const formatDateYYYYMMDD = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const handleSubmitReview = async ({ rating, review }: { rating: number; review: string }) => {
    if (!activeTripId) return;

    const userId = Number(localStorage.getItem("user_id") || 0);
    const payload: ReviewInterface = {
      Day: formatDateYYYYMMDD(new Date()),
      Rate: rating,
      TripID: Number(activeTripId),
      Comment: review?.trim() || undefined,
      User_id: userId || undefined,
    };

    try {
      setReviewSubmitting(true);
      await CreateReview(payload);
      message.success("ขอบคุณสำหรับการให้คะแนน!");
      closeRateModal();
    } catch (e: any) {
      message.error(e?.message || "ส่งรีวิวไม่สำเร็จ");
    } finally {
      setReviewSubmitting(false);
    }
  };

  // ===== Tabs =====
  const tabItems = useMemo(() => {
    const items: any[] = [];
    if (isLogin) {
      items.push({
        key: "overview",
        label: "Overview",
        children: (
          <>
            {trips.length > 0 ? (
              trips.map((t, idx) => {
                const isActive = Number(t.ID) === Number(activeTripId);
                return (
                  <div key={t.ID ?? idx}>
                    <div className={`itin-cardrow ${isActive ? "is-active" : ""}`}>
                      <div className="itin-cardrow-text">
                        <p
                          className="title"
                          style={{ cursor: "pointer" }}
                          onClick={() => handleViewTrip(Number(t.ID))}
                        >
                          {idx + 1} - {t.Name}
                        </p>
                      </div>
                      <div className="itin-cardrow-right">
                        <button
                          type="button"
                          className="btn-icon rate"
                          aria-label="Rate trip"
                          onClick={openRateModal}
                        >
                          <StarFilled />
                        </button>

                        <button
                          type="button"
                          className="btn-icon danger"
                          aria-label="Delete trip"
                          onClick={() => confirmDeleteTrip(t)}
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p>No trips found.</p>
            )}
          </>
        ),
      });
    }
    items.push({
      key: "details",
      label: "Details",
      children: (
        <>
          {summary.map((s, i) => (
            <div className="itin-cardrow" key={i}>
              <div className="itin-cardrow-icon"><SummaryIcon name={s.icon} /></div>
              <div className="itin-cardrow-text">
                <p className="title">{s.title}</p>
                <p className="sub">{s.subtitle}</p>
              </div>
            </div>
          ))}
        </>
      ),
    });
    return items;
  }, [isLogin, trips, summary, handleViewTrip, activeTripId, fetchTripsForUser, navigate]);

  const onTabsChange = (key: string) => {
    if (key === "overview" && editingDay !== null) {
      endEditDay();
      msg.info("ปิดโหมดแก้ไขของวันปัจจุบัน เนื่องจากสลับไป Overview");
    }
    setTabKey(key);
  };

  const codes = useMemo(() => (
    Object.values(groupedByDay).flatMap(rows =>
      rows.flatMap(sp => [sp.FromCode, sp.ToCode])
    ).filter(Boolean) as string[]
  ), [groupedByDay]);

  const placeNameMap = usePlaceNamesHybrid(codes);
  const displayName = (code?: string | null) =>
    (code && placeNameMap[code.toUpperCase()]) || code || "-";

  const [modal, modalContextHolder] = Modal.useModal();

  return (
    <div className="itin-root">
      {contextHolder}
      {modalContextHolder}
      <div className="itin-container">
        <aside className="itin-summary">
          <div className="itin-title-row"><p className="itin-page-title">{trip?.Name || "Trip"} ( {trip?.Days} วัน )</p></div>
          <div className="itin-tabs"><Tabs activeKey={tabKey} onChange={onTabsChange} items={tabItems} /></div>
        </aside>

        <main className="itin-content">
          {loading && (
            <div className="itin-loading"><Spin /></div>
          )}

          {Object.entries(groupedByDay).map(([dayKey, activities]) => {
            const dayNum = Number(dayKey);
            const isEditingThisDay = editingDay === dayNum;
            const rows = isEditingThisDay ? (editedData[dayNum] ?? activities) : activities;

            return (
              <section key={dayKey}>
                <div className="itin-day-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 className="itin-section-title" style={{ margin: 0 }}>{getDayHeaderText(dayNum)}</h2>
                  <div className="button-edit-group">
                    {isEditingThisDay ? (
                      <>
                        <Button className="btn-secondary" icon={<CloseOutlined />} onClick={endEditDay}>
                          ยกเลิก
                        </Button>
                        <Button className="btn-secondary" type="primary" icon={<SaveOutlined />} onClick={() => handleSaveDay(dayNum)} style={{ marginLeft: 8 }}>
                          บันทึก
                        </Button>
                      </>
                    ) : (
                      <Button className="btn-secondary" icon={<EditOutlined />} onClick={() => startEditDay(dayNum)}>
                        แก้ไข
                      </Button>
                    )}
                  </div>
                </div>

                {rows.map((record, idx) => {
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

                        <p className="sub">
                          {isEditingThisDay ? (
                            <Select
                              showSearch
                              value={editedData[dayNum]?.[idx]?.ToCode ?? record.ToCode}
                              onChange={(v) => handleLocationChange(dayNum, idx, v)}
                              placeholder="เลือกสถานที่แนะนำตามเส้นทาง"
                              options={rowOptions[key] ?? []}
                              optionFilterProp="label"
                              filterOption={(input, option) => (option?.label?.toString() ?? "").toLowerCase().includes(input.toLowerCase())}
                              notFoundContent={renderNotFound(key)}
                              loading={!!rowLoading[key]}
                              onOpenChange={(open) => { if (open) void ensureRowOptions(dayNum, idx, record); }}
                              onFocus={() => void ensureRowOptions(dayNum, idx, record)}
                              onClick={() => void ensureRowOptions(dayNum, idx, record)}
                              style={{ minWidth: 320 }}
                            />
                          ) : (
                            displayName(record.ToCode)
                          )}
                        </p>

                        <p className="sub">{record.StartTime} - {record.EndTime}</p>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
          <RateReviewModal
            open={reviewOpen}
            onCancel={closeRateModal}
            onSubmit={handleSubmitReview}
            loading={reviewSubmitting}
            tripName={trip?.Name}
          />
        </main>
      </div>
    </div>
  );
};

export default TripItinerary;
