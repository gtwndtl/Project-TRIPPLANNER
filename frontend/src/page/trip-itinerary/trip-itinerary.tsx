// src/page/trip-itinerary/TripItinerary.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PrinterOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import "./trip-itinerary.css";
import MapRoute from "../../component/map-route/map-route";
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
  GetAllReviews,
} from "../../services/https";
import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";
import type { DefaultOptionType } from "antd/es/select";
import Select from "antd/es/select";
import { Button, Empty, message, Modal, Spin, Tabs, Tooltip } from "antd";
import { usePlaceNamesHybrid } from "../../hooks/usePlaceNamesAuto";
import RateReviewModal from "../../component/review/review";
import { useUserId } from "../../hooks/useUserId";
import TripItineraryPrintSheet from "../../component/itinerary-print/itinerary-print";

type PlaceKind = "landmark" | "restaurant" | "accommodation";
const SP_TABLE_NAME = "shortestpaths";

// สไตล์การ์ด map ภายใน aside
const mapCardStyle: React.CSSProperties = {
  margin: "10px 12px 12px",
  background: "var(--surface)",
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
  padding: "8px 10px 12px",
};


// ===== Utils =====
const deepClone = <T,>(obj: T): T => {
  if (typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
};

// Render **bold** โดยไม่ใช้ dangerouslySetInnerHTML
const renderDescNode = (raw?: string) => {
  const text = raw ?? "-";
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = /^\*\*(.+)\*\*$/.exec(p);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
};

// ===== Kind helpers =====
const inferKind = (code?: string): PlaceKind => {
  const ch = code?.[0]?.toUpperCase();
  if (ch === "R") return "restaurant";
  if (ch === "A") return "accommodation";
  return "landmark";
};

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
  const [modal, modalContextHolder] = Modal.useModal();

  const userIdNum = useUserId();

  // ===== LocalStorage state sync =====
  const [activeTripId, setActiveTripId] = useState<number | null>(() => {
    const id = localStorage.getItem("TripID");
    return id ? Number(id) : null;
  });
  const [isLogin, setIsLogin] = useState<boolean>(() => localStorage.getItem("isLogin") === "true");

  // ===== Persisted Tabs =====
  const TAB_STORAGE_KEY = "itin.activeTab";
  const VALID_TABS = ["overview", "details"] as const;

  const [tabKey, setTabKey] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("tab");
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    const fallback = localStorage.getItem("isLogin") === "true" ? "overview" : "details";
    const candidate = q || stored || fallback;
    return VALID_TABS.includes(candidate as any) ? candidate! : fallback;
  });

  // ถ้าสถานะล็อกอินเปลี่ยน แล้วแท็บปัจจุบันใช้ไม่ได้ ให้ปรับอัตโนมัติ
  useEffect(() => {
    const allowed = isLogin ? VALID_TABS : ["details"];
    if (!allowed.includes(tabKey as any)) setTabKey(allowed[0]);
  }, [isLogin]);

  // เขียนสถานะแท็บกลับสู่ URL + localStorage ทุกครั้งที่เปลี่ยน
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tabKey);
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
    localStorage.setItem(TAB_STORAGE_KEY, tabKey);
  }, [tabKey]);


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

  // ไม่ล็อกอิน → ส่งกลับ trip-chat
  useEffect(() => {
    if (!isLogin) navigate("/trip-chat", { replace: true });
  }, [isLogin, navigate]);

  // ===== Data states =====
  const [trip, setTrip] = useState<TripInterface | null>(null);
  const [trips, setTrips] = useState<TripInterface[]>([]);
  const [user, setUser] = useState<any>(null);
  const [userCondition, setUserCondition] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // ===== Per-day edit state =====
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editedData, setEditedData] = useState<Record<number, ShortestpathInterface[]>>({});
  const [savingDay, setSavingDay] = useState<number | null>(null);

  // ===== Row options states =====
  const [rowOptions, setRowOptions] = useState<Record<string, DefaultOptionType[]>>({});
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [rowLoadedOnce, setRowLoadedOnce] = useState<Record<string, boolean>>({});
  const [reviewedTripIds, setReviewedTripIds] = useState<Set<number>>(new Set());

  // ===== Request token (race guard) =====
  const reqIdRef = useRef(0);

  // ===== Cache & Debounce สำหรับตัวเลือก =====
  const optionsCacheRef = useRef(new Map<string, DefaultOptionType[]>());
  const ensureRowOptionsTimerRef = useRef<number | null>(null);
  const ensureRowOptionsDebounced = (fn: () => void) => {
    if (ensureRowOptionsTimerRef.current) window.clearTimeout(ensureRowOptionsTimerRef.current);
    ensureRowOptionsTimerRef.current = window.setTimeout(fn, 120);
  };
  useEffect(() => {
    optionsCacheRef.current.clear(); // เปลี่ยนทริป → ล้าง cache
  }, [activeTripId]);

  // ===== Helpers: set active trip =====
  const setActiveTrip = useCallback((id: number) => {
    setActiveTripId(id);
    localStorage.setItem("TripID", String(id));
    window.dispatchEvent(new Event("TripIDChanged"));
  }, []);

  // โหลดรีวิวของฉัน
  useEffect(() => {
    if (!isLogin || !userIdNum) return;
    (async () => {
      try {
        const reviews: any[] = await GetAllReviews();
        const myReviews = reviews.filter((r) => Number(r.User_id) === Number(userIdNum));
        setReviewedTripIds(new Set(myReviews.map((r) => Number(r.TripID))));
      } catch (e) {
        console.error("fetch reviews failed:", e);
      }
    })();
  }, [isLogin, userIdNum, trips.length]);

  // ===== refreshAll: โหลด Trip → ใช้ Con_id ดึง Condition (มี race guard) =====
  const refreshAll = useCallback(
    async (tripId: number) => {
      setLoading(true);
      const myReqId = ++reqIdRef.current;
      try {
        const tripRes = await GetTripById(tripId);
        const [userRes, condRes] = await Promise.all([
          userIdNum ? GetUserById(userIdNum) : Promise.resolve(null),
          tripRes?.Con_id ? GetConditionById(Number(tripRes.Con_id)) : Promise.resolve(null),
        ]);
        if (reqIdRef.current === myReqId) {
          setTrip(tripRes || null);
          setUser(userRes || null);
          setUserCondition(condRes || null);
        }
      } catch (err) {
        if (reqIdRef.current === myReqId) {
          console.error("Error refreshing data:", err);
          msg.error("โหลดข้อมูลทริปล้มเหลว");
        }
      } finally {
        if (reqIdRef.current === myReqId) setLoading(false);
      }
    },
    [msg, userIdNum]
  );

  useEffect(() => {
    if (activeTripId) refreshAll(activeTripId);
  }, [activeTripId, refreshAll]);

  // ===== Fetch trips + auto-select/redirect =====
  const fetchTripsForUser = useCallback(async () => {
    if (!userIdNum || !isLogin) return;
    try {
      const allConditions = await GetAllConditions();
      const userConditions = allConditions.filter((c: any) => Number(c.User_id) === Number(userIdNum));
      const conditionIds = userConditions.map((c: any) => Number(c.ID));

      const allTrips = await GetAllTrips();
      const userTrips = allTrips.filter((t: any) => conditionIds.includes(Number(t.Con_id)));
      setTrips(userTrips);

      if (userTrips.length === 0) {
        localStorage.removeItem("TripID");
        window.dispatchEvent(new Event("TripIDChanged"));
        navigate("/trip-chat", { replace: true });
        return;
      }

      const firstId = Number(userTrips[0].ID);
      const activeExistsInList = userTrips.some((t) => Number(t.ID ?? -1) === Number(activeTripId));

      if (!activeTripId || !activeExistsInList) {
        setActiveTrip(firstId);
        await refreshAll(firstId);
      }
    } catch (err) {
      console.error("Error fetching user trips:", err);
    }
  }, [userIdNum, isLogin, activeTripId, setActiveTrip, refreshAll, navigate]);

  useEffect(() => {
    fetchTripsForUser();
  }, [fetchTripsForUser]);

  // ===== Group + sort by PathIndex (ต้องมาก่อน start/end edit เพราะใช้ในนั้น) =====
  const groupedByDay = useMemo(() => {
    const map = (trip?.ShortestPaths ?? []).reduce((acc, curr) => {
      const day = curr.Day ?? 0;
      if (!acc[day]) acc[day] = [];
      acc[day].push(curr);
      return acc;
    }, {} as Record<number, ShortestpathInterface[]>);
    Object.keys(map).forEach((d) => {
      map[+d].sort((a, b) => (a.PathIndex ?? 0) - (b.PathIndex ?? 0));
    });
    return map;
  }, [trip]);

  // ===== Edit toggle per day (ประกาศก่อนใช้ใน switchTripWithGuard) =====
  const startEditDay = (day: number) => {
    const base = groupedByDay[day] ?? [];
    setEditedData((prev) => ({ ...prev, [day]: deepClone(base) }));
    setEditingDay(day);
  };
  const endEditDay = () => {
    setEditingDay(null);
    setEditedData({});
  };

  // ===== เปลี่ยนทริปแบบมี Guard เมื่อมีการแก้ไขค้าง =====
  const switchTripWithGuard = useCallback(
    (tripId: number) => {
      const doSwitch = () => {
        setActiveTrip(tripId);
        refreshAll(tripId);
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
        }
      };
      if (editingDay !== null) {
        modal.confirm({
          className: "itin-modal",
          centered: true,
          title: "มีการแก้ไขที่ยังไม่ได้บันทึก",
          content: "คุณต้องการออกจากโหมดแก้ไขของวันนี้หรือไม่?",
          okText: "ออกและยกเลิก",
          cancelText: "อยู่ต่อ",
          onOk: () => {
            endEditDay();
            doSwitch();
          },
        });
        return;
      }
      doSwitch();
    },
    [editingDay, modal, setActiveTrip, refreshAll, endEditDay]
  );

  // ===== Unsaved guard (ออกหน้า/สลับแท็บ) =====
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editingDay !== null) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editingDay]);

  // ===== Helpers (Save) =====
  const getChangedRows = (original: ShortestpathInterface[], edited: ShortestpathInterface[]) => {
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
      new Set(changed.map((r) => r.ToCode?.toUpperCase() || "").filter((c) => c.startsWith("A")))
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
    if (savingDay != null) return;
    setSavingDay(day);

    const TripIDLS = Number(localStorage.getItem("TripID") || 0);
    if (!TripIDLS) {
      msg.error("ไม่พบ TripID");
      setSavingDay(null);
      return;
    }

    const edited = editedData[day];
    if (!edited) {
      setSavingDay(null);
      endEditDay();
      return;
    }

    const original = (trip?.ShortestPaths ?? []).filter((sp) => sp.Day === day);
    const changed = getChangedRows(original, edited);

    if (changed.length === 0) {
      msg.info("ไม่มีการเปลี่ยนแปลง");
      setSavingDay(null);
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
        newAcc
          ? "บันทึกสำเร็จ (อัปเดตที่พักทั้งทริป และแก้รายการอื่นแล้ว)"
          : `บันทึกสำเร็จ ${changed.length} รายการ`
      );

      await refreshAll(TripIDLS);

      // ✅ รีเฟรชทั้งหน้าเมื่อบันทึกเสร็จ
      setTimeout(() => {
        window.location.reload();
      }, 600);

    } catch (e: any) {
      msg.error(e?.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSavingDay(null);
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

  const ensureRowOptions = async (day: number, index: number, record: ShortestpathInterface) => {
    const key = `${day}:${index}`;
    const { prevCode, nextCode } = getPrevNext(day, index, record);
    const current = editedData[day]?.[index]?.ToCode || record.ToCode || "";
    const kind = inferKindSmart(current, prevCode, nextCode, record);

    const cacheKey =
      kind === "accommodation" ? `A|${day}|${current}` : `${kind}|${prevCode}|${nextCode}|${current}`;

    const cached = optionsCacheRef.current.get(cacheKey);
    if (cached) {
      setRowOptions((s) => ({ ...s, [key]: cached }));
      setRowLoadedOnce((s) => ({ ...s, [key]: true }));
      return;
    }

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
        optionsCacheRef.current.set(cacheKey, options);
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

      optionsCacheRef.current.set(cacheKey, options);
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
      return <Empty description="ไม่มีตัวเลือกในรัศมี" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }
    return null;
  };

  const getDayHeaderText = (dayIndex: number): string => `วันที่ ${dayIndex}`;

  const summary = useMemo(
    () => [
      { icon: "calendar" as const, title: trip?.Days ? `${trip.Days} วัน` : "—", subtitle: "ระยะเวลา" },
      { icon: "compass" as const, title: userCondition?.Style ?? "—", subtitle: "สไตล์" },
      { icon: "wallet" as const, title: userCondition?.Price ?? "—", subtitle: "งบประมาณ" },
      { icon: "pin" as const, title: trip?.Name || "—", subtitle: "ปลายทาง" },
    ],
    [trip, user, userCondition]
  );

  // ===== Modal confirm for delete =====
  const confirmDeleteTrip = (t: TripInterface) => {
    modal.confirm({
      className: "itin-modal",
      title: "ลบทริปนี้?",
      content: `คุณต้องการลบ "${t.Name}" หรือไม่?`,
      okText: "ลบ",
      cancelText: "ยกเลิก",
      okButtonProps: { danger: true },
      centered: true,
      getContainer: () => document.body,
      async onOk() {
        const loadingHide = message.loading("กำลังลบทริป...", 0);
        try {
          const nextCandidate = trips.find((x) => Number(x.ID) !== Number(t.ID));
          await DeleteTrip(Number(t.ID));
          loadingHide();
          msg.success("ลบทริปสำเร็จ");
          await fetchTripsForUser();
          if (Number(t.ID) === Number(activeTripId)) {
            if (nextCandidate) switchTripWithGuard(Number(nextCandidate.ID));
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

  const handleSubmitReview = async ({ rating, review }: { rating: number; review: string }) => {
    if (!activeTripId) return;

    const payload = {
      Day: new Date().toISOString(),
      Rate: Number(rating),
      TripID: Number(activeTripId),
      Comment: review?.trim(),
      User_id: userIdNum,
    };

    try {
      setReviewSubmitting(true);
      await CreateReview(payload);
      msg.success("ขอบคุณสำหรับการให้คะแนน!");
      setReviewedTripIds((prev) => new Set([...prev, Number(activeTripId)]));
      closeRateModal();
    } catch (e: any) {
      console.error("CreateReview error:", e);
      msg.error(e?.message || "ส่งรีวิวไม่สำเร็จ");
    } finally {
      setReviewSubmitting(false);
    }
  };

  // ===== Tabs (guard เมื่อมีของแก้ไขค้าง) =====
  const onTabsChange = (key: string) => {
    if (editingDay !== null) {
      modal.confirm({
        title: "มีการแก้ไขที่ยังไม่ได้บันทึก",
        content: "คุณต้องการออกจากโหมดแก้ไขของวันนี้หรือไม่?",
        okText: "ออกและยกเลิก",
        cancelText: "อยู่ต่อ",
        onOk: () => {
          endEditDay();
          setTabKey(key);
        },
      });
      return;
    }
    setTabKey(key);
  };

  const groupedCodes = useMemo(
    () =>
    (Object.values(groupedByDay)
      .flatMap((rows) => rows.flatMap((sp) => [sp.FromCode, sp.ToCode]))
      .filter(Boolean) as string[]),
    [groupedByDay]
  );

  const placeNameMap = usePlaceNamesHybrid(groupedCodes);
  const displayName = (code?: string | null) =>
    (code && placeNameMap[code.toUpperCase()]) || code || "-";

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div className="itin-root">
      {contextHolder}
      {modalContextHolder}
      <div className="itin-container">
        <aside className="itin-summary no-print">
          <div className="itin-title-row">
            <p className="itin-page-title">
              {trip?.Name || "Trip"} (<span className="nowrap">{trip?.Days ?? "—"} วัน</span>)
            </p>
          </div>
          <div className="itin-tabs">
            <Tabs
              activeKey={tabKey}
              onChange={onTabsChange}
              items={[
                ...(isLogin
                  ? [
                    {
                      key: "overview",
                      label: "Overview",
                      children: (
                        <>
                          {trips.length > 0 ? (
                            trips.map((t, idx) => {
                              const idNum = Number(t.ID);
                              const isActive = idNum === Number(activeTripId);
                              const hasReviewed = reviewedTripIds.has(idNum);
                              return (
                                <div key={t.ID ?? idx}>
                                  <div className={`itin-cardrow ${isActive ? "is-active" : ""}`}>
                                    <div className="itin-cardrow-text">
                                      <p
                                        className="title"
                                        style={{ cursor: "pointer" }}
                                        onClick={() => switchTripWithGuard(idNum)}
                                      >
                                        {idx + 1} - {t.Name}
                                      </p>
                                    </div>
                                    <div className="itin-cardrow-right">
                                      {!hasReviewed && (
                                        <Tooltip title="ให้คะแนนทริป">
                                          <button
                                            type="button"
                                            className="btn-icon rate"
                                            aria-label="Rate trip"
                                            onClick={() => {
                                              if (!isActive) switchTripWithGuard(idNum);
                                              openRateModal();
                                            }}
                                          >
                                            <StarFilled />
                                          </button>
                                        </Tooltip>
                                      )}
                                      <Tooltip title="ลบ">
                                        <button
                                          type="button"
                                          className="btn-icon danger"
                                          aria-label="Delete trip"
                                          onClick={() => confirmDeleteTrip(t)}
                                        >
                                          <DeleteOutlined />
                                        </button>
                                      </Tooltip>
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
                    } as const,
                  ]
                  : []),
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
                      <div className="no-print" style={mapCardStyle}>
                        <MapRoute />
                      </div>
                    </>
                  ),
                } as const,
              ]}
            />
          </div>
        </aside>

        <main className="itin-content no-print">
          {loading && (
            <div className="itin-loading">
              <Spin />
            </div>
          )}

          {Object.entries(groupedByDay).map(([dayKey, activities]) => {
            const dayNum = Number(dayKey);
            const isEditingThisDay = editingDay === dayNum;
            const rows = isEditingThisDay ? (editedData[dayNum] ?? activities) : activities;

            return (
              <section key={dayKey}>
                <div
                  className="itin-day-header"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <h2 className="itin-section-title" style={{ margin: 0 }}>
                    {getDayHeaderText(dayNum)}
                  </h2>
                  <div className="button-edit-group">
                    {isEditingThisDay ? (
                      <>
                        <Button
                          className="btn-secondary"
                          icon={<CloseOutlined />}
                          onClick={endEditDay}
                          disabled={savingDay === dayNum}
                        >
                          ยกเลิก
                        </Button>
                        <Button
                          className="btn-secondary"
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={() => handleSaveDay(dayNum)}
                          style={{ marginLeft: 8 }}
                          disabled={savingDay === dayNum}
                          loading={savingDay === dayNum}
                        >
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

                {rows.length === 0 ? (
                  <div className="itin-empty-day">
                    <Empty description="ยังไม่มีแผนสำหรับวันนี้" />
                  </div>
                ) : (
                  rows.map((record, idx) => {
                    const key = `${dayNum}:${idx}`;
                    return (
                      <div className="itin-cardrow" key={record.ID ?? key}>
                        <div className="itin-cardrow-icon">
                          <ItemIcon code={record.ToCode} />
                        </div>

                        <div className="itin-cardrow-text">
                          <p className="title-itin">{renderDescNode(record.ActivityDescription)}</p>

                          <p className="sub">
                            {isEditingThisDay ? (
                              <Select
                                showSearch
                                value={editedData[dayNum]?.[idx]?.ToCode ?? record.ToCode}
                                onChange={(v) => handleLocationChange(dayNum, idx, v)}
                                placeholder="เลือกสถานที่แนะนำตามเส้นทาง"
                                options={rowOptions[key] ?? []}
                                optionFilterProp="label"
                                filterOption={(input, option) =>
                                  (option?.label?.toString() ?? "").toLowerCase().includes(input.toLowerCase())
                                }
                                notFoundContent={renderNotFound(key)}
                                loading={!!rowLoading[key]}
                                onOpenChange={(open) => {
                                  if (open) ensureRowOptionsDebounced(() => void ensureRowOptions(dayNum, idx, record));
                                }}
                                onFocus={() =>
                                  ensureRowOptionsDebounced(() => void ensureRowOptions(dayNum, idx, record))
                                }
                                onClick={() =>
                                  ensureRowOptionsDebounced(() => void ensureRowOptions(dayNum, idx, record))
                                }
                                style={{ minWidth: 360 }}
                                dropdownMatchSelectWidth={false}
                                disabled={savingDay === dayNum}
                              />
                            ) : (
                              displayName(record.ToCode)
                            )}
                          </p>

                          <p className="sub">
                            {record.StartTime} - {record.EndTime}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
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

        {trip && (
          <TripItineraryPrintSheet
            trip={trip}
            condition={userCondition}
            groupedByDay={groupedByDay}
            displayName={displayName}
            getDayHeaderText={getDayHeaderText}
          />
        )}
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

export default TripItinerary;
