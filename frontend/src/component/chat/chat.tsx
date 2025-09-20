import { useEffect, useRef, useState, useCallback } from "react";
import "./chat.css";

// ====== Types ======
import type { LandmarkInterface } from "../../interfaces/Landmark";
import type { TripInterface } from "../../interfaces/Trips";
import type { ShortestpathInterface } from "../../interfaces/Shortestpath";

// ====== Services ======
import {
  GetAllLandmarks,
  GetRouteFromAPI,
  PostGroq,
  CreateTrip,
  CreateShortestPath,
  CreateCondition,
  GetUserById,
} from "../../services/https";

// ====== User Id from localStorage ======
import { useUserId } from "../../hooks/useUserId";
import type { UserInterface } from "../../interfaces/User";
import { Avatar } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

// ====== Local constants ======
const AVATAR_URL =
  "https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE";

// ====== LocalStorage keys (สำหรับ Guest) ======
const LOCAL_GUEST_TRIP_PLAN_TEXT = "guest_trip_plan_text";
const LOCAL_GUEST_ROUTE_DATA = "guest_route_data";
const LOCAL_GUEST_ACTIVITIES = "guest_activities";
const LOCAL_GUEST_META = "guest_meta"; // { keyword, days, budget, placeId, placeName, prefs, time, guestCondition? }
const LOCAL_GUEST_SHORTEST_PATHS = "guest_shortest_paths"; // เก็บ FromCode/ToCode สำหรับ guest

// ====== Preferences dictionary ======
const P1_KEYWORDS = ["สายบุญ", "วัฒนธรรม", "ไหว้พระ", "ประวัติศาสตร์"];          // priority สูงสุด
const P2_KEYWORDS = ["ชิวๆ", "ชิว ๆ", "เดินเล่น", "คาเฟ่", "ช้อปปิ้ง", "กินเล่น"]; // ไลฟ์สไตล์สบายๆ
const P3_KEYWORDS = ["จุดชมวิว", "ธรรมชาติ", "ทะเล", "ภูเขา", "สวนสาธารณะ"];     // เอาท์ดอร์/วิว

const DEFAULT_WEIGHTS = { w1: 0.6, w2: 0.8, w3: 0.9 };
const DEFAULT_N_TOP = 40;

// ===== util: ดึงรูปจากแลนด์มาร์ก =====
const getPlaceImage = (p?: Partial<LandmarkInterface> | null) =>
  p?.ThumbnailURL;

// ===== Types (ภายในไฟล์นี้)
type GuestActivity = { day: number; startTime: string; endTime: string; description: string };
type RouteData = {
  start_name?: string;
  accommodation?: { id?: string };
  trip_plan_by_day?: Array<{ day: number; plan: Array<{ id: string }> }>;
  paths?: Array<{ from: string; to: string; distance_km?: number }>;
};

// ===== parse แผนจาก LLM → activities =====
function parseTripPlanTextToActivities(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const activities: Array<{ day: number; startTime: string; endTime: string; description: string }> = [];
  let currentDay = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "วันที่ 1", "### วันที่ 1", "** วันที่ 1"
    const dayMatch = line.match(/(?:#+\s*)?วันที่\s*(\d+)\**/i);
    if (dayMatch) {
      currentDay = parseInt(dayMatch[1], 10);
      continue;
    }
    if (currentDay === 0) continue;

    // "08:00 - 09:00 เช็คอินที่ ..."
    const timeDescInlineMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})\s+(.+)/);
    if (timeDescInlineMatch) {
      const [, startTime, endTime, description] = timeDescInlineMatch as unknown as [string, string, string, string];
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }

    // "08:00 - 09:00" + บรรทัดถัดไปเป็นคำอธิบาย
    const timeOnlyMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})$/);
    if (timeOnlyMatch && i + 1 < lines.length) {
      const startTime = timeOnlyMatch[1];
      const endTime = timeOnlyMatch[2];
      const description = lines[i + 1];
      activities.push({ day: currentDay, startTime, endTime, description });
      i++;
      continue;
    }

    // "20:00 พักผ่อนที่ ..." → 20:00–21:00
    const singleLineSpecial = line.match(/^(\d{2}:\d{2})\s+(.+)/);
    if (singleLineSpecial) {
      const [_, startTime, description] = singleLineSpecial as unknown as [string, string, string];
      const [h, m] = startTime.split(":").map(Number);
      const endH = Math.min(h + 1, 23);
      const endTime = `${endH.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }
  }

  return activities;
}

// ===== จัดรูปข้อความแผนทริปให้อ่านง่าย =====
const formatTripPlanText = (text: string) => {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return <br key={"br" + i} />;

    if (/^\*\*\s*วันที่/.test(trimmed)) {
      return (
        <h4 key={"day" + i} style={{ marginTop: 20, marginBottom: 10, color: "#333" }}>
          {trimmed.replace(/^\*\*\s*/, "")}
        </h4>
      );
    }

    if (/^\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(trimmed)) {
      const times = trimmed.match(/^(\d{2}:\d{2})[–-](\d{2}:\d{2})/);
      if (!times) return trimmed;
      const start = times[1];
      const end = times[2];
      return (
        <div key={"time" + i} style={{ marginTop: 6, marginBottom: 4 }}>
          <b>
            {start} - {end}
          </b>
          <br />
          <span>{trimmed.replace(/^\d{2}:\d{2}[–-]\d{2}:\d{2}\s*/, "")}</span>
        </div>
      );
    }

    return <p key={"p" + i}>{trimmed}</p>;
  });
};

// ===== reconstruct ShortestPaths (สำหรับ guest) จาก activities + routeData
function reconstructGuestShortestPaths(
  activities: GuestActivity[],
  routeData: RouteData | null
): Array<
  Pick<
    ShortestpathInterface,
    "Day" | "PathIndex" | "FromCode" | "ToCode" | "Type" | "Distance" | "ActivityDescription" | "StartTime" | "EndTime"
  >
> {
  if (!routeData) return [];
  const accCode = routeData.accommodation?.id || "A1";
  const sps: Array<
    Pick<
      ShortestpathInterface,
      | "Day"
      | "PathIndex"
      | "FromCode"
      | "ToCode"
      | "Type"
      | "Distance"
      | "ActivityDescription"
      | "StartTime"
      | "EndTime"
    >
  > = [];
  const dayPlanIndices: Record<number, number> = {};
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
      Day: act.day,
      PathIndex: PathIndex++,
      FromCode: fromCode,
      ToCode: toCode,
      Type: "Activity",
      Distance: typeof distance === "number" ? distance : 0,
      ActivityDescription: act.description,
      StartTime: act.startTime,
      EndTime: act.endTime,
    });

    // เดิน pointer เฉพาะกิจกรรมปกติ
    if (!isCheckIn && !isCheckout) {
      if (dayPlan && currentIndex + 1 < (dayPlan.plan?.length || 0)) {
        dayPlanIndices[act.day] = currentIndex + 1;
      }
    }
  }

  return sps;
}

// ===== saveTripCondition: guest จะไม่บันทึกลง backend ให้เก็บใน localStorage แทน =====
const saveTripCondition = async (
  userId: number | null | undefined,
  tripDetails?: { day: string | number; price: number; accommodation: string; landmark: string; style: string }
) => {
  try {
    if (!tripDetails) {
      console.warn("[Condition] tripDetails is undefined. Skip creating condition.");
      return;
    }
    if (tripDetails.day === undefined || tripDetails.day === null) {
      console.warn("[Condition] tripDetails.day is missing. Skip creating condition.");
      return;
    }

    // Guest → เก็บลง LOCAL_GUEST_META แบบ merge (อย่าทับ guestCondition เดิม)
    if (!userId) {
      const prevMeta = JSON.parse(localStorage.getItem(LOCAL_GUEST_META) || "{}");
      localStorage.setItem(
        LOCAL_GUEST_META,
        JSON.stringify({
          ...prevMeta,
          guestCondition: tripDetails,
        })
      );
      return;
    }

    // ผู้ใช้ปกติ → บันทึกลง backend
    const payload = {
      User_id: userId,
      Day: tripDetails.day.toString(),
      Price: tripDetails.price,
      Accommodation: tripDetails.accommodation,
      Landmark: tripDetails.landmark,
      Style: tripDetails.style,
    };

    await CreateCondition(payload);
  } catch (error) {
    console.error("[Condition] เกิดข้อผิดพลาดในการบันทึกเงื่อนไขทริป", error);
  }
};

// ====== Message Types ======
export type Msg =
  | { id: string; role: "ai" | "user"; text: string; isTripPlan?: false; kind?: "text" }
  | { id: string; role: "ai"; text: string; isTripPlan: true; kind?: "text" }
  | { id: string; role: "ai"; kind: "days-prompt"; placeName: string; image?: string; text: string }
  | { id: string; role: "ai"; kind: "days-quickpick"; choices: number[] }
  | { id: string; role: "ai"; kind: "budget-prompt"; text: string }
  | { id: string; role: "ai"; kind: "budget-quickpick"; choices: number[] }
  // ✅ ใหม่: การ์ดนับถอยหลังนำทาง พร้อมปุ่มยกเลิก/ไปเลย
  | { id: string; role: "ai"; kind: "redirect-countdown"; seconds: number; total: number; text?: string };

// ===== Helpers: ดึง keyword/days/budget + types จากข้อความผู้ใช้ =====
function parseBudgetToNumber(s: string): number | null {
  const km = s.match(/(\d+(?:[.,]\d+)?)\s*[kK]\b/);
  if (km) return Math.round(parseFloat(km[1].replace(",", "")) * 1000);
  const th = s.match(/(\d+)\s*(พัน|หมื่น)/);
  if (th) {
    const base = parseInt(th[1], 10);
    const mul = th[2] === "หมื่น" ? 10000 : 1000;
    return base * mul;
  }
  const n1 = s.match(/(\d[\d,\.]*)\s*(?:บาท|฿)?/);
  if (n1) return Math.round(parseFloat(n1[1].replace(/[,]/g, "")));
  return null;
}

function extractKeywordDaysBudgetAndTypes(text: string) {
  const t = text.replace(/\s+/g, " ").trim();

  // days
  let days: number | null = null;
  const d1 = t.match(/(\d+)\s*วัน/);
  if (d1) days = parseInt(d1[1], 10);

  // budget
  let budget: number | null = null;
  const b1 = t.match(/(?:งบ(?:ประมาณ)?|budget)\s*(?:ไม่เกิน|ประมาณ|ที่)?\s*([\d.,kK]+|\d+\s*(?:พัน|หมื่น))(?:\s*(?:บาท|฿))?/i);
  if (b1) {
    budget = parseBudgetToNumber(b1[1]);
  } else {
    const b2 = t.match(/(\d[\d,\.]+)\s*(?:บาท|฿)/);
    if (b2) budget = parseBudgetToNumber(b2[1]);
  }

  // keyword
  let keyword: string | null = null;
  const k1 = t.match(/อยากไป\s*(.*?)(?:\d+\s*วัน|งบ|budget|$)/i);
  if (k1) keyword = k1[1].trim();

  // types: แยกเป็น 3 กลุ่มตาม priority
  const p1 = P1_KEYWORDS.filter((w) => t.includes(w));
  const p2 = P2_KEYWORDS.filter((w) => t.includes(w));
  const p3 = P3_KEYWORDS.filter((w) => t.includes(w));

  const prefer = p1.join(",");
  const prefer2 = p2.join(",");
  const prefer3 = p3.join(",");

  if (!keyword && !days && !budget && !prefer && !prefer2 && !prefer3) return null;

  return {
    keyword: keyword ?? "",
    days,
    budget,
    prefer,
    prefer2,
    prefer3,
  } as {
    keyword: string;
    days: number | null;
    budget: number | null;
    prefer: string;
    prefer2: string;
    prefer3: string;
  };
}

const TripChat = () => {
  const userIdNum = useUserId();
  const isPreviewOnly = !userIdNum; // guest mode
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<UserInterface | null>(null);
  const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: crypto.randomUUID(),
      role: "ai",
      text: 'สวัสดีค่ะ ฉันช่วยวางแผนทริปให้ได้เลย ลองพิมพ์ว่า "อยากไปอารีย์ 2 วัน งบ 5,000 เน้นชิวๆ เดินเล่น และมีจุดชมวิว" ดูก็ได้ 😊',
      kind: "text",
    },
    ...(isPreviewOnly
      ? [
        {
          id: crypto.randomUUID(),
          role: "ai",
          text: "โหมดพรีวิว: คุณสร้างและดูแผนได้ แต่ยังไม่บันทึกลงระบบ หากต้องการบันทึก โปรดล็อกอิน",
          kind: "text",
        } as Msg,
      ]
      : []),
  ]);

  const [suggestedPlaces, setSuggestedPlaces] = useState<LandmarkInterface[]>([]);
  const [awaitingUserSelection, setAwaitingUserSelection] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<LandmarkInterface | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [selectedPlaceDays, setSelectedPlaceDays] = useState<number | null>(null);
  const [awaitingDays, setAwaitingDays] = useState(false);
  const [lastSuggestKeyword, setLastSuggestKeyword] = useState<string>("");

  // budget states
  const [awaitingBudget, setAwaitingBudget] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<number | null>(null);

  // preferences states
  const [pref1, setPref1] = useState<string>(""); // prefer
  const [pref2, setPref2] = useState<string>(""); // prefer2
  const [pref3, setPref3] = useState<string>(""); // prefer3

  const suggestions = ["ฉันอยากไปสยาม 3 วัน", "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ เดินเล่น", "อยากไปวัดอรุณ 1 วัน สายบุญ"];

  // ====== Redirect countdown state (timer refs) ======
  const redirectRef = useRef<{ id: string; seconds: number; total: number; intervalId: number | null } | null>(null);

  const startRedirectCountdown = useCallback(
    (initialSeconds = 5) => {
      const id = crypto.randomUUID();
      const total = initialSeconds;

      // เพิ่มการ์ดนับถอยหลัง
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "ai",
          kind: "redirect-countdown",
          seconds: initialSeconds,
          total,
          text: "บันทึกทริปเรียบร้อยแล้ว",
        } as Msg,
      ]);

      // ตั้ง ref
      redirectRef.current = { id, seconds: initialSeconds, total, intervalId: null };

      // เริ่ม interval
      const intervalId = window.setInterval(() => {
        if (!redirectRef.current) return;
        const next = redirectRef.current.seconds - 1;

        // อัปเดต message ให้แสดงวินาทีล่าสุด
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && (m as any).kind === "redirect-countdown"
              ? ({ ...(m as any), seconds: next } as Msg)
              : m
          )
        );

        // อัปเดต ref
        redirectRef.current = { ...redirectRef.current, seconds: next };

        // ครบเวลา → นำทาง
        if (next <= 0) {
          window.clearInterval(intervalId);
          redirectRef.current = null;
          try {
            navigate("/itinerary");
          } catch { }
        }
      }, 1000);

      // เก็บ intervalId
      if (redirectRef.current) redirectRef.current.intervalId = intervalId;
    },
    [navigate]
  );

  const cancelRedirect = useCallback(() => {
    const info = redirectRef.current;
    if (info?.intervalId) window.clearInterval(info.intervalId);
    redirectRef.current = null;

    // ลบการ์ดนับถอยหลัง แล้วแจ้งยกเลิก
    setMessages((prev) => [
      ...prev.filter((m) => m.id !== info?.id),
      {
        id: crypto.randomUUID(),
        role: "ai",
        text: 'ยกเลิกการนำทางแล้ว คุณสามารถเข้าไปที่หน้า "My Trip" จากเมนูได้ทุกเมื่อ',
        kind: "text",
      } as Msg,
    ]);
  }, []);

  const goNow = useCallback(() => {
    const info = redirectRef.current;
    if (info?.intervalId) window.clearInterval(info.intervalId);
    redirectRef.current = null;
    try {
      navigate("/itinerary");
    } catch { }
  }, [navigate]);

  // เคลียร์ interval เมื่อ component unmount
  useEffect(() => {
    return () => {
      if (redirectRef.current?.intervalId) window.clearInterval(redirectRef.current.intervalId);
      redirectRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, awaitingUserSelection]);

  useEffect(() => {
    const loadLandmarks = async () => {
      try {
        const data = await GetAllLandmarks();
        setLandmarks(data);
      } catch (e) {
        console.error("โหลดแลนด์มาร์กล้มเหลว", e);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "ai",
            text: "ขออภัยเกิดข้อผิดพลาดในการดึงข้อมูลสถานที่ กรุณาลองใหม่ภายหลัง",
            kind: "text",
          },
        ]);
      }
    };
    loadLandmarks();
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await GetUserById(userIdNum as number);
        setUser(data);
      } catch (e) {
        console.error("โหลดข้อมูลผู้ใช้ล้มเหลว", e);
      }
    };
    if (userIdNum) loadUser();
  }, [userIdNum]);

  const pushBot = (text: string, isPlan = false) =>
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "ai", text, kind: "text", ...(isPlan ? { isTripPlan: true } : {}) } as Msg,
    ]);

  // Days prompt + quick-pick
  const pushBotDaysPrompt = (placeName: string | undefined, image?: string) =>
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "ai",
        kind: "days-prompt",
        placeName: placeName ?? "",
        image,
        text: `คุณต้องการไป "${placeName ?? ""}" กี่วันคะ?`,
      },
      {
        id: crypto.randomUUID(),
        role: "ai",
        kind: "days-quickpick",
        choices: [1, 3, 5, 7],
      },
    ]);

  // Budget prompt + quick-pick
  const pushBotBudgetPrompt = (presetText?: string) =>
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "ai",
        kind: "budget-prompt",
        text: presetText ?? "งบประมาณรวมของทริปประมาณเท่าไหร่คะ? (พิมพ์ตัวเลข เช่น 5000 หรือ 5,000 หรือ 5k)",
      },
      {
        id: crypto.randomUUID(),
        role: "ai",
        kind: "budget-quickpick",
        choices: [2000, 5000, 8000, 12000],
      },
    ]);

  const pushUser = (text: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text, kind: "text" }]);

  // ---------- Core: generateRouteAndPlan ----------
  const generateRouteAndPlan = useCallback(
    async (id: number, keyword: string, days: number, budget?: number) => {
      try {
        setLoading(true);
        const typesText = [pref1, pref2, pref3].filter(Boolean).join(" / ") || "ไม่ระบุสไตล์";
        pushBot(
          `กำลังสร้างแผนทริปสำหรับ "${keyword}" ${days} วัน${budget ? ` ภายใต้งบ ~${budget.toLocaleString()} บาท` : ""
          } (${typesText})...`
        );

        // ขอ route โดยส่ง preferences และพารามิเตอร์อัลกอริทึมไปด้วย
        const routeData: RouteData = await GetRouteFromAPI(id, days, budget, {
          use_boykov: true,
          distance: 4000,
          k: 20,
          k_mst: 20,
          mode: "penalize",
          penalty: 1.3,
          n_top: DEFAULT_N_TOP,
          prefer: pref1 || undefined,
          prefer2: pref2 || undefined,
          prefer3: pref3 || undefined,
          w1: pref1 ? DEFAULT_WEIGHTS.w1 : undefined,
          w2: pref2 ? DEFAULT_WEIGHTS.w2 : undefined,
          w3: pref3 ? DEFAULT_WEIGHTS.w3 : undefined,
        });

        const budgetText = budget
          ? `\n- งบประมาณรวมสำหรับทั้งทริปไม่เกิน ~${budget.toLocaleString()} บาท (พยายามเลือกกิจกรรม/ร้านอาหารให้เหมาะกับงบ)\n`
          : "";

        const prompt = `
คุณคือผู้ช่วยวางแผนทริปท่องเที่ยวมืออาชีพ โปรดจัดแผนการเดินทางเป็นเวลา ${days} วัน โดยเริ่มจาก "${routeData.start_name}"

ด้านล่างคือข้อมูลเส้นทางระหว่างสถานที่ (paths) และแผนรายวัน (trip_plan):
${JSON.stringify(routeData.paths, null, 2)}

${JSON.stringify(routeData.trip_plan_by_day, null, 2)}

กรุณาจัดแผนทริปให้ครบทั้ง ${days} วัน โดยมีรายละเอียดดังนี้:
- แบ่งแผนตามวัน เช่น “วันที่ 1”, “วันที่ 2” พร้อมระบุช่วงเวลา (เช่น 09:00–10:30) ให้เหมาะสมกับจำนวนกิจกรรมในแต่ละวัน
- ใช้ช่วงเวลาแต่ละกิจกรรมประมาณ 1.5–3 ชั่วโมง และจัดตามลำดับใน paths และ trip_plan
- เริ่มกิจกรรมแต่ละวันเวลาประมาณ 08:00
- ห้ามใช้คำว่า “เป็นต้นไป” ให้ระบุช่วงเวลาอย่างชัดเจนเท่านั้น เช่น 18:00–20:00
- วันแรกให้เริ่มต้นด้วยกิจกรรม “เช็คอินที่ <ชื่อที่พัก>” เวลา 08:00–09:00
- สิ้นสุดทุกวันด้วย “พักผ่อนที่ <ชื่อที่พัก>” ช่วงเย็น
- วันสุดท้ายให้ปิดท้ายด้วย “เช็คเอาท์และเดินทางกลับ” หลังจบกิจกรรมสุดท้าย และต้องมีเวลา เริ่มต้น - จบ เสมอ เช่น 19:00-20:00
- ห้ามใช้รหัสสถานที่ (เช่น P123, R99, A1) ในคำอธิบาย
- เขียนคำอธิบายกิจกรรมตามประเภท:
  - P = สถานที่ท่องเที่ยว เช่น "เที่ยวชม...", "เดินเล่นที่...", "ถ่ายรูปที่..."
  - R = ร้านอาหาร เช่น "รับประทานอาหารกลางวันที่...", "แวะชิมของว่างที่..."
  - A = ที่พัก เช่น "เช็คอินที่...", หลังวันแรก "พักผ่อนที่...", "เช็คเอาท์และเดินทางกลับ"
- หากมีสถานที่ซ้ำในหลายวัน ให้ปรับคำอธิบายกิจกรรมให้หลากหลาย ไม่ซ้ำซาก
- ใช้ภาษาสุภาพ กระชับ อ่านง่าย และจัดรูปแบบให้อ่านสบาย มีการเว้นบรรทัดอย่างเหมาะสม
${budgetText}
`;

        const groqRes = await PostGroq(prompt);
        const tripPlanText = groqRes?.choices?.[0]?.message?.content?.trim();
        if (!tripPlanText) {
          pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
          return;
        }

        // แสดงแผนแบบจัดรูป
        pushBot(tripPlanText, true);

        // ====== โหมดพรีวิว: เก็บทุกอย่างลง localStorage ======
        if (isPreviewOnly) {

          localStorage.removeItem("TripID");
          try { window.dispatchEvent(new Event("TripIDChanged")); } catch { }
          
          const activities = parseTripPlanTextToActivities(tripPlanText || "");

          // 1) เก็บข้อความแผน + route + activities
          localStorage.setItem(LOCAL_GUEST_TRIP_PLAN_TEXT, tripPlanText);
          localStorage.setItem(LOCAL_GUEST_ROUTE_DATA, JSON.stringify(routeData));
          localStorage.setItem(LOCAL_GUEST_ACTIVITIES, JSON.stringify(activities));

          // 2) คำนวณ shortest paths (มี FromCode/ToCode) แล้วเก็บไว้ให้ด้วย
          const guestSPs = reconstructGuestShortestPaths(activities as GuestActivity[], routeData);
          localStorage.setItem(LOCAL_GUEST_SHORTEST_PATHS, JSON.stringify(guestSPs));

          // 3) อัปเดต META แบบ merge (รวม prefs + guestCondition ถ้ายังไม่มี)
          const prevMeta = JSON.parse(localStorage.getItem(LOCAL_GUEST_META) || "{}");
          const mergedMeta = {
            ...prevMeta,
            keyword,
            days,
            budget: budget ?? prevMeta?.budget ?? null,
            placeId: id,
            placeName: selectedPlace?.Name ?? keyword,
            prefs: { prefer: pref1, prefer2: pref2, prefer3: pref3 },
            time: new Date().toISOString(),
            guestCondition:
              prevMeta?.guestCondition ??
              (typeof days === "number" && days > 0
                ? {
                  day: days.toString(),
                  price: budget ?? 0,
                  accommodation: "โรงแรม",
                  landmark: selectedPlace?.Name || keyword,
                  style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
                }
                : undefined),
          };
          localStorage.setItem(LOCAL_GUEST_META, JSON.stringify(mergedMeta));

          navigate("/guest/preview");
          return;
        }

        // ====== โหมดล็อกอิน: บันทึกลงระบบ ======
        const conditionPayload = {
          User_id: userIdNum as number,
          Day: days.toString(),
          Price: budget ?? 5000,
          Accommodation: "โรงแรม",
          Landmark: keyword,
          Style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
        };

        let conIdFromCreate = 1;
        try {
          const conRes = await CreateCondition(conditionPayload);
          if (conRes?.ID) conIdFromCreate = conRes.ID;
        } catch (err) {
          console.error("[Condition] create failed, fallback Con_id=1", err);
        }

        const accIdStr = routeData.accommodation?.id ?? "";
        const accIdNum = parseInt(accIdStr.replace(/[^\d]/g, ""), 10);

        const newTrip: TripInterface = {
          Name: keyword,
          Types: "custom",
          Days: days,
          Con_id: conIdFromCreate,
          Acc_id: isFinite(accIdNum) ? accIdNum : 0,
        };

        const savedTrip = await CreateTrip(newTrip);
        localStorage.setItem("TripID", savedTrip.ID!.toString());
        try { window.dispatchEvent(new Event("TripIDChanged")); } catch { }

        // Save shortest paths
        const activities = parseTripPlanTextToActivities(tripPlanText || "");
        let PathIndex = 1;
        const dayPlanIndices: { [day: number]: number } = {};

        for (const act of activities) {
          if (!routeData.trip_plan_by_day || !Array.isArray(routeData.trip_plan_by_day)) {
            console.error("routeData.trip_plan_by_day missing:", routeData.trip_plan_by_day);
            pushBot("เกิดข้อผิดพลาดในการดึงข้อมูลแผนทริป กรุณาลองใหม่");
            return;
          }

          const dayPlan = routeData.trip_plan_by_day.find((d: { day: number }) => d.day === (act as any).day);
          if (!dayPlan) {
            console.warn(`ไม่พบแผนสำหรับวัน ${(act as any).day}`);
            continue;
          }

          const accommodationCode = routeData.accommodation?.id || "A1";
          const currentIndex = dayPlanIndices[(act as any).day] ?? 0;

          let fromCode = "";
          let toCode = "";

          if (/เช็คอิน/.test((act as any).description)) {
            fromCode = accommodationCode;
            toCode = accommodationCode;
          } else if (/เช็คเอาท์/.test((act as any).description)) {
            if (dayPlan.plan && dayPlan.plan.length > 0) {
              fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
            } else {
              fromCode = accommodationCode;
            }
            toCode = accommodationCode;
          } else if (/พักผ่อน/.test((act as any).description)) {
            if (dayPlan.plan && dayPlan.plan.length > 0) {
              fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
            } else {
              fromCode = accommodationCode;
            }
            toCode = accommodationCode;
          } else {
            if (dayPlan.plan && dayPlan.plan.length > 0) {
              if (currentIndex === 0) {
                fromCode = accommodationCode;
                toCode = dayPlan.plan[0].id;
              } else if (currentIndex > 0 && currentIndex < dayPlan.plan.length) {
                fromCode = dayPlan.plan[currentIndex - 1].id;
                toCode = dayPlan.plan[currentIndex].id;
              } else {
                fromCode = accommodationCode;
                toCode = accommodationCode;
              }
            } else {
              fromCode = accommodationCode;
              toCode = accommodationCode;
            }
          }

          const path = routeData.paths?.find(
            (p: { from: string; to: string }) =>
              (p.from === fromCode && p.to === toCode) || (p.from === toCode && p.to === fromCode)
          );
          const distance = path ? path.distance_km ?? 0 : 0;

          const shortestPathData: ShortestpathInterface = {
            TripID: savedTrip.ID,
            Day: (act as any).day,
            PathIndex: PathIndex++,
            FromCode: fromCode,
            ToCode: toCode,
            Type: "Activity",
            Distance: parseFloat(distance.toString()),
            ActivityDescription: (act as any).description,
            StartTime: (act as any).startTime,
            EndTime: (act as any).endTime,
          };

          try {
            await CreateShortestPath(shortestPathData);
          } catch (e) {
            console.error("Save shortest-path failed:", e);
          }

          if (!/เช็คอิน|เช็คเอาท์/.test((act as any).description)) {
            if (currentIndex + 1 < (dayPlan.plan?.length || 0)) {
              dayPlanIndices[(act as any).day] = currentIndex + 1;
            }
          }
        }

        // ✅ แทนที่จะ setTimeout → แสดงการ์ดนับถอยหลัง 5 วิ พร้อมปุ่มยกเลิก/ไปเลย
        startRedirectCountdown(5);
      } catch (error) {
        console.error("Error generating route or calling Groq", error);
        pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
      } finally {
        setLoading(false);
      }
    },
    [isPreviewOnly, navigate, selectedPlace?.Name, userIdNum, pref1, pref2, pref3, startRedirectCountdown]
  );

  // ===== Quick-pick วัน =====
  const handlePickDays = useCallback(
    async (days: number) => {
      if (!selectedPlace) {
        pushBot("กรุณาเลือกสถานที่ก่อนค่ะ");
        return;
      }
      setSelectedPlaceDays(days);

      // ยังไม่ทราบงบ → ถามก่อน
      if (selectedBudget == null) {
        setAwaitingBudget(true);
        pushBotBudgetPrompt();
        return;
      }

      const tripDetails = {
        day: days.toString(),
        price: selectedBudget ?? 5000,
        accommodation: "โรงแรม",
        landmark: selectedPlace.Name || "",
        style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
      };
      await saveTripCondition(userIdNum, tripDetails);
      await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, days, selectedBudget ?? undefined);

      setAwaitingDays(false);
      setAwaitingConfirm(false);
      setSelectedPlace(null);
      setSelectedPlaceDays(null);
    },
    [selectedPlace, userIdNum, generateRouteAndPlan, selectedBudget, pref1, pref2, pref3]
  );

  // ===== Quick-pick งบ =====
  const handlePickBudget = useCallback(
    async (budget: number) => {
      setSelectedBudget(budget);
      setAwaitingBudget(false);

      if (selectedPlace && selectedPlaceDays && selectedPlaceDays > 0) {
        const tripDetails = {
          day: selectedPlaceDays.toString(),
          price: budget,
          accommodation: "โรงแรม",
          landmark: selectedPlace.Name || "",
          style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
        };
        await saveTripCondition(userIdNum, tripDetails);
        await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, selectedPlaceDays, budget);

        setAwaitingConfirm(false);
        setSelectedPlace(null);
        setSelectedPlaceDays(null);
        setAwaitingDays(false);
        return;
      }

      pushBot(`รับทราบงบประมาณ ~ ${budget.toLocaleString()} บาท ค่ะ`);
    },
    [selectedPlace, selectedPlaceDays, userIdNum, generateRouteAndPlan, pref1, pref2, pref3]
  );

  // ===== เลือกสถานที่จากการ์ด =====
  const handleSelectPlace = useCallback(
    async (place: LandmarkInterface) => {
      try {
        setSelectedPlace(place);
        setAwaitingUserSelection(false);

        if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
          if (selectedBudget == null) {
            setAwaitingBudget(true);
            pushBotBudgetPrompt();
            setAwaitingConfirm(false);
            setAwaitingDays(false);
            return;
          }

          const tripDetails = {
            day: selectedPlaceDays.toString(),
            price: selectedBudget ?? 5000,
            accommodation: "โรงแรม",
            landmark: place.Name || "",
            style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
          };
          await saveTripCondition(userIdNum, tripDetails);
          await generateRouteAndPlan(place.ID!, place.Name!, selectedPlaceDays, selectedBudget ?? undefined);

          setAwaitingConfirm(false);
          setSelectedPlace(null);
          setSelectedPlaceDays(null);
          setAwaitingDays(false);
        } else {
          setAwaitingConfirm(false);
          setAwaitingDays(true);
          const img = getPlaceImage(place);
          pushBotDaysPrompt(place.Name ?? "", img);
        }
      } catch (e) {
        console.error("Select place failed:", e);
        pushBot("เกิดข้อผิดพลาด กรุณาลองเลือกสถานที่อีกครั้งค่ะ");
      }
    },
    [generateRouteAndPlan, selectedPlaceDays, userIdNum, selectedBudget, pref1, pref2, pref3]
  );

  // ===== Handler หลักของข้อความผู้ใช้ =====
  const handleUserMessage = useCallback(
    async (userText: string) => {
      pushUser(userText);
      const msg = userText.trim();

      // 1) กรอกงบประมาณ
      if (awaitingBudget) {
        const b = parseBudgetToNumber(msg);
        if (b && b > 0) {
          await handlePickBudget(b);
        } else {
          pushBot("กรุณาพิมพ์งบประมาณเป็นตัวเลข เช่น 5000 หรือ 5,000 หรือ 5k ค่ะ");
        }
        return;
      }

      // 2) กำลังให้ผู้ใช้เลือกสถานที่จาก list
      if (awaitingUserSelection) {
        const byName = suggestedPlaces.find((p) => p.Name === msg);
        if (byName) {
          setSelectedPlace(byName);
          setAwaitingUserSelection(false);
          if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
            if (selectedBudget == null) {
              setAwaitingBudget(true);
              pushBotBudgetPrompt();
              setAwaitingConfirm(false);
              setAwaitingDays(false);
              return;
            }

            const tripDetails = {
              day: selectedPlaceDays.toString(),
              price: selectedBudget ?? 5000,
              accommodation: "โรงแรม",
              landmark: byName?.Name || "",
              style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(byName.ID!, byName.Name!, selectedPlaceDays, selectedBudget ?? undefined);

            setAwaitingConfirm(false);
            setSelectedPlace(null);
            setSelectedPlaceDays(null);
            setAwaitingDays(false);
          } else {
            setAwaitingDays(true);
            pushBotDaysPrompt(byName.Name ?? "", getPlaceImage(byName));
          }
        } else {
          const idx = parseInt(msg, 10) - 1;
          if (!isNaN(idx) && idx >= 0 && idx < suggestedPlaces.length) {
            const place = suggestedPlaces[idx];
            setSelectedPlace(place);
            setAwaitingUserSelection(false);
            if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
              if (selectedBudget == null) {
                setAwaitingBudget(true);
                pushBotBudgetPrompt();
                setAwaitingConfirm(false);
                setAwaitingDays(false);
                return;
              }

              const tripDetails = {
                day: selectedPlaceDays.toString(),
                price: selectedBudget ?? 5000,
                accommodation: "โรงแรม",
                landmark: place?.Name || "",
                style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
              };
              await saveTripCondition(userIdNum, tripDetails);
              await generateRouteAndPlan(place.ID!, place.Name!, selectedPlaceDays, selectedBudget ?? undefined);

              setAwaitingConfirm(false);
              setSelectedPlace(null);
              setSelectedPlaceDays(null);
              setAwaitingDays(false);
            } else {
              setAwaitingDays(true);
              pushBotDaysPrompt(place.Name ?? "", getPlaceImage(place));
            }
          } else {
            pushBot(`กรุณาเลือกจากการ์ด หรือพิมพ์เลขสถานที่ ที่ต้องการจาก (1–${suggestedPlaces.length})`);
          }
        }
        return;
      }

      // 3) รอยืนยันเลือกสถานที่ (ถ้าคุณยังใช้ flow นี้)
      if (awaitingConfirm) {
        const norm = msg.toLowerCase();
        if (norm.startsWith("ใช่")) {
          if (selectedPlace && selectedPlaceDays !== null) {
            if (selectedBudget == null) {
              setAwaitingBudget(true);
              pushBotBudgetPrompt();
              setAwaitingConfirm(false);
              setAwaitingDays(false);
              return;
            }

            const tripDetails = {
              day: selectedPlaceDays.toString(),
              price: selectedBudget ?? 5000,
              accommodation: "โรงแรม",
              landmark: selectedPlace?.Name || "",
              style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(
              selectedPlace.ID!,
              selectedPlace.Name!,
              selectedPlaceDays,
              selectedBudget ?? undefined
            );

            setAwaitingConfirm(false);
            setSelectedPlace(null);
            setSelectedPlaceDays(null);
            setAwaitingDays(false);
          } else {
            setAwaitingConfirm(false);
            setAwaitingDays(true);
            pushBotDaysPrompt(selectedPlace?.Name || "", getPlaceImage(selectedPlace || undefined));
          }
        } else if (norm.startsWith("ไม่")) {
          pushBot("โอเคค่ะ กรุณาพิมพ์คำค้นใหม่อีกครั้งนะคะ");
          setAwaitingConfirm(false);
          setSelectedPlace(null);
          setSelectedPlaceDays(null);
        } else {
          pushBot('กรุณาตอบ "ใช่" หรือ "ไม่" ค่ะ');
        }
        return;
      }

      // 4) รอจำนวนวัน (กรณีพิมพ์ตัวเลขแทนกดการ์ด)
      if (awaitingDays) {
        const daysOnly = msg.replace(/[^\d]/g, "");
        const daysNum = parseInt(daysOnly, 10);

        if (!isNaN(daysNum) && daysNum > 0) {
          setSelectedPlaceDays(daysNum);
          if (selectedPlace) {
            if (selectedBudget == null) {
              setAwaitingBudget(true);
              pushBotBudgetPrompt();
              return;
            }

            const tripDetails = {
              day: daysNum.toString(),
              price: selectedBudget ?? 5000,
              accommodation: "โรงแรม",
              landmark: selectedPlace.Name || "",
              style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ทั่วไป",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, daysNum, selectedBudget ?? undefined);

            setAwaitingDays(false);
            setAwaitingConfirm(false);
            setSelectedPlace(null);
            setSelectedPlaceDays(null);
          } else {
            pushBot("เกิดข้อผิดพลาด กรุณาเลือกสถานที่ใหม่อีกครั้ง");
          }
        } else {
          pushBot("กรุณาพิมพ์จำนวนวันเป็นตัวเลขที่ถูกต้องค่ะ");
        }
        return;
      }

      // 5) วิเคราะห์ข้อความ → ค้นสถานที่ + preferences
      const analysis = extractKeywordDaysBudgetAndTypes(msg);
      if (analysis?.keyword) {
        setAwaitingDays(false);
        setAwaitingConfirm(false);
        setAwaitingUserSelection(false);
        setSelectedPlace(null);
        setSelectedPlaceDays(null);

        // เก็บ preferences จากข้อความล่าสุด
        setPref1(analysis.prefer || "");
        setPref2(analysis.prefer2 || "");
        setPref3(analysis.prefer3 || "");

        // ตั้งงบจากข้อความ (ถ้ามี)
        if (analysis.budget != null) setSelectedBudget(analysis.budget);
        else setSelectedBudget(null);

        try {
          setLoading(true);
          const landmarkNames = landmarks.map((l) => l.Name).join(", ");
          const prompt = `
คุณคือผู้ช่วยแนะนำสถานที่ท่องเที่ยวในระบบของเรา

สถานที่ที่เรามีในระบบมีดังนี้:
${landmarkNames}

โปรดแนะนำสถานที่ที่ใกล้เคียงหรือเกี่ยวข้องกับคำว่า "${analysis.keyword}"

**โปรดตอบเป็น JSON array ของชื่อสถานที่เท่านั้น เช่น ["วัดพระแก้ว", "วัดอรุณ"]**
อย่าตอบข้อความอื่นหรือบรรยาย เอาแค่ 5 ชื่อ
`;
          const groqRes = await PostGroq(prompt);
          let placeNamesFromLLM: string[] = [];
          try {
            placeNamesFromLLM = JSON.parse(groqRes.choices[0].message.content);
          } catch (e) {
            console.error("แปลง JSON ผิดพลาด:", e);
          }

          const matchedLandmarks = landmarks.filter((l) =>
            placeNamesFromLLM.some((name) => l.Name?.includes(name))
          );

          if (matchedLandmarks.length > 1) {
            setSuggestedPlaces(matchedLandmarks);
            setAwaitingUserSelection(true);
            setLastSuggestKeyword(analysis.keyword);
            if (typeof analysis.days === "number" && analysis.days > 0) {
              setSelectedPlaceDays(analysis.days);
            } else {
              setSelectedPlaceDays(null);
            }
            if (analysis.budget != null) setSelectedBudget(analysis.budget);
            return;
          }

          if (matchedLandmarks.length === 1) {
            const matched = matchedLandmarks[0];
            setSelectedPlace(matched);
            if (typeof analysis.days === "number" && analysis.days > 0) {
              setSelectedPlaceDays(analysis.days);

              if (analysis.budget == null) {
                setAwaitingDays(false);
                setAwaitingBudget(true);
                pushBotBudgetPrompt();
                return;
              }

              const tripDetails = {
                day: analysis.days.toString(),
                price: analysis.budget!,
                accommodation: "โรงแรม",
                landmark: matched.Name || "",
                style: [analysis.prefer, analysis.prefer2, analysis.prefer3].filter(Boolean).join(",") || "ทั่วไป",
              };
              await saveTripCondition(userIdNum, tripDetails);
              await generateRouteAndPlan(matched.ID!, analysis.keyword, analysis.days, analysis.budget!);
            } else {
              setAwaitingDays(true);
              pushBotDaysPrompt(matched.Name ?? "", getPlaceImage(matched));
              if (analysis.budget != null) setSelectedBudget(analysis.budget);
            }
            return;
          }

          pushBot(`ไม่พบสถานที่ที่เกี่ยวข้องกับ "${analysis.keyword}" ในระบบของเรา ลองพิมพ์คำค้นใหม่ดูนะคะ`);
        } catch (error) {
          console.error(error);
          pushBot("เกิดข้อผิดพลาดในการค้นหาสถานที่ กรุณาลองใหม่");
        } finally {
          setLoading(false);
        }
        return;
      }

      // 6) อื่นๆ
      pushBot('หากต้องการวางแผนทริป พิมพ์ว่า "อยากไป..." พร้อมจำนวนวัน และงบประมาณ (ถ้ามี) เช่น "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ และจุดชมวิว"');
    },
    [
      awaitingUserSelection,
      suggestedPlaces,
      awaitingConfirm,
      selectedPlace,
      selectedPlaceDays,
      awaitingDays,
      landmarks,
      generateRouteAndPlan,
      userIdNum,
      awaitingBudget,
      handlePickBudget,
      selectedBudget,
      pref1, pref2, pref3,
    ]
  );

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    handleUserMessage(text);
    setInput("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // ===== UI การ์ดสถานที่ให้คลิกเลือก =====
  const renderPlaceCards = () => {
    if (!awaitingUserSelection || suggestedPlaces.length < 2) return null;

    return (
      <div className="trip-chat-row">
        <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
        <div className="trip-chat-bubble-group left">
          <p className="trip-chat-author">Your Assistant</p>
          <div className="trip-chat-bubble ai">
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              จาก "{lastSuggestKeyword}" เราพบสถานที่ใกล้เคียง เลือกได้เลย:
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              {suggestedPlaces.map((p, i) => {
                const img = getPlaceImage(p);
                return (
                  <button
                    key={(p as any).ID || i}
                    type="button"
                    onClick={() => handleSelectPlace(p)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      overflow: "hidden",
                      background: "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    title={p.Name}
                  >
                    <div
                      style={{
                        height: 110,
                        background: "#f3f4f6",
                        backgroundImage: img ? `url(${img})` : undefined,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <div style={{ padding: "8px 10px" }}>
                      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 2 }}>#{i + 1}</div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "#111827",
                          lineHeight: 1.3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {p.Name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              หรือพิมพ์หมายเลขสถานที่ที่ต้องการ
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="trip-chat-main">
      <div className="trip-chat-titlebar">
        <h1 className="trip-chat-title">Chat with Your Assistant</h1>
      </div>

      {/* โซนสกอลล์รายการข้อความ */}
      <div className="trip-chat-scroll">
        {messages.map((m) => {
          const isUser = m.role === "user";

          // days-prompt (รูป + ถามจำนวนวัน)
          if (m.role === "ai" && (m as any).kind === "days-prompt") {
            const dp = m as Extract<Msg, { kind: "days-prompt" }>;
            return (
              <div key={m.id} className={`trip-chat-row ${isUser ? "right" : ""}`}>
                {!isUser && <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />}
                <div className={`trip-chat-bubble-group ${isUser ? "right" : "left"}`}>
                  <p className={`trip-chat-author ${isUser ? "right" : ""}`}>Your Assistant</p>
                  <div className={`trip-chat-bubble ai`}>
                    <div
                      style={{
                        borderRadius: 10,
                        overflow: "hidden",
                        border: "1px solid #e5e7eb",
                        marginBottom: 8,
                        background: "#fff",
                      }}
                    >
                      <div
                        style={{
                          height: 160,
                          backgroundImage: `url(${dp.image || "/images/place-placeholder.jpg"})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          backgroundColor: "#f3f4f6",
                        }}
                        aria-label={dp.placeName}
                        title={dp.placeName}
                      />
                      <div style={{ padding: "8px 10px", textAlign: "center" }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: "#111827",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {dp.placeName}
                        </div>
                      </div>
                    </div>
                    <div>{dp.text}</div>
                  </div>
                </div>
              </div>
            );
          }

          // days-quickpick
          if (m.role === "ai" && (m as any).kind === "days-quickpick") {
            const dqp = m as Extract<Msg, { kind: "days-quickpick" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, textAlign: "center" }}>
                        เลือกจำนวนวันที่ต้องการเดินทาง
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(60px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {dqp.choices.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => handlePickDays(d)}
                            style={{
                              padding: "10px 0",
                              border: "1px solid " + "#d1d5db",
                              borderRadius: 8,
                              background: "#fff",
                              cursor: "pointer",
                              fontWeight: 700,
                            }}
                            title={`${d} วัน`}
                          >
                            {d} วัน
                          </button>
                        ))}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                        หรือพิมพ์จำนวนวันเป็นตัวเลข
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // budget-prompt
          if (m.role === "ai" && (m as any).kind === "budget-prompt") {
            const bp = m as Extract<Msg, { kind: "budget-prompt" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">{bp.text}</div>
                </div>
              </div>
            );
          }

          // budget-quickpick
          if (m.role === "ai" && (m as any).kind === "budget-quickpick") {
            const bqp = m as Extract<Msg, { kind: "budget-quickpick" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, textAlign: "center" }}>
                        เลือกงบประมาณรวมของทริป
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(80px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {bqp.choices.map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => handlePickBudget(b)}
                            style={{
                              padding: "10px 0",
                              border: "1px solid " + "#d1d5db",
                              borderRadius: 8,
                              background: "#fff",
                              cursor: "pointer",
                              fontWeight: 700,
                            }}
                            title={`${b.toLocaleString()} บาท`}
                          >
                            {b.toLocaleString()} บ.
                          </button>
                        ))}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
                        หรือพิมพ์จำนวนเงินเป็นตัวเลข (เช่น 5000 หรือ 5k)
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // ✅ redirect-countdown card
          if (m.role === "ai" && (m as any).kind === "redirect-countdown") {
            const rc = m as Extract<Msg, { kind: "redirect-countdown" }>;
            const percent = Math.max(0, Math.min(100, Math.round(((rc.total - rc.seconds) / rc.total) * 100)));
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>
                        {rc.text || "บันทึกทริปเรียบร้อยแล้ว"}
                      </div>
                      <div style={{ color: "#374151", marginBottom: 10 }}>
                        จะพาคุณไปหน้า <b>My Trip</b> ใน <b>{rc.seconds}</b> วินาที
                      </div>

                      {/* Progress bar */}
                      <div
                        aria-label="progress"
                        style={{
                          width: "100%",
                          height: 8,
                          background: "#f3f4f6",
                          borderRadius: 999,
                          overflow: "hidden",
                          marginBottom: 12,
                        }}
                      >
                        <div
                          style={{
                            width: `${percent}%`,
                            height: "100%",
                            background: "#d1d5db",
                            transition: "width 300ms linear",
                          }}
                        />
                      </div>

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={cancelRedirect}
                          style={{
                            padding: "8px 12px",
                            border: "1px solid #d1d5db",
                            borderRadius: 8,
                            background: "#fff",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                          title="ยกเลิกการนำทางอัตโนมัติ"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={goNow}
                          style={{
                            padding: "8px 12px",
                            border: "1px solid #111827",
                            borderRadius: 8,
                            background: "#111827",
                            color: "#fff",
                            cursor: "pointer",
                            fontWeight: 700,
                          }}
                          title="ไปหน้า My Trip ตอนนี้"
                        >
                          ไปเลยตอนนี้
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // default renderer
          return (
            <div key={m.id} className={`trip-chat-row ${isUser ? "right" : ""}`}>
              {!isUser && (
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
              )}

              <div className={`trip-chat-bubble-group ${isUser ? "right" : "left"}`}>
                <p className={`trip-chat-author ${isUser ? "right" : ""}`}>
                  {isUser ? (user?.Firstname ?? "You") : "Your Assistant"}
                </p>

                <div className={`trip-chat-bubble ${isUser ? "user" : "ai"}`}>
                  {"isTripPlan" in (m as any) && (m as any).isTripPlan
                    ? formatTripPlanText((m as any).text)
                    : (m as any).text}
                </div>
              </div>

              {isUser && (
                <div
                  className="trip-chat-avatar"
                  style={{
                    width: 40,
                    height: 40,
                    background: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Avatar size={40} icon={<UserOutlined />} style={{ backgroundColor: "#fde3cf", color: "#f56a00" }} />
                </div>
              )}
            </div>
          );
        })}

        {/* การ์ดรูปสถานที่สำหรับเลือก */}
        {renderPlaceCards()}

        {loading && (
          <div className="trip-chat-row">
            <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
            <div className="trip-chat-bubble-group left">
              <p className="trip-chat-author">Your Assistant</p>
              <p className="trip-chat-bubble ai">
                <div className="typing">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </p>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="trip-chat-composer">
        <div
          className="trip-chat-avatar"
          style={{
            width: 40,
            height: 40,
            background: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Avatar size={40} icon={<UserOutlined />} style={{ backgroundColor: "#fde3cf", color: "#f56a00" }} />
        </div>
        <div className="trip-chat-inputwrap">
          <input
            className="trip-chat-input"
            placeholder='พิมพ์เช่น "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ และจุดชมวิว"'
            aria-label="Type your message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />

          <button
            type="button"
            className="trip-chat-inputbtn"
            aria-label="Send message"
            onClick={handleSend}
            title="Send"
            disabled={loading}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
              <path d="M239.16,25.34a8,8,0,0,0-8.5-1.74l-208,80a8,8,0,0,0,0,14.8l88,32,32,88a8,8,0,0,0,14.8,0l80-208A8,8,0,0,0,239.16,25.34ZM164.69,164.69,144,216l-28.69-79.31,49.38-49.38-81.14,29.15L40,80,216,40Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Suggestions */}
      <div style={{ padding: "0 16px 12px 16px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInput(s)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
                color: "#374151",
              }}
              title="เติมข้อความ"
            >
              + {s}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
};

export default TripChat;
