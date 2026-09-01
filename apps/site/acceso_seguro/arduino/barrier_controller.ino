/*
 * AccesoSeguro - Barrier Controller (IN/OUT)
 *
 * Protocolo Serial:
 * Python -> Arduino: "OPEN_IN", "CLOSE_IN", "OPEN_OUT", "CLOSE_OUT", "PING"
 * Arduino -> Python: "OK", "PASSED_IN", "PASSED_OUT", "PONG"
 */

#define RELAY_IN_PIN   2
#define RELAY_OUT_PIN  3
#define SENSOR_IN_PIN  4
#define SENSOR_OUT_PIN 5

// Estado anterior de los sensores para detectar flanco (pulso)
bool lastSensorInState = HIGH; 
bool lastSensorOutState = HIGH;

void setup() {
  Serial.begin(9600);
  
  pinMode(RELAY_IN_PIN, OUTPUT);
  pinMode(RELAY_OUT_PIN, OUTPUT);
  
  // Los relés suelen activarse en LOW (depende del módulo), asumo HIGH = inactivo
  digitalWrite(RELAY_IN_PIN, HIGH);
  digitalWrite(RELAY_OUT_PIN, HIGH);
  
  pinMode(SENSOR_IN_PIN, INPUT_PULLUP);
  pinMode(SENSOR_OUT_PIN, INPUT_PULLUP);
}

void loop() {
  // 1. Leer comandos desde el puerto serial
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "PING") {
      Serial.println("PONG");
    } 
    else if (cmd == "OPEN_IN") {
      digitalWrite(RELAY_IN_PIN, LOW); // Activar
      Serial.println("OK");
    }
    else if (cmd == "CLOSE_IN") {
      digitalWrite(RELAY_IN_PIN, HIGH); // Desactivar
      Serial.println("OK");
    }
    else if (cmd == "OPEN_OUT") {
      digitalWrite(RELAY_OUT_PIN, LOW);
      Serial.println("OK");
    }
    else if (cmd == "CLOSE_OUT") {
      digitalWrite(RELAY_OUT_PIN, HIGH);
      Serial.println("OK");
    }
  }

  // 2. Leer sensores y emitir eventos
  // Usamos INPUT_PULLUP, por lo tanto LOW = vehículo detectado (sensor cerrado a GND)
  bool currentSensorInState = digitalRead(SENSOR_IN_PIN);
  if (currentSensorInState == LOW && lastSensorInState == HIGH) {
    // Flanco de bajada detectado
    Serial.println("PASSED_IN");
    delay(50); // debounce
  }
  lastSensorInState = currentSensorInState;

  bool currentSensorOutState = digitalRead(SENSOR_OUT_PIN);
  if (currentSensorOutState == LOW && lastSensorOutState == HIGH) {
    Serial.println("PASSED_OUT");
    delay(50); // debounce
  }
  lastSensorOutState = currentSensorOutState;
}
