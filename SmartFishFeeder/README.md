# 🐟 SmartFish Feeder — React Native App

A pixel-perfect React Native (Expo) mobile app for controlling and monitoring a smart aquarium fish feeder, with real-time data sync via **Firebase Realtime Database**.

---

## 📱 Screens

| Screen | Description |
|--------|-------------|
| **Home** | Food level donut gauge, Feed Now button, portion control, trend chart, stat cards, last dispense |
| **Schedules** | Add/toggle/delete feeding schedules, Vacation Mode |
| **Logs** | Chronological history of all feed events |
| **Calibration** | Servo test spin, food level reset, factory reset |

---

## 🚀 Quick Start

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** → name it `smart-fish-feeder`
3. Enable **Realtime Database** (Start in **test mode** for now)
4. Go to **Project Settings → General → Your apps → Web** and copy your config

### 2. Add Your Firebase Config

Edit [`firebase/config.js`](firebase/config.js) and replace all `YOUR_*` placeholders:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef",
};
```

### 3. Install Dependencies

```bash
cd SmartFishFeeder
npm install
```

### 4. Seed Demo Data (Optional)

Populate your Firebase DB with demo data to see the app working immediately:

```bash
# Edit seed-firebase.js with your config first!
node seed-firebase.js
```

### 5. Run the App

```bash
npx expo start
```

Then:
- Press **`a`** to open on Android emulator
- Press **`i`** to open on iOS simulator
- Scan the QR code with **Expo Go** app on your phone

---

## 🔥 Firebase RTDB Structure

```
/feeder
  ├── foodLevel          : number   (0–100)
  ├── portionSize        : number   (1–5)
  ├── servoStatus        : string   ("Ready" | "Dispensing")
  ├── nextFeed           : string   ("08:00 AM")
  ├── burnPerDay         : number   (% per day)
  ├── deviceOnline       : boolean
  ├── vacationMode       : boolean
  ├── lastDispense
  │     ├── timestamp    : number   (ms epoch)
  │     └── servoSpin    : string   ("1.5s servo spin")
  ├── schedules
  │     └── <pushId>
  │           ├── name         : string
  │           ├── time         : string  ("08:00")
  │           ├── ampm         : string  ("AM" | "PM")
  │           ├── frequency    : string  ("Daily" | "Mon-Fri" | …)
  │           ├── portionSize  : number
  │           ├── spinDuration : string  ("1.5s spin")
  │           ├── active       : boolean
  │           └── icon         : string  (emoji)
  └── foodHistory
        └── <pushId>
              ├── level        : number
              ├── timestamp    : number
              ├── type         : string  ("manual" | "scheduled")
              ├── servoSpin    : string
              └── scheduleName : string
```

---

## 🛠 Hardware Integration (ESP32 / Arduino)

Your physical feeder firmware should:

1. **Read** `/feeder/portionSize` and `/feeder/vacationMode`
2. **Listen** for `/feeder/servoStatus === "Dispensing"` to trigger motor
3. **Write** `/feeder/servoStatus` back to `"Ready"` when done
4. **Write** `/feeder/foodLevel` (from ultrasonic sensor reading)
5. **Write** `/feeder/deviceOnline: true` with a keep-alive every 30s
6. **Write** feed events to `/feeder/foodHistory`

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `expo ~51` | React Native toolchain |
| `firebase ^10` | Realtime Database |
| `react-native-svg` | Donut chart + area chart |
| `@expo/vector-icons` | Ionicons + MaterialCommunityIcons |

---

## 🎨 Design

Matches the **SmartFish Feeder** Figma design:
- Color palette: Warm beige background, teal accents, coral CTA
- Cards with soft shadows and rounded corners
- Animated SVG donut gauge
- Area chart with gradient fill + projected empty line

---

## 🔒 Firebase Security Rules (Production)

Replace test mode rules with:

```json
{
  "rules": {
    "feeder": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

And add Firebase Auth to the app before going to production.
