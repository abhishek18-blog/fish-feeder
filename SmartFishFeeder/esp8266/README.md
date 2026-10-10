# 🐟 ESP8266 SmartFish Feeder Firmware Guide

This firmware connects your physical fish feeder hardware to **Firebase Realtime Database** so that:
1. Tapping **"Feed Now"** in the mobile app physically rotates your servo motor.
2. The **HC-SR04 ultrasonic sensor** continuously measures the actual food level (max distance calibrated to **5.0 cm** = empty, **1.0 cm** = full).
3. **No fake or hardcoded deductions** — real sensor readings drive the percentage in both the app and database!

---

## 🔌 Hardware Wiring Diagram

### 1. Servo Motor (SG90 / MG90S / Continuous 360° Rotation)
| Servo Wire Color | Pin on ESP8266 (NodeMCU / D1 Mini) | Note |
|---|---|---|
| **Orange / Yellow (PWM Signal)** | **D4** (GPIO 2) or **D1** (GPIO 5) | **Safe boot pin!** |
| **Red (VCC)** | **VIN** (5V) or external 5V | Power pin |
| **Brown / Black (GND)** | **GND** | Ground |

> ⚠️ **CRITICAL NOTE ON PIN D8:** Never connect a servo signal to **D8 (GPIO15)** on ESP8266! GPIO15 is a hardware boot-strap pin that MUST be LOW at power-on. When a servo is connected to D8, the ESP8266 fails to boot and hangs. Connect your servo signal wire to **D4** instead!

---

### 2. Ultrasonic Sensor (HC-SR04) for Food Level Measurement
| HC-SR04 Pin | Pin on ESP8266 | Function |
|---|---|---|
| **VCC** | **VIN** (5V) | Power |
| **Trig** | **D6** (GPIO 12) | Trigger pulse |
| **Echo** | **D7** (GPIO 13) | Echo duration |
| **GND** | **GND** | Ground |

---

## 📏 Ultrasonic Calibration (Max 5.0 cm)

* **Container Empty (0%):** Distance $\ge$ **5.0 cm**
* **Container Full (100%):** Distance $\le$ **1.0 cm**
* **Percentage Formula:** $\text{Level} = \frac{5.0 - \text{distance}}{5.0 - 1.0} \times 100\%$
* Includes a 5-sample median filter to filter out echoes or jitter from container walls.

---

## 🛠 Arduino IDE Setup

### Step 1: Install ESP8266 Board Support
1. Open **Arduino IDE**.
2. Go to **File → Preferences**.
3. Under **Additional Boards Manager URLs**, paste:
   ```
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
4. Go to **Tools → Board → Boards Manager**, search for **`esp8266`**, and click **Install**.

---

### Step 2: Install Required Libraries
In Arduino IDE, go to **Sketch → Include Library → Manage Libraries...** and install:

1. **`Firebase ESP8266 Client`** by **Mobizt**
2. **`ArduinoJson`** by **Benoit Blanchon** (Version 6.x recommended)
3. *(The `Servo` library is built into the ESP8266 board core)*

---

### Step 3: Wi-Fi & Firebase Credentials
Open [`FishFeeder_ESP8266.ino`](FishFeeder_ESP8266.ino). Your Wi-Fi and Firebase are configured:

```cpp
#define WIFI_SSID     "Abcd"
#define WIFI_PASSWORD "abhi2004"

#define FIREBASE_HOST "aqua-feeder-57e0d-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyCu0IG_SpEuauBZRek50KZA19Y7o4o9mF0"
```

---

### Step 4: Upload to ESP8266
1. Plug your ESP8266 into your computer via USB.
2. Select your board under **Tools → Board** (e.g. `NodeMCU 1.0 (ESP-12E Module)` or `LOLIN(WEMOS) D1 R2 & mini`).
3. Select your port under **Tools → Port**.
4. Click **Upload** (Arrow button).
5. Open **Tools → Serial Monitor** at **115200 baud** to view real-time distance and feed logs.
