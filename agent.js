// agent.js
const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const { readAllMeters } = require("./modbus.js");

const { MQTT_URL, MQTT_USER, MQTT_PASS } = process.env;

// Paths
const CONFIG_DIR = path.resolve(__dirname, "config");
const METERS_PATH = path.join(CONFIG_DIR, "meters.json");
const BACKUP_PATH = path.join(CONFIG_DIR, "meters.json.bak");

// Helpers
function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function validateMetersConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return "Config is not a JSON object";
  if (!cfg.site || typeof cfg.site !== "string") return "Missing site";
  if (!cfg.gw || typeof cfg.gw !== "string") return "Missing gw";
  if (!Array.isArray(cfg.meters)) return "meters must be an array";
  for (const m of cfg.meters) {
    if (!m.meter || !m.ip || !m.unitId || !m.model) {
      return "Each meter requires meter, ip, unitId, model";
    }
  }
  return null;
}

function getCurrentIDs() {
  const cfg = safeReadJSON(METERS_PATH);
  return {
    site: (cfg && cfg.site) || "",
    gw: (cfg && cfg.gw) || "",
  };
}

// MQTT client
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on("connect", () => {
  const { gw } = getCurrentIDs();
  console.log("MQTT conectado");

  // Subscribe to config updates for this GW. If gw is missing, use a wildcard bootstrap.
  const configTopic = gw ? `config/${gw}/meters` : `config/+/meters`;
  client.subscribe(configTopic, { qos: 1 }, (err) => {
    if (err) console.error("Error al suscribirse a config:", err.message || err);
    else console.log("Suscrito a:", configTopic);
  });
});

client.on("message", (topic, message) => {
  try {
    const cfg = JSON.parse(message.toString());
    const err = validateMetersConfig(cfg);
    if (err) {
      console.error("Config inválida:", err);
      return;
    }

    // Backup previous config
    try {
      if (fs.existsSync(METERS_PATH)) {
        fs.copyFileSync(METERS_PATH, BACKUP_PATH);
      }
    } catch (e) {
      console.warn("No se pudo crear backup:", e.message || e);
    }

    // Atomic write
    const tmpPath = METERS_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), "utf-8");
    fs.renameSync(tmpPath, METERS_PATH);

    console.log("✅ meters.json actualizado desde MQTT:", topic);
    const ids = getCurrentIDs();
    console.log("IDs actuales:", ids);
  } catch (e) {
    console.error("Error aplicando config MQTT:", e.message || e);
  }
});

async function loop() {
  try {
    const ts = new Date().toISOString();
    const ids = getCurrentIDs();
    const cfg = safeReadJSON(METERS_PATH);

    // If config missing or empty, skip work to avoid noise
    if (!cfg || !Array.isArray(cfg.meters) || cfg.meters.length === 0) {
      console.log("⏱️ Loop:", ts, "sin configuración de medidores");
      return;
    }

    const meters = await readAllMeters(METERS_PATH);
    console.log("⏱️ Loop ejecutado:", ts, "meters:", meters.length);

    const topicPrefix = `data/${ids.site}/${ids.gw}`;
    for (const m of meters) {
      for (const ch of m.channels) {
        const payload = {
          site: ids.site,
          gw: ids.gw,
          ts,
          meter: m.meter,
          channel: ch.channel,
          voltage: ch.voltage,
          current: ch.current,
          p_act: ch.p_act,
          p_react: ch.p_react,
          p_app: ch.p_app,
          pf: ch.pf,
          energy_import: ch.energy_import,
          demand_p_act: ch.demand_p_act,
          ithd: ch.ithd,
          vthd: ch.vthd,
        };
        client.publish(topicPrefix, JSON.stringify(payload));
      }
    }
  } catch (err) {
    console.error("Error en loop:", err?.message || err);
  }
}

setInterval(loop, 1000);