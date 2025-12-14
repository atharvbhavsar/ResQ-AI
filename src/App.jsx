import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
// import Sidebar from "./sections/Sidebar.js";
import Main from "./sections/Main.js";
import GovernmentDashboard from "./components/GovernmentDashboard.js";
// import GovDashboardSimple from "./components/GovDashboardSimple.jsx";
import "leaflet/dist/leaflet.css";

function App() {
  return (
    <Router>
      <Routes>
        {/* Government Dashboard Route */}
        <Route path="/government" element={<GovernmentDashboard />} />

        {/* Main Dispatcher Dashboard Route */}
        <Route
          path="/"
          element={
            <div className="resq-dashboard">
              <header className="resq-header">
                <div className="header-logo">
                  <div className="logo-icon">🚨</div>
                  <div className="header-text">
                    <h1 className="brand-name">RESQ AI</h1>
                    <p className="header-subtitle">Backend Live Track Call Data</p>
                  </div>
                </div>
                <div className="live-indicator">
                  <span className="pulse-dot"></span>
                  <span>LIVE</span>
                </div>
              </header>
              <div className="main-content">
                <Main className="w-full flex h-full" />
              </div>
            </div>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
