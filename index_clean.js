//importing libraries
const cors = require("cors");
const express = require("express");
const session = require("express-session");
require("dotenv").config();
const axios = require("axios");
const twilio = require("twilio");
const bodyParser = require("body-parser");
const WebSocket = require("ws");
const { createClient } = require("@deepgram/sdk");
const Database = require("better-sqlite3");

// Import Deep Learning Priority Module
const { 
  initializePriorityModels, 
  assignPriorityML, 
  assignPriorityFallback 
} = require('./priorityML.js');

// Initialize Express/HTTP/Socket first
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, { cors: { origin: '*' } });

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Runtime state
const callStates = new Map();
let activeSocket = null;
let lastEmittedData = null;

// Environment/config
const OLLAMA_API = process.env.OLLAMA_API || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'neural-chat';
const SINGLE_QUESTION_MODE = false;

// Socket.io wiring
io.on('connection', (socket) => {
  console.log('🔌 [Socket] Frontend connected! Socket ID:', socket.id);
  activeSocket = socket;
  socket.on('disconnect', () => {
    console.log('🔌 [Socket] Frontend disconnected. Socket ID:', socket.id);
    if (activeSocket && activeSocket.id === socket.id) {
      activeSocket = null;
      console.log('   ⚠️ [Socket] Active socket cleared - no frontend connected');
    }
  });
});

// Import location parser
const { parseLocationComponents, getLocationHierarchy } = require('./locationParser');

// Initialize SQLite database
const db = new Database("emergency_calls.db");

// Create calls table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS emergency_calls (
    id TEXT PRIMARY KEY,
    emergency TEXT,
    name TEXT,
    location TEXT,
    number TEXT,
    transcript TEXT,
    priority INTEGER,
    status TEXT DEFAULT 'open',
    inProgress INTEGER DEFAULT 1,
    coordinates TEXT,
    city TEXT DEFAULT 'Unknown',
    district TEXT DEFAULT 'Unknown',
    state TEXT DEFAULT 'Unknown',
    country TEXT DEFAULT 'India',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_priority ON emergency_calls(priority);
  CREATE INDEX IF NOT EXISTS idx_created_at ON emergency_calls(created_at);
  CREATE INDEX IF NOT EXISTS idx_city ON emergency_calls(city);
  CREATE INDEX IF NOT EXISTS idx_district ON emergency_calls(district);
  CREATE INDEX IF NOT EXISTS idx_state ON emergency_calls(state);
  CREATE INDEX IF NOT EXISTS idx_status ON emergency_calls(status);
`);

// Resolve a call and persist in DB
app.post('/api/calls/:id/resolve', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare(`UPDATE emergency_calls SET status = 'resolved', inProgress = 0, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`);
    const result = stmt.run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }
    // also remove from in-memory state
    if (callStates.has(id)) callStates.delete(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// List active (in-progress/open) calls for UI reload
app.get('/api/calls/active', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, emergency, name, location, number, transcript, priority, inProgress, status, coordinates, created_at
      FROM emergency_calls
      WHERE inProgress = 1
      ORDER BY priority ASC, created_at ASC
    `).all();
    // parse coordinates JSON
    const data = rows.map(r => ({
      ...r,
      coordinates: r.coordinates ? JSON.parse(r.coordinates) : null,
      createdAt: r.created_at
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List resolved calls
app.get('/api/calls/resolved', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, emergency, name, location, number, transcript, priority, status, coordinates, created_at, resolved_at
      FROM emergency_calls
      WHERE status = 'resolved'
      ORDER BY resolved_at DESC
    `).all();
    const data = rows.map(r => ({
      ...r,
      coordinates: r.coordinates ? JSON.parse(r.coordinates) : null,
      createdAt: r.created_at
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Main /api/calls endpoint - returns active calls (for Content.js)
app.get('/api/calls', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, emergency, name, location, number, transcript, priority, inProgress, status, coordinates, created_at
      FROM emergency_calls
      WHERE inProgress = 1
      ORDER BY priority ASC, created_at ASC
    `).all();
    const data = rows.map(r => ({
      ...r,
      coordinates: r.coordinates ? JSON.parse(r.coordinates) : null,
      createdAt: r.created_at
    }));
    console.log('[API /api/calls] Returning', data.length, 'active calls');
    res.json(data);
  } catch (err) {
    console.error('[API] Error getting calls:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE endpoint to clear old test data
app.delete('/api/calls/clear/old', (req, res) => {
  try {
    // Delete calls that are resolved or from test data (older than specific IDs)
    const result = db.prepare(`
      DELETE FROM emergency_calls 
      WHERE status = 'resolved' OR id IN (
        'efjejoqokwjqfjwq', 'efnjffejwnwjnfj', 'efjejbwwfwfwnoqokq', 
        'efnjwfgwgfnjddfnwjnfj', 'efnjwfgwgfnjdd2fwjnfj'
      )
    `).run();
    
    console.log('[API] Deleted', result.changes, 'old test records');
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    console.error('[API] Error clearing old data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// (moved app/io initialization earlier)

// Helper: per-call state
function getCallState(callId) {
  if (!callId) return {};
  let cs = callStates.get(callId);
  if (!cs) {
    cs = {
      callId,
      init: false,
      hangUp: false,
      redo: [0, 0, 0],
      count: 0,
      transcript: '',
      emergency: null,
      name: null,
      location: null,
      number: null,
      coordinates: null,
    };
    callStates.set(callId, cs);
  }
  return cs;
}

  

// Helper function: Get priority label
function getPriorityLabel(priority) {
  switch(priority) {
    case 1: return "🔴 CRITICAL";
    case 2: return "🟠 HIGH";
    case 3: return "🟡 MEDIUM";
    case 4: return "🔵 LOW";
    case 5: return "🟢 INFO";
    default: return "⚪ UNKNOWN";
  }
}

// Helper function: Calculate time in queue
function calculateTimeInQueue(createdAt) {
  if (!createdAt) return "N/A";
  const created = new Date(createdAt);
  const now = new Date();
  const seconds = Math.floor((now - created) / 1000);
  
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

// Twilio call entrypoint
// Safe GET handler to avoid "application error" when accessed via browser/ngrok
app.get("/transcribe", (req, res) => {
  res.status(200).json({
    message: "This endpoint expects a POST from Twilio (webhook).",
    usage: {
      contentType: ["application/x-www-form-urlencoded", "application/json"],
      exampleForm: "CallSid=CA123&From=%2B1234567890&To=%2B1987654321&RecordingUrl=https%3A%2F%2Fexample.com%2Frec.wav",
      exampleJson: {
        CallSid: "CA123",
        From: "+1234567890",
        To: "+1987654321",
        RecordingUrl: "https://example.com/rec.wav"
      }
    }
  });
});

app.post("/transcribe", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Generate unique call ID from Twilio call SID if available, otherwise use timestamp
  const callId = req.body.CallSid || (Date.now() + "-" + Math.floor(Math.random() * 10000));
  
  // Get or create call state
  const callState = getCallState(callId);
  
  console.log(`\n📞 [/transcribe] Call ID: ${callId}, First call: ${!callState.init}`);

  if (!callState.init) {
    twiml.say({ voice: "Polly.Joanna-Neural" }, "1 1 2, what is your emergency?");
    callState.init = true;
    callState.hangUp = false;
    callState.redo = [0, 0, 0];
    callState.count = 0;
    callState.transcript = "Dispatcher: 112, what is your emergency?";
    callState.emergency = null;
    callState.name = null;
    callState.location = null;
    // Prefer caller ID from Twilio if available
    const fromRaw = req.body.From || "";
    if (fromRaw) {
      const digits = String(fromRaw).replace(/[^0-9]/g, "");
      if (digits.length >= 10) {
        const last10 = digits.slice(-10);
        callState.number = `${last10.slice(0,5)}-${last10.slice(5)}`;
      } else {
        callState.number = fromRaw;
      }
    } else {
      callState.number = null;
    }
    // Stamp call start time for UI cards
    callState.createdAt = new Date().toISOString();
  }

  twiml.gather({
    input: "speech",
    action: `/respond?callId=${callId}`,
    speechTimeout: "auto",
    speechModel: "experimental_conversations",
    enhanced: "true",
    language: "en-IN",
    hints: "Atharv, Bhavsar, Sukh Sagar, Pune, Maharashtra, Mumbai, Delhi, Bengaluru, Kolkata, Hyderabad, Ahmedabad, Chennai, Surat, Jaipur, Lucknow, Kanpur, Nagpur, Indore, Bhopal, Patna, Vadodara, Ghaziabad, emergency, fire, accident, medical, police, ambulance, hospital, location, address, street, road, avenue, boulevard, lane, drive, court, opposite, near, building, injured, help, stalking, assault, robbery, burglary, shooting, stabbing, overdose, heart attack, stroke, seizure, breathing, unconscious, bleeding, apartment, house, store, restaurant, park, school, church, mosque, temple, north, south, east, west, intersection, corner, block, highway, freeway, mile, kilometer, sector, number",
    profanityFilter: "false"
  });

  // Safety: if no input is received, ensure the call flow continues
  twiml.redirect({ method: 'POST' }, `/respond?callId=${callId}`);

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// Endpoint to receive GPS coordinates from caller's device
app.post("/location", async (req, res) => {
  const { latitude, longitude, accuracy, callId } = req.body;
  
  if (latitude && longitude && callId) {
    console.log(`[GPS] Received precise coordinates: ${latitude}, ${longitude} (accuracy: ${accuracy}m)`);
    
    // Get call state
    const callState = getCallState(callId);
    
    callState.coordinates = {
      lat: latitude,
      lon: longitude,
      accuracy: accuracy,
      source: 'device-gps'
    };
    
    // Reverse geocode to get address
    try {
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse`,
        {
          params: {
            lat: latitude,
            lon: longitude,
            format: 'json'
          },
          headers: {
            'User-Agent': 'RESQ-AI-911-Dispatch/1.0'
          },
          timeout: 5000
        }
      );
      
      if (response.data && response.data.display_name) {
        callState.location = response.data.display_name;
        callState.coordinates.displayName = response.data.display_name;
        console.log(`[GPS] Reverse geocoded to: ${callState.location}`);
      }
    } catch (error) {
      console.error('[GPS] Reverse geocoding failed:', error.message);
    }
    
    // Emit to dashboard immediately
    if (activeSocket) {
      const priority = await assignPriority(callState.emergency);
      activeSocket.emit("call progress event", {
        id: callState.callId,
        emergency: callState.emergency,
        name: callState.name,
        number: callState.number,
        location: callState.location,
        inProgress: true,
        transcript: callState.transcript,
        coordinates: callState.coordinates,
        priority: priority
      });
    }
    
    res.json({ success: true, message: 'Location received' });
  } else {
    res.status(400).json({ error: 'Invalid coordinates or callId' });
  }
});

// respond endpoint handles responce generation and call termination
app.post("/respond", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const callId = req.query.callId || req.body.CallSid;
  
  console.log("\n=== /respond ENDPOINT CALLED ===");
  console.log(`   req.query.callId: ${req.query.callId}`);
  console.log(`   req.body.CallSid: ${req.body.CallSid}`);
  console.log(`   req.body.SpeechResult: ${req.body.SpeechResult}`);
  console.log(`   All req.body keys: ${Object.keys(req.body).join(', ')}`);
  
  // CRITICAL: Validate callId
  if (!callId) {
    console.error("❌ CRITICAL: No callId provided to /respond endpoint!");
    console.error("   req.query.callId:", req.query.callId);
    console.error("   req.body.CallSid:", req.body.CallSid);
    console.error("   Full req.body:", JSON.stringify(req.body, null, 2));
    twiml.say({ voice: "Polly.Joanna-Neural" }, "System error. Please call 112 again.");
    twiml.hangup();
    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
    return;
  }
  
  const callState = getCallState(callId);
  let voiceInput = req.body.SpeechResult || "";
  
  // Debug: Log session state
  console.log(`📞 [/respond] Call ID: ${callId}`);
  console.log(`   Init: ${callState.init}, Emergency: ${callState.emergency}, Count: ${callState.count}, HangUp: ${callState.hangUp}`);
  
  // Clean up transcription - Twilio sometimes adds extra spaces or formatting
  if (voiceInput) {
    voiceInput = voiceInput.trim();
    console.log("   Raw voice input:", voiceInput);
    
    callState.transcript += `\nCaller: ${voiceInput}\nDispatcher: `;
  } else {
    console.log("   ⚠️  No speech detected - requesting input again");
    // If no speech detected, ask again
    twiml.gather({
      input: "speech",
      action: `/respond?callId=${callId}`,
      speechTimeout: "auto",
      speechModel: "experimental_conversations",
      enhanced: "true",
      language: "en-IN",
      hints: "Atharv, Bhavsar, emergency, fire, accident, medical, police, ambulance, hospital, location, address, street, road, avenue, boulevard, lane, drive, court, opposite, near, building, injured, help, stalking, assault, robbery, burglary, shooting, stabbing, overdose, heart attack, stroke, seizure, breathing, unconscious, bleeding, apartment, house, store, restaurant, park, school, church, mosque, temple, north, south, east, west, intersection, corner, block, highway, freeway, mile, kilometer, sector, number",
      profanityFilter: "false"
    });
    // Safety: continue call even if gather times out
    twiml.redirect({ method: 'POST' }, `/respond?callId=${callId}`);
    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
    return;
  }

  try {
    let aiResponse = await generateAIResponse(callState);
    console.log("   AI Response generated:", aiResponse.substring(0, 80) + "...");
    
    if (!aiResponse || aiResponse.trim() === "") {
      console.error("   ⚠️  AI returned empty response, using fallback");
      aiResponse = "Please provide more information so I can help you.";
    }
    
    twiml.say({ voice: "Polly.Joanna-Neural" }, aiResponse);
    
    // Single-question mode keeps the call open without prompting further
    if (SINGLE_QUESTION_MODE) {
      twiml.say({ voice: "Polly.Joanna-Neural" }, "Thank you. Please stay on the line. We are dispatching help.");
      twiml.pause({ length: 300 }); // keep the line open ~5 minutes
    } else {
      // Add gather to continue listening for caller's response
      if (!callState.hangUp) {
        twiml.gather({
          input: "speech",
          action: `/respond?callId=${callId}`,
          speechTimeout: "auto",
          speechModel: "experimental_conversations",
          enhanced: "true",
          language: "en-IN",
          hints: "Atharv, Bhavsar, emergency, fire, accident, medical, police, ambulance, hospital, location, address, street, road, avenue, boulevard, lane, drive, court, opposite, near, building, injured, help, stalking, assault, robbery, burglary, shooting, stabbing, overdose, heart attack, stroke, seizure, breathing, unconscious, bleeding, apartment, house, store, restaurant, park, school, church, mosque, temple, north, south, east, west, intersection, corner, block, highway, freeway, mile, kilometer, sector, number",
          profanityFilter: "false"
        });
        // Safety: ensure flow persists on timeout
        twiml.redirect({ method: 'POST' }, `/respond?callId=${callId}`);
      }
    }
  } catch (error) {
    console.error("❌ AI Response Error:", error.message);
    console.error("   Stack:", error.stack);
    twiml.say({ voice: "Polly.Joanna-Neural" }, "I'm processing your request. Please stay on the line.");
    
    // DON'T set hangUp = true on error - continue the call
    // Only set hangUp if it was already marked in generateAIResponse
    if (!callState.hangUp) {
      twiml.gather({
        input: "speech",
        action: `/respond?callId=${callId}`,
        speechTimeout: "auto",
        speechModel: "experimental_conversations",
        enhanced: "true",
        language: "en-IN",
        hints: "Atharv, Bhavsar, emergency, fire, accident, medical, police, ambulance, hospital, location, address, street, road, avenue, boulevard, lane, drive, court, opposite, near, building, injured, help, stalking, assault, robbery, burglary, shooting, stabbing, overdose, heart attack, stroke, seizure, breathing, unconscious, bleeding, apartment, house, store, restaurant, park, school, church, mosque, temple, north, south, east, west, intersection, corner, block, highway, freeway, mile, kilometer, sector, number",
        profanityFilter: "false"
      });
    }
  }

  // Prepare data to emit
  const emergencyType = callState.emergency;
  // Always assign priority if we have emergency type, even if call is still in progress
  const autoPriority = emergencyType && emergencyType !== "undefined" ? await assignPriority(emergencyType) : 0;
  
  const callData = {
    inProgress: callState.hangUp ? false : true,
    emergency: emergencyType,
    name: callState.name,
    location: callState.location,
    number: callState.number,
    transcript: callState.transcript,
    id: callState.callId,
    coordinates: callState.coordinates || null,
    priority: autoPriority, // Auto-assign priority based on emergency type
    createdAt: callState.createdAt || new Date().toISOString(),
  };
  
  if (autoPriority > 0) {
    console.log(`   [Auto-Priority] Assigned priority ${autoPriority} for ${emergencyType}${callState.hangUp ? ' (call ended)' : ' (in progress)'}`);
  }

  // Parse location components BEFORE database save
  let locationData = {
    city: 'Unknown',
    district: 'Unknown',
    state: 'Unknown',
    country: 'India'
  };

  if (callState.location || (callState.coordinates && callState.coordinates.lat)) {
    locationData = await parseLocationComponents(
      callState.location,
      callState.coordinates?.lat,
      callState.coordinates?.lon
    );
  }

  // Save to database with queue tracking
  try {

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO emergency_calls 
      (id, emergency, name, location, number, transcript, priority, status, inProgress, coordinates, city, district, state, country, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      callData.id,
      callData.emergency,
      callData.name,
      callData.location,
      callData.number,
      callData.transcript,
      autoPriority,
      'open',
      callData.inProgress ? 1 : 0,
      callData.coordinates ? JSON.stringify(callData.coordinates) : null,
      locationData.city,
      locationData.district,
      locationData.state,
      locationData.country
    );
    
    // Log queue information
    const queue = getCallQueue();
    const callPosition = queue.findIndex(c => c.id === callData.id) + 1;
    
    if (callData.inProgress && queue.length > 0) {
      console.log(`   ✅ [Database] Saved - ID: ${callData.id.substring(0, 20)}..., Emergency: ${callData.emergency}, Priority: ${autoPriority}`);
      console.log(`   📊 [Queue] Call #${callPosition} of ${queue.length} - Next to dispatch: ${queue[0]?.name || 'Fetching...'} (Priority ${queue[0]?.priority})`);
    }
  } catch (dbError) {
    console.error("   Database save error:", dbError);
  }

  // ALWAYS emit to ensure frontend receives updates
  if (activeSocket) {
    console.log("   📤 [Socket] Emitting 'call progress event' to frontend");
    console.log("      Call ID:", callData.id);
    console.log("      Emergency:", callData.emergency);
    console.log("      Name:", callData.name);
    console.log("      Location:", locationData.city + ', ' + locationData.state);
    console.log("      Socket ID:", activeSocket.id);
    
    // Include location data in Socket emission
    const socketData = {
      ...callData,
      city: locationData.city,
      district: locationData.district,
      state: locationData.state,
      country: locationData.country,
      status: 'open'
    };
    
    activeSocket.emit("call progress event", socketData);
    lastEmittedData = { ...socketData };
  } else {
    console.error("   ❌ [Socket] NO ACTIVE SOCKET! Frontend will NOT receive this call.");
    console.error("      Make sure frontend is running and connected to Socket.IO");
  }

  if (callState.hangUp) {
    twiml.hangup();
    console.log("   \n🏁 Call ended. ID:", callState.callId);
    console.log("   Final Data:");
    console.log(`     Emergency: ${callState.emergency}`);
    console.log(`     Name: ${callState.name}`);
    console.log(`     Location: ${callState.location}`);
    console.log(`     Number: ${callState.number}`);

    // Clean up call state from memory (database already has it)
    callStates.delete(callState.callId);
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// Call Ollama API with improved error handling
async function callOllama(prompt, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`   [Ollama] Calling API (attempt ${i + 1}/${maxRetries})...`);
      const response = await axios.post(OLLAMA_API, {
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        temperature: 0.7,
      }, {
        timeout: 30000 // 30 second timeout
      });
      
      if (!response.data || !response.data.response) {
        throw new Error("Ollama returned empty response");
      }
      
      const result = response.data.response.trim();
      console.log(`   [Ollama] Response received: ${result.substring(0, 100)}...`);
      return result;
    } catch (error) {
      console.error(`   ❌ Ollama API Error (attempt ${i + 1}/${maxRetries}): ${error.message}`);
      
      if (i < maxRetries - 1) {
        const delayMs = (i + 1) * 1000;
        console.log(`   ⏳ Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.error(`   ❌ Ollama API failed after ${maxRetries} attempts`);
        throw error;
      }
    }
  }
}

// Assign priority based on emergency type using DEEP LEARNING
// 5-Level Priority System (Comprehensive Emergency Classification)
// L1 = Priority 1: IMMEDIATE / LIFE-THREATENING (Red)
// L2 = Priority 2: URGENT / HIGH RISK (Orange)
// L3 = Priority 3: SEMI-URGENT (Yellow)
// L4 = Priority 4: NON-URGENT (Blue)
// L5 = Priority 5: INFORMATION / ROUTINE (Green)
// ⚠️ CRITICAL: Priority assignment is AUTOMATIC using neural network classification
async function assignPriority(emergency) {
  // Use deep learning neural network for intelligent classification
  try {
    const result = await assignPriorityML(emergency);
    console.log(`   [DL-Priority] ${result.method.toUpperCase()}: Level ${result.priority} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
    return result.priority || 4;
  } catch (error) {
    console.error('[DL] Classification error:', error.message);
    const fallbackResult = assignPriorityFallback(emergency);
    return fallbackResult.priority || 4;
  }
}

// Get call queue ordered by priority (lower number = higher urgency) and timestamp (FIFO for same priority)
function getCallQueue() {
  try {
    const calls = db.prepare(`
      SELECT id, emergency, name, location, number, priority, created_at, inProgress
      FROM emergency_calls
      WHERE inProgress = 1
      ORDER BY priority ASC, created_at ASC
    `).all();
    return calls;
  } catch (error) {
    console.error('Error fetching call queue:', error);
    return [];
  }
}

// Get next call to dispatch (highest priority, oldest timestamp)
function getNextCallToDispatch() {
  const queue = getCallQueue();
  return queue.length > 0 ? queue[0] : null;
}

// Geocode address to get GPS coordinates using free Nominatim API
async function geocodeAddress(address) {
  try {
    console.log(`[Geocoding] Converting address to coordinates: ${address}`);
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'TriageAI-911-Dispatch-System'
      },
      timeout: 5000
    });

    if (response.data && response.data.length > 0) {
      const result = response.data[0];
      const coordinates = {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        displayName: result.display_name,
        address: result.address
      };
      console.log(`[Geocoding] Found coordinates: ${coordinates.lat}, ${coordinates.lon}`);
      return coordinates;
    } else {
      console.log(`[Geocoding] No coordinates found for: ${address}`);
      // Fallback to Vishwakarma Institute of Technology, Pune
      return {
        lat: 18.4636,
        lon: 73.8682,
        displayName: "Vishwakarma Institute of Technology, Pune, Maharashtra, India",
        address: {
          building: "Vishwakarma Institute of Technology",
          city: "Pune",
          state: "Maharashtra",
          country: "India"
        }
      };
    }
  } catch (error) {
    console.error('[Geocoding] Error:', error.message);
    // Fallback to Vishwakarma Institute of Technology, Pune
    return {
      lat: 18.4636,
      lon: 73.8682,
      displayName: "Vishwakarma Institute of Technology, Pune, Maharashtra, India",
      address: {
        building: "Vishwakarma Institute of Technology",
        city: "Pune",
        state: "Maharashtra",
        country: "India"
      }
    };
  }
}

// generateAIResponse generates the next dispatcher line
async function generateAIResponse(callState) {
  console.log("   [AI] Transcript so far:", callState.transcript.substring(0, 150) + "...");

  if (!callState.emergency || callState.emergency === "undefined") {
    console.log("   🚨 Extracting emergency type...");
    const prompt = `You are a 911 dispatch officer. Extract the nature of emergencies in less than 5 key words.

Here is an emergency: ${callState.transcript}. Extract the nature of this emergency in less than 5 key words:`;
    
    try {
      const emergencyresp = await callOllama(prompt);
      
      if (!emergencyresp || emergencyresp.trim() === "") {
        console.log("   ⚠️  Ollama returned empty emergency - asking again");
        return "I need you to tell me what your emergency is. What's happening?";
      }
      
      callState.emergency = emergencyresp.trim();
      console.log("   ✅ Emergency set to:", callState.emergency);

      const botResponce = "Okay, stay calm. Can you tell me your exact location? Please include the street name, building number, or any nearby landmarks.";
      callState.transcript += `\nDispatcher: ${botResponce}`;
      return botResponce;
    } catch (error) {
      console.error("   ❌ Emergency extraction failed:", error.message);
      // Don't give up - ask again
      return "I'm sorry, can you tell me again what your emergency is?";
    }
  }

  if (!callState.location || callState.location === "undefined") {
    console.log("   📍 Extracting location...");
    const prompt = `Extract ONLY the location/address from this 911 emergency call transcript. Look for ANY mention of: street names, road names, building names, landmarks, areas, neighborhoods, "opposite to", "near", or any place reference.

Transcript: ${callState.transcript}

IMPORTANT: Pay special attention to the LAST thing the caller said. They may have provided location details like:
- Street names/numbers (e.g., "235 September", "123 Main Street")
- Landmarks (e.g., "opposite to police station", "near Central Park")
- Building names (e.g., "Airport Road Mall", "City Hospital")
- Neighborhoods/areas (e.g., "Downtown", "Brooklyn")

If you find ANY location information at all (even partial like "opposite police station" or "235 September"), return the COMPLETE location exactly as stated. Combine all location parts together.

If there is absolutely NO location mentioned, return exactly the word "undefined".

Location:`;
    
    try {
      const locationresp = await callOllama(prompt);
      console.log("   📍 Location response:", locationresp);

      if (locationresp.toLowerCase().includes("undefined") && callState.redo[0] < 2) {
        console.log("   no location given");
        const botResponce = callState.redo[0] === 0 ? 
          "I need your exact location to send help. Can you tell me your address or where you are?" :
          "Please help me understand where you are. What street, building, or landmark are you near?";
        callState.transcript += `\nDispatcher: ${botResponce}`;
        callState.redo[0] += 1;
        return botResponce;
      }

      if (locationresp.toLowerCase().includes("undefined")) {
        callState.location = "Location not provided by caller";
      } else {
        callState.location = locationresp.trim();
        console.log("   ✅ Location set to:", callState.location);
        
        // Try to geocode the location to get GPS coordinates
        const coordinates = await geocodeAddress(callState.location);
        if (coordinates) {
          callState.coordinates = coordinates;
          callState.location = coordinates.displayName; // Use full formatted address
          console.log("   ✅ Geocoded location:", callState.location);
          console.log("   ✅ GPS Coordinates:", `${coordinates.lat}, ${coordinates.lon}`);
        }
      }

      const botResponce = "Okay, can I get your full name?";
      callState.transcript += `\nDispatcher: ${botResponce}`;
      return botResponce;
    } catch (error) {
      console.error("   ❌ Location extraction failed:", error.message);
      return "Can you tell me your full name?";
    }
  }

  if (!callState.name || callState.name === "undefined") {
    console.log("   👤 Extracting name...");
    const prompt = `Extract the caller's name from this emergency call transcript. The dispatcher is asking for the caller's name.

Transcript: ${callState.transcript}

IMPORTANT: Look at what the caller said AFTER "can I get your full name" or "tell me your name".
Common speech recognition errors to correct:
- "Browser" is likely "Bhavsar" (Indian surname)
- "Athar" might be "Atharv" 
- Numbers (like phone numbers) are NOT names
- Look for actual person names

Return ONLY the person's name if clearly stated, or return exactly the word "undefined" if NO name is mentioned.

Name:`;
    
    try {
      const nameresp = await callOllama(prompt);
      console.log("   👤 Name response:", nameresp);

      if (nameresp.toLowerCase().includes("undefined") && callState.redo[1] < 2) {
        console.log("   no name given");
        const botResponce = callState.redo[1] === 0 ? 
          "I need your name for our records. Can you please tell me your full name, slowly and clearly?" :
          "Please say your first name and last name, one word at a time.";
        callState.transcript += `\nDispatcher: ${botResponce}`;
        callState.redo[1] += 1;
        return botResponce;
      }

      if (nameresp.toLowerCase().includes("undefined")) {
        callState.name = "Name not provided by caller";
      } else {
        callState.name = nameresp.trim();
        console.log("   ✅ Name set to:", callState.name);
      }

      const botResponce = "And what's your phone number just in case we get disconnected?";
      callState.transcript += `\nDispatcher: ${botResponce}`;
      return botResponce;
    } catch (error) {
      console.error("   ❌ Name extraction failed:", error.message);
      callState.name = "Name not provided";
      return "Can you tell me your phone number?";
    }
  }

  if (!callState.number || callState.number === "undefined") {
    console.log("   ☎️  Extracting phone number...");
    const prompt = `Extract the phone number from this emergency call transcript. Look for when the dispatcher asks for the phone number and what numbers the caller says.

Transcript: ${callState.transcript}

Return ONLY the phone number if found (e.g., "98765-43210", "9876543210"), or return the exact word "undefined" if NO phone number is mentioned.`;
    
    try {
      const numberresp = await callOllama(prompt);
      console.log("   ☎️  Phone response:", numberresp);

      // Normalize and validate phone to 10 digits
      const lower = numberresp ? numberresp.toLowerCase().trim() : "undefined";
      if (lower === "undefined") {
        if (callState.redo[2] < 2) {
          console.log("   no number given");
          const botResponce = callState.redo[2] === 0 ? 
            "I need your phone number in case we get disconnected. What's your number?" :
            "Please tell me your phone number so we can stay connected.";
          callState.transcript += `\nDispatcher: ${botResponce}`;
          callState.redo[2] += 1;
          return botResponce;
        }
        callState.number = "Phone number not provided by caller";
      } else {
        const digits = lower.replace(/[^0-9]/g, "");
        if (digits.length === 10) {
          // format as XXXXX-XXXXX (Indian format)
          const formatted = `${digits.slice(0,5)}-${digits.slice(5)}`;
          callState.number = formatted;
          console.log("   ✅ Phone set to:", callState.number);
        } else if (digits.length > 0) {
          // ask again until we get 10 digits
          if (callState.redo[2] < 3) {
            const botResponce = "Please repeat your 10 digit phone number slowly, one digit at a time.";
            callState.transcript += `\nDispatcher: ${botResponce}`;
            callState.redo[2] += 1;
            return botResponce;
          } else {
            callState.number = "Invalid phone number provided";
          }
        } else {
          callState.number = "Phone number not provided by caller";
        }
      }

      // Save to database after phone number collected
      console.log("   ✅ All required info collected - saving to database");
      const priority = await assignPriority(callState.emergency);
      await saveCallToDatabase(callState);

      const botResponce = "Thank you. I'm dispatching help to your location right now. Can you tell me more details about what's happening so I can give you the best guidance?";
      callState.transcript += `\nDispatcher: ${botResponce}`;
      return botResponce;
    } catch (error) {
      console.error("   ❌ Phone extraction failed:", error.message);
      return "Thank you for that information. Can you tell me more details about what's happening?";
    }
  }

  // Only proceed to follow-up questions if we have all required info
  const hasEmergency = callState.emergency && callState.emergency !== "undefined" && !callState.emergency.toLowerCase().includes("undefined") && callState.emergency !== "Name not provided";
  const hasLocation = callState.location && callState.location !== "undefined" && !callState.location.toLowerCase().includes("undefined") && callState.location !== "Location not provided by caller";
  const hasName = callState.name && callState.name !== "undefined" && !callState.name.toLowerCase().includes("undefined") && callState.name !== "Name not provided by caller";
  const hasNumber = callState.number && callState.number !== "undefined" && !callState.number.toLowerCase().includes("undefined") && callState.number !== "Phone number not provided by caller";
  
  console.log(`   📋 Status: Emergency=${hasEmergency} Location=${hasLocation} Name=${hasName} Number=${hasNumber}, FollowupCount=${callState.count}, HangUp=${callState.hangUp}`);
  
  if (hasEmergency && hasLocation && hasName && hasNumber) {
    console.log("   ✅ All required fields collected - proceeding to follow-up questions");
    
    let followupPrompt = `you are an automated ai dispatch officer talking to a human. 
      Here is the past conversation -> ${callState.transcript}. 
      Emergency: ${callState.emergency}
      Location: ${callState.location}
      Name: ${callState.name}
      Phone: ${callState.number}
      
      Your job is to gather additional details, provide help and guidance, then professionally end the call.
      Be supportive, professional, and helpful. Ask relevant follow-up questions about the emergency.
      Keep your response to 2-3 sentences maximum.
      Write the next dispatcher line.
          `;

    if (callState.count == 0) {
      console.log("   📞 Follow-up question 1/4 - Emergency details");
      followupPrompt += "Ask for more specific details about the emergency situation. What exactly do you see? Are there any injuries? Dispatcher: \n";
    } else if (callState.count == 1) {
      console.log("   📞 Follow-up question 2/4 - Safety status");
      followupPrompt += `Ask follow-up questions to get more details. Is everyone okay? Is anyone injured? Are there any hazards? Dispatcher:\n`;
    } else if (callState.count == 2) {
      console.log("   📞 Follow-up question 3/4 - Additional details");
      followupPrompt += `Ask additional important details. Are emergency services needed for anything specific? Is traffic affected? Any other important information? Dispatcher:\n`;
    } else if (callState.count == 3) {
      console.log("   📞 Follow-up question 4/4 - Final details");
      followupPrompt += `Ask one more clarifying question to ensure you have all important details before ending the call. Dispatcher:\n`;
    } else if (callState.count >= 4) {
      console.log("   📞 End of call - saying goodbye");
      followupPrompt += `Now professionally end the call by saying "Emergency services are already on the way to your location. I'm going to end this call now so we can dispatch the appropriate teams. Thank you for your information and for calling 911." 
              Dispatcher:\n`;
      callState.hangUp = true;
    }

    const aiPrompt = `You are a 911 dispatch officer providing emergency assistance.

${followupPrompt}`;

    try {
      const botResponce = await callOllama(aiPrompt);

      if (botResponce == "" || !botResponce) {
        console.log("   ⚠️  Empty response from AI - using fallback");
        return "Thank you for providing all of this information. I will have a 9-1-1 dispatch officer get in contact with you as soon as possible.";
      } else {
        console.log(`   ✅ Follow-up response (count=${callState.count}): ${botResponce.substring(0, 100)}`);
        let toreturn = botResponce.trim();
        callState.transcript += `\nCaller: [listening...]\nDispatcher: ${toreturn}`;
        callState.count += 1;
        return toreturn;
      }
    } catch (error) {
      console.error("   ❌ Follow-up response failed:", error.message);
      if (callState.count >= 3) {
        callState.hangUp = true;
        return "Emergency services are already on the way to your location. I'm going to end this call now so we can dispatch the appropriate teams. Thank you for your information and for calling 112.";
      } else {
        return "Can you provide more details about this emergency?";
      }
    }
  } else {
    console.log("   ❌ Missing required fields - prompting for missing info");
    if (!hasEmergency) {
      return "I need you to tell me what your emergency is. What's happening?";
    } else if (!hasLocation) {
      return "I need your location to send help. Where are you right now?";
    } else if (!hasName) {
      return "I need your name for our records. What's your full name?";
    } else if (!hasNumber) {
      return "I need your phone number in case we get disconnected. What's your number?";
    } else {
      return "I'm collecting your information to dispatch help. Please stay on the line.";
    }
  }
}

// Helper function to save call state to database
async function saveCallToDatabase(callState) {
  try {
    const priority = await assignPriority(callState.emergency);
    
    // Parse location components
    let locationData = {
      city: 'Unknown',
      district: 'Unknown',
      state: 'Unknown',
      country: 'India'
    };

    if (callState.location || (callState.coordinates && callState.coordinates.lat)) {
      locationData = await parseLocationComponents(
        callState.location,
        callState.coordinates?.lat,
        callState.coordinates?.lon
      );
    }

    // Insert into database with location fields
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO emergency_calls 
      (id, emergency, name, location, number, transcript, priority, status, inProgress, coordinates, city, district, state, country, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      callState.callId,
      callState.emergency,
      callState.name,
      callState.location,
      callState.number,
      callState.transcript,
      priority,
      'open',
      callState.hangUp ? 0 : 1,
      callState.coordinates ? JSON.stringify(callState.coordinates) : null,
      locationData.city,
      locationData.district,
      locationData.state,
      locationData.country
    );
    
    // Get queue position
    const queue = getCallQueue();
    const position = queue.findIndex(c => c.id === callState.callId) + 1;
    
    console.log(`   ✅ [DB Saved] ID: ${callState.callId.substring(0, 20)}..., Location: ${locationData.city}, ${locationData.state}`);
    console.log(`   📊 [Queue] Position: #${position} of ${queue.length} active calls`);
    
    if (position === 1) {
      console.log(`   🚨 [URGENT] THIS CALL IS NEXT TO DISPATCH!`);
    }
    
    // Emit real-time update to all connected frontend clients
    const callData = {
      id: callState.callId,
      emergency: callState.emergency,
      name: callState.name,
      location: callState.location,
      number: callState.number,
      priority: priority,
      status: 'open',
      inProgress: callState.hangUp ? 0 : 1,
      coordinates: callState.coordinates,
      city: locationData.city,
      district: locationData.district,
      state: locationData.state,
      country: locationData.country,
      created_at: new Date().toISOString()
    };
    
    io.emit('call progress event', callData);
    console.log(`   📡 [Socket.IO] Emitted call progress event to ${io.engine.clientsCount} connected clients`);
  } catch (dbError) {
    console.error("   ❌ Database save error:", dbError);
  }
}

// ============ GOVERNMENT DASHBOARD ENDPOINTS ============

/**
 * GET /api/government/locations
 * Returns location hierarchy (state -> district -> city)
 */
app.get('/api/government/locations', async (req, res) => {
  try {
    const hierarchy = await getLocationHierarchy(db);
    res.json({ success: true, data: hierarchy });
  } catch (error) {
    console.error('❌ [API] Get locations error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/government/calls?state=Maharashtra&district=Pune&city=Pune
 * Filter emergency calls by location
 */
app.get('/api/government/calls', async (req, res) => {
  try {
    const { state, district, city, priority, status } = req.query;
    
    console.log('   [API /government/calls] Filters - state:', state, 'district:', district, 'city:', city, 'priority:', priority, 'status:', status);
    
    let query = 'SELECT * FROM emergency_calls WHERE 1=1';
    const params = [];

    // Filter by status - open means inProgress=1, resolved means status='resolved'
    if (status === 'open' || !status) {
      query += ' AND inProgress = 1';
    } else if (status === 'resolved') {
      query += ' AND status = ?';
      params.push('resolved');
    }

    if (state && state !== 'ALL') {
      query += ' AND state = ?';
      params.push(state);
    }

    if (district && district !== 'ALL') {
      query += ' AND district = ?';
      params.push(district);
    }

    if (city && city !== 'ALL') {
      query += ' AND city = ?';
      params.push(city);
    }

    if (priority && priority !== 'ALL') {
      query += ' AND priority = ?';
      params.push(parseInt(priority));
    }

    query += ' ORDER BY priority ASC, created_at DESC';

    console.log('   [API] Query:', query);
    console.log('   [API] Params:', params);
    const calls = db.prepare(query).all(...params);
    console.log('   [API /government/calls] Returned', calls.length, 'calls');
    
    if (calls.length > 0) {
      console.log('   [API] First call:', calls[0]);
    }

    res.json({ success: true, data: calls, count: calls.length });
  } catch (error) {
    console.error('❌ [API] Filter calls error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/government/stats
 * Get statistics for government dashboard
 */
app.get('/api/government/stats', async (req, res) => {
  try {
    const { state, district, city } = req.query;

    let whereClause = 'WHERE inProgress = 1';
    const params = [];

    if (state && state !== 'ALL') {
      whereClause += ' AND state = ?';
      params.push(state);
    }

    if (district && district !== 'ALL') {
      whereClause += ' AND district = ?';
      params.push(district);
    }

    if (city && city !== 'ALL') {
      whereClause += ' AND city = ?';
      params.push(city);
    }

    // Total active cases
    const totalCases = db.prepare(
      `SELECT COUNT(*) as count FROM emergency_calls ${whereClause}`
    ).get(...params);

    // Cases by priority
    const byPriority = db.prepare(`
      SELECT priority, COUNT(*) as count 
      FROM emergency_calls ${whereClause}
      GROUP BY priority
      ORDER BY priority ASC
    `).all(...params);

    // Cases by location (top 10)
    const byLocation = db.prepare(`
      SELECT city, district, state, COUNT(*) as count 
      FROM emergency_calls ${whereClause}
      GROUP BY city, district, state
      ORDER BY count DESC
      LIMIT 10
    `).all(...params);

    // Average response priority (lower = more urgent)
    const avgPriority = db.prepare(
      `SELECT AVG(priority) as avgPriority FROM emergency_calls ${whereClause}`
    ).get(...params);

    // Get all active calls with coordinates for map
    const mapCalls = db.prepare(`
      SELECT id, emergency, name, location, city, district, state, priority, coordinates, created_at
      FROM emergency_calls ${whereClause}
    `).all(...params);

    res.json({
      success: true,
      data: {
        totalCases: totalCases.count,
        byPriority: byPriority,
        byLocation: byLocation,
        averagePriority: avgPriority.avgPriority || 0,
        mapCalls: mapCalls
      }
    });
  } catch (error) {
    console.error('❌ [API] Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/government/calls/:id
 * Get detailed call information
 */
app.get('/api/government/calls/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const call = db.prepare(
      'SELECT * FROM emergency_calls WHERE id = ?'
    ).get(id);

    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found' });
    }

    // Parse coordinates if stored as JSON string
    if (call.coordinates && typeof call.coordinates === 'string') {
      try {
        call.coordinates = JSON.parse(call.coordinates);
      } catch (e) {
        call.coordinates = {};
      }
    }

    res.json({ success: true, data: call });
  } catch (error) {
    console.error('❌ [API] Get call detail error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ END GOVERNMENT DASHBOARD ENDPOINTS ============

// Start server
const BASE_PORT = Number(process.env.PORT) || 3001;

async function startServer(port) {
  // Initialize Deep Learning Models
  console.log('[Init] 🤖 Loading deep learning models...');
  const dlReady = await initializePriorityModels();
  if (dlReady) {
    console.log('[Init] ✅ Deep learning models loaded successfully');
  } else {
    console.log('[Init] ⚠️ Deep learning models failed to load, using fallback method');
  }

  http.listen(port, () => {
    console.log(`🚀 Backend listening on port ${port}`);
  }).on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`⚠️ Port ${port} in use. Retrying on ${nextPort}...`);
      // Small delay before retry to avoid tight loop
      setTimeout(() => startServer(nextPort), 500);
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });
}

startServer(BASE_PORT);
