/**
 * ==============================================================================
 * SmartFish Feeder — ESP8266 Firmware (Automated Schedules + Pololu VL53L0X ToF)
 * ==============================================================================
 * 
 * Hardware Connections:
 *   - Servo PWM Signal : D4 (GPIO2)   [Safe boot pin — DO NOT use D8!]
 *   - VL53L0X SDA      : D6 (GPIO12)  [I2C Data]
 *   - VL53L0X SCL      : D5 (GPIO14)  [I2C Clock]
 *   - VL53L0X VCC      : 3.3V or 5V
 *   - VL53L0X GND      : GND
 *   - Status LED       : LED_BUILTIN  [Active LOW]
 *   - Yellow LED       : D3 (GPIO0)   -> Blinks during Wi-Fi connect, Solid ON when connected
 *   - Green LED        : D1 (GPIO5)   -> Blinks while dispensing
 *   - Red LED          : D2 (GPIO4)   -> Solid ON when idle
 * 
 * Features:
 *   - Real-time continuous VL53L0X distance reading (mm converted to cm)
 *   - Clock stretch limit configured to 4000µs to prevent ESP8266 I2C timeouts
 *   - Real-time Firebase sync (updates immediately when food level changes + 5s heartbeat)
 *   - Multi-AP Wi-Fi fallback ("Batman " and "Abcd")
 *   - Automated schedules (IST UTC+5:30 via NTP)
 * ==============================================================================
 */

#include <Wire.h>
#include <VL53L0X.h>
#include <ESP8266WiFi.h>
#include <ESP8266WiFiMulti.h>
#include <FirebaseESP8266.h>
#include <Servo.h>
#include <time.h>

// ------------------------------------------------------------------------------
// 1. Wi-Fi Configuration (Dual Networks)
// ------------------------------------------------------------------------------
#define WIFI_SSID_1     "Batman "
#define WIFI_PASSWORD_1 "123456789"

#define WIFI_SSID_2     "Abcd"
#define WIFI_PASSWORD_2 "abhi2004"

ESP8266WiFiMulti wifiMulti;

// ------------------------------------------------------------------------------
// 2. Firebase Configuration
// ------------------------------------------------------------------------------
#define FIREBASE_HOST "aqua-feeder-57e0d-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyCu0IG_SpEuauBZRek50KZA19Y7o4o9mF0"

// ------------------------------------------------------------------------------
// 3. Hardware Pin Definitions
// ------------------------------------------------------------------------------
#define SERVO_PIN        D4          // GPIO2  -> Servo PWM Signal
#define SDA_PIN          D6          // GPIO12 -> VL53L0X I2C Data (SDA)
#define SCL_PIN          D5          // GPIO14 -> VL53L0X I2C Clock (SCL)
#define LED_PIN          LED_BUILTIN // Onboard LED (Active LOW)
#define GREEN_LED_PIN    D1          // GPIO5  -> Green LED: blinks while dispensing
#define RED_LED_PIN      D2          // GPIO4  -> Red LED: solid ON when idle
#define YELLOW_LED_PIN   D3          // GPIO0  -> Yellow LED: Blinks connecting, Solid connected

// ------------------------------------------------------------------------------
// 4. Food Level Sensor Calibration & Update Interval
// ------------------------------------------------------------------------------
#define DISTANCE_MAX_CM   5.0f   // 5.0 cm = container empty (0%)
#define DISTANCE_MIN_CM   1.0f   // 1.0 cm or closer = container full (100%)
#define FOOD_LEVEL_SYNC_INTERVAL_MS 30000UL // Update food level every 30 seconds


// ------------------------------------------------------------------------------
// 5. Schedules Structure
// ------------------------------------------------------------------------------
struct ScheduleItem {
  String id;
  String name;
  int hour24;     // 0 - 23
  int minute;     // 0 - 59
  int portion;    // 1x, 2x, etc.
  bool active;
  String frequency; // Daily, Mon-Fri, Weekends
};

#define MAX_SCHEDULES 12
ScheduleItem schedulesList[MAX_SCHEDULES];
int totalSchedules = 0;

int lastFiredHour = -1;
int lastFiredMinute = -1; // Prevents double-feeding within the same minute
int lastFiredDay = -1;

// ------------------------------------------------------------------------------
// 6. Global Objects & State
// ------------------------------------------------------------------------------
FirebaseData fbdo; // Single SSL client keeps Keep-Alive warm and saves 20KB RAM
FirebaseAuth auth;
FirebaseConfig config;
Servo feederServo;
VL53L0X sensor;

unsigned long lastPoll = 0;
unsigned long lastSensorRead = 0;
unsigned long lastFirebaseSync = 0;
unsigned long lastScheduleSync = 0;

int currentFoodLevel = 100;
int currentPortionSize = 1;
float currentDistanceCm = 1.0f;
bool sensorConnected = false;
bool isDispensingNow = false;
int lastFeedCommand = 0;           // Last feedCommand ID we already handled
bool feedCommandPrimed = false;    // True once we know the current ID (avoids replaying old feeds on boot)
int fbFailCount = 0;               // Consecutive failed Firebase requests

/**
 * Tracks Firebase health. Reconnects or reboots if connections fail consecutively.
 */
void noteFirebaseResult(bool ok) {
  if (ok) { fbFailCount = 0; return; }
  fbFailCount++;
  Serial.print("⚠️ [FIREBASE] Request failed (");
  Serial.print(fbFailCount);
  Serial.print("): ");
  Serial.println(fbdo.errorReason());
  if (fbFailCount == 5) {
    Serial.println("🔄 [FIREBASE] Rebuilding connection...");
    fbdo.clear();
    Firebase.begin(&config, &auth);
  }
  if (fbFailCount >= 15) {
    Serial.println("🔁 [FIREBASE] Unrecoverable — restarting ESP.");
    delay(200);
    ESP.restart();
  }
}

// ------------------------------------------------------------------------------
// 7. Robust Pololu VL53L0X Time-of-Flight (ToF) Distance Functions (Single-Shot)
// ------------------------------------------------------------------------------

static int tofFailStreak = 0;

bool initToFSensor() {
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000); // 100kHz standard I2C speed for ESP8266 stability
  Wire.setClockStretchLimit(4000); // 4000us clock stretch limit prevents ESP8266 I2C timeout!
  delay(20);

  // Ping sensor on I2C address 0x29
  Wire.beginTransmission(0x29);
  if (Wire.endTransmission() != 0) {
    Serial.println("⚠️ [VL53L0X] Sensor NOT detected on I2C address 0x29! Check SDA=D6, SCL=D5, VCC, GND.");
    sensorConnected = false;
    return false;
  }

  sensor.setTimeout(500); // 500ms timeout per measurement

  if (!sensor.init()) {
    Serial.println("⚠️ [VL53L0X] Failed to detect sensor! (Check VCC=3.3V/5V, GND, SDA=D6, SCL=D5)");
    sensorConnected = false;
    return false;
  }

  // Set measurement timing budget to 50ms for accurate, stable single-shot readings
  sensor.setMeasurementTimingBudget(50000);
  sensorConnected = true;

  Serial.println("✅ [VL53L0X] Time-of-Flight sensor initialized successfully on SDA=D6, SCL=D5!");
  return true;
}

float readGenuineDistanceCm() {
  // 1. Verify physical I2C connection first
  Wire.beginTransmission(0x29);
  if (Wire.endTransmission() != 0) {
    Serial.println("⚠️ [VL53L0X] I2C communication lost! (Sensor disconnected or wiring loose)");
    sensorConnected = false;
    return -1.0f;
  }

  if (!sensorConnected) {
    if (!initToFSensor()) {
      return -1.0f;
    }
    delay(30);
  }

  // 2. Take 3 single-shot samples
  uint16_t samples[3];
  int validCount = 0;
  bool hadOutOfRange = false;

  for (int i = 0; i < 3; i++) {
    uint16_t mm = sensor.readRangeSingleMillimeters();

    // ST API error codes 8190, 8191 or > 1200mm mean no reflective surface in range (empty container)
    if (mm == 8190 || mm == 8191 || mm > 1200) {
      hadOutOfRange = true;
    } else if (!sensor.timeoutOccurred() && mm >= 5 && mm <= 1200 && mm != 65535) {
      samples[validCount++] = mm;
    }
    delay(20);
    yield();
  }

  sensorConnected = true; // Hardware is confirmed present on I2C bus

  // If all samples were out of range: laser saw no food surface -> Container Empty (0%)
  if (validCount == 0 && hadOutOfRange) {
    Serial.println("ℹ️ [VL53L0X] No surface in range (out-of-range 8190/8191) -> Container is Empty (0%).");
    return DISTANCE_MAX_CM; // 5.0 cm = 0% Empty
  }

  if (validCount == 0) {
    Serial.println("⚠️ [VL53L0X] Measurement timeout on all samples.");
    return DISTANCE_MAX_CM; // Treat as empty container rather than disconnecting
  }

  // 3. Compute median of valid samples
  uint16_t selectedMm = samples[0];
  if (validCount == 2) {
    selectedMm = (samples[0] + samples[1]) / 2;
  } else if (validCount == 3) {
    if (samples[0] > samples[1]) { uint16_t t = samples[0]; samples[0] = samples[1]; samples[1] = t; }
    if (samples[1] > samples[2]) { uint16_t t = samples[1]; samples[1] = samples[2]; samples[2] = t; }
    if (samples[0] > samples[1]) { uint16_t t = samples[0]; samples[0] = samples[1]; samples[1] = t; }
    selectedMm = samples[1];
  }

  float distCm = (float)selectedMm / 10.0f; // Convert millimeters to centimeters
  return distCm;
}


int measureAndSyncToF(bool forceSync = false) {
  float dist = readGenuineDistanceCm();
  unsigned long now = millis();

  if (dist < 0.0f) {
    // If sensor failed 3 consecutive cycles, inform Firebase once
    if (!sensorConnected && forceSync) {
      FirebaseJson syncJson;
      syncJson.set("sensorConnected", false);
      syncJson.set("deviceOnline", true);
      syncJson.set("lastHeartbeat", (int)time(nullptr));
      Firebase.updateNodeSilent(fbdo, "/feeder", syncJson);
    }
    return currentFoodLevel;
  }

  // Linear percentage mapping: 1.0cm or closer = 100% full, 5.0cm = 0% empty
  float pct = ((DISTANCE_MAX_CM - dist) / (DISTANCE_MAX_CM - DISTANCE_MIN_CM)) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  int newFoodLevel = (int)round(pct);

  // Print 30s measurement to Serial Monitor
  Serial.print("📏 [VL53L0X ToF] Distance: ");
  Serial.print(dist, 2);
  Serial.print(" cm (");
  Serial.print(dist * 10.0f, 0);
  Serial.print(" mm) | Food Level: ");
  Serial.print(newFoodLevel);
  Serial.println("%");

  currentDistanceCm = dist;
  currentFoodLevel = newFoodLevel;
  lastFirebaseSync = now;

  // Push updated food level & distance to Firebase
  FirebaseJson syncJson;
  syncJson.set("foodLevel", currentFoodLevel);
  syncJson.set("foodDistanceCm", currentDistanceCm);
  syncJson.set("sensorConnected", true);
  syncJson.set("lastSensorPing", (int)time(nullptr));
  syncJson.set("deviceOnline", true);
  syncJson.set("lastHeartbeat", (int)time(nullptr));
  bool ok = Firebase.updateNodeSilent(fbdo, "/feeder", syncJson);
  noteFirebaseResult(ok);

  return currentFoodLevel;
}


// ------------------------------------------------------------------------------
// 8. LED Status Control
// ------------------------------------------------------------------------------

static unsigned long lastGreenBlink = 0;
static bool greenLedState = false;

void setIdleLEDs() {
  digitalWrite(GREEN_LED_PIN, LOW);  // Green OFF
  digitalWrite(RED_LED_PIN,   HIGH); // Red ON
  greenLedState = false;
}

void setDispensingLEDs() {
  digitalWrite(RED_LED_PIN,   LOW);  // Red OFF
  digitalWrite(GREEN_LED_PIN, HIGH); // Green ON
  greenLedState = true;
  lastGreenBlink = millis();
}

void tickGreenBlink() {
  if (millis() - lastGreenBlink >= 200) {
    lastGreenBlink = millis();
    greenLedState = !greenLedState;
    digitalWrite(GREEN_LED_PIN, greenLedState ? HIGH : LOW);
  }
}

// ------------------------------------------------------------------------------
// 9. Servo Dispense Action
// ------------------------------------------------------------------------------

void dispenseFood(int portionSize, String feedLabel = "Manual Feed", String feedType = "manual") {
  if (isDispensingNow) return;
  isDispensingNow = true;

  if (portionSize < 1) portionSize = 1;
  if (portionSize > 5) portionSize = 5;

  Serial.println();
  Serial.println("==================================================");
  Serial.print(">>> 🐟 [DISPENSE] ");
  Serial.print(feedLabel);
  Serial.print(" | ");
  Serial.print(portionSize);
  Serial.println("x portion(s)");
  Serial.println("==================================================");

  // 1. Red OFF (D2), Green BLINKS (D1)
  setDispensingLEDs();
  digitalWrite(LED_PIN, LOW);

  // 2. 360° Continuous Servo rotation
  unsigned long spinDurationMs = (unsigned long)portionSize * 1500UL;
  feederServo.attach(SERVO_PIN);

  unsigned long start = millis();
  while (millis() - start < spinDurationMs) {
    feederServo.write(0); // 0 = Full-speed Clockwise
    tickGreenBlink();
    delay(20);
    yield();
  }

  feederServo.write(90);  // 90 = STOP
  delay(150);
  feederServo.detach();

  // 3. Green OFF (D1), Red back ON (D2)
  setIdleLEDs();
  digitalWrite(LED_PIN, HIGH);

  // 4. Unlock UI in Firebase
  String spinStr = String(portionSize * 1.5f, 1) + "s servo spin";
  bool readyOk = false;
  for (int attempt = 0; attempt < 4 && !readyOk; attempt++) {
    readyOk = Firebase.setString(fbdo, "/feeder/servoStatus", "Ready");
    if (!readyOk) { delay(200); yield(); }
  }
  noteFirebaseResult(readyOk);

  delay(600);
  measureAndSyncToF(true); // Force real-time sync after feed

  FirebaseJson historyJson;
  historyJson.set("level", currentFoodLevel);
  historyJson.set("type", feedType);
  historyJson.set("scheduleName", feedLabel);
  historyJson.set("servoSpin", spinStr);
  historyJson.set("timestamp", (double)time(nullptr) * 1000.0);
  Firebase.pushJSON(fbdo, "/feeder/foodHistory", historyJson);

  Serial.println(">>> [DISPENSE] Finished — Green LED OFF, Red LED ON (idle).");
  isDispensingNow = false;
}

// ------------------------------------------------------------------------------
// 10. Schedules Fetching & Time Comparison (IST UTC+5:30)
// ------------------------------------------------------------------------------

void syncSchedulesFromFirebase() {
  Serial.println("📅 [SCHEDULES] Fetching schedules from Firebase...");

  if (!Firebase.getJSON(fbdo, "/feeder/schedules")) {
    Serial.print("   Warning: Could not fetch schedules: ");
    Serial.println(fbdo.errorReason());
    return;
  }

  if (fbdo.dataType() == "null") {
    Serial.println("   ℹ️ No schedules configured in Firebase yet.");
    totalSchedules = 0;
    return;
  }

  FirebaseJson& json = fbdo.jsonObject();
  size_t count = json.iteratorBegin();
  totalSchedules = 0;

  String key, value;
  int type = 0;

  for (size_t i = 0; i < count && totalSchedules < MAX_SCHEDULES; i++) {
    json.iteratorGet(i, type, key, value);

    FirebaseJson itemJson;
    itemJson.setJsonData(value);
    FirebaseJsonData d;

    itemJson.get(d, "active");
    bool active = d.boolValue;

    itemJson.get(d, "time");
    String timeStr = d.stringValue;

    itemJson.get(d, "ampm");
    String ampm = d.stringValue;

    itemJson.get(d, "name");
    String name = d.stringValue;

    itemJson.get(d, "portionSize");
    int portion = (d.intValue > 0) ? d.intValue : 1;

    itemJson.get(d, "frequency");
    String freq = d.stringValue;

    timeStr.trim();
    int colonIdx = timeStr.indexOf(':');
    if (colonIdx > 0) {
      int h = timeStr.substring(0, colonIdx).toInt();
      int m = timeStr.substring(colonIdx + 1).toInt();

      ampm.trim();
      ampm.toUpperCase();
      if (ampm == "PM" && h < 12) h += 12;
      if (ampm == "AM" && h == 12) h = 0;

      schedulesList[totalSchedules].id = key;
      schedulesList[totalSchedules].name = (name.length() > 0) ? name : "Scheduled Feed";
      schedulesList[totalSchedules].hour24 = h;
      schedulesList[totalSchedules].minute = m;
      schedulesList[totalSchedules].portion = portion;
      schedulesList[totalSchedules].active = active;
      schedulesList[totalSchedules].frequency = freq;

      totalSchedules++;
    }
  }
  json.iteratorEnd();

  Serial.print("   ✅ Loaded ");
  Serial.print(totalSchedules);
  Serial.println(" schedule(s).");
}

void checkAndExecuteSchedules() {
  time_t now = time(nullptr);
  if (now <= 1735689600) return; // Only execute schedules when genuine NTP time is synced


  struct tm* t = localtime(&now);
  int curHour = t->tm_hour;
  int curMin  = t->tm_min;
  int curWday = t->tm_wday;
  int curDay  = t->tm_yday;

  if (curDay == lastFiredDay && curHour == lastFiredHour && curMin == lastFiredMinute) {
    return;
  }

  for (int i = 0; i < totalSchedules; i++) {
    if (!schedulesList[i].active) continue;

    if (curHour == schedulesList[i].hour24 && curMin == schedulesList[i].minute) {
      String freq = schedulesList[i].frequency;
      bool dayMatches = true;

      if (freq == "Mon-Fri" && (curWday == 0 || curWday == 6)) {
        dayMatches = false;
      } else if (freq == "Weekends" && (curWday >= 1 && curWday <= 5)) {
        dayMatches = false;
      }

      if (dayMatches) {
        bool vacation = false;
        if (Firebase.getBool(fbdo, "/feeder/vacationMode")) {
          vacation = fbdo.boolData();
        }

        if (vacation) {
          Serial.println("🏖️ [VACATION MODE] Schedule skipped.");
          lastFiredDay = curDay;
          lastFiredHour = curHour;
          lastFiredMinute = curMin;
          return;
        }

        Serial.println("⏰ [ALARM TRIGGERED] Executing scheduled feed!");
        lastFiredDay = curDay;
        lastFiredHour = curHour;
        lastFiredMinute = curMin;

        dispenseFood(schedulesList[i].portion, schedulesList[i].name, "scheduled");
        return;
      }
    }
  }
}

// ------------------------------------------------------------------------------
// 11. Setup
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // Status LEDs
  pinMode(GREEN_LED_PIN,  OUTPUT); // D1
  pinMode(RED_LED_PIN,    OUTPUT); // D2
  pinMode(YELLOW_LED_PIN, OUTPUT); // D3 -> Wi-Fi Status
  digitalWrite(YELLOW_LED_PIN, LOW);
  setIdleLEDs();

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   🐟 SmartFish Feeder — Automated ESP8266        ");
  Serial.println("   ToF Sensor: SDA=D6 (GPIO12), SCL=D5 (GPIO14)   ");
  Serial.println("   Servo PWM : D4 (GPIO2)                         ");
  Serial.println("   LEDs      : Yellow=D3, Green=D1, Red=D2        ");
  Serial.println("==================================================");

  // 1. Multi-AP Wi-Fi Connection with Yellow LED Blinking
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  wifiMulti.addAP(WIFI_SSID_1, WIFI_PASSWORD_1);
  wifiMulti.addAP(WIFI_SSID_2, WIFI_PASSWORD_2);

  Serial.println("Connecting to Wi-Fi (checking Batman & Abcd)...");

  unsigned long startWifi = millis();
  bool yellowState = false;

  while (wifiMulti.run() != WL_CONNECTED && (millis() - startWifi < 30000)) {
    // Fast blinking on Yellow LED D3 and onboard LED while connecting
    yellowState = !yellowState;
    digitalWrite(YELLOW_LED_PIN, yellowState ? HIGH : LOW);
    digitalWrite(LED_PIN, yellowState ? LOW : HIGH);
    Serial.print(".");
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    // Wi-Fi established: Yellow LED stays stable ON
    digitalWrite(YELLOW_LED_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);

    Serial.println();
    Serial.print("   ✅ Connected to SSID: ");
    Serial.println(WiFi.SSID());
    Serial.print("   📶 Signal: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("   🌐 IP Address: ");
    Serial.println(WiFi.localIP());

    // 2. Set Baseline Timestamp & Synchronize IST Time via NTP
    // Setting a baseline timestamp (1735689600 = 2025-01-01 00:00:00 UTC) guarantees that
    // BearSSL never sees year 1970 even if NTP takes a few extra seconds to resolve.
    // This permanently prevents "Certificate is expired or not yet valid"!
    struct timeval tv = { 1735689600, 0 };
    settimeofday(&tv, nullptr);

    Serial.print("   🇮🇳 Syncing Indian Standard Time (IST)");
    configTime(19800, 0, "time.google.com", "pool.ntp.org", "asia.pool.ntp.org");
    time_t now = time(nullptr);
    int retry = 0;
    while (now <= 1735689600 && retry < 40) {
      delay(200);
      Serial.print(".");
      now = time(nullptr);
      retry++;
    }
    if (now > 1735689600) {
      Serial.println(" synced!");
      Serial.print("   ⏰ Current IST Time: ");
      Serial.println(ctime(&now));
    } else {
      Serial.println(" (NTP syncing in background; baseline active for SSL)");
    }

  } else {
    // Failed: Turn Yellow LED off to indicate no connection
    digitalWrite(YELLOW_LED_PIN, LOW);
    digitalWrite(LED_PIN, HIGH);
    Serial.println("\n   ❌ Wi-Fi connection timed out!");
  }

  // 3. Initialize Firebase
  Serial.print("Connecting to Firebase...");
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  fbdo.setResponseSize(2048);
  fbdo.setBSSLBufferSize(4096, 1024);

  config.timeout.wifiReconnect = 5000;
  config.timeout.socketConnection = 8000;
  config.timeout.sslHandshake = 8000;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  if (Firebase.setBool(fbdo, "/feeder/deviceOnline", true)) {
    Serial.println(" ✅ CONNECTED!");
  } else {
    String err = fbdo.errorReason();
    Serial.println(" ⚠️ Warning: " + err);
    if (err.indexOf("auth") >= 0 || err.indexOf("token") >= 0 || err.indexOf("401") >= 0 || err.indexOf("Unauthorized") >= 0) {
      config.signer.tokens.legacy_token = "";
      Firebase.begin(&config, &auth);
      if (Firebase.setBool(fbdo, "/feeder/deviceOnline", true)) {
        Serial.println("   ✅ Connected with public rules!");
      }
    }
  }

  // 4. Initialize Pololu VL53L0X Time-of-Flight Sensor (after Wi-Fi/Firebase so no unread interrupt lockup)
  initToFSensor();
  measureAndSyncToF(true);

  FirebaseJson initJson;
  initJson.set("servoStatus", "Ready");
  initJson.set("maxDistanceCm", DISTANCE_MAX_CM);
  initJson.set("minDistanceCm", DISTANCE_MIN_CM);
  Firebase.updateNodeSilent(fbdo, "/feeder", initJson);

  if (Firebase.getInt(fbdo, "/feeder/portionSize")) {
    int p = fbdo.intData();
    if (p >= 1 && p <= 5) currentPortionSize = p;
  }

  if (Firebase.getInt(fbdo, "/feeder/feedCommand")) {
    lastFeedCommand = fbdo.intData();
    feedCommandPrimed = true;
  }

  // 5. Initial Schedule Sync
  syncSchedulesFromFirebase();

  lastSensorRead = millis();
  lastScheduleSync = millis() + 15000; // Offset by 15s so sensor sync and schedule sync alternate cleanly!

  Serial.println("==================================================");
  Serial.println("✅ Feeder Active! Food level updates every 30s...");
  Serial.println("==================================================");
}

// ------------------------------------------------------------------------------
// 12. Main Loop
// ------------------------------------------------------------------------------
void loop() {
  yield();

  // Automatic Wi-Fi reconnection handling
  if (wifiMulti.run() != WL_CONNECTED) {
    digitalWrite(YELLOW_LED_PIN, LOW); // Yellow OFF if Wi-Fi drops
    delay(500);
    return;
  } else {
    digitalWrite(YELLOW_LED_PIN, HIGH); // Solid ON when healthy
  }

  unsigned long nowMs = millis();

  // 1. Check for "Feed Now" command every 500ms (fast response, no SSL socket clogging)
  if (nowMs - lastPoll >= 500) {
    lastPoll = nowMs;

    if (!isDispensingNow) {
      bool ok = Firebase.getInt(fbdo, "/feeder/feedCommand");
      noteFirebaseResult(ok);

      if (ok) {
        int cmd = fbdo.intData();
        if (!feedCommandPrimed) {
          lastFeedCommand = cmd;
          feedCommandPrimed = true;
        } else if (cmd != lastFeedCommand) {
          lastFeedCommand = cmd;
          Serial.println("⚡ [FEED NOW] New command received from App!");

          if (Firebase.getInt(fbdo, "/feeder/portionSize")) {
            int p = fbdo.intData();
            if (p >= 1 && p <= 5) currentPortionSize = p;
          }
          dispenseFood(currentPortionSize, "Manual Feed", "manual");
        }
      }
    }
  }

  // 2. Measure & Update Food Level every 30 SECONDS
  if (nowMs - lastSensorRead >= FOOD_LEVEL_SYNC_INTERVAL_MS) {
    lastSensorRead = nowMs;
    if (!isDispensingNow) {
      measureAndSyncToF(false);

      if (Firebase.getInt(fbdo, "/feeder/portionSize")) {
        int p = fbdo.intData();
        if (p >= 1 && p <= 5) currentPortionSize = p;
      }
    }
  }

  // Check if user tapped "Ping Sensor Now" in app (checks every 2 seconds)
  static unsigned long lastPingCheck = 0;
  if (nowMs - lastPingCheck >= 2000) {
    lastPingCheck = nowMs;
    if (!isDispensingNow) {
      if (Firebase.getBool(fbdo, "/feeder/triggerSensorRead") && fbdo.boolData()) {
        Firebase.setBool(fbdo, "/feeder/triggerSensorRead", false);
        Serial.println("📡 [APP PING] Immediate sensor read requested by App!");
        measureAndSyncToF(true);
      }
    }
  }

  // 3. Heap monitor
  static unsigned long lastHeapCheck = 0;
  if (nowMs - lastHeapCheck >= 5000) {
    lastHeapCheck = nowMs;
    uint32_t heap = ESP.getFreeHeap();
    if (heap < 9000 && !isDispensingNow) {
      Serial.print("🧠 [HEAP] Low memory (");
      Serial.print(heap);
      Serial.println(" bytes) — restarting to recover.");
      delay(200);
      ESP.restart();
    }
  }

  // 4. Check Schedules every 1s (local RAM comparison, 0 network cost)
  static unsigned long lastClockTick = 0;
  if (nowMs - lastClockTick >= 1000) {
    lastClockTick = nowMs;
    checkAndExecuteSchedules();
  }

  // 5. Re-sync Schedules from Firebase every 30s (offset by 15s from food level sync)
  if (nowMs - lastScheduleSync >= 30000) {
    lastScheduleSync = nowMs;
    if (!isDispensingNow) {
      syncSchedulesFromFirebase();
    }
  }

  delay(20);
}