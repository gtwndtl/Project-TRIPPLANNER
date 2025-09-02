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

// ====== User Id from localStorage (เหมือนโค้ดแรก) ======
import { useUserId } from "../../hooks/useUserId";
import type { UserInterface } from "../../interfaces/User";
import { Avatar } from "antd";
import { UserOutlined } from "@ant-design/icons";

// ===== util: ดึงรูปจากแลนด์มาร์ก =====
const getPlaceImage = (p?: Partial<LandmarkInterface> | null) =>
  (p as any)?.ThumbnailURL ||
  (p as any)?.CoverUrl ||
  (p as any)?.ImageUrl ||
  (p as any)?.Photos?.[0]?.Url ||
  "/images/place-placeholder.jpg";

// ฟังก์ชัน parse ข้อความแผนทริป LLM เป็น array กิจกรรม {day, startTime, endTime, description}
function parseTripPlanTextToActivities(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const activities: Array<{ day: number; startTime: string; endTime: string; description: string }> =
    [];
  let currentDay = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // รองรับ วันที่ 1**, ### วันที่ 1, วันที่ 1 **
    const dayMatch = line.match(/(?:#+\s*)?วันที่\s*(\d+)\**/i);
    if (dayMatch) {
      currentDay = parseInt(dayMatch[1], 10);
      continue;
    }

    if (currentDay === 0) continue;

    // เคส: "08:00 - 09:00 เช็คอินที่ ..."
    const timeDescInlineMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})\s+(.+)/);
    if (timeDescInlineMatch) {
      const [, startTime, endTime, description] = timeDescInlineMatch;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }

    // เคส: "08:00 - 09:00" + บรรทัดถัดไปเป็นคำอธิบาย
    const timeOnlyMatch = line.match(/^(\d{2}:\d{2})\s*[–\-]\s*(\d{2}:\d{2})$/);
    if (timeOnlyMatch && i + 1 < lines.length) {
      const startTime = timeOnlyMatch[1];
      const endTime = timeOnlyMatch[2];
      const description = lines[i + 1];
      activities.push({ day: currentDay, startTime, endTime, description });
      i++;
      continue;
    }

    // เคสพิเศษ: "20:00 เป็นต้นไป พักผ่อนที่ ..." → แปลงเป็น 20:00–21:00
    const singleLineSpecial = line.match(/^(\d{2}:\d{2})\s+(.+)/);
    if (singleLineSpecial) {
      const [_, startTime, description] = singleLineSpecial;
      const [h, m] = startTime.split(":").map(Number);
      const endH = Math.min(h + 1, 23);
      const endTime = `${endH.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }
  }

  return activities;
}

// ฟังก์ชันช่วยจัดรูปแบบข้อความแผนทริปให้อ่านง่าย (เหมือนโค้ดแรก)
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

const saveTripCondition = async (
  userId: number,
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

    const payload = {
      User_id: userId,
      Day: tripDetails.day.toString(),
      Price: tripDetails.price,
      Accommodation: tripDetails.accommodation,
      Landmark: tripDetails.landmark,
      Style: tripDetails.style,
    };

    const res = await CreateCondition(payload);
    console.log("[Condition] บันทึกเงื่อนไขทริปสำเร็จ:", res);
  } catch (error) {
    console.error("[Condition] เกิดข้อผิดพลาดในการบันทึกเงื่อนไขทริป", error);
  }
};

// ====== Message Types (เพิ่มชนิด days-prompt + days-quickpick) ======
type Msg =
  | { id: string; role: "ai" | "user"; text: string; isTripPlan?: false; kind?: "text" }
  | { id: string; role: "ai"; text: string; isTripPlan: true; kind?: "text" }
  | { id: string; role: "ai"; kind: "days-prompt"; placeName: string; image?: string; text: string }
  | { id: string; role: "ai"; kind: "days-quickpick"; choices: number[] };

const TripChat = () => {
  const userIdNum = useUserId();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<UserInterface | null>(null);
  const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: crypto.randomUUID(),
      role: "ai",
      text: 'สวัสดีค่ะ! ฉันช่วยวางแผนทริปให้คุณได้เลย ลองบอกมาว่าคุณอยากไปที่ไหน? เช่น "ฉันอยากไปวัดพระแก้ว 3 วัน"',
      kind: "text",
    },
  ]);

  const [suggestedPlaces, setSuggestedPlaces] = useState<LandmarkInterface[]>([]);
  const [awaitingUserSelection, setAwaitingUserSelection] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<LandmarkInterface | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [selectedPlaceDays, setSelectedPlaceDays] = useState<number | null>(null);
  const [awaitingDays, setAwaitingDays] = useState(false);
  const [lastSuggestKeyword, setLastSuggestKeyword] = useState<string>("");

  const suggestions = ["ฉันอยากไปสยาม 3 วัน", "ฉันอยากไปสาธร", "ฉันอยากไปไหนก็ไม่รู้"];

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
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
        const data = await GetUserById(userIdNum);
        setUser(data);
      } catch (e) {
        console.error("โหลดข้อมูลผู้ใช้ล้มเหลว", e);
      }
    };
    if (userIdNum) loadUser();
  }, [userIdNum]);

  const extractKeywordAndDays = (text: string) => {
    const match = text.match(/อยากไป(.*?)(\d+)\s*วัน/);
    if (match) {
      return { keyword: match[1].trim(), days: parseInt(match[2], 10) };
    }
    const match2 = text.match(/อยากไป\s*(.+)/);
    if (match2) {
      return { keyword: match2[1].trim(), days: null };
    }
    return null;
  };

  const pushBot = (text: string, isPlan = false) =>
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "ai", text, kind: "text", ...(isPlan ? { isTripPlan: true } : {}) } as Msg,
    ]);

  // แสดงรูป + ข้อความถามจำนวนวัน แล้วตามด้วยการ์ด Quickpick 1/3/5/7 วัน
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

  const pushUser = (text: string) =>
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text, kind: "text" }]);

  // ---------- Core: generateRouteAndPlan ----------
  const generateRouteAndPlan = useCallback(
    async (id: number, keyword: string, days: number) => {
      try {
        setLoading(true);
        pushBot(`กำลังสร้างแผนทริปสำหรับ "${keyword}" ${days} วัน...`);
        const routeData = await GetRouteFromAPI(id, days);
        const prompt = `
คุณคือผู้ช่วยวางแผนทริปท่องเที่ยวมืออาชีพ โปรดจัดแผนการเดินทางในกรุงเทพฯ เป็นเวลา ${days} วัน โดยเริ่มจาก "${routeData.start_name}"

ด้านล่างคือข้อมูลเส้นทางระหว่างสถานที่ (paths) และแผนรายวัน (trip_plan):
${JSON.stringify(routeData.paths, null, 2)}

${JSON.stringify(routeData.trip_plan_by_day, null, 2)}

กรุณาจัดแผนทริปให้ครบทั้ง ${days} วัน โดยมีรายละเอียดดังนี้:

- แบ่งแผนตามวัน เช่น “วันที่ 1”, “วันที่ 2” พร้อมระบุช่วงเวลา (เช่น 09:00–10:30) ให้เหมาะสมกับจำนวนกิจกรรมในแต่ละวัน
- ใช้ช่วงเวลาแต่ละกิจกรรมประมาณ 1.5–3 ชั่วโมง และจัดตามลำดับใน paths และ trip_plan
- เริ่มกิจกรรมแต่ละวันเวลาประมาณ 08:00
- ห้ามใช้คำว่า “เป็นต้นไป” ให้ระบุช่วงเวลาอย่างชัดเจนเท่านั้น เช่น 18:00–20.00
- วันแรกให้เริ่มต้นด้วยกิจกรรม “เช็คอินที่ <ชื่อที่พัก>” เวลา 08:00–09:00
- สิ้นสุดทุกวันด้วย “พักผ่อนที่ <ชื่อที่พัก>” ช่วงเย็น
- วันสุดท้ายให้ปิดท้ายด้วย “เช็คเอาท์และเดินทางกลับ” หลังจบกิจกรรมสุดท้าย และต้องมีเวลา เริ่มต้น - จบ เสมอ เช่น 19:00-20:00
- ห้ามใช้รหัสสถานที่ (เช่น P123, R99, A1) ในคำอธิบาย
- เขียนคำอธิบายกิจกรรมตามประเภท:
  - P = สถานที่ท่องเที่ยว เช่น "เที่ยวชม...", "เดินเล่นที่...", "ถ่ายรูปที่..."
  - R = ร้านอาหาร เช่น "รับประทานอาหารกลางวันที่...", "แวะชิมของว่างที่..."
  - A = ที่พัก เช่น "เช็คอินที่...",หลังวันแรก "พักผ่อนที่...", "เช็คเอาท์และเดินทางกลับ"
- หากมีสถานที่ซ้ำในหลายวัน ให้ปรับคำอธิบายกิจกรรมให้หลากหลาย ไม่ซ้ำซาก
- ใช้ภาษาสุภาพ กระชับ อ่านง่าย และจัดรูปแบบให้อ่านสบาย มีการเว้นบรรทัดอย่างเหมาะสม
`;

        const groqRes = await PostGroq(prompt);
        const tripPlanText = groqRes?.choices?.[0]?.message?.content?.trim();
        if (!tripPlanText) {
          pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
          return;
        }

        // แสดงแผนแบบจัดรูป (formatTripPlanText)
        pushBot(tripPlanText, true);

        // ====== CreateCondition ======
        const conditionPayload = {
          User_id: userIdNum,
          Day: days.toString(),
          Price: 5000,
          Accommodation: "โรงแรม",
          Landmark: keyword,
          Style: "ชิวๆ",
        };

        let conIdFromCreate = 1; // fallback
        try {
          const conRes = await CreateCondition(conditionPayload);
          if (conRes?.ID) conIdFromCreate = conRes.ID;
        } catch (err) {
          console.error("[Condition] create failed, using default Con_id=1", err);
        }

        // ====== CreateTrip ======
        const accIdStr = routeData.accommodation?.id ?? "";
        const accIdNum = parseInt(accIdStr.replace(/[^\d]/g, ""), 10);

        const newTrip: TripInterface = {
          Name: keyword,
          Types: "custom",
          Days: days,
          Con_id: conIdFromCreate,
          Acc_id: accIdNum,
        };

        const savedTrip = await CreateTrip(newTrip);
        // pushBot(`บันทึกทริปสำเร็จ! (ID: ${savedTrip.ID})`);
        localStorage.setItem("TripID", savedTrip.ID!.toString());

        // ====== Save shortest paths ======
        const activities = parseTripPlanTextToActivities(tripPlanText || "");
        let PathIndex = 1;
        const dayPlanIndices: { [day: number]: number } = {};

        for (const act of activities) {
          if (!routeData.trip_plan_by_day || !Array.isArray(routeData.trip_plan_by_day)) {
            console.error(
              "routeData.trip_plan_by_day is missing or not an array:",
              routeData.trip_plan_by_day
            );
            pushBot("เกิดข้อผิดพลาดในการดึงข้อมูลแผนทริป กรุณาลองใหม่");
            return;
          }

          const dayPlan = routeData.trip_plan_by_day.find((d: { day: number }) => d.day === act.day);
          if (!dayPlan) {
            console.warn(`ไม่พบแผนสำหรับวัน ${act.day}`);
            continue;
          }

          const accommodationCode = routeData.accommodation?.id || "A1";
          const currentIndex = dayPlanIndices[act.day] ?? 0;

          let fromCode = "";
          let toCode = "";

          if (/เช็คอิน/.test(act.description)) {
            fromCode = accommodationCode;
            toCode = accommodationCode;
          } else if (/เช็คเอาท์/.test(act.description)) {
            if (dayPlan.plan && dayPlan.plan.length > 0) {
              fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
            } else {
              fromCode = accommodationCode;
            }
            toCode = accommodationCode;
          } else if (/พักผ่อน/.test(act.description)) {
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

          const path = routeData.paths.find(
            (p: { from: string; to: string }) =>
              (p.from === fromCode && p.to === toCode) || (p.from === toCode && p.to === fromCode)
          );
          const distance = path ? path.distance_km : 0;

          const shortestPathData: ShortestpathInterface = {
            TripID: savedTrip.ID,
            Day: act.day,
            PathIndex: PathIndex++,
            FromCode: fromCode,
            ToCode: toCode,
            Type: "Activity",
            Distance: parseFloat(distance.toString()),
            ActivityDescription: act.description,
            StartTime: act.startTime,
            EndTime: act.endTime,
          };

          try {
            await CreateShortestPath(shortestPathData);
          } catch (e) {
            console.error("Save shortest-path failed:", e);
          }

          if (!/เช็คอิน|เช็คเอาท์/.test(act.description)) {
            if (currentIndex + 1 < (dayPlan.plan?.length || 0)) {
              dayPlanIndices[act.day] = currentIndex + 1;
            }
          }
        }
      } catch (error) {
        console.error("Error generating route or calling Groq", error);
        pushBot("ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง");
      } finally {
        setLoading(false);
      }
    },
    [userIdNum]
  );

  // คลิก quick-pick วัน
  const handlePickDays = useCallback(
    async (days: number) => {
      if (!selectedPlace) {
        pushBot("กรุณาเลือกสถานที่ก่อนค่ะ");
        return;
      }
      setSelectedPlaceDays(days);

      // บันทึกเงื่อนไขก่อน
      const tripDetails = {
        day: days.toString(),
        price: 5000,
        accommodation: "โรงแรม",
        landmark: selectedPlace.Name || "",
        style: "ชิวๆ",
      };
      await saveTripCondition(userIdNum, tripDetails);

      // สร้างเส้นทางและแผนทริป
      await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, days);

      // เคลียร์สถานะ
      setAwaitingDays(false);
      setAwaitingConfirm(false);
      setSelectedPlace(null);
      setSelectedPlaceDays(null);
    },
    [selectedPlace, userIdNum, generateRouteAndPlan]
  );

  // ===== เลือกสถานที่ด้วยการ "คลิกการ์ด" =====
  const handleSelectPlace = useCallback(
    async (place: LandmarkInterface) => {
      try {
        setSelectedPlace(place);
        setAwaitingUserSelection(false);

        // ถ้ารู้จำนวนวันแล้ว → บันทึกเงื่อนไข + สร้างแผน
        if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
          const tripDetails = {
            day: selectedPlaceDays.toString(),
            price: 5000,
            accommodation: "โรงแรม",
            landmark: place.Name || "",
            style: "ชิวๆ",
          };
          await saveTripCondition(userIdNum, tripDetails);
          await generateRouteAndPlan(place.ID!, place.Name!, selectedPlaceDays);

          setAwaitingConfirm(false);
          setSelectedPlace(null);
          setSelectedPlaceDays(null);
          setAwaitingDays(false);
        } else {
          // ยังไม่รู้จำนวนวัน → แสดง "รูป + คำถามจำนวนวัน" + Quickpick
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
    [generateRouteAndPlan, selectedPlaceDays, userIdNum]
  );

  const handleUserMessage = useCallback(
    async (userText: string) => {
      pushUser(userText);
      const msg = userText.trim();

      // 1) รอเลือกสถานที่จาก list
      if (awaitingUserSelection) {
        const byName = suggestedPlaces.find((p) => p.Name === msg);
        if (byName) {
          setSelectedPlace(byName);
          setAwaitingUserSelection(false);
          if (selectedPlaceDays !== null && selectedPlaceDays > 0) {
            const tripDetails = {
              day: selectedPlaceDays.toString(),
              price: 5000,
              accommodation: "โรงแรม",
              landmark: byName?.Name || "",
              style: "ชิวๆ",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(byName.ID!, byName.Name!, selectedPlaceDays);

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
              const tripDetails = {
                day: selectedPlaceDays.toString(),
                price: 5000,
                accommodation: "โรงแรม",
                landmark: place?.Name || "",
                style: "ชิวๆ",
              };
              await saveTripCondition(userIdNum, tripDetails);
              await generateRouteAndPlan(place.ID!, place.Name!, selectedPlaceDays);

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

      // 2) รอยืนยันเลือกสถานที่ (คง flow เดิม ถ้าเคยใช้)
      if (awaitingConfirm) {
        const norm = msg.toLowerCase();
        if (norm.startsWith("ใช่")) {
          if (selectedPlace && selectedPlaceDays !== null) {
            const tripDetails = {
              day: selectedPlaceDays.toString(),
              price: 5000,
              accommodation: "โรงแรม",
              landmark: selectedPlace?.Name || "",
              style: "ชิวๆ",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, selectedPlaceDays);

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

      // 3) รอจำนวนวัน (กรณีพิมพ์ตัวเลขแทนกดการ์ด)
      if (awaitingDays) {
        const daysOnly = msg.replace(/[^\d]/g, "");
        const daysNum = parseInt(daysOnly, 10);

        if (!isNaN(daysNum) && daysNum > 0) {
          setSelectedPlaceDays(daysNum);
          if (selectedPlace) {
            const tripDetails = {
              day: daysNum.toString(),
              price: 5000,
              accommodation: "โรงแรม",
              landmark: selectedPlace.Name || "",
              style: "ชิวๆ",
            };
            await saveTripCondition(userIdNum, tripDetails);
            await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, daysNum);

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

      // 4) วิเคราะห์ข้อความปกติ → เรียก LLM เพื่อแนะนำสถานที่ในระบบ
      const analysis = extractKeywordAndDays(msg);
      if (analysis?.keyword) {
        setAwaitingDays(false);
        setAwaitingConfirm(false);
        setAwaitingUserSelection(false);
        setSelectedPlace(null);
        setSelectedPlaceDays(null);

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
            return;
          }

          if (matchedLandmarks.length === 1) {
            const matched = matchedLandmarks[0];
            setSelectedPlace(matched);
            if (typeof analysis.days === "number" && analysis.days > 0) {
              setSelectedPlaceDays(analysis.days);

              const tripDetails = {
                day: analysis.days.toString(),
                price: 5000,
                accommodation: "โรงแรม",
                landmark: matched.Name || "",
                style: "ชิวๆ",
              };
              await saveTripCondition(userIdNum, tripDetails);
              await generateRouteAndPlan(matched.ID!, analysis.keyword, analysis.days);
            } else {
              setAwaitingDays(true);
              pushBotDaysPrompt(matched.Name ?? "", getPlaceImage(matched));
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

      // 5) อื่นๆ
      pushBot('ขอบคุณสำหรับข้อความค่ะ หากต้องการวางแผนทริป พิมพ์ว่า "ฉันอยากไป..." พร้อมจำนวนวัน');
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
        {/* Avatar AI */}
        <div
          className="trip-chat-avatar"
          style={{
            backgroundImage:
              'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE")',
          }}
        />
        <div className="trip-chat-bubble-group left">
          <p className="trip-chat-author">AI Assistant</p>
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
        <h1 className="trip-chat-title">Chat with AI</h1>
      </div>

      {/* โซนสกอลล์รายการข้อความ */}
      <div className="trip-chat-scroll">
        {messages.map((m) => {
          const isUser = m.role === "user";

          // ===== renderer ใหม่สำหรับ days-prompt (รูป+ข้อความถามจำนวนวัน) =====
          if (m.role === "ai" && (m as any).kind === "days-prompt") {
            const dp = m as Extract<Msg, { kind: "days-prompt" }>;
            return (
              <div key={m.id} className={`trip-chat-row ${isUser ? "right" : ""}`}>
                {!isUser && (
                  <div
                    className="trip-chat-avatar"
                    style={{
                      backgroundImage:
                        'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE")',
                    }}
                  />
                )}
                <div className={`trip-chat-bubble-group ${isUser ? "right" : "left"}`}>
                  <p className={`trip-chat-author ${isUser ? "right" : ""}`}>AI Assistant</p>
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

          // ===== renderer สำหรับการ์ด Quickpick จำนวนวัน =====
          if (m.role === "ai" && (m as any).kind === "days-quickpick") {
            const dqp = m as Extract<Msg, { kind: "days-quickpick" }>;
            return (
              <div key={m.id} className="trip-chat-row">
                <div
                  className="trip-chat-avatar"
                  style={{
                    backgroundImage:
                      'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE")',
                  }}
                />
                <div className="trip-chat-bubble-group left">
                  <p className="trip-chat-author">AI Assistant</p>
                  <div className="trip-chat-bubble ai">
                    <div
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 10,
                        padding: 12,
                        background: "#fff",
                      }}
                    >
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
                              border: "1px solid #d1d5db",
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

          // ===== renderer เดิมสำหรับข้อความทั่วไป/แผนทริป =====
          return (
            <div key={m.id} className={`trip-chat-row ${isUser ? "right" : ""}`}>
              {!isUser && (
                <div
                  className="trip-chat-avatar"
                  style={{
                    backgroundImage:
                      'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE")',
                  }}
                />
              )}

              <div className={`trip-chat-bubble-group ${isUser ? "right" : "left"}`}>
                <p className={`trip-chat-author ${isUser ? "right" : ""}`}>
                  {isUser ? (user?.Firstname ?? "You") : "AI Assistant"}
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
                  <Avatar
                    size={40}
                    icon={<UserOutlined />}
                    style={{ backgroundColor: "#fde3cf", color: "#f56a00" }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* การ์ดรูปสถานที่สำหรับเลือก */}
        {renderPlaceCards()}

        {loading && (
          <div className="trip-chat-row">
            {/* Avatar AI */}
            <div
              className="trip-chat-avatar"
              style={{
                backgroundImage:
                  'url("https://lh3.googleusercontent.com/aida-public/AB6AXuBIjnYTrzokvvU5de3TEWGfw-agnUCZ2-VIE54Pb0F4q-QwJA5mEvlXu2ErhvgtLN9t4Un4HopdtVlw_TWXw0tdOOiqJ6uqBstG3CvtddEwjWLkxiMCwl8jo6872bXiBeMf1kZZYRC4uS-ZSUCFz65eRaCMtiZ-zPN891z-ggZxtauPNeo2938BZmwJnYZ-Jgc-9HI5SJeQeR3rrAPE713E61VFK8y0sFN038hCtInQYQt1GmEYxyDaR8YmSlUlIOsp9lP9-FYZODE")',
              }}
            />

            <div className="trip-chat-bubble-group left">
              <p className="trip-chat-author">AI Assistant</p>
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

      {/* Composer ติดล่าง */}
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
          <Avatar
            size={40}
            icon={<UserOutlined />}
            style={{ backgroundColor: "#fde3cf", color: "#f56a00" }}
          />
        </div>
        <div className="trip-chat-inputwrap">
          <input
            className="trip-chat-input"
            placeholder="Type your message..."
            aria-label="Type your message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />

          {/* ปุ่มส่งข้อความ (paper plane) */}
          <button
            type="button"
            className="trip-chat-inputbtn"
            aria-label="Send message"
            onClick={handleSend}
            title="Send"
            disabled={loading}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 256 256"
              aria-hidden="true"
            >
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
