// src/component/setting/setting.tsx
import { useEffect, useMemo, useState } from "react";
import "./setting.css";
import { GetUserById } from "../../services/https";
import dayjs from "dayjs";
import { message, Tabs, type TabsProps } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { UserInterface } from "../../interfaces/User";
import ProfileInfo from "../../component/setting/profile/profile";
import AccountInfo from "../../component/setting/account/account";
import Preferences from "../../component/setting/preferences/preferences";
import ChangePassword from "../../component/setting/account/change-assword/change-password.tsx";


const Setting = () => {
  const [user, setUser] = useState<UserInterface | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, contextHolder] = message.useMessage();

  const navigate = useNavigate();
  const [params] = useSearchParams();

  // state เปิดฟอร์มเปลี่ยนรหัสผ่าน
  const [showChangePwd, setShowChangePwd] = useState(false);

  // กำหนด active tab จาก query string (?tab=account|profile|preferences)
  const activeKey = params.get("tab") || "account";

  // คำนวณอายุจากวันเกิด
  const age = useMemo(() => {
    if (!user?.Birthday) return undefined;
    const b = dayjs(user.Birthday);
    if (!b.isValid()) return undefined;
    const today = dayjs();
    let a = today.year() - b.year();
    if (
      today.month() < b.month() ||
      (today.month() === b.month() && today.date() < b.date())
    ) {
      a--;
    }
    return a;
  }, [user?.Birthday]);

  useEffect(() => {
    const rawId = localStorage.getItem("id");
    const id = rawId ? Number(rawId) : NaN;

    if (!rawId || Number.isNaN(id)) {
      msg.error("ยังไม่ได้เข้าสู่ระบบ");
      setTimeout(() => navigate("/login"), 800);
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const result = await GetUserById(id);
        if (!result?.ID) {
          msg.error("ไม่พบข้อมูลผู้ใช้");
          setTimeout(() => navigate("/"), 1000);
          return;
        }
        setUser(result);
      } catch (err) {
        console.error("GetUserById error:", err);
        msg.error("เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้");
      } finally {
        setLoading(false);
      }
    })();
  }, [msg, navigate]);

  const items: TabsProps["items"] = [
    {
      key: "account",
      label: "Account",
      children: (
        <>
          {showChangePwd ? (
            <ChangePassword onClose={() => setShowChangePwd(false)} />
          ) : (
            <AccountInfo
              Email={user?.Email || "-"}
              onChangePassword={() => setShowChangePwd(true)}
            />
          )}
        </>
      ),
    },
    {
      key: "profile",
      label: "Profile",
      children: (
        <ProfileInfo
          Firstname={user?.Firstname || "-"}
          Lastname={user?.Lastname || "-"}
          Age={age}
          Birthday={
            user?.Birthday ? dayjs(user.Birthday).format("MMMM D, YYYY") : "-"
          }
        />
      ),
    },
    {
      key: "preferences",
      label: "Preferences",
      children: <Preferences />,
    },
  ];

  return (
    <div className="setting-root">
      {contextHolder}
      <div className="setting-container">
        <div className="setting-content">
          <div className="setting-titlebar">
            <p className="setting-title">Settings</p>
          </div>

          {loading ? (
            <div className="setting-loading">Loading…</div>
          ) : (
            <Tabs
              className="setting-tabs-antd"
              activeKey={activeKey}
              onChange={(key) =>
                navigate(`/settings?tab=${key}`, { replace: true })
              }
              items={items}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Setting;
