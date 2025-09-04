import "./landing.css";
import { Carousel } from "antd";
import { CompassOutlined, BranchesOutlined, ScheduleOutlined } from "@ant-design/icons";
import a1 from "../../assets/a.jpg";
import a2 from "../../assets/b.jpg";
import a3 from "../../assets/c.jpg";
import a4 from "../../assets/d.jpg";
import a5 from "../../assets/e.jpg";
import { useNavigate } from "react-router-dom";

const Landing = () => {
  const slides = [a1, a2, a3, a4, a5];
  const navigate = useNavigate();

  return (
    <div className="landing-container">
      <div className="landing-content-wrapper">
        {/* Hero Section */}
        <section className="landing-hero">
          <div className="landing-hero-stage">
            {/* รูปเลื่อนอย่างเดียว */}
            <Carousel
              className="landing-hero-carousel"
              arrows
              autoplay
              autoplaySpeed={3000}
              dots
              draggable
            >
              {slides.map((img, idx) => (
                <div key={idx}>
                  <div
                    className="landing-hero-slide"
                    style={{
                      backgroundImage: `linear-gradient(rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.40) 100%), url(${img})`,
                    }}
                  />
                </div>
              ))}
            </Carousel>

            {/* ข้อความ + ปุ่ม (คงที่ ไม่เลื่อน) */}
            <div className="landing-hero-overlay">
              <div className="landing-hero-text">
                <h1 className="landing-hero-title">TRIP PLANNER</h1>
                <h2 className="landing-hero-subtitle">
                  วางแผนการเดินทางโดยง่ายเพียงแค่ระบุสถานที่
                </h2>
              </div>

              <button
                className="button"
                onClick={() => navigate("/trip-chat")}
              >
                <span className="button_lg">
                  <span className="button_sl"></span>
                  <span className="button_text">เริ่มต้นการวางแผน</span>
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="landing-how-it-works">
          <div className="landing-section-header">
            <h1 className="landing-section-title">How it works</h1>
            <p className="landing-section-description">
              เพียงไม่กี่ขั้นตอน ระบบก็สามารถสร้างแผนการเดินทางที่เหมาะสมและพร้อมใช้งานสำหรับคุณ
            </p>
          </div>

          <div className="landing-steps-grid">
            {/* Step 1 */}
            <div className="landing-step-card">
              <div className="landing-step-icon">
                <CompassOutlined style={{ fontSize: "28px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Tell us your destination</h2>
                <p className="landing-step-description">
                  แจ้งจุดหมายปลายทางที่คุณต้องการเดินทางไป
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="landing-step-card">
              <div className="landing-step-icon">
                <BranchesOutlined style={{ fontSize: "28px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Algorithm processes your trip</h2>
                <p className="landing-step-description">
                  ระบบใช้อัลกอริทึมประมวลผลและสร้างแผนการเดินทางที่เหมาะสม
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="landing-step-card">
              <div className="landing-step-icon">
                <ScheduleOutlined style={{ fontSize: "28px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Use your itinerary</h2>
                <p className="landing-step-description">
                  นำแผนการเดินทางไปใช้จริงหรือปรับแก้ตามความต้องการ
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Landing;
