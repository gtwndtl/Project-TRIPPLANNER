import React from "react";
import { useNavigate, useLocation } from "react-router-dom"; // 👈 เพิ่ม useLocation
import "./footer.css";

const SiteFooter: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation(); // 👈 เพิ่ม

  const go = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    navigate(path);
  };

  // 👇 ฟังก์ชันเลื่อนไปยัง section ตาม id
  const goHash = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();

    if (location.pathname === "/") {
      // อยู่หน้า Landing แล้ว → เลื่อนทันที
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // อยู่หน้าอื่น → กลับหน้า Landing แล้วค่อยเลื่อน
      navigate("/", { state: { scrollTo: id } });
    }
  };

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          {/* Brand */}
          <div className="footer-col">
            <h3 className="footer-brand">TRIP PLANNER</h3>
          </div>

          {/* Quick Links */}
          <div className="footer-col">
            <h4 className="footer-title">Product</h4>
            <ul className="footer-links">
              <li><a href="/trip-chat" onClick={(e) => go(e, "/trip-chat")}>Trip Chat</a></li>
              <li><a href="/itinerary/explore" onClick={(e) => go(e, "/itinerary/explore")}>Explore Trips</a></li>
            </ul>
          </div>

          {/* Resources */}
          <div className="footer-col">
            <h4 className="footer-title">Resources</h4>
            <ul className="footer-links">
              {/* 👇 เปลี่ยนลิงก์ How it works ให้เรียก goHash */}
              <li>
                <a href="/#how-it-works" onClick={(e) => goHash(e, "how-it-works")}>
                  How it works
                </a>
              </li>
              <li>
                <a href="/#journey-inspirations" onClick={(e) => goHash(e, "journey-inspirations")}>
                  Journey Inspirations
                </a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="footer-col">
            <h4 className="footer-title">Contact</h4>
            <ul className="footer-links">
              <li><a href="mailto:support@tripplanner.app">support@tripplanner.app</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Trip Planner</span>
          <nav className="footer-bottom-links">
            <a href="/#privacy">Privacy</a>
            <a href="/#terms">Terms</a>
            <a href="/#status">Status</a>
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
