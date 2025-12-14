import React, { useState, useEffect } from "react";
import PriorityCards from "./PriorityCards";
import { liveData, automatedData } from "../data/data";
import io from "socket.io-client";

const Content = () => {
  const [automated, setautomated] = useState(true);
  const [selectedCard, setSelectedCard] = useState("efnwhfwhn1");
  const [data, setData] = useState(liveData);
  const [priorityCard, setpriorityCard] = useState(automatedData);
  const [liveCallData, setLiveCallData] = useState([]);
  let labels = ["Incomming", "1", "2", "3", "4", "5"];

  // Socket.IO connection for real-time call updates
  useEffect(() => {
    const socket = io('http://localhost:3001', {
      transports: ['websocket'],
      upgrade: false
    });
    
    // Load existing calls from database on mount
    const loadCalls = () => {
      fetch('http://localhost:3001/api/calls')
        .then(res => res.json())
        .then(calls => {
          console.log('Loaded calls from database:', calls);
          setpriorityCard(calls);
        })
        .catch(err => console.error('Error loading calls:', err));
    };
    
    loadCalls();
    
    socket.on('call progress event', (callData) => {
      console.log('Live call update received:', callData);
      
      // Only process if we have a valid call ID
      if (!callData || !callData.id) {
        console.log('Invalid call data, skipping update');
        return;
      }
      
      // Update priority cards with new data
      setpriorityCard(prev => {
        const existingIndex = prev.findIndex(call => call.id === callData.id);
        
        if (existingIndex !== -1) {
          // Update existing call
          console.log('Updating existing call at index', existingIndex);
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...callData,
            status: callData.status || updated[existingIndex].status,
            priority: callData.priority !== undefined ? callData.priority : updated[existingIndex].priority
          };
          console.log('Updated call:', updated[existingIndex]);
          return updated;
        } else {
          // Add new call with default values
          console.log('Adding new call');
          const newCall = {
            id: callData.id,
            name: callData.name || 'Unknown Caller',
            number: callData.number || 'Unknown',
            emergency: callData.emergency || 'Unknown Emergency',
            location: callData.location || 'Unknown Location',
            status: callData.status || 'open',
            priority: callData.priority !== undefined ? callData.priority : 0,
            transcript: callData.transcript || '',
            inProgress: callData.inProgress !== false
          };
          return [...prev, newCall];
        }
      });
    });
    
    // Handle call resolved event
    socket.on('call resolved', (data) => {
      console.log('Call resolved:', data.id);
      setpriorityCard(prev => prev.filter(call => call.id !== data.id));
    });

    // Auto-refresh calls every 3 seconds for real-time updates
    const refreshInterval = setInterval(() => {
      loadCalls();
    }, 3000);

    return () => {
      console.log('Disconnecting socket');
      socket.disconnect();
      clearInterval(refreshInterval);
    };
  }, []);

  const updateLabel = (e) => {
    let theCards = [];
    const currentData = automated ? priorityCard : [...data, ...liveCallData];

    currentData.forEach((card) => {
      if (card.id === selectedCard) {
        theCards.push({
          ...card,
          priority: parseInt(e.target.value),
        });
      } else {
        theCards.push(card);
      }
    });
    
    if (automated) {
      setpriorityCard(theCards);
    } else {
      const staticData = theCards.filter(card => !card.inProgress && !liveCallData.find(live => live.id === card.id));
      const liveData = theCards.filter(card => liveCallData.find(live => live.id === card.id));
      setData(staticData);
      setLiveCallData(liveData);
    }
  };

  return (
    <div className="py-8" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/**top bar */}
      <div>
        <div className="flex">
          <div
            onClick={() => setautomated(true)}
            className={`w-36 bg-white text-red-600 border-gray-300 border-[1px]  items-center justify-center flex h-10 rounded-l-lg ${
              automated && `text-white bg-red-600`
            }`}
            style={{ 
              fontWeight: '700',
              fontSize: '0.95rem',
              letterSpacing: '0.5px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: automated ? '0 4px 15px rgba(255, 51, 51, 0.3)' : 'none'
            }}
          >
            <h3>Automated</h3>
          </div>
          <div
            onClick={() => setautomated(false)}
            className={`w-36 items-center justify-center border-gray-300 border-[1px]  flex h-10 rounded-r-lg ${
              !automated && `text-white bg-red-600`
            } bg-white text-red-600`}
            style={{ 
              fontWeight: '700',
              fontSize: '0.95rem',
              letterSpacing: '0.5px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              boxShadow: !automated ? '0 4px 15px rgba(255, 51, 51, 0.3)' : 'none'
            }}
          >
            <h3>Live Attended</h3>
          </div>
        </div>
      </div>

      {/**emergencies */}
      <div className="py-8 flex gap-5 w-full overflow-x-scroll ">
        {automated
          ? labels.map((label) => (
              <PriorityCards
                key={label}
                priority={label}
                priorityCard={priorityCard}
                setpriorityCard={setpriorityCard}
                updateLabel={updateLabel}
                selectedCard={selectedCard}
                setSelectedCard={setSelectedCard}
              />
            ))
          : labels.map((label) => (
              <PriorityCards
                key={label}
                priority={label}
                priorityCard={[...data, ...liveCallData]}
                setpriorityCard={setData}
                updateLabel={updateLabel}
                selectedCard={selectedCard}
                setSelectedCard={setSelectedCard}
              />
            ))}
      </div>
    </div>
  );
};

export default Content;
