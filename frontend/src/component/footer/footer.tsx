import "./footer.css";

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer-container">
      <div className="footer-wrapper">
        <div className="footer-links">
          <a href="#">About Us</a>
          <a href="#">Contact</a>
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
        <p className="footer-copy">
          © {currentYear} TripPlanner. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
