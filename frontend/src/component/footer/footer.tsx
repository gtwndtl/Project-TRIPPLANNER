import React from "react";
import { useNavigate } from "react-router-dom";
import "./footer.css";

const SiteFooter: React.FC = () => {
  const navigate = useNavigate();

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
              <li><a onClick={() => navigate("/trip-chat")}>Trip Chat</a></li>
              <li><a onClick={() => navigate("/itinerary/explore")}>Explore Trips</a></li>
            </ul>
          </div>

          {/* Resources */}
          <div className="footer-col">
            <h4 className="footer-title">Resources</h4>
            <ul className="footer-links">
              <li><a href="#faq">FAQ</a></li>
              <li><a href="#how-it-works">How it works</a></li>
              <li><a href="#contact">Support</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="footer-col">
            <h4 className="footer-title">Contact</h4>
            <ul className="footer-links">
              <li><a href="mailto:support@tripplanner.app">support@tripplanner.app</a></li>
              <li><a href="#">Feedback</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Trip Planner</span>
          <nav className="footer-bottom-links">
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Status</a>
          </nav>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
