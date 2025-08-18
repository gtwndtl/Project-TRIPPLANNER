import './chat.css';
import { Input, Button, Tag } from 'antd';
import { useState, useRef, useEffect } from 'react';
import type { LandmarkInterface } from '../../interfaces/Landmark';
import type { TripInterface } from '../../interfaces/Trips';
import type { ShortestpathInterface } from '../../interfaces/Shortestpath';
import {
  GetAllLandmarks,
  GetRouteFromAPI,
  PostGroq,
  CreateTrip,
  CreateShortestPath,
  CreateCondition,
} from '../../services/https';
import { PlusCircleOutlined } from '@ant-design/icons';

// ดึง User_id จาก localStorage (เก็บเป็น number)
const userIdStr = localStorage.getItem('user_id');
const userIdNum = userIdStr ? parseInt(userIdStr, 10) : 0;

// ฟังก์ชัน parse ข้อความแผนทริป LLM เป็น array กิจกรรม {day, startTime, endTime, description}
function parseTripPlanTextToActivities(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const activities: Array<{ day: number; startTime: string; endTime: string; description: string }> = [];
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
      const [h, m] = startTime.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      const endTime = `${endH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      activities.push({ day: currentDay, startTime, endTime, description });
      continue;
    }
  }

  console.log('✅ parsed activities:', activities);
  return activities;
}

// ฟังก์ชันช่วยจัดรูปแบบข้อความแผนทริปให้อ่านง่าย
const formatTripPlanText = (text: string) => {
  const lines = text.split('\n');

  return lines.map((line, i) => {
    const trimmed = line.trim();

    if (trimmed === '') return <br key={'br' + i} />;

    if (/^\*\*\s*วันที่/.test(trimmed)) {
      return (
        <h4 key={'day' + i} style={{ marginTop: 20, marginBottom: 10, color: '#333' }}>
          {trimmed.replace(/^\*\*\s*/, '')}
        </h4>
      );
    }

    if (/^\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(trimmed)) {
      const times = trimmed.match(/^(\d{2}:\d{2})[–-](\d{2}:\d{2})/);
      if (!times) return trimmed;

      const start = times[1];
      const end = times[2];

      return (
        <div key={'time' + i} style={{ marginTop: 6, marginBottom: 4 }}>
          <b>
            {start} - {end}
          </b>
          <br />
          <span>{trimmed.replace(/^\d{2}:\d{2}[–-]\d{2}:\d{2}\s*/, '')}</span>
        </div>
      );
    }

    return <p key={'p' + i}>{trimmed}</p>;
  });
};

const Chat = () => {
  const [suggestedPlaces, setSuggestedPlaces] = useState<LandmarkInterface[]>([]);
  const [awaitingUserSelection, setAwaitingUserSelection] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<LandmarkInterface | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<
    { text: string; sender: 'user' | 'bot'; data?: any; isTripPlan?: boolean }[]
  >([
    {
      text:
        'สวัสดีค่ะ! ฉันช่วยวางแผนทริปให้คุณได้เลย ลองบอกมาว่าคุณอยากไปที่ไหน? เช่น "ฉันอยากไปวัดพระแก้ว 3 วัน"',
      sender: 'bot',
    },
  ]);
  const [landmarks, setLandmarks] = useState<LandmarkInterface[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchLandmarks = async () => {
      try {
        const data = await GetAllLandmarks();
        setLandmarks(data);
      } catch (error) {
        console.error('โหลดข้อมูล landmark ล้มเหลว', error);
        setMessages((prev) => [
          ...prev,
          { text: 'ขออภัยเกิดข้อผิดพลาดในการดึงข้อมูลสถานที่ กรุณาลองใหม่ภายหลัง', sender: 'bot' },
        ]);
      }
    };
    fetchLandmarks();
  }, []);

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

  // ฟังก์ชันบันทึก Condition (ไม่รับ userId เป็นพารามิเตอร์ ใช้ userIdNum จากด้านบน)
// แทนที่ฟังก์ชันเดิมทั้งก้อนด้วยอันนี้
// แทนที่ฟังก์ชันเดิมทั้งก้อนด้วยอันนี้
const saveTripCondition = async (
  userId: number,
  tripDetails?: {
    day: string | number;
    price: number;
    accommodation: string;
    landmark: string;
    style: string;
  }
) => {
  try {
    // กันพังกรณีโดนเรียกโดยไม่ได้ส่ง tripDetails มา
    if (!tripDetails) {
      console.warn('[Condition] tripDetails is undefined. Skip creating condition.');
      return;
    }
    if (tripDetails.day === undefined || tripDetails.day === null) {
      console.warn('[Condition] tripDetails.day is missing. Skip creating condition.');
      return;
    }

    // แปลง Day เป็น string ให้ตรง ConditionInterface
    const payload = {
      User_id: userId,
      Day: tripDetails.day.toString(),          // <- สำคัญ: เป็น string ตาม interface
      Price: tripDetails.price,
      Accommodation: tripDetails.accommodation,
      Landmark: tripDetails.landmark,
      Style: tripDetails.style,
    };

    console.log('[Condition] ส่งข้อมูล Condition:', payload);
    const res = await CreateCondition(payload);
    console.log('[Condition] บันทึกเงื่อนไขทริปสำเร็จ:', res);
    // ไม่ return อะไรเพิ่ม เพื่อไม่กระทบโค้ดส่วนอื่น
  } catch (error) {
    console.error('[Condition] เกิดข้อผิดพลาดในการบันทึกเงื่อนไขทริป', error);
    // ไม่ throw เพื่อไม่ให้ flow อื่นล้ม
  }
};




  const generateRouteAndPlan = async (id: number, keyword: string, days: number) => {
    try {
      setLoading(true);
      setMessages((prev) => [...prev, { text: `กำลังสร้างแผนทริปสำหรับ "${keyword}"...`, sender: 'bot' }]);

      const routeData = await GetRouteFromAPI(id, days);
      console.log('GetRouteFromAPI ได้ข้อมูล:', routeData);

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
        setMessages((prev) => [
          ...prev,
          { text: 'ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง', sender: 'bot' },
        ]);
      }

      setMessages((prev) => [...prev, { text: tripPlanText, sender: 'bot', isTripPlan: true }]);
      const accIdStr = routeData.accommodation?.id ?? '';
      const accIdNum = parseInt(accIdStr.replace(/[^\d]/g, ''), 10);

const conditionPayload = {
  User_id: userIdNum,
  Day: days.toString(),           // ให้เป็น string ตาม ConditionInterface
  Price: 5000,                    // TODO: เอาจาก UI หรือค่าที่ต้องการ
  Accommodation: 'โรงแรม',         // TODO: เอาจาก UI หรือค่าที่ต้องการ
  Landmark: keyword,
  Style: 'ชิวๆ',                  // TODO: เอาจาก UI หรือค่าที่ต้องการ
};

console.log('[Condition] POST payload:', conditionPayload);
let conIdFromCreate = 1; // fallback
try {
  const conRes = await CreateCondition(conditionPayload);
  console.log('[Condition] create success:', conRes);
  if (conRes?.ID) {
    conIdFromCreate = conRes.ID; // ใช้ Con_id ที่ได้จาก backend
  }
} catch (err) {
  console.error('[Condition] create failed, using default Con_id=1', err);
}
      // บันทึก Trip
      const newTrip: TripInterface = {
        Name: keyword,
        Types: 'custom',
        Days: days,
        Con_id: conIdFromCreate,
        Acc_id: accIdNum,
      };
      console.log('Payload to create trip:', newTrip);
      console.log('routeData.accommodation?.id:', routeData.accommodation?.id);

      const savedTrip = await CreateTrip(newTrip);
      console.log('บันทึก Trip สำเร็จ:', savedTrip);
      setMessages((prev) => [...prev, { text: `บันทึกทริปสำเร็จ! (ID: ${savedTrip.ID})`, sender: 'bot' }]);
      localStorage.setItem('TripID', savedTrip.ID!.toString());

      // แปลงข้อความแผนทริปเป็นกิจกรรม
      const activities = parseTripPlanTextToActivities(tripPlanText || '');
      console.log('parsed activities:', activities);

      let PathIndex = 1;

      // เก็บดัชนีการเดินในแต่ละวัน เพื่อ map FromCode/ToCode
      const dayPlanIndices: { [day: number]: number } = {};

      for (const act of activities) {
        // หาแผนของวันนั้น
        if (!routeData.trip_plan_by_day || !Array.isArray(routeData.trip_plan_by_day)) {
          console.error('routeData.trip_plan_by_day is missing or not an array:', routeData.trip_plan_by_day);
          setMessages((prev) => [...prev, { text: 'เกิดข้อผิดพลาดในการดึงข้อมูลแผนทริป กรุณาลองใหม่', sender: 'bot' }]);
          return;
        }

        const dayPlan = routeData.trip_plan_by_day.find((d: { day: number }) => d.day === act.day);
        if (!dayPlan) {
          console.warn(`ไม่พบแผนสำหรับวัน ${act.day}`);
          continue;
        }

        const accommodationCode = routeData.accommodation?.id || 'A1';

        const currentIndex = dayPlanIndices[act.day] ?? 0;

        let fromCode = '';
        let toCode = '';
        console.log(`วัน ${act.day}: currentIndex=${currentIndex}, plan.length=${dayPlan.plan?.length}`);

        if (/เช็คอิน/.test(act.description)) {
          // เริ่มวัน: from/to = ที่พัก
          fromCode = accommodationCode;
          toCode = accommodationCode;
        } else if (/เช็คเอาท์/.test(act.description)) {
          // จบวันสุดท้าย: from = จุดสุดท้ายของวัน, to = ที่พัก
          if (dayPlan.plan && dayPlan.plan.length > 0) {
            fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
          } else {
            fromCode = accommodationCode;
          }
          toCode = accommodationCode;
        } else if (/พักผ่อน/.test(act.description)) {
          // พักผ่อน: from = จุดสุดท้ายของวัน, to = ที่พัก
          if (dayPlan.plan && dayPlan.plan.length > 0) {
            fromCode = dayPlan.plan[dayPlan.plan.length - 1].id;
          } else {
            fromCode = accommodationCode;
          }
          toCode = accommodationCode;
        } else {
          // กิจกรรมระหว่างวัน
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

        // หา distance จาก routeData.paths
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
          Type: 'Activity',
          Distance: parseFloat(distance.toString()),
          ActivityDescription: act.description,
          StartTime: act.startTime,
          EndTime: act.endTime,
        };

        try {
          console.log('ส่งข้อมูลไป shortest-paths:', JSON.stringify(shortestPathData, null, 2));
          const res = await CreateShortestPath(shortestPathData);
          console.log('Test save success:', res);
        } catch (e) {
          console.error('Test save fail:', e);
        }

        if (!/เช็คอิน|เช็คเอาท์/.test(act.description)) {
          if (currentIndex + 1 < dayPlan.plan.length) {
            dayPlanIndices[act.day] = currentIndex + 1;
          } else {
            console.log(`วัน ${act.day}: currentIndex ถึงขีดจำกัดแล้ว (${currentIndex + 1} >= ${dayPlan.plan.length})`);
          }
        }
      }
    } catch (error) {
      console.error('Error generating route or calling Groq', error);
      setMessages((prev) => [
        ...prev,
        { text: 'ขออภัย เกิดข้อผิดพลาดระหว่างการสร้างแผนทริป กรุณาลองใหม่ภายหลัง', sender: 'bot' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const [selectedPlaceDays, setSelectedPlaceDays] = useState<number | null>(null);
  const [awaitingDays, setAwaitingDays] = useState(false);

  const handleUserMessage = async (userMessage: string) => {
    setMessages((prev) => [...prev, { text: userMessage, sender: 'user' }]);
    const msg = userMessage.trim();

    // กรณีรอเลือกสถานที่จาก list
    if (awaitingUserSelection) {
      const matched = suggestedPlaces.find((p) => p.Name === msg);
      if (matched) {
        setSelectedPlace(matched);
        setAwaitingConfirm(true);
        setAwaitingUserSelection(false);
        setMessages((prev) => [
          ...prev,
          { text: `คุณต้องการเลือกสถานที่ "${matched.Name}" ใช่ไหมคะ? (ตอบ ใช่ / ไม่)`, sender: 'bot' },
        ]);
      } else {
        const idx = parseInt(msg, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < suggestedPlaces.length) {
          const place = suggestedPlaces[idx];
          setSelectedPlace(place);
          setAwaitingConfirm(true);
          setAwaitingUserSelection(false);
          setMessages((prev) => [
            ...prev,
            { text: `คุณต้องการเลือกสถานที่ "${place.Name}" ใช่ไหมคะ? (ตอบ ใช่ / ไม่)`, sender: 'bot' },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              text: `กรุณาพิมพ์ชื่อสถานที่ที่ต้องการ หรือพิมพ์เลขที่ถูกต้องจากรายการ เช่น 1 ถึง ${suggestedPlaces.length}`,
              sender: 'bot',
            },
          ]);
        }
      }
      return;
    }

    // กรณีรอ confirm สถานที่
    if (awaitingConfirm) {
      const normalizedMsg = msg.toLowerCase().trim();
      if (normalizedMsg.startsWith('ใช่')) {
        if (selectedPlace && selectedPlaceDays !== null) {
          // ✅ สร้าง Condition ก่อน
          const tripDetails = {
            day: selectedPlaceDays.toString(),
            price: 5000, // TODO: ปรับตาม UI/อินพุตจริง
            accommodation: 'โรงแรม', // TODO: ปรับตามการเลือกจริง
            landmark: selectedPlace?.Name || '',
            style: 'ชิวๆ', // TODO: ปรับตามการเลือกจริง
          };
          await saveTripCondition(userIdNum, tripDetails);

          // ✅ ไปสร้างเส้นทางและแผนทริปต่อทันที
          await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, selectedPlaceDays);

          // ✅ เคลียร์สถานะ
          setAwaitingConfirm(false);
          setSelectedPlace(null);
          setSelectedPlaceDays(null);
          setAwaitingDays(false);
        } else {
          // ยังไม่มีจำนวนวัน → ขอจำนวนวันต่อ
          setAwaitingConfirm(false);
          setAwaitingDays(true);
          setMessages((prev) => [
            ...prev,
            { text: `คุณต้องการไป "${selectedPlace?.Name}" กี่วันคะ? กรุณาพิมพ์จำนวนวันเป็นตัวเลข`, sender: 'bot' },
          ]);
        }
        return;
      } else if (normalizedMsg.startsWith('ไม่')) {
        setMessages((prev) => [...prev, { text: 'โอเคค่ะ กรุณาพิมพ์คำค้นใหม่อีกครั้งนะคะ', sender: 'bot' }]);
        setAwaitingConfirm(false);
        setSelectedPlace(null);
        setSelectedPlaceDays(null);
      } else {
        setMessages((prev) => [...prev, { text: 'กรุณาตอบ "ใช่" หรือ "ไม่" ค่ะ', sender: 'bot' }]);
      }
      return;
    }

    // กรณีรอจำนวนวัน
    if (awaitingDays) {
      const daysOnly = msg.replace(/[^\d]/g, '');
      const daysNum = parseInt(daysOnly, 10);

      if (!isNaN(daysNum) && daysNum > 0) {
        setSelectedPlaceDays(daysNum);
        if (selectedPlace) {
          // ✅ สร้าง Condition ก่อน
          const tripDetails = {
            day: daysNum.toString(),
            price: 5000, // TODO: ปรับตาม UI/อินพุตจริง
            accommodation: 'โรงแรม', // TODO: ปรับตามการเลือกจริง
            landmark: selectedPlace.Name || '',
            style: 'ชิวๆ', // TODO: ปรับตามการเลือกจริง
          };
          await saveTripCondition(userIdNum, tripDetails);


          // ✅ ไปสร้างเส้นทางและแผนทริปต่อ
          await generateRouteAndPlan(selectedPlace.ID!, selectedPlace.Name!, daysNum);

          setAwaitingDays(false);
          setAwaitingConfirm(false);
          setSelectedPlace(null);
          setSelectedPlaceDays(null);
        } else {
          setMessages((prev) => [
            ...prev,
            { text: 'เกิดข้อผิดพลาด กรุณาเลือกสถานที่ใหม่อีกครั้ง', sender: 'bot' },
          ]);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          { text: 'กรุณาพิมพ์จำนวนวันเป็นตัวเลขที่ถูกต้องค่ะ', sender: 'bot' },
        ]);
      }
      return;
    }

    // กรณีข้อความปกติ
    const analysis = extractKeywordAndDays(msg);

    if (analysis?.keyword) {
      setAwaitingDays(false);
      setAwaitingConfirm(false);
      setAwaitingUserSelection(false);
      setSelectedPlace(null);
      setSelectedPlaceDays(null);

      try {
        setLoading(true);
        const landmarkNames = landmarks.map((l) => l.Name).join(', ');
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
          console.error('แปลง JSON ผิดพลาด:', e);
        }

        const matchedLandmarks = landmarks.filter((l) =>
          placeNamesFromLLM.some((name) => l.Name?.includes(name))
        );

        if (matchedLandmarks.length > 1) {
          setSuggestedPlaces(matchedLandmarks);
          setAwaitingUserSelection(true);
          if (typeof analysis.days === 'number' && analysis.days > 0) {
            setSelectedPlaceDays(analysis.days);
          } else {
            setSelectedPlaceDays(null);
          }
          setMessages((prev) => [
            ...prev,
            {
              text: `จาก "${analysis.keyword}" เราพบสถานที่ใกล้เคียงดังนี้:\n${matchedLandmarks
                .map((l, i) => `${i + 1}. ${l.Name}`)
                .join('\n')}\nกรุณาพิมพ์เลขที่สถานที่ที่คุณต้องการเลือกค่ะ`,
              sender: 'bot',
            },
          ]);
          return;
        }

        if (matchedLandmarks.length === 1) {
          const matched = matchedLandmarks[0];
          setSelectedPlace(matched);
          if (typeof analysis.days === 'number' && analysis.days > 0) {
            setSelectedPlaceDays(analysis.days);

            // ✅ สร้าง Condition ก่อน
            const tripDetails = {
              day: analysis.days.toString(),
              price: 5000, // TODO: ปรับตาม UI/อินพุตจริง
              accommodation: 'โรงแรม', // TODO: ปรับตามการเลือกจริง
              landmark: matched.Name || '',
              style: 'ชิวๆ', // TODO: ปรับตามการเลือกจริง
            };
            await saveTripCondition(userIdNum, tripDetails);


            // ✅ ไปสร้างเส้นทางและแผนทริป
            await generateRouteAndPlan(matched.ID!, analysis.keyword, analysis.days);
          } else {
            setAwaitingDays(true);
            setMessages((prev) => [
              ...prev,
              { text: `คุณต้องการไป "${matched.Name}" กี่วันคะ? กรุณาพิมพ์จำนวนวันเป็นตัวเลข`, sender: 'bot' },
            ]);
          }
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            text: `ไม่พบสถานที่ที่เกี่ยวข้องกับ "${analysis.keyword}" ในระบบของเรา ลองพิมพ์คำค้นใหม่ดูนะคะ`,
            sender: 'bot',
          },
        ]);
      } catch (error) {
        console.error(error);
        setMessages((prev) => [
          ...prev,
          { text: 'เกิดข้อผิดพลาดในการค้นหาสถานที่ กรุณาลองใหม่', sender: 'bot' },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ข้อความอื่นๆ ทั่วไป
    setMessages((prev) => [
      ...prev,
      { text: 'ขอบคุณสำหรับข้อความค่ะ หากต้องการวางแผนทริป พิมพ์ว่า "ฉันอยากไป..." พร้อมจำนวนวัน', sender: 'bot' },
    ]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.trim()) {
        handleUserMessage(chatInput.trim());
        setChatInput('');
      }
    }
  };

  const chatSuggestions = ['ฉันอยากไปสยาม 3 วัน', 'ฉันอยากไปสาธร', 'ฉันอยากไปไหนก็ไม่รู้'];
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>Let me help you to plan your trip</h3>
        <p>Just describe your stay preferences and I’ll bring you the most personalised results.</p>
      </div>

      <div className="chat-messages">
        {messages.map((msg, index) =>
          msg.sender === 'bot' ? (
            <div key={index} className="bot-message-wrapper">
              <div className="chat-message bot-message" style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
                {msg.isTripPlan ? formatTripPlanText(msg.text) : msg.text}
              </div>
            </div>
          ) : (
            <div key={index} className="chat-message user-message">
              {msg.text}
            </div>
          )
        )}
        {loading && (
          <div className="bot-message-wrapper">
            <div className="chat-message bot-message">กำลังพิมพ์...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <div className="chat-input-left">
          <Input
            placeholder="Ask anything..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            bordered={false}
          />

          <div className="chat-suggestions">
            {chatSuggestions.map((suggestion, index) => (
              <Tag key={index} className="chat-suggestion-tag" onClick={() => setChatInput(suggestion)}>
                <PlusCircleOutlined className="chat-suggestion-icon" />
                {suggestion}
              </Tag>
            ))}
          </div>
        </div>

        <div className="chat-input-send">
          <Button
            type="text"
            onClick={() => {
              if (chatInput.trim()) {
                handleUserMessage(chatInput.trim());
                setChatInput('');
              }
            }}
            disabled={loading}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
