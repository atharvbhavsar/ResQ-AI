import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import './GovernmentDashboard.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

// Priority colors
const PRIORITY_COLORS = {
  1: '#FF0000',
  2: '#FF6600',
  3: '#FFFF00',
  4: '#0066FF',
  5: '#00CC00'
};

const PRIORITY_LABELS = {
  1: '🔴 L1 - Immediate',
  2: '🟠 L2 - Urgent',
  3: '🟡 L3 - Semi-Urgent',
  4: '🔵 L4 - Non-Urgent',
  5: '🟢 L5 - Information'
};

export default function GovernmentDashboard() {
  const [locations, setLocations] = useState({});
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState({});
  const [filters, setFilters] = useState({
    state: 'ALL',
    district: 'ALL',
    city: 'ALL',
    priority: 'ALL',
    status: 'open'
  });
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState(null);
  const [activeTab, setActiveTab] = useState('map');
  const [selectedCall, setSelectedCall] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Initialize socket connection
  useEffect(() => {
    console.log('[Socket] Connecting to Government Dashboard...');
    const newSocket = io(BACKEND_URL);

    newSocket.on('connect', () => {
      console.log('[Socket] ✅ Connected to backend');
    });

    newSocket.on('call progress event', (data) => {
      console.log('[Socket] 📞 New call received:', data);
      loadCalls();
    });

    newSocket.on('call resolved', (data) => {
      console.log('[Socket] ✅ Call resolved:', data);
      loadCalls();
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Load location hierarchy on mount
  useEffect(() => {
    loadLocations();
    loadCalls();
  }, []);

  // Load calls when filters change
  useEffect(() => {
    loadCalls();
  }, [filters]);

  const loadLocations = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/government/locations`);
      const result = await response.json();
      if (result.success) {
        setLocations(result.data);
      }
    } catch (error) {
      console.error('❌ Failed to load locations:', error);
    }
  };

  const loadCalls = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      if (filters.state !== 'ALL') params.append('state', filters.state);
      if (filters.district !== 'ALL') params.append('district', filters.district);
      if (filters.city !== 'ALL') params.append('city', filters.city);
      if (filters.priority !== 'ALL') params.append('priority', filters.priority);
      params.append('status', filters.status);

      const callsUrl = `${BACKEND_URL}/api/government/calls?${params.toString()}`;
      console.log('[Dashboard] ⏳ Fetching calls from:', callsUrl);
      
      const callsResponse = await fetch(callsUrl);
      const callsData = await callsResponse.json();
      
      console.log('[Dashboard] ✅ Calls received:', callsData.data?.length || 0, 'calls');
      console.log('[Dashboard] 📊 First call:', callsData.data?.[0]);

      const statsUrl = `${BACKEND_URL}/api/government/stats?${params.toString()}`;
      const statsResponse = await fetch(statsUrl);
      const statsData = await statsResponse.json();
      
      console.log('[Dashboard] 🗺️ Map calls:', statsData.data?.mapCalls?.length || 0);

      if (callsData.success && callsData.data) {
        console.log('[Dashboard] 🔄 Setting state with', callsData.data.length, 'calls');
        setCalls(callsData.data);
      } else {
        console.error('[Dashboard] ❌ API error:', callsData);
        setCalls([]);
      }

      if (statsData.success && statsData.data) {
        console.log('[Dashboard] 🔄 Setting stats');
        setStats(statsData.data);
      } else {
        console.error('[Dashboard] ❌ Stats error:', statsData);
        setStats({});
      }

      setLoading(false);
    } catch (error) {
      console.error('[Dashboard] ❌ Fetch error:', error.message);
      setCalls([]);
      setStats({});
      setLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      ...(field === 'state' && { district: 'ALL', city: 'ALL' }),
      ...(field === 'district' && { city: 'ALL' })
    }));
  };

  const handleCallClick = async (callId) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/government/calls/${callId}`);
      const result = await response.json();
      if (result.success) {
        setSelectedCall(result.data);
        setShowModal(true);
      }
    } catch (error) {
      console.error('❌ Failed to load call details:', error);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedCall(null);
  };

  // Create map markers
  const mapMarkers = (stats.mapCalls || []).map(call => {
    try {
      const coords = typeof call.coordinates === 'string' 
        ? JSON.parse(call.coordinates) 
        : call.coordinates;
      
      if (!coords || !coords.lat || !coords.lon) return null;

      return (
        <Marker
          key={call.id}
          position={[coords.lat, coords.lon]}
          icon={L.divIcon({
            html: `<div style="background-color: ${PRIORITY_COLORS[call.priority]}; 
                   width: 30px; height: 30px; border-radius: 50%; 
                   display: flex; align-items: center; justify-content: center;
                   color: white; font-weight: bold; border: 2px solid white;">
                   ${call.priority}</div>`,
            iconSize: [30, 30],
            className: 'custom-icon'
          })}
        >
          <Popup>
            <div className="popup-content">
              <h3>{call.emergency}</h3>
              <p><strong>Caller:</strong> {call.name || 'Unknown'}</p>
              <p><strong>Phone:</strong> {call.number || 'Unknown'}</p>
              <p><strong>Location:</strong> {call.city}, {call.district}, {call.state}</p>
              <p><strong>Priority:</strong> {PRIORITY_LABELS[call.priority]}</p>
              <p><strong>Time:</strong> {new Date(call.created_at).toLocaleString()}</p>
            </div>
          </Popup>
        </Marker>
      );
    } catch (error) {
      console.error('Error creating marker:', error);
      return null;
    }
  }).filter(Boolean);

  // Log on each render to track state
  console.log('[Dashboard RENDER] activeTab:', activeTab, '| calls:', calls.length, '| loading:', loading);

  // Debug: Track state changes
  useEffect(() => {
    console.log('[Dashboard STATE CHANGE] calls updated to:', calls.length, '- First few:', calls.slice(0, 3));
  }, [calls]);

  return (
    <div className="government-dashboard">
      <header className="gov-header">
        <div className="header-logo">
          <div className="logo-icon">🚨</div>
          <div className="header-text">
            <h1 className="brand-name">RESQ AI</h1>
            <p className="header-subtitle"></p>
          </div>
        </div>
        <div className="live-indicator">
          <span className="pulse-dot"></span>
          <span>LIVE</span>
        </div>
      </header>

      {/* Location Filters */}
      <div className="filters-section">
        <div className="filter-group">
          <label>State:</label>
          <select 
            value={filters.state} 
            onChange={(e) => handleFilterChange('state', e.target.value)}
          >
            <option value="ALL">All States</option>
            {Object.keys(locations).sort().map(state => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>District:</label>
          <select 
            value={filters.district}
            onChange={(e) => handleFilterChange('district', e.target.value)}
            disabled={!filters.state || filters.state === 'ALL'}
          >
            <option value="ALL">All Districts</option>
            {locations[filters.state] && Object.keys(locations[filters.state]).sort().map(district => (
              <option key={district} value={district}>{district}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>City:</label>
          <select 
            value={filters.city}
            onChange={(e) => handleFilterChange('city', e.target.value)}
            disabled={!filters.district || filters.district === 'ALL'}
          >
            <option value="ALL">All Cities</option>
            {filters.state && filters.district && locations[filters.state]?.[filters.district]?.map(city => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Priority:</label>
          <select 
            value={filters.priority}
            onChange={(e) => handleFilterChange('priority', e.target.value)}
          >
            <option value="ALL">All Priorities</option>
            <option value="1">🔴 L1 - Immediate</option>
            <option value="2">🟠 L2 - Urgent</option>
            <option value="3">🟡 L3 - Semi-Urgent</option>
            <option value="4">🔵 L4 - Non-Urgent</option>
            <option value="5">🟢 L5 - Information</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Status:</label>
          <select 
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="tab-navigation">
        <button 
          className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          🗺️ Map View
        </button>
        <button 
          className={`tab-btn ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          📋 Cases Table
        </button>
        <button 
          className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Statistics
        </button>
      </div>

      {/* Statistics Cards */}
      {activeTab === 'stats' && (
        <div className="stats-section">
          <div className="stat-card">
            <h3>📞 Total Active Cases</h3>
            <p className="stat-value">{stats.totalCases || 0}</p>
          </div>

          <div className="stat-card">
            <h3>⚡ Average Urgency</h3>
            <p className="stat-value">L{Math.round(stats.averagePriority || 3)}</p>
          </div>

          <div className="priority-breakdown">
            <h3>Cases by Priority</h3>
            {stats.byPriority && stats.byPriority.map(item => (
              <div key={item.priority} className="priority-bar">
                <span>{PRIORITY_LABELS[item.priority]}</span>
                <div className="bar" style={{
                  width: `${(item.count / (stats.totalCases || 1)) * 100}%`,
                  backgroundColor: PRIORITY_COLORS[item.priority]
                }}>
                  {item.count}
                </div>
              </div>
            ))}
          </div>

          <div className="location-breakdown">
            <h3>Top Emergency Locations</h3>
            {stats.byLocation && stats.byLocation.map((loc, idx) => (
              <div key={idx} className="location-item">
                <span>{loc.city}, {loc.district}</span>
                <strong>{loc.count} cases</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Map View */}
      {activeTab === 'map' && (
        <div className="map-section">
          <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '600px' }}>
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />
            {mapMarkers}
          </MapContainer>
        </div>
      )}

      {/* Cases Table */}
      {activeTab === 'table' && (
        <div className="table-section">
          {loading ? (
            <p>Loading cases...</p>
          ) : calls.length === 0 ? (
            <p>No cases found for selected location.</p>
          ) : (
            <table className="cases-table">
              <thead>
                <tr>
                  <th>Emergency</th>
                  <th>Caller</th>
                  <th>Location</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(call => (
                  <tr 
                    key={call.id} 
                    className={`priority-${call.priority}`}
                    onClick={() => handleCallClick(call.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{call.emergency}</td>
                    <td>{call.name || 'Unknown'}</td>
                    <td>{call.city}, {call.district}</td>
                    <td>
                      <span className="priority-badge" style={{ 
                        backgroundColor: PRIORITY_COLORS[call.priority] 
                      }}>
                        {PRIORITY_LABELS[call.priority]}
                      </span>
                    </td>
                    <td>{call.status}</td>
                    <td>{new Date(call.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Call Details Modal */}
      {showModal && selectedCall && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📞 Emergency Call Details</h2>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-section">
                <h3>🚨 Emergency Information</h3>
                <div className="detail-row">
                  <span className="detail-label">Emergency Type:</span>
                  <span className="detail-value">{selectedCall.emergency}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Priority Level:</span>
                  <span className="detail-value priority-badge" style={{
                    backgroundColor: PRIORITY_COLORS[selectedCall.priority]
                  }}>
                    {PRIORITY_LABELS[selectedCall.priority]}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Status:</span>
                  <span className="detail-value status-badge">{selectedCall.status}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">In Progress:</span>
                  <span className="detail-value">{selectedCall.inProgress ? 'Yes' : 'No'}</span>
                </div>
              </div>

              <div className="detail-section">
                <h3>👤 Caller Information</h3>
                <div className="detail-row">
                  <span className="detail-label">Name:</span>
                  <span className="detail-value">{selectedCall.name || 'Unknown'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Phone Number:</span>
                  <span className="detail-value">{selectedCall.number || 'Not provided'}</span>
                </div>
              </div>

              <div className="detail-section">
                <h3>📍 Location Details</h3>
                <div className="detail-row">
                  <span className="detail-label">Address:</span>
                  <span className="detail-value">{selectedCall.location}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">City:</span>
                  <span className="detail-value">{selectedCall.city}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">District:</span>
                  <span className="detail-value">{selectedCall.district}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">State:</span>
                  <span className="detail-value">{selectedCall.state}</span>
                </div>
                {selectedCall.coordinates && (
                  <div className="detail-row">
                    <span className="detail-label">Coordinates:</span>
                    <span className="detail-value">
                      {typeof selectedCall.coordinates === 'string' 
                        ? JSON.parse(selectedCall.coordinates).lat + ', ' + JSON.parse(selectedCall.coordinates).lon
                        : selectedCall.coordinates.lat + ', ' + selectedCall.coordinates.lon}
                    </span>
                  </div>
                )}
              </div>

              <div className="detail-section">
                <h3>⏰ Timestamp Information</h3>
                <div className="detail-row">
                  <span className="detail-label">Call Started:</span>
                  <span className="detail-value">{new Date(selectedCall.created_at).toLocaleString()}</span>
                </div>
                {selectedCall.resolved_at && (
                  <div className="detail-row">
                    <span className="detail-label">Resolved At:</span>
                    <span className="detail-value">{new Date(selectedCall.resolved_at).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {selectedCall.transcript && (
                <div className="detail-section">
                  <h3>📝 Call Transcript</h3>
                  <div className="transcript-box">
                    {selectedCall.transcript}
                  </div>
                </div>
              )}

              <div className="detail-section">
                <h3>🆔 System Information</h3>
                <div className="detail-row">
                  <span className="detail-label">Call ID:</span>
                  <span className="detail-value call-id">{selectedCall.id}</span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-close" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
