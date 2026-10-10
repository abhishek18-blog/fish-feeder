/**
 * ==============================================================================
 * SmartFish Feeder — ESP8266 Firmware (Automated Schedules + Genuine Ultrasonic)
 * ==============================================================================
 * 
 * Hardware Connections:
 *   - Servo PWM Signal : D4 (GPIO2)   [Safe boot pin — DO NOT use D8!]
 *   - HC-SR04 Trigger  : D6 (GPIO12)
 *   - HC-SR04 Echo     : D7 (GPIO13)
 *   - Status LED       : LED_BUILTIN (Active LOW)
 * 
 * Features:
 *   1. Genuine Ultrasonic Sensor Reading (HC-SR04):
 *      - Accurate ping measurement in centimeters.
 *      - Max distance = 5.0 cm (0% empty), Min distance = 1.0 cm (100% full).
 *      - Publishes foodDistanceCm, foodLevel, sensorConnected, lastSensorPing.
 *   2. Automated Schedules (IST UTC+5:30):
 *      - Syncs Indian Standard Time via NTP.
 *      - Automatically checks active schedules from Firebase (/feeder/schedules).
 *      - Dispatches automatic feeds at scheduled times (e.g. 09:43 AM, 06:00 PM).
 *      - Respects Vacation Mode & frequency (Daily, Mon-Fri, Weekends).
 *   3. Real-Time Remote Control:
 *      - Instant manual feed when "Feed Now" is tapped in app.
 *      - Responds to "Ping Sensor Now" requests from app.
 * ==============================================================================
 */

#include <ESP8266WiFi.h>
#include <FirebaseESP8266.h>
#include <Servo.h>
#include <time.h>

// ------------------------------------------------------------------------------
// 1. Wi-Fi Configuration
// ------------------------------------------------------------------------------
#define WIFI_SSID     "Abcd"
#define WIFI_PASSWORD "abhi2004"

// ------------------------------------------------------------------------------
// 2. Firebase Configuration
// ------------------------------------------------------------------------------
#define FIREBASE_HOST "aqua-feeder-57e0d-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "AIzaSyCu0IG_SpEuauBZRek50KZA19Y7o4o9mF0"

// ------------------------------------------------------------------------------
// 3. Hardware Pin Definitions
// ------------------------------------------------------------------------------
#define SERVO_PIN        D4          // GPIO2  -> Servo PWM Signal
#define TRIG_PIN         D6          // GPIO12 -> Ultrasonic Trigger
#define ECHO_PIN         D7          // GPIO13 -> Ultrasonic Echo
#define LED_PIN          LED_BUILTIN // Onboard LED (Active LOW)
#define GREEN_LED_PIN    D1          // GPIO5  -> Green LED: blinks while dispensing
#define RED_LED_PIN      D2          // GPIO4  -> Red LED: solid ON when idle

// ------------------------------------------------------------------------------
// 4. Ultrasonic Sensor Calibration (Max 5.0 cm = 0%, Min 1.0 cm = 100%)
// ------------------------------------------------------------------------------
#define DISTANCE_MAX_CM   5.0f   // 5.0 cm = container empty (0%)
#define DISTANCE_MIN_CM   1.0f   // 1.0 cm or closer = container full (100%)

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

unsigned long lastPoll = 0;
unsigned long lastSensorAndHeartbeat = 0;
unsigned long lastScheduleSync = 0;

int currentFoodLevel = 100;
int currentPortionSize = 1;
float currentDistanceCm = 1.0f;
bool sensorConnected = false;
bool isDispensingNow = false;
int lastFeedCommandCount = -1;

// ------------------------------------------------------------------------------
// 7. Genuine Ultrasonic Ping Functions
// ------------------------------------------------------------------------------

/**
 * Executes a genuine hardware ping to the HC-SR04 ultrasonic sensor.
 * Returns distance in centimeters, or -1.0f if timeout / disconnected.
 */
float pingRawDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // 25ms timeout (~400cm max range)
  long duration = pulseIn(ECHO_PIN, HIGH, 25000);

  if (duration <= 0) {
    return -1.0f; // Timeout / sensor disconnected
  }

  // Sound speed in air: 343 m/s = 0.0343 cm/us (divide by 2 for round-trip)
  float cm = (duration * 0.0343f) / 2.0f;
  return cm;
}

/**
 * Takes 3 genuine pings and returns the median distance.
 * Filters out single-pulse acoustic reflections from container walls.
 */
float readGenuineDistanceCm() {
  float readings[3];
  int validCount = 0;

  for (int i = 0; i < 3; i++) {
    float d = pingRawDistanceCm();
    if (d > 0.4f && d < 35.0f) {
      readings[validCount++] = d;
    }
    delay(15);
    yield();
  }

  if (validCount == 0) {
    sensorConnected = false;
    return -1.0f;
  }

  sensorConnected = true;

  if (validCount == 1) return readings[0];
  if (validCount == 2) return (readings[0] + readings[1]) / 2.0f;

  // Median of 3
  if ((readings[0] <= readings[1] && readings[1] <= readings[2]) ||
      (readings[2] <= readings[1] && readings[1] <= readings[0])) return readings[1];
  if ((readings[1] <= readings[0] && readings[0] <= readings[2]) ||
      (readings[2] <= readings[0] && readings[0] <= readings[1])) return readings[0];
  return readings[2];
}

/**
 * Calculates genuine food level percentage from real ultrasonic distance:
 *   Distance >= 5.0 cm -> 0% (Empty)
 *   Distance <= 1.0 cm -> 100% (Full)
 * Publishes raw distance, percentage & heartbeat in ONE single batched request!
 */
int measureAndSyncUltrasonic() {
  float dist = readGenuineDistanceCm();

  FirebaseJson syncJson;
  syncJson.set("deviceOnline", true);
  syncJson.set("lastHeartbeat", (int)time(nullptr));

  if (dist < 0.0f) {
    Serial.println("⚠️ [ULTRASONIC] Sensor read timeout (Check VCC=5V, Trig=D6, Echo=D7)");
    syncJson.set("sensorConnected", false);
    Firebase.updateNodeSilent(fbdo, "/feeder", syncJson);
    return currentFoodLevel;
  }

  currentDistanceCm = dist;

  // Exact linear percentage between 1.0cm (100%) and 5.0cm (0%)
  float pct = ((DISTANCE_MAX_CM - dist) / (DISTANCE_MAX_CM - DISTANCE_MIN_CM)) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;

  currentFoodLevel = (int)round(pct);

  Serial.print("📏 [GENUINE PING] Distance: ");
  Serial.print(currentDistanceCm, 2);
  Serial.print(" cm | Food Level: ");
  Serial.print(currentFoodLevel);
  Serial.println("%");

  // Sync all genuine readings in ONE single fast packet (instead of 6 separate requests)
  syncJson.set("foodLevel", currentFoodLevel);
  syncJson.set("foodDistanceCm", currentDistanceCm);
  syncJson.set("sensorConnected", true);
  syncJson.set("lastSensorPing", (int)time(nullptr));
  Firebase.updateNodeSilent(fbdo, "/feeder", syncJson);

  return currentFoodLevel;
}

// ------------------------------------------------------------------------------
// 8. LED Status Control
// ------------------------------------------------------------------------------

// Non-blocking green LED blink state (used inside the servo spin loop)
static unsigned long lastGreenBlink = 0;
static bool greenLedState = false;

/**
 * Call setIdleLEDs() when nothing is happening:
 *   Red LED   -> solid ON  (D2)
 *   Green LED -> solid OFF (D1)
 */
void setIdleLEDs() {
  digitalWrite(GREEN_LED_PIN, LOW);  // Green OFF
  digitalWrite(RED_LED_PIN,   HIGH); // Red ON
  greenLedState = false;
}

/**
 * Call setDispensingLEDs() once at the START of dispensing:
 *   Red LED   -> OFF immediately (D2)
 *   Green LED -> starts blinking (D1) — call tickGreenBlink() in spin loop
 */
void setDispensingLEDs() {
  digitalWrite(RED_LED_PIN,   LOW);  // Red OFF
  digitalWrite(GREEN_LED_PIN, HIGH); // Green ON (first half of first blink)
  greenLedState = true;
  lastGreenBlink = millis();
}

/**
 * Call inside the servo spin while-loop to keep green LED blinking
 * at ~200ms interval without using blocking delay
 */
void tickGreenBlink() {
  if (millis() - lastGreenBlink >= 200) {
    lastGreenBlink = millis();
    greenLedState = !greenLedState;
    digitalWrite(GREEN_LED_PIN, greenLedState ? HIGH : LOW);
  }
}

/**
 * Helper: wait for ms while keeping Green LED blinking and Wi-Fi watchdog happy
 */
void waitWithGreenBlink(unsigned long ms) {
  unsigned long start = millis();
  while (millis() - start < ms) {
    tickGreenBlink();
    delay(20);
    yield();
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

  // ── 1. LED: Red OFF (D2), Green starts BLINKING (D1) ─────────────────────
  setDispensingLEDs();
  digitalWrite(LED_PIN, LOW); // Onboard LED ON

  // ── 2. Full-Arc Servo Sweep (Works on BOTH 180° SG90 & 360° Servos!) ─────
  // Sweeping 180° -> 0° -> 90° with full travel time guarantees the motor
  // physically moves back and forth on EVERY press and never gets stuck at 180°.
  feederServo.attach(SERVO_PIN, 500, 2400);
  delay(30);

  for (int p = 0; p < portionSize; p++) {
    feederServo.write(180);      // Swing to 180° (or spin forward)
    waitWithGreenBlink(650);     // Wait 650ms while blinking Green LED

    feederServo.write(0);        // Swing back to 0° (un-jams & completes stroke)
    waitWithGreenBlink(650);     // Wait 650ms while blinking Green LED
  }

  // Return to neutral 90° and give physical gears 400ms to reach position before detach
  feederServo.write(90);
  waitWithGreenBlink(400);
  feederServo.detach();

  // ── 3. LED: Green OFF (D1), Red back ON (D2 - idle) ──────────────────────
  setIdleLEDs();
  digitalWrite(LED_PIN, HIGH); // Onboard LED OFF

  // ── 4. Immediately unlock App UI ("Ready") with retry ────────────────────
  String spinStr = String(portionSize * 1.5f, 1) + "s servo spin";
  if (!Firebase.setString(fbdo, "/feeder/servoStatus", "Ready")) {
    delay(100);
    Firebase.setString(fbdo, "/feeder/servoStatus", "Ready");
  }

  // Wait 800ms for food surface to settle, then take genuine ultrasonic ping
  delay(800);
  measureAndSyncUltrasonic();

  // Push event to Firebase history
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

/**
 * Downloads all schedules from Firebase (/feeder/schedules) and parses them
 */
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
    String timeStr = d.stringValue; // e.g. "9:43" or "08:00"

    itemJson.get(d, "ampm");
    String ampm = d.stringValue; // "AM" or "PM"

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
  Serial.println(" schedule(s):");
  for (int i = 0; i < totalSchedules; i++) {
    Serial.print("      ");
    Serial.print(i + 1);
    Serial.print(". \"");
    Serial.print(schedulesList[i].name);
    Serial.print("\" -> ");
    if (schedulesList[i].hour24 < 10) Serial.print("0");
    Serial.print(schedulesList[i].hour24);
    Serial.print(":");
    if (schedulesList[i].minute < 10) Serial.print("0");
    Serial.print(schedulesList[i].minute);
    Serial.print(" (");
    Serial.print(schedulesList[i].active ? "ACTIVE" : "PAUSED");
    Serial.print(", ");
    Serial.print(schedulesList[i].frequency);
    Serial.println(")");
  }
}

/**
 * Compares current IST time against all active schedules
 */
void checkAndExecuteSchedules() {
  time_t now = time(nullptr);
  if (now < 100000) return; // Time not yet synced from NTP

  struct tm* t = localtime(&now);
  int curHour = t->tm_hour; // 0 - 23
  int curMin  = t->tm_min;  // 0 - 59
  int curWday = t->tm_wday; // 0=Sun, 1=Mon, ..., 6=Sat

  int curDay  = t->tm_yday; // Day of year (0-365)

  // Avoid running multiple times during the same minute of the same day
  if (curDay == lastFiredDay && curHour == lastFiredHour && curMin == lastFiredMinute) {
    return;
  }

  for (int i = 0; i < totalSchedules; i++) {
    if (!schedulesList[i].active) continue;

    if (curHour == schedulesList[i].hour24 && curMin == schedulesList[i].minute) {
      // Check frequency rules
      String freq = schedulesList[i].frequency;
      bool dayMatches = true;

      if (freq == "Mon-Fri" && (curWday == 0 || curWday == 6)) {
        dayMatches = false;
      } else if (freq == "Weekends" && (curWday >= 1 && curWday <= 5)) {
        dayMatches = false;
      }

      if (dayMatches) {
        // Check vacation mode in Firebase
        bool vacation = false;
        if (Firebase.getBool(fbdo, "/feeder/vacationMode")) {
          vacation = fbdo.boolData();
        }

        if (vacation) {
          Serial.println("🏖️ [VACATION MODE] Schedule skipped because Vacation Mode is ON.");
          lastFiredDay = curDay;
          lastFiredHour = curHour;
          lastFiredMinute = curMin;
          return;
        }

        Serial.println();
        Serial.println("⏰ [ALARM TRIGGERED] Scheduled time reached!");
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
// 10. Setup
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH); // Onboard LED OFF initially

  // ── External Status LEDs ──────────────────────────────────────────────────
  pinMode(GREEN_LED_PIN, OUTPUT); // D1 -> Green: blinks while dispensing
  pinMode(RED_LED_PIN,   OUTPUT); // D2 -> Red:   solid ON while idle
  setIdleLEDs();                  // Start in idle state: Red ON, Green OFF

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   🐟 SmartFish Feeder — Automated ESP8266        ");
  Serial.println("   Ultrasonic: Trig=D6, Echo=D7 (Max 5.0cm)       ");
  Serial.println("   Servo PWM : D4 (GPIO2)                         ");
  Serial.println("   Timezone  : Indian Standard Time (IST UTC+5:30)");
  Serial.println("==================================================");

  // 1. Connect to Wi-Fi (25s timeout)
  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startWifi = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startWifi < 25000) {
    delay(400);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Blink
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, HIGH); // Off
    Serial.println();
    Serial.println("   ✅ Wi-Fi Connected!");
    Serial.print("   📶 Signal (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("   🌐 IP Address: ");
    Serial.println(WiFi.localIP());

    // 2. Configure Indian Standard Time (IST = UTC+5:30 = 19800s)
    Serial.print("   🇮🇳 Syncing Indian Standard Time (IST)...");
    configTime(19800, 0, "in.pool.ntp.org", "asia.pool.ntp.org", "time.google.com");
    time_t now = time(nullptr);
    int retry = 0;
    while (now < 100000 && retry < 20) {
      delay(200);
      now = time(nullptr);
      retry++;
    }
    if (now > 100000) {
      Serial.println(" synced!");
      Serial.print("   ⏰ Current IST Time: ");
      Serial.println(ctime(&now));
    } else {
      Serial.println(" (NTP pending)");
    }
  } else {
    Serial.println();
    Serial.println("   ❌ WI-FI FAILED TO CONNECT! (Check 2.4 GHz band & password)");
  }

  // 3. Initialize Firebase Realtime Database (Single Keep-Alive SSL Socket)
  Serial.print("Connecting to Firebase Database...");
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
    // If Web API key caused auth parse failure, retry with empty legacy token for public test rules
    if (err.indexOf("auth") >= 0 || err.indexOf("token") >= 0 || err.indexOf("401") >= 0 || err.indexOf("Unauthorized") >= 0) {
      Serial.println("   Retrying with public rule access (clearing legacy token)...");
      config.signer.tokens.legacy_token = "";
      Firebase.begin(&config, &auth);
      if (Firebase.setBool(fbdo, "/feeder/deviceOnline", true)) {
        Serial.println("   ✅ Connected to Firebase successfully with public rules!");
      } else {
        Serial.println("   ❌ Still unable to write: " + fbdo.errorReason());
        Serial.println("   👉 Please check Firebase Realtime Database Rules or paste your Database Secret.");
      }
    }
  }

  // 4. Initial Genuine Ultrasonic Measurement & State Sync
  Serial.println("Taking initial ultrasonic ping...");
  measureAndSyncUltrasonic();

  FirebaseJson initJson;
  initJson.set("servoStatus", "Ready");
  initJson.set("maxDistanceCm", DISTANCE_MAX_CM);
  initJson.set("minDistanceCm", DISTANCE_MIN_CM);
  Firebase.updateNodeSilent(fbdo, "/feeder", initJson);

  if (Firebase.getInt(fbdo, "/feeder/portionSize")) {
    int p = fbdo.intData();
    if (p >= 1 && p <= 5) currentPortionSize = p;
  }

  // 5. Download Schedules immediately on boot
  syncSchedulesFromFirebase();

  Serial.println("==================================================");
  Serial.println("✅ Feeder Active! Monitoring schedules & app...");
  Serial.println("==================================================");
}

// ------------------------------------------------------------------------------
// 11. Main Loop (Ultra-fast single-request polling)
// ------------------------------------------------------------------------------
void loop() {
  yield();

  if (WiFi.status() != WL_CONNECTED) {
    delay(500);
    return;
  }

  unsigned long nowMs = millis();

  // ── 1. Check for "Feed Now" every 300ms (ONLY 1 lightweight GET!) ─────────
  // Because we don't clog the socket with 3 GETs per loop, this responds in ~150ms!
  if (nowMs - lastPoll >= 300) {
    lastPoll = nowMs;

    if (!isDispensingNow && Firebase.getString(fbdo, "/feeder/servoStatus")) {
      if (fbdo.stringData() == "Dispensing") {
        Serial.println("⚡ [FEED NOW] Instant trigger received from App!");
        dispenseFood(currentPortionSize, "Manual Feed", "manual");
      }
    }
  }

  // ── 2. Check Schedules Every 1 Second (Local RAM check — 0 network cost!) ─
  static unsigned long lastClockTick = 0;
  if (nowMs - lastClockTick >= 1000) {
    lastClockTick = nowMs;
    checkAndExecuteSchedules();
  }

  // ── 3. Batched Ultrasonic Ping + Heartbeat + Portion Sync Every 15s ───────
  if (nowMs - lastSensorAndHeartbeat >= 15000) {
    lastSensorAndHeartbeat = nowMs;
    if (!isDispensingNow) {
      measureAndSyncUltrasonic();

      // Sync portionSize & check if manual sensor read was requested
      if (Firebase.getInt(fbdo, "/feeder/portionSize")) {
        int p = fbdo.intData();
        if (p >= 1 && p <= 5) currentPortionSize = p;
      }
      if (Firebase.getBool(fbdo, "/feeder/triggerSensorRead") && fbdo.boolData()) {
        Firebase.setBool(fbdo, "/feeder/triggerSensorRead", false);
      }
    }
  }

  // ── 4. Re-Sync Schedules From Firebase Every 30 Seconds ───────────────────
  if (nowMs - lastScheduleSync >= 30000) {
    lastScheduleSync = nowMs;
    if (!isDispensingNow) {
      syncSchedulesFromFirebase();
    }
  }

  delay(20);
}
