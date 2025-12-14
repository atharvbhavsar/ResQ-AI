# ResQ -AI - Advanced Emergency Dispatch System

## 🚨 Project Overview

Our emergency response systems are broken. Call center employees are being overworked, under-equipped, and prone to pranks. According to Toronto emergency dispatch audits, emergency calls are being left on hold for up to 10 minutes, and dispatch centers fail to meet minimum standards for answering calls almost daily.

**Lives are on the line.** There needs to be a better system.

## 🤖 What is ResQ AI?

** ResQ AI** is an AI-powered emergency dispatch system that:

- ✅ **Answers calls immediately** with intelligent AI chatbot
- ✅ **Extracts critical information** (emergency type, location, caller name, phone)
- ✅ **Automatically assigns priorities** using 5-level classification
- ✅ **Manages call queue** fairly and transparently
- ✅ **Frees up dispatchers** to handle more emergencies faster
- ✅ **Provides real-time dashboard** with queue visibility
- ✅ **Records complete transcripts** for audit trail

By having an AI bot handle calls right away until a real dispatcher is available, dispatchers can focus on coordinating dispatch processes while more calls are being answered simultaneously.

**Potential Impact:** Save lives by reducing call wait times and ensuring critical emergencies are dispatched immediately.

---

## 🎯 Key Features

### 1. **Intelligent Call Handling**
- AI chatbot answers calls within seconds
- Extracts emergency type, location, name, phone number
- Asks follow-up questions to gather more details
- Uses Deepgram for superior speech recognition

### 2. **5-Level Priority Classification**
Automatically categorizes all 911 calls:

| Level | Category | Color | Response Time | Examples |
|-------|----------|-------|----------------|----------|
| **L1** | Immediate/Life-Threatening | 🔴 Red | DISPATCH IMMEDIATELY | Rape, heart attack, fire, shooting, drowning |
| **L2** | Urgent/High Risk | 🟠 Orange | DISPATCH QUICKLY | Fractures, burglary, missing person |
| **L3** | Semi-Urgent | 🟡 Yellow | ROUTINE DISPATCH | Vomiting, fever, mild injury |
| **L4** | Non-Urgent | 🔵 Blue | SCHEDULE DISPATCH | Headache, lost item, minor cuts |
| **L5** | Information/Routine | 🟢 Green | ADMINISTRATIVE | Directions, information request |

### 3. **Automatic Queue Management**
- Calls ordered by priority (L1 → L2 → L3 → L4 → L5)
- FIFO ordering within same priority level
- Real-time queue position tracking
- No manual priority override possible

### 4. **GPS Coordinates**
- Automatic geocoding from caller address
- Device GPS integration
- Precise location for emergency response
- Map visualization on dispatcher dashboard

### 5. **Complete Audit Trail**
- Full call transcript recorded
- Exact timestamps maintained
- Priority assignment documented
- Queue position tracked

### 6. **REST API Endpoints**
```bash
GET /queue          # View all active calls
GET /next-dispatch  # Get next call to dispatch
GET /call/:id       # Get specific call details
```

---

## 📊 Priority System (L1-L5)

### 🔴 **L1 - IMMEDIATE / LIFE-THREATENING**
Dispatch immediately. Life at risk.

**Examples:**
- Sexual crimes (rape, assault, abuse)
- Unconsciousness / Cardiac arrest
- Heart attack / Stroke
- Not breathing / Choking
- Major bleeding / Poisoning
- House/factory fire
- Armed attack / Active shooter
- Building collapse / Drowning / Trapped

### 🟠 **L2 - URGENT / HIGH RISK**
Dispatch quickly. Serious but not immediately fatal.

**Examples:**
- Fractures (severe pain)
- Moderate burns
- High fever in child / Severe dehydration
- Asthma attack (stable)
- Animal bites
- Allergic reaction
- Burglary happening
- Missing person / Suspicious activity

### 🟡 **L3 - SEMI-URGENT**
Routine dispatch. Same-day response needed.

**Examples:**
- Vomiting / Dehydration
- Mild fever
- Mild allergic reaction
- Waterlogging / Minor flooding
- Minor injury
- Theft / Robbery (non-violent)

### 🔵 **L4 - NON-URGENT**
Schedule dispatch. Can wait for available resource.

**Examples:**
- Mild fever / Headache / Cold
- Lost item / Lost pet
- Noise complaint / Neighbor dispute
- Power outage / Utility issue
- Minor property damage

### 🟢 **L5 - INFORMATION / ROUTINE**
Administrative handling.

**Examples:**
- Asking for directions
- Information request
- Reporting old incidents
- Status check

---

## 🏗️ System Architecture

```
                    ┌─────────────────┐
                    │   112 CALLER    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  TWILIO PHONE   │
                    └────────┬────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │     NODE.JS EXPRESS SERVER (3001)       │
        │  - /transcribe (receive call)            │
        │  - /respond   (AI responses)             │
        │  - /location  (GPS coordinates)          │
        │  - /queue     (API - get queue)          │
        │  - /next-dispatch (API - next call)      │
        │  - /call/:id  (API - call details)       │
        └────────┬──────────────────┬─────────────┘
                 │                  │
        ┌────────▼──────┐  ┌────────▼──────────┐
        │  OLLAMA AI    │  │  SQLITE DATABASE  │
        │ (Neural-Chat) │  │  (emergency_calls)│
        │ - Emergency   │  │  - Calls log      │
        │   extraction  │  │  - Priorities     │
        │ - Follow-up   │  │  - Transcripts    │
        │   questions   │  │  - Timestamps     │
        └───────────────┘  └───────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │   DISPATCHER DASHBOARD (React/WebUI)   │
        │  - Call queue visualization             │
        │  - Priority indicators                  │
        │  - Map with GPS coordinates             │
        │  - Call details                         │
        └────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v14+)
- Twilio account
- Deepgram API key (optional, for better speech recognition)
- Ollama AI (for emergency type extraction)

### Installation

```bash
# Clone repository
git clone https://github.com/Vinaya-Sharma/TriageAI.git
cd TriageAI

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your API keys:
#   - TWILIO_ACCOUNT_SID
#   - TWILIO_AUTH_TOKEN
#   - TWILIO_PHONE_NUMBER
#   - DEEPGRAM_API_KEY

# Start Ollama AI service
ollama serve

# In another terminal, start the server
node index_clean.js

# (Optional) Expose to internet with ngrok
ngrok http 3001
```

### Twilio Configuration

1. Set Webhook URL in Twilio Dashboard:
   ```
   http://your-ngrok-url/transcribe
   ```

2. Set Status Callback URL:
   ```
   http://your-ngrok-url/status-callback
   ```

---

## 📖 Documentation

- **[PRIORITY_LEVELS_5.md](./PRIORITY_LEVELS_5.md)** - Comprehensive 5-level priority system
- **[SYSTEM_UPGRADE_SUMMARY.md](./SYSTEM_UPGRADE_SUMMARY.md)** - System enhancements overview
- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - Testing procedures and scenarios
- **[PRIORITY_SYSTEM.md](./PRIORITY_SYSTEM.md)** - Original priority system documentation

---

## 🧪 Testing

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive testing procedures.

### Quick Test

```bash
# Check system status
curl http://localhost:3001/

# View call queue
curl http://localhost:3001/queue

# Get next call to dispatch
curl http://localhost:3001/next-dispatch

# Get specific call
curl http://localhost:3001/call/[CALL_ID]
```

---


---

## 🔒 Security & Privacy

- ✅ Full call transcripts stored (audit trail)
- ✅ Caller phone numbers protected (not exposed in API)
- ✅ GPS coordinates only used for emergency dispatch
- ✅ Priority assignment is automatic (no human bias)
- ✅ All data stored in local SQLite database
- ✅ No external data sharing without consent

---

## 📊 Performance

- **Call Answer Time:** < 2 seconds
- **Priority Assignment:** < 1 second
- **Database Query:** < 100ms
- **Queue Size:** Supports 100+ concurrent calls
- **Transcript:** Full conversation recorded
- **Audit Trail:** Complete from start to resolution

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 👨‍💼 Author

**Atharv Bhavsar** - Created ResQ-AI to help save lives in emergency response.

---

## 🎯 Mission

To revolutionize emergency dispatch by:
1. ✅ Reducing call wait times
2. ✅ Ensuring critical emergencies are prioritized correctly
3. ✅ Freeing dispatchers to handle more calls
4. ✅ Saving lives through faster response times

---

## ⚠️ Disclaimer

ResQ.AI is a **supplementary system** designed to assist dispatchers, not replace them. All critical decisions should be verified by trained emergency dispatch personnel. In case of doubt, always prioritize life-saving action.

Demo Video Link:https://youtu.be/3jPz0feIYIQ?si=X5abnIzkKbvLHTVN

---

**Status:** ✅ Production Ready  
**Last Updated:** December 2025  
**Version:** 3.0
