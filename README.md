# zaris

> **Zari WhatsApp Automation Server** — High-performance Node.js Express server integrated with Evolution API v2.3 to automatically reply with your official product Catalogue URL whenever an incoming message contains the word `catalogue` (or `catalog`), in any case (upper/lower/mixed).

---

## 🌟 Key Features

- 🎯 **Smart Catalogue Auto-Reply**: Detects `"catalogue"`, `"catalog"`, `"Catalogue"`, `"CATALOGUE"`, or any containing sentence, and replies with the official link: `https://wa.me/c/919423185940`.
- 👁️ **Automatic Read Receipts**: Automatically marks incoming WhatsApp messages as read via Evolution API's `POST /chat/markMessageAsRead/:instance` endpoint.
- 🛡️ **Anti-Loop & Deduplication**: Avoids responding to bot's own outgoing messages (`fromMe: true`) and debounces duplicate webhook events within a 15-second TTL window.
- 📱 **Evolution API v2 Integration**: Pre-configured for instance `zari` on `https://evo.infispark.in`.
- 💳 **Customer Payment Notifications**: Built-in API endpoint (`/api/send-payment`) for automated transaction receipts (deposit, advance, settlement, refund).
- 🖥️ **Modern Minimalist Web Dashboard**: Real-time metrics, live message & reply logs, interactive keyword simulator, direct WhatsApp messenger, and 1-click webhook sync.
- 🐳 **Docker & Docker Compose Ready**: Production-grade Dockerfile and compose configuration included.

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/infisparks/zaris.git
cd zaris
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Review your `.env` settings:

```ini
PORT=3001
EVOLUTION_API_URL=https://evo.infispark.in
EVOLUTION_API_KEY=vR39h6avY69g7kAU3YQbS6V6XEvudson
WHATSAPP_API_KEY=vR39h6avY69g7kAU3YQbS6V6XEvudson
INSTANCE_NAME=zari
CATALOGUE_URL=https://wa.me/c/919423185940
AUTO_READ_MESSAGES=true
REPLY_DELAY_MS=1000
```

### 3. Start the Server

```bash
# Start in production mode
npm start

# Or start in watch/development mode
npm run dev
```

The server will start on `http://localhost:3001`.

---

## 🔗 Evolution API Webhook Setup

To receive WhatsApp messages in real-time, register your webhook with Evolution API:

- **Webhook URL**: `https://your-domain.com/webhook`
- **Events**: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE`

You can also configure this directly in the Web Dashboard at `http://localhost:3001` with one click!

---

## 📡 API Endpoints

### 1. Webhook Receiver
- **Endpoint**: `POST /webhook` (or `POST /api/webhook`)
- **Description**: Receives incoming WhatsApp message events from Evolution API. If the message text contains the word `catalogue` (case-insensitive), it automatically marks the message as read and replies with the Catalogue URL.

### 2. Send Custom WhatsApp Message
- **Endpoint**: `POST /api/message/send`
- **Payload**:
```json
{
  "number": "919423185940",
  "text": "Hello! How can we assist you today?"
}
```

### 3. Send Payment / Deposit Receipt
- **Endpoint**: `POST /api/send-payment`
- **Payload**:
```json
{
  "patientName": "Aarav Sharma",
  "patientMobile": "919423185940",
  "paymentAmount": 5000,
  "amountType": "deposit",
  "updatedDeposit": 15000
}
```

### 4. Server & Instance Status
- **Endpoint**: `GET /api/status`
- **Description**: Returns live connection state for instance `zari`, server uptime, and statistics.

### 5. Live Activity Logs
- **Endpoint**: `GET /api/logs`
- **Description**: Returns the latest incoming messages and auto-reply audit trail.

### 6. Test Trigger Simulator
- **Endpoint**: `POST /api/test-trigger`
- **Payload**:
```json
{
  "testMessage": "Please send me your Catalogue"
}
```

---

## 🐳 Docker Deployment

### Run with Docker Compose:
```bash
docker-compose up -d --build
```

### Or build and run standalone Docker container:
```bash
docker build -t zari-whatsapp .
docker run -d -p 3001:3001 --env-file .env --name zari-whatsapp zari-whatsapp
```

---

## 📄 License

ISC © InfiSpark
