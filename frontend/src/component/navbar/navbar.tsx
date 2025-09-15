import "./navbar.css";
import { Avatar, Button, Dropdown, message } from "antd";
import {
  SlackOutlined,
  UserOutlined,
  SettingOutlined,
  LogoutOutlined,
  ProfileOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

/* ========= Avatar Color Utils (เหมือนแนว Landing) ========= */
const AVATAR_COLORS = [
  "#1677ff", "#13c2c2", "#52c41a", "#fa8c16",
  "#f5222d", "#722ed1", "#eb2f96", "#2f54eb",
  "#a0d911", "#faad14", "#1890ff", "#9254de",
];

// FNV-1a 32-bit
const fnv1a = (str: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
};

// salt ต่อ session
const SESSION_SALT = (() => {
  try {
    const key = "AVATAR_SALT_V1";
    let s = sessionStorage.getItem(key);
    if (!s) {
      s = Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, s);
    }
    return s;
  } catch {
    return "nosession";
  }
})();

const pickColorFromSeed = (seed: string) => {
  const h = fnv1a(`${seed}:${SESSION_SALT}`);
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const initials = (name?: string) => {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase();
};
/* ========================================================= */

const Navbar = () => {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [isLogin, setIsLogin] = useState(false);

  useEffect(() => {
    setIsLogin(localStorage.getItem("isLogin") === "true");

    // เผื่อมีการเปลี่ยนสถานะ login จากส่วนอื่น ๆ ของแอป
    const onUserChanged = () => setIsLogin(localStorage.getItem("isLogin") === "true");
    window.addEventListener("UserChanged", onUserChanged as EventListener);
    return () => window.removeEventListener("UserChanged", onUserChanged as EventListener);
  }, []);

  /* ===== สร้าง seed และสี avatar แบบ deterministic ต่อ session ===== */
  const displayName = useMemo(() => {
    const f = (localStorage.getItem("Firstname") || localStorage.getItem("firstName") || "").trim();
    const l = (localStorage.getItem("Lastname") || localStorage.getItem("lastName") || "").trim();
    const full = `${f} ${l}`.trim();
    if (full) return full;
    const alt = (localStorage.getItem("Name") || localStorage.getItem("username") || "").trim();
    return alt;
  }, [isLogin]);

  const userSeed = useMemo(() => {
    const id =
      localStorage.getItem("UserID") ||
      localStorage.getItem("userId") ||
      localStorage.getItem("uid") ||
      "";
    return `navbar|${id}|${displayName || "guest"}`;
  }, [displayName, isLogin]);

  const avatarColor = useMemo(() => pickColorFromSeed(userSeed), [userSeed]);

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === "settings") {
      navigate("/settings");
    }
    if (key === "mytrips") {
      navigate("/itinerary");
    }
    if (key === "logout") {
      localStorage.clear();
      setIsLogin(false);
      window.dispatchEvent(new Event("UserChanged"));
      messageApi.open({
        type: "success",
        content: "ออกจากระบบสำเร็จ",
        duration: 1.2,
        onClose: () => navigate("/"),
      });
    }
  };

  const profileMenu = {
    onClick: handleMenuClick,
    items: [
      { key: "mytrips", icon: <ProfileOutlined />, label: "My Trips" },
      { type: "divider" as const },
      { key: "settings", icon: <SettingOutlined />, label: "Settings" },
      { type: "divider" as const },
      { key: "logout", icon: <LogoutOutlined />, label: "Log out", danger: true },
    ],
  };

  return (
    <header className="navbar">
      {contextHolder}

      {/* Logo & Brand */}
      <div className="navbar-left">
        <Link to="/" className="navbar-logo" aria-label="Go to home">
          <SlackOutlined style={{ fontSize: 20, color: "#000000ff" }} />
        </Link>
        <Link to="/" className="navbar-brand">TripPlanner</Link>
      </div>

      {/* Navigation & Actions */}
      <div className="navbar-right">
        <nav className="navbar-links">
          <Link to="/">Home</Link>
          <Link to="/trip-chat">Chat</Link>
          <Link to="/itinerary/explore">Explore</Link>
          <Link to="/help">Help</Link>
        </nav>

        {!isLogin && (
          <Button
            type="primary"
            shape="round"
            size="middle"
            onClick={() => navigate("/login")}
          >
            Login
          </Button>
        )}

        {isLogin && (
          <Dropdown menu={profileMenu} trigger={["click"]} placement="bottomRight" arrow>
            {/* ถ้ามีชื่อ → แสดง initials, ไม่มีชื่อ → แสดงไอคอน */}
            <Avatar
              size={40}
              style={{ backgroundColor: avatarColor, color: "#fff", cursor: "pointer" }}
              {...(!displayName ? { icon: <UserOutlined /> } : {})}
            >
              {displayName ? initials(displayName) : null}
            </Avatar>
          </Dropdown>
        )}
      </div>
    </header>
  );
};

export default Navbar;
