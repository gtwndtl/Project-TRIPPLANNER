import { Button, Table, Select, message, Spin, Empty } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import Navbar from '../../navbar/navbar';
import './tripsummarypage.css';
import {
  GetTripById,
  GetLandmarksAndRestuarantforEdit,
  GetAccommodationSuggestionsForEdit,
  UpdateShortestPath,
  BulkUpdateAccommodation,
} from '../../services/https';
import type { TripInterface } from '../../interfaces/Trips';
import type { ShortestpathInterface } from '../../interfaces/Shortestpath';
import {
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { DefaultOptionType } from 'antd/es/select';

type PlaceKind = 'landmark' | 'restaurant' | 'accommodation';

// ✅ ชื่อตาราง shortestpaths ตาม GORM struct Shortestpath (ไม่มี underscore)
const SP_TABLE_NAME = 'shortestpaths';

const inferKind = (code?: string): PlaceKind => {
  const ch = code?.[0]?.toUpperCase();
  if (ch === 'R') return 'restaurant';
  if (ch === 'A') return 'accommodation';
  return 'landmark';
};

// ใช้บริบทเดา ถ้า current ว่าง
const inferKindSmart = (
  currentCode: string,
  prevCode: string,
  nextCode: string,
  record: ShortestpathInterface
): PlaceKind => {
  const byCurrent = inferKind(currentCode);
  if (currentCode) return byCurrent;

  const pick = (code?: string) => (code ? code[0]?.toUpperCase() : '');
  const p = pick(prevCode);
  const n = pick(nextCode);
  const f = pick(record.FromCode);
  const t = pick(record.ToCode);

  if ([p, n, f, t].includes('A')) return 'accommodation';
  if ([p, n, f, t].includes('R')) return 'restaurant';
  return 'landmark';
};

const TripSummaryPage = () => {
  const TripID = localStorage.getItem('TripID') ?? '';
  const [trip, setTrip] = useState<TripInterface | null>(null);
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [editedData, setEditedData] = useState<Record<number, ShortestpathInterface[]>>({});

  // แคชตัวเลือก/สถานะต่อแถว
  const [rowOptions, setRowOptions] = useState<Record<string, DefaultOptionType[]>>({});
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [rowLoadedOnce, setRowLoadedOnce] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchTrip = async () => {
      if (!TripID) return;
      try {
        const tripData = await GetTripById(Number(TripID));
        setTrip(tripData);
      } catch (e) {
        console.debug('GetTripById error:', e);
        message.error('โหลดทริปไม่สำเร็จ');
      }
    };
    fetchTrip();
  }, [TripID]);

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

  const handleEditClick = (day: number) => {
    setEditingDay(day);
    if (groupedByDay && groupedByDay[day]) {
      setEditedData((prev) => ({
        ...prev,
        [day]: JSON.parse(JSON.stringify(groupedByDay[day])),
      }));
    }
  };

  // ===== Helpers (Save) =====

  // ช่วยหา diff เฉพาะที่ ToCode เปลี่ยน
  const getChangedRows = (original: ShortestpathInterface[], edited: ShortestpathInterface[]) => {
    const origById = new Map<number, ShortestpathInterface>();
    original.forEach((o) => {
      if (o.ID != null) origById.set(o.ID, o);
    });
    return edited.filter((e) => {
      const o = e.ID != null ? origById.get(e.ID) : undefined;
      if (!o) return false;
      return (o.ToCode || '') !== (e.ToCode || '');
    });
  };

  // หาโค้ด A... ใหม่ที่ผู้ใช้แก้ (ถ้ามี) จากรายการที่เปลี่ยน
  const getNewAccommodationCode = (changed: ShortestpathInterface[]) => {
    const aCodes = Array.from(
      new Set(
        changed
          .map((r) => r.ToCode?.toUpperCase() || '')
          .filter((c) => c.startsWith('A'))
      )
    );
    if (aCodes.length === 0) return null;
    if (aCodes.length > 1) {
      message.warning(`พบการแก้ที่พักหลายรหัส (${aCodes.join(', ')}) จะใช้ ${aCodes[0]} ทั้งทริป`);
    }
    return aCodes[0];
  };

  // ===== Edit / Save =====

  const handleLocationChange = (day: number, index: number, value: string) => {
    const updated = [...(editedData[day] || [])];
    updated[index] = { ...updated[index], ToCode: value };
    setEditedData((prev) => ({ ...prev, [day]: updated }));
  };

  const handleSave = async (day: number) => {
    const edited = editedData[day];
    if (!edited) {
      setEditingDay(null);
      return;
    }
    const original = (trip?.ShortestPaths ?? []).filter((sp) => sp.Day === day);

    // เอาเฉพาะรายการที่ ToCode เปลี่ยน
    const changed = getChangedRows(original, edited);
    if (changed.length === 0) {
      message.info('ไม่มีการเปลี่ยนแปลง');
      setEditingDay(null);
      return;
    }

    try {
      // 1) ถ้ามีการเปลี่ยนเป็น A... ให้อัปเดตที่พักทั้ง "ทริป" ก่อน
      const newAcc = getNewAccommodationCode(changed);
      if (newAcc) {
        await BulkUpdateAccommodation({
          trip_id: Number(TripID),
          acc_code: newAcc,
          // ไม่ส่ง days => ทั้งทริป
          scope: 'both',
        });

        // sync state: เปลี่ยนทุกแถวในทั้งทริปที่เป็น A... ให้เป็นรหัสเดียวกัน
        setTrip((prev) => {
          if (!prev) return prev;
          const updated = { ...prev };
          updated.ShortestPaths = (prev.ShortestPaths ?? []).map((sp) => {
            const u = { ...sp };
            if (u.FromCode?.toUpperCase().startsWith('A')) u.FromCode = newAcc;
            if (u.ToCode?.toUpperCase().startsWith('A')) u.ToCode = newAcc;
            return u;
          });
          return updated;
        });
      }

      // 2) อัปเดตแถวอื่น ๆ (ที่ไม่ใช่ A... หรือเป็นการเปลี่ยนไป P/R)
      const nonAccChanged = changed.filter((r) => !(r.ToCode || '').toUpperCase().startsWith('A'));
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
              Distance: row.Distance, // backend จะคำนวณใหม่เอง
              ActivityDescription: row.ActivityDescription,
              StartTime: row.StartTime,
              EndTime: row.EndTime,
            };
            return UpdateShortestPath(row.ID!, payload);
          })
        );
      }

      // 3) sync state เฉพาะวันที่กำลังแก้ ให้ตรงกับ edited (หลังจากอัปเดต non-A)
      setTrip((prev) => {
        if (!prev) return prev;
        const updated = { ...prev };
        updated.ShortestPaths = (prev.ShortestPaths ?? []).map((sp) =>
          sp.Day === day ? edited.find((e) => e.ID === sp.ID) || sp : sp
        );
        return updated;
      });

      message.success(
        getNewAccommodationCode(changed)
          ? `บันทึกสำเร็จ (อัปเดตที่พักทั้งทริป และแก้รายการอื่นแล้ว)`
          : `บันทึกสำเร็จ ${changed.length} รายการ`
      );
    } catch (e: any) {
      message.error(e?.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setEditingDay(null);
    }
  };

  const handleCancel = () => {
    setEditingDay(null);
    setEditedData({});
  };

  // ===== Suggestions =====

  const getPrevNext = (day: number, index: number, record: ShortestpathInterface) => {
    const arr = editedData[day] ?? groupedByDay[day] ?? [];
    const prevRow = index > 0 ? arr[index - 1] : undefined;
    const nextRow = index < arr.length - 1 ? arr[index + 1] : undefined;

    let prevCode = prevRow?.ToCode || prevRow?.FromCode || '';
    let nextCode = nextRow?.ToCode || nextRow?.FromCode || '';

    if (!prevCode) prevCode = record.FromCode || record.ToCode || '';
    if (!nextCode) nextCode = record.ToCode || record.FromCode || '';

    return { prevCode, nextCode };
  };

  // โหลด options ของแถว — ดึงทุกครั้งที่เปิด (กันปัญหาเคยได้ [] แล้วไม่ดึงอีก)
  const ensureRowOptions = async (day: number, index: number, record: ShortestpathInterface) => {
    const key = `${day}:${index}`;

    const { prevCode, nextCode } = getPrevNext(day, index, record);
    const current = editedData[day]?.[index]?.ToCode || record.ToCode || '';
    const kind = inferKindSmart(current, prevCode, nextCode, record);

    try {
      setRowLoading((s) => ({ ...s, [key]: true }));

      if (kind === 'accommodation') {
        const options = await GetAccommodationSuggestionsForEdit({
          trip_id: Number(TripID),
          day,
          strategy: 'sum',
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
        type: kind === 'restaurant' ? 'restaurant' : 'landmark',
        prev: prevCode,
        next: nextCode,
        radius_m: 3000,
        limit: 12,
        exclude: current || undefined,
      });

      setRowOptions((s) => ({ ...s, [key]: options }));
      setRowLoadedOnce((s) => ({ ...s, [key]: true }));
    } catch (e: any) {
      message.error(e?.message || 'โหลดรายการแนะนำไม่สำเร็จ');
      setRowLoadedOnce((s) => ({ ...s, [key]: true }));
      setRowOptions((s) => ({ ...s, [key]: [] }));
    } finally {
      setRowLoading((s) => ({ ...s, [key]: false }));
    }
  };

  const nameResolver = (day: number): Map<string, string> => {
    const m = new Map<string, string>();
    const arr = editedData[day] ?? groupedByDay[day] ?? [];
    arr.forEach((_, idx) => {
      const opts = rowOptions[`${day}:${idx}`] ?? [];
      opts.forEach((opt) => {
        if (opt.value != null) m.set(String(opt.value), String(opt.label));
      });
    });
    return m;
  };

  const renderNotFound = (key: string) => {
    if (rowLoading[key]) return <Spin size="small" />;
    if (rowLoadedOnce[key]) return <Empty description="ไม่มีตัวเลือกในรัศมี" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    return null;
  };

  const columns = (day: number) => [
    {
      title: (
        <>
          <ClockCircleOutlined style={{ marginRight: 6 }} />
          เวลา
        </>
      ),
      render: (record: ShortestpathInterface) => `${record.StartTime} - ${record.EndTime}`,
      width: 140,
    },
    {
      title: (
        <>
          <EnvironmentOutlined style={{ marginRight: 6 }} />
          สถานที่
        </>
      ),
      render: (_: any, record: ShortestpathInterface, index: number) => {
        const key = `${day}:${index}`;
        if (editingDay === day) {
          return (
            <Select
              showSearch
              value={editedData[day]?.[index]?.ToCode}
              onChange={(value) => handleLocationChange(day, index, value)}
              style={{ width: 360 }}
              placeholder="เลือกสถานที่แนะนำตามเส้นทาง"
              options={rowOptions[key] ?? []}
              optionFilterProp="label"
              filterOption={(input, option) =>
                (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
              }
              notFoundContent={renderNotFound(key)}
              loading={!!rowLoading[key]}
              onOpenChange={(open) => {
                if (open) void ensureRowOptions(day, index, record);
              }}
              onFocus={() => void ensureRowOptions(day, index, record)}
              onClick={() => void ensureRowOptions(day, index, record)}
            />
          );
        }
        const resolver = nameResolver(day);
        return resolver.get(record.ToCode || '') || record.ToCode;
      },
      width: 380,
    },
    {
      title: (
        <>
          <CheckCircleOutlined style={{ marginRight: 6 }} />
          กิจกรรม
        </>
      ),
      dataIndex: 'ActivityDescription',
      render: (text: string) => (
        <span
          dangerouslySetInnerHTML={{
            __html: (text || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
          }}
        />
      ),
    },
    {
      title: (
        <>
          <InfoCircleOutlined style={{ marginRight: 6 }} />
          รายละเอียด
        </>
      ),
      dataIndex: 'Details',
      render: () => '-',
    },
  ];

  const getDayHeaderText = (dayIndex: number): string => {
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (dayIndex - 1));

    return `วันที่ ${dayIndex} - ${targetDate.toLocaleDateString('th-TH', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}`;
  };

  return (
    <div className="trip-summary-page-container">
      <Navbar />
      <div className="trip-summary-page-content">
        <div className="trip-summary-box">
          <div className="trip-summary-head">
            <h1>{trip?.Name}</h1>
            <p>แผนการเดินทาง {trip?.Days} วัน</p>
          </div>

          {Object.entries(groupedByDay).map(([day, activities]) => {
            const dayNum = Number(day);
            const isEditing = editingDay === dayNum;

            return (
              <div key={day} className="trip-day-section">
                <div className="trip-day-header">
                  <span>{getDayHeaderText(dayNum)}</span>
                  <div className="button-edit-group">
                    {isEditing ? (
                      <>
                        <Button icon={<CloseOutlined />} onClick={handleCancel}>
                          ยกเลิก
                        </Button>
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={() => handleSave(dayNum)}
                          style={{ marginLeft: 8 }}
                        >
                          บันทึก
                        </Button>
                      </>
                    ) : (
                      <Button
                        icon={<EditOutlined />}
                        onClick={() => handleEditClick(dayNum)}
                        style={{ marginLeft: 8 }}
                      >
                        แก้ไข
                      </Button>
                    )}
                  </div>
                </div>

                <Table
                  className="trip-summary-table"
                  columns={columns(dayNum)}
                  dataSource={isEditing ? editedData[dayNum] : activities}
                  rowKey="ID"
                  pagination={false}
                  size="middle"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TripSummaryPage;
