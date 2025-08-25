import "./landing.css";
import { Button, Carousel } from "antd";
import { EnvironmentOutlined, CalendarOutlined, DollarOutlined } from "@ant-design/icons";
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
          <Carousel
            className="landing-hero-carousel"
            arrows
            autoplay={{ dotDuration: true }} autoplaySpeed={3000}
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
                >
                  <div className="landing-hero-text">
                    <h1 className="landing-hero-title">
                      Plan your perfect trip with AI
                    </h1>
                    <h2 className="landing-hero-subtitle">
                      Let our AI create a personalized itinerary based on your interests and preferences.
                    </h2>
                  </div>
                  <button className="button" onClick={() => navigate("/trip-chat")}>
                    <span className="button_lg">
                      <span className="button_sl"></span>
                      <span className="button_text">Create a new Trip</span>
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </Carousel>
        </section>

        {/* How It Works Section */}
        <section className="landing-how-it-works">
          <div className="landing-section-header">
            <h1 className="landing-section-title">How it works</h1>
            <p className="landing-section-description">
              Our AI trip planner simplifies your travel planning process.
            </p>
          </div>

          <div className="landing-steps-grid">
            <div className="landing-step-card">
              <div className="landing-step-icon">
                <EnvironmentOutlined style={{ fontSize: "24px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Choose your destination</h2>
                <p className="landing-step-description">
                  Select your desired location from our extensive list of destinations.
                </p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-icon">
                <CalendarOutlined style={{ fontSize: "24px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Set your travel dates</h2>
                <p className="landing-step-description">
                  Specify your travel dates to ensure accurate scheduling.
                </p>
              </div>
            </div>

            <div className="landing-step-card">
              <div className="landing-step-icon">
                <DollarOutlined style={{ fontSize: "24px", color: "#111418" }} />
              </div>
              <div className="landing-step-text">
                <h2 className="landing-step-title">Get a personalized itinerary</h2>
                <p className="landing-step-description">
                  Receive a customized itinerary tailored to your interests and budget.
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
