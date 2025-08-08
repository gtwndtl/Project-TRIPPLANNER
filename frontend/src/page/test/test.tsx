import React from "react";
import { useNavigate } from "react-router-dom";
import "./test.css";

const NoPermission: React.FC = () => {
  const navigate = useNavigate();

  return (
    <main className="unauthorized-root">
      <section className="unauthorized-card" role="alert" aria-live="polite">
        <div className="badge">403</div>

        <h1 className="title">Unauthorized Access</h1>
        <p className="subtitle">
          You don’t have permission to view this page. If you think this is a mistake, please contact support.
        </p>

        <div className="button-group">
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Go to Home
          </button>
          <a
            className="btn btn-secondary"
            href="https://www.facebook.com/share/1BCm2ko5nD/?mibextid=wwXIfr"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contact Support
          </a>
        </div>
      </section>
    </main>
  );
};

export default NoPermission;
