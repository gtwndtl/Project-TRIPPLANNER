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
const LOCAL_GUEST_META = "guest_meta";
const LOCAL_GUEST_SHORTEST_PATHS = "guest_shortest_paths";

// ====== Preferences dictionary ======
const P1_KEYWORDS = ["สายบุญ", "วัฒนธรรม", "ไหว้พระ", "ประวัติศาสตร์"];
const P2_KEYWORDS = ["ชิวๆ", "ชิว ๆ", "เดินเล่น", "คาเฟ่", "ช้อปปิ้ง", "กินเล่น"];
const P3_KEYWORDS = ["จุดชมวิว", "ธรรมชาติ", "ทะเล", "ภูเขา", "สวนสาธารณะ"];

const DEFAULT_WEIGHTS = { w1: 0.6, w2: 0.8, w3: 0.9 };
const DEFAULT_N_TOP = 40;

// ===== util: ดึงรูปจากแลนด์มาร์ก =====
const getPlaceImage = (p?: Partial<LandmarkInterface> | null) => p?.ThumbnailURL;

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

    const dayMatch = line.match(/(?:#+\s*)?วันที่\s*(\d+)\**/i);
    if (dayMatch) {
      currentDay = parseInt(dayMatch[1], 10);
      continue;
    }
    if (currentDay === 0) continue;

    const timeDescInlineMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})\s+(.+)/);
    if (timeDescInlineMatch) {
      const [, startTime, endTime, description] =
        timeDescInlineMatch as unknown as [string, string, string, string];
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }

    const timeOnlyMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})$/);
    if (timeOnlyMatch && i + 1 < lines.length) {
      const startTime = timeOnlyMatch[1];
      const endTime = timeOnlyMatch[2];
      const description = lines[i + 1];
      activities.push({ day: currentDay, startTime, endTime, description });
      i++;
      continue;
    }

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

// ===== reconstruct ShortestPaths (สำหรับ guest) =====
function reconstructGuestShortestPaths(
  activities: GuestActivity[],
  routeData: RouteData | null
): Array<
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

    if (!isCheckIn && !isCheckout) {
      if (dayPlan && currentIndex + 1 < (dayPlan.plan?.length || 0)) {
        dayPlanIndices[act.day] = currentIndex + 1;
      }
    }
  }

  return sps;
}

// ===== Helpers: ดึง keyword/days/budget + types =====
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

  let days: number | null = null;
  const d1 = t.match(/(\d+)\s*วัน/);
  if (d1) days = parseInt(d1[1], 10);

  let budget: number | null = null;
  const b1 = t.match(/(?:งบ(?:ประมาณ)?|budget)\s*(?:ไม่เกิน|ประมาณ|ที่)?\s*([\d.,kK]+|\d+\s*(?:พัน|หมื่น))(?:\s*(?:บาท|฿))?/i);
  if (b1) budget = parseBudgetToNumber(b1[1]);
  else {
    const b2 = t.match(/(\d[\d,\.]+)\s*(?:บาท|฿)/);
    if (b2) budget = parseBudgetToNumber(b2[1]);
  }

  let keyword: string | null = null;
  const k1 = t.match(/อยากไป\s*(.*?)(?:\d+\s*วัน|งบ|budget|$)/i);
  if (k1) keyword = k1[1].trim();

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

// ===== Flow control types/state =====
type FlowStep = "idle" | "choosePlace" | "chooseDays" | "chooseBudget" | "generating";

const TripChat = () => {
  const userIdNum = useUserId();
  const isPreviewOnly = !userIdNum;
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<UserInterface | null>(null);
  const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
  const [messages, setMessages] = useState<any[]>([
    {
      id: crypto.randomUUID(),
      role: "ai",
      text:
        'สวัสดีค่ะ ฉันช่วยวางแผนทริปได้ ลองพิมพ์ว่า "อยากไปอารีย์ 2 วัน งบ 5,000 เน้นชิวๆ เดินเล่น และจุดชมวิว" หรือพิมพ์ "แนะนำ สยาม"',
      kind: "text",
    },
    ...(isPreviewOnly
      ? [
          {
            id: crypto.randomUUID(),
            role: "ai",
            text: "โหมดพรีวิว: สร้างและดูแผนได้ แต่ยังไม่บันทึกลงระบบ หากต้องการบันทึก โปรดล็อกอิน",
            kind: "text",
          } as any,
        ]
      : []),
  ]);

  const [suggestedPlaces, setSuggestedPlaces] = useState<LandmarkInterface[]>([]);
  const [awaitingUserSelection, setAwaitingUserSelection] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<LandmarkInterface | null>(null);
  const [selectedPlaceDays, setSelectedPlaceDays] = useState<number | null>(null);
  const [awaitingDays, setAwaitingDays] = useState(false);

  // budget states
  const [awaitingBudget, setAwaitingBudget] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<number | null>(null);

  // preferences states
  const [pref1, setPref1] = useState<string>("");
  const [pref2, setPref2] = useState<string>("");
  const [pref3, setPref3] = useState<string>("");

  const suggestions = [
    "ฉันอยากไปสยาม 3 วัน",
    "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ เดินเล่น",
    "อยากไปวัดอรุณ 1 วัน สายบุญ",
    "แนะนำสถานที่",
  ];

  // redirect countdown
  const redirectRef = useRef<{ id: string; seconds: number; total: number; intervalId: number | null } | null>(null);

  // Flow stack
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [flowStack, setFlowStack] = useState<FlowStep[]>([]);
  const jobIdRef = useRef<string | null>(null);

  // กัน Condition ซ้ำ
  const lastConIdRef = useRef<number | null>(null);
  const conditionSavedRef = useRef<boolean>(false);

  // refs สำหรับยุบการ์ด
  const daysGroupRef = useRef<{ promptId: string; quickId: string } | null>(null);
  const budgetGroupRef = useRef<{ promptId: string; quickId: string } | null>(null);
  const recCardIdRef = useRef<string | null>(null);

  // Short command
  const isBackCmd = (s: string) => /^(ย้อนกลับ|back)$/i.test(s.trim());

  // tip helper
  const pushTip = (bullets: string[], title?: string) =>
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "ai", kind: "tip", bullets, ...(title ? { title } : {}) } as any,
    ]);

  // ===== Recommendations (การ์ดเดียว) — 2 คอลัมน์เริ่มต้น =====
  const pushRecommendations = (places: LandmarkInterface[], title = "แนะนำสถานที่ใกล้เคียง") => {
    const id = crypto.randomUUID();
    recCardIdRef.current = id;
    const mapped = places.slice(0, 8).map((p) => ({
      id: String((p as any).ID || p.Name),
      name: p.Name || "",
      image: getPlaceImage(p),
    }));
    setMessages((prev) => [
      ...prev,
      { id, role: "ai", kind: "recommendations", title, places: mapped } as any,
    ]);
  };

  const recommendPlaces = (keyword?: string) => {
    const kw = (keyword || "").trim();
    if (!landmarks.length) return pushBot("ยังไม่มีข้อมูลสถานที่ให้แนะนำตอนนี้ค่ะ");

    let candidates = landmarks;
    if (kw) {
      const low = kw.toLowerCase();
      candidates = landmarks.filter((l) => (l.Name || "").toLowerCase().includes(low));
      if (!candidates.length) candidates = landmarks;
    }
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    pushRecommendations(shuffled, kw ? `แนะนำสถานที่ที่เกี่ยวกับ "${kw}"` : "แนะนำสถานที่ยอดนิยม");
  };

  // ===== Countdown helpers =====
  const startRedirectCountdown = useCallback(
    (initialSeconds = 5) => {
      const id = crypto.randomUUID();
      const total = initialSeconds;

      setMessages((prev) => [
        ...prev,
        { id, role: "ai", kind: "redirect-countdown", seconds: initialSeconds, total, text: "บันทึกทริปเรียบร้อยแล้ว" } as any,
      ]);

      redirectRef.current = { id, seconds: initialSeconds, total, intervalId: null };

      const intervalId = window.setInterval(() => {
        if (!redirectRef.current) return;
        const next = redirectRef.current.seconds - 1;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === id && (m as any).kind === "redirect-countdown"
              ? ({ ...(m as any), seconds: next } as any)
              : m
          )
        );

        redirectRef.current = { ...redirectRef.current, seconds: next };

        if (next <= 0) {
          window.clearInterval(intervalId);
          redirectRef.current = null;
          try {
            navigate("/itinerary");
          } catch {}
        }
      }, 1000);

      if (redirectRef.current) redirectRef.current.intervalId = intervalId;
    },
    [navigate]
  );

  const cancelRedirect = useCallback(() => {
    const info = redirectRef.current;
    if (info?.intervalId) window.clearInterval(info.intervalId);
    redirectRef.current = null;

    setMessages((prev) => [
      ...prev.filter((m) => m.id !== info?.id),
      {
        id: crypto.randomUUID(),
        role: "ai",
        text: 'ยกเลิกการนำทางแล้ว คุณสามารถเข้าไปที่หน้า "My Trip" จากเมนูได้ทุกเมื่อ',
        kind: "text",
      } as any,
    ]);
  }, []);

  const goNow = useCallback(() => {
    const info = redirectRef.current;
    if (info?.intervalId) window.clearInterval(info.intervalId);
    redirectRef.current = null;
    try {
      navigate("/itinerary");
    } catch {}
  }, [navigate]);

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
          { id: crypto.randomUUID(), role: "ai", text: "ขออภัยเกิดข้อผิดพลาดในการดึงข้อมูลสถานที่ กรุณาลองใหม่ภายหลัง", kind: "text" },
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

  // ===== Pushers =====
  const pushBot = (text: string, isPlan = false) =>
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "ai", text, kind: "text", ...(isPlan ? { isTripPlan: true } : {}) } as any,
    ]);

  const pushUser = (text: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text, kind: "text" }]);

  // ===== helper: ยุบการ์ด -> เหลือข้อความที่เลือก =====
  const collapseQuickpickToChoice = useCallback((quickId: string, chosenText: string, removeIds: string[]) => {
    setMessages((prev) => {
      const next: any[] = [];
      for (const m of prev) {
        if (removeIds.includes(m.id)) continue;
        if (m.id === quickId) {
          next.push({ id: quickId, role: "user", kind: "choice", text: chosenText });
        } else {
          next.push(m);
        }
      }
      return next;
    });
  }, []);

  // ===== Days prompt + quick-pick
  const pushBotDaysPrompt = (placeName: string | undefined, image?: string, opts?: { stack?: boolean }) => {
    const useStack = opts?.stack !== false; // default true
    if (useStack) setFlowStack((stk) => [...stk, flowStep]);
    setFlowStep("chooseDays");
    setAwaitingDays(true);

    const pid = crypto.randomUUID();
    const qid = crypto.randomUUID();
    daysGroupRef.current = { promptId: pid, quickId: qid };

    setMessages((prev) => [
      ...prev,
      { id: pid, role: "ai", kind: "days-prompt", placeName: placeName ?? "", image, text: `คุณต้องการไป "${placeName ?? ""}" กี่วันคะ?` },
      { id: qid, role: "ai", kind: "days-quickpick", choices: [1, 3, 5, 7] },
    ]);
    pushTip(['พิมพ์ "ย้อนกลับ" เพื่อกลับไปเลือกสถานที่']);
  };

  // ===== Budget prompt + quick-pick (โชว์รูป+ชื่อ ถ้ามี)
  const pushBotBudgetPrompt = (presetText?: string, opts?: { stack?: boolean }) => {
    const useStack = opts?.stack !== false; // default true
    if (useStack) setFlowStack((stk) => [...stk, flowStep]);
    setFlowStep("chooseBudget");
    setAwaitingBudget(true);

    const pid = crypto.randomUUID();
    const qid = crypto.randomUUID();
    budgetGroupRef.current = { promptId: pid, quickId: qid };

    // โชว์ prompt (ภาพ+ชื่อสถานที่ถ้ามีจะ render ใน bubble)
    setMessages((prev) => [
      ...prev,
      { id: pid, role: "ai", kind: "budget-prompt", text: presetText ?? "งบประมาณรวมของทริปประมาณเท่าไหร่คะ? (เช่น 5000 หรือ 5k)" },
      { id: qid, role: "ai", kind: "budget-quickpick", choices: [2000, 5000, 8000, 12000] },
    ]);
    pushTip(['พิมพ์ "ย้อนกลับ" เพื่อแก้จำนวนวัน']);
  };

  // ===== Back (พิมพ์ได้ ไม่มีปุ่ม)
  const handleBack = useCallback(() => {
    if (!flowStack.length) {
      pushBot("อยู่ต้นทางของบทสนทนาแล้วค่ะ");
      return;
    }

    const prev = flowStack[flowStack.length - 1];
    setFlowStack((stk) => stk.slice(0, -1));
    setFlowStep(prev);

    const goingPlace = prev === "choosePlace";
    const goingDays = prev === "chooseDays";
    const goingBudget = prev === "chooseBudget";

    setAwaitingUserSelection(goingPlace);
    setAwaitingDays(goingDays);
    setAwaitingBudget(goingBudget);

    if (goingPlace) {
      if (suggestedPlaces.length) {
        pushRecommendations(suggestedPlaces, "เลือกสถานที่ใหม่");
      }
    } else if (goingDays) {
      const name = selectedPlace?.Name ?? "";
      const img = getPlaceImage(selectedPlace || undefined);
      pushBotDaysPrompt(name, img, { stack: false });
    } else if (goingBudget) {
      pushBotBudgetPrompt(undefined, { stack: false });
    }

    pushBot("ย้อนกลับ 1 ขั้นเรียบร้อย 🔙");
  }, [flowStack, suggestedPlaces, selectedPlace]);

  // ---------- Core: generateRouteAndPlan ----------
  const generateRouteAndPlan = useCallback(
    async (id: number, keyword: string, days: number, budget?: number) => {
      // เริ่ม job ใหม่
      setFlowStack((stk) => [...stk, flowStep]);
      setFlowStep("generating");

      const thisJob = crypto.randomUUID();
      jobIdRef.current = thisJob;

      try {
        setLoading(true);
        const styleText = [pref1, pref2, pref3].filter(Boolean).join(" / ") || "ไม่ระบุ";
        pushBot(
          `กำลังสร้างแผนทริปสำหรับ "${keyword}" ${days} วัน${
            budget ? ` ภายใต้งบ ~${budget.toLocaleString()} บาท` : ""
          } (${styleText})...`
        );

        // ===== บันทึก Condition ครั้งเดียว (เฉพาะโหมดล็อกอิน) =====
        let conIdToUse: number | null = null;
        if (!isPreviewOnly) {
          if (lastConIdRef.current && conditionSavedRef.current) {
            conIdToUse = lastConIdRef.current; // ใช้ซ้ำ
          } else {
            const payload = {
              User_id: userIdNum as number,
              Day: days.toString(),
              Price: budget ?? 5000,
              Accommodation: "โรงแรม",
              Landmark: keyword,
              Style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ไม่ระบุ",
            };
            try {
              const conRes = await CreateCondition(payload);
              conIdToUse = conRes?.ID ?? 1;
              lastConIdRef.current = conIdToUse;
              conditionSavedRef.current = true;
            } catch (err) {
              console.error("[Condition] create failed, fallback Con_id=1", err);
              conIdToUse = 1;
              lastConIdRef.current = 1;
              conditionSavedRef.current = true; // ป้องกันยิงซ้ำภายใน job เดียวกัน
            }
          }
        }

        // ===== เรียกเส้นทาง
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

        if (jobIdRef.current !== thisJob) return;

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
        if (jobIdRef.current !== thisJob) return;

        const tripPlanText = groqRes?.choices?.[0]?.message?.content?.trim();
        if (!tripPlanText) {
          pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
          const prev = flowStack[flowStack.length - 1] || "idle";
          setFlowStep(prev);
          setFlowStack((stk) => stk.slice(0, -1));
          return;
        }

        // แสดงแผนแบบจัดรูป
        pushBot(tripPlanText, true);

        // ====== โหมดพรีวิว: เก็บทุกอย่างลง localStorage ======
        if (isPreviewOnly) {
          localStorage.removeItem("TripID");
          try { window.dispatchEvent(new Event("TripIDChanged")); } catch {}

          const activities = parseTripPlanTextToActivities(tripPlanText || "");

          localStorage.setItem(LOCAL_GUEST_TRIP_PLAN_TEXT, tripPlanText);
          localStorage.setItem(LOCAL_GUEST_ROUTE_DATA, JSON.stringify(routeData));
          localStorage.setItem(LOCAL_GUEST_ACTIVITIES, JSON.stringify(activities));

          const guestSPs = reconstructGuestShortestPaths(activities as GuestActivity[], routeData);
          localStorage.setItem(LOCAL_GUEST_SHORTEST_PATHS, JSON.stringify(guestSPs));

          const mergedMeta = {
            keyword,
            days,
            budget: budget ?? null,
            placeId: id,
            placeName: selectedPlace?.Name ?? keyword,
            prefs: { prefer: pref1, prefer2: pref2, prefer3: pref3 },
            time: new Date().toISOString(),
            guestCondition: {
              day: days.toString(),
              price: budget ?? 0,
              accommodation: "โรงแรม",
              landmark: selectedPlace?.Name || keyword,
              style: [pref1, pref2, pref3].filter(Boolean).join(",") || "ไม่ระบุ",
            },
          };
          localStorage.setItem(LOCAL_GUEST_META, JSON.stringify(mergedMeta));

          const prev = flowStack[flowStack.length - 1] || "idle";
          setFlowStep(prev);
          setFlowStack((stk) => stk.slice(0, -1));

          navigate("/guest/preview");
          return;
        }

        // ====== โหมดล็อกอิน: บันทึกลงระบบ ======
        const accIdStr = routeData.accommodation?.id ?? "";
        const accIdNum = parseInt(accIdStr.replace(/[^\d]/g, ""), 10);

        const newTrip: TripInterface = {
          Name: keyword,
          Types: "custom",
          Days: days,
          Con_id: lastConIdRef.current ?? 1,
          Acc_id: isFinite(accIdNum) ? accIdNum : 0,
        };

        const savedTrip = await CreateTrip(newTrip);
        localStorage.setItem("TripID", savedTrip.ID!.toString());
        try { window.dispatchEvent(new Event("TripIDChanged")); } catch {}

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
          if (!dayPlan) continue;

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

        const prev = flowStack[flowStack.length - 1] || "idle";
        setFlowStep(prev);
        setFlowStack((stk) => stk.slice(0, -1));
        startRedirectCountdown(5);
      } catch (error) {
        console.error("Error generating route or calling Groq", error);
        pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
        const prev = flowStack[flowStack.length - 1] || "idle";
        setFlowStep(prev);
        setFlowStack((stk) => stk.slice(0, -1));
      } finally {
        setLoading(false);
      }
    },
    [isPreviewOnly, navigate, selectedPlace?.Name, userIdNum, pref1, pref2, pref3, startRedirectCountdown, flowStep, flowStack]
  );

  // ===== Quick-pick วัน =====
  const handlePickDays = useCallback(
    async (days: number) => {
      if (!selectedPlace) {
        pushBot("กรุณาเลือกสถานที่ก่อนค่ะ");
        return;
      }

      // ยุบการ์ดวัน
      if (daysGroupRef.current) {
        const { promptId, quickId } = daysGroupRef.current;
        collapseQuickpickToChoice(quickId, `${days} วัน`, [promptId]);
        daysGroupRef.current = null;
      }

      setSelectedPlaceDays(days);

      // ถ้ายังไม่รู้ budget → ถามก่อน (ไม่บันทึก condition ที่นี่ เพื่อกันซ้ำ)
      if (selectedBudget == null) {
        pushBotBudgetPrompt();
        return;
      }

      // พร้อมสร้าง
      await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, days, selectedBudget ?? undefined);

      setAwaitingDays(false);
      setSelectedPlace(null);
      setSelectedPlaceDays(null);
    },
    [selectedPlace, selectedBudget, collapseQuickpickToChoice, generateRouteAndPlan]
  );

  // ===== Quick-pick งบ =====
  const handlePickBudget = useCallback(
    async (budget: number) => {
      // ยุบการ์ดงบ
      if (budgetGroupRef.current) {
        const { promptId, quickId } = budgetGroupRef.current;
        collapseQuickpickToChoice(quickId, `งบประมาณ ~ ${budget.toLocaleString()} บาท`, [promptId]);
        budgetGroupRef.current = null;
      }

      setSelectedBudget(budget);
      setAwaitingBudget(false);

      if (selectedPlace && selectedPlaceDays && selectedPlaceDays > 0) {
        // สร้างแผน (บันทึก condition แค่ตอน generateRouteAndPlan)
        await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, selectedPlaceDays, budget);

        setSelectedPlace(null);
        setSelectedPlaceDays(null);
        setAwaitingDays(false);
        return;
      }
    },
    [selectedPlace, selectedPlaceDays, collapseQuickpickToChoice, generateRouteAndPlan]
  );

  // ===== เลือกสถานที่จากการ์ดแนะนำ =====
  const handleSelectPlace = useCallback(
    async (place: LandmarkInterface) => {
      try {
        setSelectedPlace(place);
        setAwaitingUserSelection(false);

        // ยุบการ์ดแนะนำสถานที่
        if (recCardIdRef.current) {
          const idToRemove = recCardIdRef.current;
          setMessages((prev) => prev.filter((m) => m.id !== idToRemove));
          recCardIdRef.current = null;
        }

        // ถ้า user เคยกรอกวันไว้แล้ว
        if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
          if (selectedBudget == null) {
            pushBotBudgetPrompt();
            return;
          }
          await generateRouteAndPlan(place.ID!, place.Name!, selectedPlaceDays, selectedBudget ?? undefined);

          setSelectedPlace(null);
          setSelectedPlaceDays(null);
          setAwaitingDays(false);
        } else {
          const img = getPlaceImage(place);
          setFlowStack((stk) => [...stk, flowStep]);
          setFlowStep("chooseDays");
          setAwaitingDays(true);
          pushBotDaysPrompt(place.Name ?? "", img);
        }
      } catch (e) {
        console.error("Select place failed:", e);
        pushBot("เกิดข้อผิดพลาด กรุณาลองเลือกสถานที่อีกครั้งค่ะ");
      }
    },
    [generateRouteAndPlan, selectedPlaceDays, selectedBudget, flowStep]
  );

  // ===== Handler หลักของข้อความผู้ใช้ =====
  const handleUserMessage = useCallback(
    async (userText: string) => {
      pushUser(userText);
      const msg = userText.trim();

      // "ย้อนกลับ"
      if (isBackCmd(msg)) { handleBack(); return; }

      // "แนะนำ ..." / "แนะนำสถานที่"
      if (/^แนะนำ($|\s+)/.test(msg) || /^แนะนำสถานที่$/i.test(msg)) {
        const kw = msg.replace(/^แนะนำ\s*/, "");
        recommendPlaces(kw);
        return;
      }

      // งบประมาณด้วยการพิมพ์ตัวเลข
      if (awaitingBudget) {
        const b = parseBudgetToNumber(msg);
        if (b && b > 0) {
          await handlePickBudget(b);
        } else {
          pushBot("กรุณาพิมพ์งบประมาณเป็นตัวเลข เช่น 5000 หรือ 5,000 หรือ 5k ค่ะ");
        }
        return;
      }

      // เลือกสถานที่ขณะโชว์การ์ดแนะนำ
      if (awaitingUserSelection) {
        const byName = suggestedPlaces.find((p) => p.Name === msg);
        if (byName) {
          await handleSelectPlace(byName);
          return;
        }
        const idx = parseInt(msg, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < suggestedPlaces.length) {
          await handleSelectPlace(suggestedPlaces[idx]);
          return;
        }
        pushBot(`กรุณาเลือกจากการ์ด หรือพิมพ์เลขสถานที่ ที่ต้องการจาก (1–${suggestedPlaces.length})`);
        return;
      }

      // กรอกจำนวนวันด้วยการพิมพ์ตัวเลข
      if (awaitingDays) {
        const daysOnly = msg.replace(/[^\d]/g, "");
        const daysNum = parseInt(daysOnly, 10);

        if (!isNaN(daysNum) && daysNum > 0) {
          if (daysGroupRef.current) {
            const { promptId, quickId } = daysGroupRef.current;
            collapseQuickpickToChoice(quickId, `${daysNum} วัน`, [promptId]);
            daysGroupRef.current = null;
          }

          setSelectedPlaceDays(daysNum);
          if (selectedPlace) {
            if (selectedBudget == null) {
              pushBotBudgetPrompt();
              return;
            }
            await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, daysNum, selectedBudget ?? undefined);

            setAwaitingDays(false);
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

      // วิเคราะห์ข้อความ → แนะนำ/เลือกสถานที่
      const analysis = extractKeywordDaysBudgetAndTypes(msg);
      if (analysis?.keyword) {
        // reset state
        setAwaitingDays(false);
        setAwaitingUserSelection(false);
        setSelectedPlace(null);
        setSelectedPlaceDays(null);

        setPref1(analysis.prefer || "");
        setPref2(analysis.prefer2 || "");
        setPref3(analysis.prefer3 || "");

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
            placeNamesFromLLM.some((name) => (l.Name || "").includes(name))
          );

          if (matchedLandmarks.length > 1) {
            setFlowStack((stk) => [...stk, flowStep]);
            setFlowStep("choosePlace");

            setSuggestedPlaces(matchedLandmarks);
            setAwaitingUserSelection(true);

            if (typeof analysis.days === "number" && analysis.days > 0) {
              setSelectedPlaceDays(analysis.days);
            } else {
              setSelectedPlaceDays(null);
            }
            if (analysis.budget != null) setSelectedBudget(analysis.budget);

            pushRecommendations(matchedLandmarks, `แนะนำจากคำว่า "${analysis.keyword}"`);
            pushTip(['คลิกการ์ดสถานที่ที่ต้องการ', 'หรือพิมพ์หมายเลข 1–' + matchedLandmarks.length, 'พิมพ์ "ย้อนกลับ" เพื่อกลับขั้นตอนก่อนหน้า']);
            return;
          }

          if (matchedLandmarks.length === 1) {
            const matched = matchedLandmarks[0];
            setSelectedPlace(matched);

            if (typeof analysis.days === "number" && analysis.days > 0) {
              setSelectedPlaceDays(analysis.days);

              if (analysis.budget == null) {
                setAwaitingDays(false);
                pushBotBudgetPrompt();
                return;
              }

              await generateRouteAndPlan(matched.ID!, analysis.keyword, analysis.days, analysis.budget!);
            } else {
              pushBotDaysPrompt(matched.Name ?? "", getPlaceImage(matched));
              if (analysis.budget != null) setSelectedBudget(analysis.budget);
            }
            return;
          }

          // ไม่แมตช์เลย → แนะนำรวม
          recommendPlaces(analysis.keyword);
        } catch (error) {
          console.error(error);
          pushBot("เกิดข้อผิดพลาดในการค้นหาสถานที่ กรุณาลองใหม่");
        } finally {
          setLoading(false);
        }
        return;
      }

      // ไม่เข้าเงื่อนไขใด → แนะนำใช้งาน
      pushBot(
        'หากต้องการวางแผนทริป พิมพ์ว่า "อยากไป..." พร้อมจำนวนวัน และงบประมาณ (ถ้ามี) เช่น "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ และจุดชมวิว"\nหรือพิมพ์ "แนะนำ สยาม" เพื่อให้เสนอสถานที่ใกล้เคียง'
      );
    },
    [
      awaitingUserSelection,
      suggestedPlaces,
      selectedPlace,
      selectedPlaceDays,
      awaitingDays,
      landmarks,
      generateRouteAndPlan,
      awaitingBudget,
      handlePickBudget,
      selectedBudget,
      pref1,
      pref2,
      pref3,
      handleBack,
      collapseQuickpickToChoice,
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
    // คีย์ลัดย้อนกลับ (ไม่มีปุ่ม แต่พิมพ์ได้)
    if ((e.altKey || e.metaKey) && e.key === "ArrowLeft") {
      e.preventDefault();
      handleBack();
    }
  };

  // ===== Renderer =====
  return (
    <main className="trip-chat-main">
      <div className="trip-chat-titlebar">
        <h1 className="trip-chat-title">Chat with Your Assistant</h1>
      </div>

      {/* โซนสกอลล์รายการข้อความ */}
      <div className="trip-chat-scroll">
        {messages.map((m) => {
          const isUser = m.role === "user";

          // days-prompt
          if (m.role === "ai" && (m as any).kind === "days-prompt") {
            const dp = m as Extract<any, { kind: "days-prompt" }>;
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
            const dqp = m as Extract<any, { kind: "days-quickpick" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, textAlign: "center" }}>เลือกจำนวนวันที่ต้องการเดินทาง</div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(4, minmax(60px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {dqp.choices.map((d: number) => (
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
                      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>หรือพิมพ์จำนวนวันเป็นตัวเลข</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // budget-prompt  ✅ โชว์รูปสถานที่และชื่อ (ถ้ามี)
          if (m.role === "ai" && (m as any).kind === "budget-prompt") {
            const bp = m as Extract<any, { kind: "budget-prompt" }>;
            const img = getPlaceImage(selectedPlace || undefined);
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    {selectedPlace && (
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
                            height: 140,
                            backgroundImage: `url(${img || "/images/place-placeholder.jpg"})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundColor: "#f3f4f6",
                          }}
                          aria-label={selectedPlace.Name}
                          title={selectedPlace.Name}
                        />
                        <div style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>{selectedPlace.Name}</div>
                      </div>
                    )}
                    <div>{bp.text}</div>
                  </div>
                </div>
              </div>
            );
          }

          // budget-quickpick  ✅ โชว์รูปสถานที่และชื่อ (ถ้ามี)
          if (m.role === "ai" && (m as any).kind === "budget-quickpick") {
            const bqp = m as Extract<any, { kind: "budget-quickpick" }>;
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
                        {bqp.choices.map((b: number) => (
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

          // TIP
          if (m.role === "ai" && (m as any).kind === "tip") {
            const tip = m as Extract<any, { kind: "tip" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    {tip.title && <div style={{ fontWeight: 700, marginBottom: 6 }}>{tip.title}</div>}
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {tip.bullets.map((b: string, i: number) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          }

          // RECOMMENDATIONS  ✅ 2 คอลัมน์เสมอ
          if (m.role === "ai" && (m as any).kind === "recommendations") {
            const rec = m as Extract<any, { kind: "recommendations" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    {rec.title && <div style={{ fontWeight: 700, marginBottom: 10 }}>{rec.title}</div>}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(160px, 1fr))",
                        gap: 12,
                      }}
                    >
                      {rec.places.map((p: any, i: number) => (
                        <button
                          key={p.id || `${p.name}-${i}`}
                          type="button"
                          onClick={() => {
                            const found =
                              landmarks.find((l) => l.Name === p.name) ||
                              landmarks.find((l) => String((l as any).ID || l.Name) === p.id);
                            if (found) handleSelectPlace(found);
                            else pushBot(`ยังไม่พบข้อมูลของ "${p.name}" ในระบบ ลองพิมพ์ชื่อสถานที่ใหม่อีกครั้งนะคะ`);
                          }}
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
                          title={p.name}
                        >
                          <div
                            style={{
                              height: 110,
                              background: "#f3f4f6",
                              backgroundImage: p.image ? `url(${p.image})` : undefined,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                          <div style={{ padding: "8px 10px" }}>
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
                              {p.name}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // redirect-countdown card
          if (m.role === "ai" && (m as any).kind === "redirect-countdown") {
            const rc = m as Extract<any, { kind: "redirect-countdown" }>;
            const percent = Math.max(0, Math.min(100, Math.round(((rc.total - rc.seconds) / rc.total) * 100)));
            return (
              <div key={m.id} className="trip-chat-row">
                <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">Your Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, background: "#fff" }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{rc.text || "บันทึกทริปเรียบร้อยแล้ว"}</div>
                      <div style={{ color: "#374151", marginBottom: 10 }}>
                        จะพาคุณไปหน้า <b>My Trip</b> ใน <b>{rc.seconds}</b> วินาที
                      </div>
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

          // default renderer (ข้อความปกติ + choice)
          return (
            <div key={m.id} className={`trip-chat-row ${isUser ? "right" : ""}`}>
              {!isUser && <div className="trip-chat-avatar" style={{ backgroundImage: `url("${AVATAR_URL}")` }} />}

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
            placeholder='พิมพ์เช่น "อยากไปอารีย์ 2 วัน งบ 5000 เน้นชิวๆ และจุดชมวิว" (หรือพิมพ์ "แนะนำ สยาม")'
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
