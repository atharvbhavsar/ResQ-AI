import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import { MdCall } from "react-icons/md";
import { AiFillCloseCircle } from "react-icons/ai";
import io from "socket.io-client";

const PriorityCards = ({
  priority,
  priorityCard,
  setpriorityCard,
  updateLabel,
  selectedCard,
  setSelectedCard,
}) => {
  const [resolvedCards, setResolvedCards] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'resolved'
  
  // Backend URL from environment or default
  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';
  console.log('[Socket] Connecting to backend:', BACKEND_URL);
  
  // setting up webserver connection with reconnection
  const socket = io(BACKEND_URL, { 
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });
  
  // Socket connection monitoring
  socket.on('connect', () => {
    console.log('[Socket] ✅ Connected to backend on', BACKEND_URL);
  });
  
  socket.on('disconnect', (reason) => {
    console.warn('[Socket] ⚠️ Disconnected:', reason);
  });
  
  socket.on('connect_error', (err) => {
    console.error('[Socket] ❌ Connection error:', err.message);
    console.error('[Socket] Is backend running on', BACKEND_URL, '?');
  });
  // Initial load from backend to persist across refresh
  useEffect(() => {
    async function loadInitial() {
      try {
        console.log('[API] Loading active calls from', BACKEND_URL);
        const resActive = await fetch(`${BACKEND_URL}/api/calls/active`);
        const jsonActive = await resActive.json();
        if (jsonActive.success) {
          const activeCards = jsonActive.data.map(call => ({
            inProgress: call.inProgress === 1 || call.inProgress === true,
            name: call.name,
            number: call.number,
            emergency: call.emergency,
            location: call.location,
            id: call.id,
            status: call.status || 'open',
            transcript: call.transcript,
            priority: call.priority || 0,
            coordinates: call.coordinates || null,
            createdAt: call.createdAt || null,
          }));
          setpriorityCard(activeCards);
        }
        const resResolved = await fetch(`${BACKEND_URL}/api/calls/resolved`);
        const jsonResolved = await resResolved.json();
        if (jsonResolved.success) {
          const resolved = jsonResolved.data.map(call => ({
            inProgress: false,
            name: call.name,
            number: call.number,
            emergency: call.emergency,
            location: call.location,
            id: call.id,
            status: call.status || 'resolved',
            transcript: call.transcript,
            priority: call.priority || 0,
            coordinates: call.coordinates || null,
            createdAt: call.createdAt || null,
          }));
          setResolvedCards(resolved);
        }
      } catch (err) {
        console.error('Failed to load initial calls', err);
      }
    }
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // setting up hugging face api
  let api_token = process.env.REACT_APP_HFTOKEN;
  let API_URL =
    "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2";

  // handling an emergency call
  socket.on("call progress event", async function (call) {
    console.log('[Socket] 📞 Received call progress event:', call);
    let thecards = [...priorityCard];
    let newCard = {
      inProgress: call.inProgress,
      name: call.name,
      number: call.number,
      emergency: call.emergency,
      location: call.location,
      id: call.id,
      status: "open",
      transcript: call.transcript,
      priority: call.priority || 0, // Use priority from backend or default to 0
      coordinates: call.coordinates || null, // Add GPS coordinates
      createdAt: call.createdAt || null,
    };

    let duplicate = thecards.findIndex(
      (card) => card.id && card.id == newCard.id
    );
    if (duplicate == -1) {
      thecards.push(newCard);
      setpriorityCard(thecards);
    } else {
      // Update existing card, preserve manually set priority if call is still in progress
      if (call.inProgress && thecards[duplicate].priority > 0) {
        newCard.priority = thecards[duplicate].priority;
      }
      thecards[duplicate] = newCard;
    }
    setpriorityCard(thecards);
  });

  // Handle call resolved events - move from active to resolved tab
  socket.on("call resolved", function (data) {
    console.log('[Socket] ✅ Call resolved:', data);
    
    // Remove from active cards
    const activeCards = priorityCard.filter(card => card.id !== data.id);
    setpriorityCard(activeCards);
    
    // Add to resolved cards
    const resolvedCard = priorityCard.find(card => card.id === data.id);
    if (resolvedCard) {
      setResolvedCards(prev => [...prev, { ...resolvedCard, status: 'resolved' }]);
    }
  });

  const MyMap = ({ coordinates }) => {
    // Use provided coordinates or default to Toronto
    const center = coordinates 
      ? [coordinates.lat, coordinates.lon]
      : [43.6534817, -79.38393473];
    
    const zoom = coordinates ? 16 : 12; // Zoom in more if we have exact coordinates
    
    return (
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        key={`${center[0]}-${center[1]}`} // Force re-render when coordinates change
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
        />
      </MapContainer>
    );
  };

  function addNewLines(text) {
    let result = [];
    result = text.split("\n");
    console.log(result);
    return result;
  }

  const handleResolve = async (cardId) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/calls/${cardId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        // Move card to resolved section
        const idx = priorityCard.findIndex(card => card.id === cardId);
        if (idx !== -1) {
          const resolved = { ...priorityCard[idx], status: 'resolved' };
          setResolvedCards(prev => [resolved, ...prev]);
        }
        // Remove from active list
        const updatedCards = priorityCard.filter(card => card.id !== cardId);
        setpriorityCard(updatedCards);
        setSelectedCard(false);
      }
    } catch (error) {
      console.error('Error resolving call:', error);
    }
  };

  return (
    <div>
      {/* Top tab switcher */}
      <div className="flex items-center gap-6 mb-4 text-sm">
        <button
          className={`${activeTab === 'active' ? 'text-black font-bold underline underline-offset-2' : 'text-myGrey'}`}
          onClick={() => setActiveTab('active')}
        >
          Incoming Emergencies
        </button>
        <button
          className={`${activeTab === 'resolved' ? 'text-black font-bold underline underline-offset-2' : 'text-myGrey'}`}
          onClick={() => setActiveTab('resolved')}
        >
          Resolved
        </button>
      </div>
      <h3
        className={`${
          priority == "Incomming" && "underline underline-offset-2 font-bold"
        } mb-8 min-w-[200px]  text-sm`}
      >
        {priority == "Incomming"
          ? "Assign Priority - Incomming"
          : `Level ${priority} Priority `}
      </h3>

      {activeTab === 'active' && priorityCard.map((card) => {
        if (
          priority == card.priority ||
          (priority == "Incomming" && card.priority == 0)
        ) {
          return card.id == selectedCard ? (
            <div
              key={card.id}
              className="relative mb-4 text-xs p-4 bg-white min-w-[600px] max-w-[900px] w-full border-[1px] border-myGrey rounded-lg min-w-88 min-h-64 "
            >
              <AiFillCloseCircle
                onClick={() => {
                  setSelectedCard(false);
                }}
                className="text-lg absolute top-2 right-2"
              />
              <div className="flex gap-2 items-center">
                <h3 className="font-bold text-sm py-2">{card.name} </h3>
                <MdCall className="w-4 h-4" />
              </div>
              <div className="text-xs">
                {/**first section */}
                <div className="flex text-myGrey gap-5">
                  <h3 className=" text-sm">Priority</h3>
                  <select
                    value={card.priority}
                    placeholder="select priority level"
                    onChange={updateLabel}
                    className="w-auto flex items-center justify-center rounded-full font-bold text-purple-500 bg-purple-100 py-1 px-2  "
                  >
                    <option value={0}>0</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                  </select>
                </div>
                <div className="flex items-center py-2 text-myGrey gap-5">
                  <h3 className=" text-sm">Number</h3>
                  <h3 className="w-auto flex items-center justify-center rounded-full font-bold text-orange-500 bg-orange-100 py-1 px-2  ">
                    {card.number}
                  </h3>
                  <h3 className=" text-sm">Status</h3>
                  <h3 className="w-auto flex items-center justify-center rounded-full font-bold text-pink-500 bg-pink-100  py-1 px-2 ">
                    {card.status}
                  </h3>
                  <h3 className=" text-sm">Emergency</h3>
                  <h3 className="w-auto flex items-center self-center text-center justify-center rounded-full font-bold text-green-500 bg-green-100  py-1 px-2 ">
                    {card.emergency}
                  </h3>
                </div>
                {/**second section */}
                <div className=" items-center py-2 text-myGrey gap-5">
                  <h3 className="font-bold underline text-sm">Transcript:</h3>
                  <h3 className=" text-sm">
                    {addNewLines(card.transcript).map((item) => {
                      if (item.includes("Dispatcher: ")) {
                        let todisplay = item.split("Dispatcher: ");
                        return (
                          <h3>
                            <span className="font-bold">Dispatcher: </span>
                            {todisplay}
                          </h3>
                        );
                      } else if (item.includes("Caller: ")) {
                        let todisplay = item.split("Caller: ");
                        return (
                          <h3>
                            <span className="font-bold">Caller: </span>
                            {todisplay}
                          </h3>
                        );
                      }
                    })}
                  </h3>
                </div>
                {/**third section */}
                <div className="flex py-1 items-center text-myGrey gap-5">
                  <h3 className=" text-sm">Location</h3>
                  <h3 className="w-auto flex items-center text-center self-center justify-center rounded-full font-bold text-blue-500 bg-blue-100  py-1 px-2 ">
                    {card.location}
                  </h3>
                  <h3 className=" text-xs text-gray-400">{card.createdAt ? new Date(card.createdAt).toLocaleString() : ""}</h3>
                  <h3 className="hover:text-blue-600 cursor-pointer underline">
                    Get Location
                  </h3>
                </div>
                {/**map */}
                <div className="w-64 h-64">{MyMap({ coordinates: card.coordinates })}</div>
                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={() => handleResolve(card.id)}
                    className="w-48 border-[1px] border-green-500 cursor-pointer flex items-center text-center self-center justify-center rounded-full font-bold text-green-500 bg-green-100 text-sm py-1 px-2 hover:bg-green-200"
                  >
                    ✓ Resolved
                  </button>
                  <button className="w-48 border-[1px] border-red-500 cursor-pointer flex items-center text-center self-center justify-center rounded-full font-bold text-red-500 bg-red-100 text-sm py-1 px-2 hover:bg-red-200">
                    Schedule Dispatch
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              key={card.id}
              onClick={() => {
                setSelectedCard(card.id);
              }}
              className="mb-4 text-xs p-4 bg-white min-w-[400px] max-w-[900px] w-full border-[1px] border-myGrey rounded-lg min-w-88 min-h-64 "
            >
              <h3 className="font-bold py-2 min-w-[400px]  text-sm ">
                {card.name}
              </h3>
              <div className="text-xs">
                {/**first section */}
                <div className="flex text-myGrey items-center mt-2 gap-5">
                  <h3 className=" text-sm">Number</h3>
                  <h3 className="w-auto flex items-center justify-center rounded-full font-bold text-orange-500 bg-orange-100 py-1 px-2  ">
                    {card.number}
                  </h3>
                </div>

                {/**second section */}
                <div className="flex items-center py-2 text-myGrey gap-5">
                  <h3 className=" text-sm">Status</h3>
                  <h3 className="w-auto flex items-center justify-center rounded-full font-bold text-pink-500 bg-pink-100  py-1 px-2 ">
                    {card.status}
                  </h3>
                  <h3 className=" text-sm">Emergency</h3>
                  <h3 className="w-auto flex items-center self-center text-center justify-center rounded-full font-bold text-green-500 bg-green-100  py-1 px-2 ">
                    {card.emergency}
                  </h3>
                </div>

                {/**third section */}
                <div className="flex items-center text-myGrey gap-5">
                  <h3 className=" text-sm">Location</h3>
                  <h3 className="w-auto flex items-center text-center self-center justify-center rounded-full font-bold text-blue-500 bg-blue-100  py-1 px-2 ">
                    {card.location}
                  </h3>
                  <h3 className=" text-xs text-gray-400">{card.createdAt ? new Date(card.createdAt).toLocaleString() : ""}</h3>
                </div>
              </div>
            </div>
          );
        }
      })}
      {activeTab === 'resolved' && (
        <div className="mt-2">
          {resolvedCards.length === 0 && (
            <div className="text-xs text-myGrey">No resolved cases yet.</div>
          )}
          {resolvedCards.map((card) => (
            <div key={`resolved-${card.id}`} className="mb-3 text-xs p-3 bg-gray-50 border border-myGrey rounded-lg min-w-[400px] max-w-[900px] w-full">
              <div className="flex items-center gap-3">
                <span className="font-bold text-sm">{card.name}</span>
                <span className="rounded-full font-bold text-orange-500 bg-orange-100 py-1 px-2">{card.number}</span>
                <span className="rounded-full font-bold text-green-500 bg-green-100 py-1 px-2">{card.emergency}</span>
                <span className="rounded-full font-bold text-blue-500 bg-blue-100 py-1 px-2">{card.location}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {card.createdAt ? new Date(card.createdAt).toLocaleString() : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PriorityCards;
