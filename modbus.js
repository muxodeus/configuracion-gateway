const fs = require("fs");
const ModbusRTU = require("modbus-serial");

async function readHolding(client, unitId, address, length) {
  client.setID(unitId);
  const res = await client.readHoldingRegisters(address - 1, length);
  return res.data;
}

function decodeValue(words, type, endianness = "LE") {
  const buf = Buffer.alloc(4);
  if (type === "Float32") {
    if (endianness === "LE") {
      buf.writeUInt16LE(words[0], 0);
      buf.writeUInt16LE(words[1], 2);
      return buf.readFloatLE(0);
    } else {
      buf.writeUInt16BE(words[0], 0);
      buf.writeUInt16BE(words[1], 2);
      return buf.readFloatBE(0);
    }
  } else if (type === "UInt32") {
    if (endianness === "LE") {
      buf.writeUInt16LE(words[0], 0);
      buf.writeUInt16LE(words[1], 2);
      return buf.readUInt32LE(0);
    } else {
      buf.writeUInt16BE(words[0], 0);
      buf.writeUInt16BE(words[1], 2);
      return buf.readUInt32BE(0);
    }
  } else {
    return words[0];
  }
}

async function readAllMeters(configPath = "./config/meters.json") {
  const metersConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const results = [];

  for (const m of metersConfig) {
    const client = new ModbusRTU();
    await client.connectTCP(m.ip, { port: m.port || 502 });

    try {
      const templatePath = `./config/templates/${m.model}.json`;
      const template = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
      const endianness = template.endianness || "LE";

      const channels = [];
      for (const ch of template.channels) {
        const chObj = { channel: ch.channel };
        for (const p of ch.params) {
          const len = p.type === "Float32" || p.type === "UInt32" ? 2 : 1;
          const words = await readHolding(client, m.unitId, p.address, len);
          chObj[p.name] = decodeValue(words, p.type, endianness);
        }
        channels.push(chObj);
      }

      results.push({
        meter: m.meter,
        channels
      });
    } finally {
      try { client.close(); } catch {}
    }
  }

  return results;
}

module.exports = { readAllMeters };