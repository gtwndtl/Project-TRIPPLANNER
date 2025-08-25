import "./navbar.css";
import { Avatar, Button, Dropdown, message } from "antd";
import { SlackOutlined, UserOutlined, SettingOutlined, LogoutOutlined, ProfileOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const Navbar = () => {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [isLogin, setIsLogin] = useState(false);

  useEffect(() => {
    setIsLogin(localStorage.getItem("isLogin") === "true");
  }, []);

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === "settings") {
      navigate("/settings"); // ปรับ path ได้ตามที่มีจริง
    }
    if (key === "mytrips") {
      navigate("/itinerary"); // ปรับ path ได้ตามที่มีจริง
    }
    if (key === "logout") {
      localStorage.clear();
      setIsLogin(false);
      window.dispatchEvent(new Event("UserChanged"));
      messageApi.open({
        type: 'success',
        content: 'ออกจากระบบสำเร็จ',
        duration: 1.2,
        onClose: () => navigate('/'), // ไปหน้าหลักหลังข้อความหาย
      });
    }
  };
  const profileMenu = {
    onClick: handleMenuClick,
    items: [
      {
        key: "mytrips",
        icon: <ProfileOutlined />,
        label: "My Trips",
      },
      { type: "divider" as const },
      {
        key: "settings",
        icon: <SettingOutlined />,
        label: "Settings",
      },
      { type: "divider" as const },
      {
        key: "logout",
        icon: <LogoutOutlined />,
        label: "Log out",
        danger: true,
      },
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
          <Link to="/explore">Explore</Link>
          <Link to="/trips">Trips</Link>
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
            <Avatar
              size={40}
              icon={<UserOutlined />}
              style={{ backgroundColor: "#fde3cf", color: "#f56a00", cursor: "pointer" }}
            />
          </Dropdown>
        )}
      </div>
    </header>
  );
};

export default Navbar;
