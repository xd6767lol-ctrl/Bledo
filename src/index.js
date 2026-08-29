require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ========== SERVIDOR WEB → PARA QUE FUNCIONE 24/7 EN RENDER ==========
app.get('/', (req, res) => res.send('✅ Bot Activo — Sistema AntiNuke | En línea 24/7'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Puerto abierto — Escuchando en el puerto ${PORT}`));

// ========== CONFIGURACIÓN ==========
const config = {
  prefix: ',', // ✅ PREFIJO COMA
  reactionRoles: {
    messageId: process.env.REACTION_MESSAGE_ID || "ID_DEL_MENSAJE_DE_REACCIONES",
    roles: {
      "🔴": process.env.ROLE_RED || "ID_DEL_ROL_ROJO",
      "🔵": process.env.ROLE_BLUE || "ID_DEL_ROL_AZUL"
    }
  },
  antinuke: {
    enabled: true,
    maxKicksPerMinute: 5,
    maxBansPerMinute: 3,
    maxChannelDeletes: 2,
    whitelistedUsers: [],
    whitelistedRoles: ["ID_ROL_ADMIN", "ID_ROL_MOD"],
    logChannel: process.env.LOG_CHANNEL || "seguridad"
  }
};

// ========== CLIENTE DISCORD ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

// ========== LOGGER ==========
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

// ========== SISTEMA ANTINUKE ==========
const antinuke = {
  kicks: new Map(),
  bans: new Map(),
  channelDeletes: new Map(),

  isWhitelisted(member) {
    if (!config.antinuke.enabled) return true;
    if (member.id === member.guild.ownerId) return true;
    if (config.antinuke.whitelistedUsers.includes(member.id)) return true;
    return member.roles.cache.some(role => config.antinuke.whitelistedRoles.includes(role.id));
  },

  async punish(guild, userId, action) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || this.isWhitelisted(member)) return;

      if (action === 'ban') await member.ban({ reason: 'AntiNuke: Acciones masivas detectadas' });
      else if (action === 'kick') await member.kick('AntiNuke: Acciones masivas detectadas');
      else if (action === 'channel') await member.roles.set([], 'AntiNuke: Eliminación masiva de canales');

      const logCh = guild.channels.cache.find(c => c.name === config.antinuke.logChannel);
      if (logCh) await logCh.send(`🚨 **AntiNuke Activado**\nUsuario: <@${userId}>\nAcción: ${action}\nCastigo aplicado`);
    } catch (e) { logger.error(`Error al sancionar ${userId}: ${e.message}`); }
  },

  checkLimit(guildId, userId, type) {
    const now = Date.now();
    const window = 60000; // 1 minuto
    const map = this[type];
    if (!map.has(guildId)) map.set(guildId, new Map());
    const userMap = map.get(guildId);
    if (!userMap.has(userId)) userMap.set(userId, []);
    
    const actions = userMap.get(userId).filter(t => now - t < window);
    actions.push(now);
    userMap.set(userId, actions);

    const limit = config.antinuke[`max${type.charAt(0).toUpperCase() + type.slice(1)}PerMinute`];
    return actions.length > limit ? actions.length : 0;
  }
};

// ========== EVENTOS ==========
client.on('ready', () => {
  logger.success(`Bot conectado como ${client.user.tag}`);
  client.user.setActivity(',help | Protegiendo servidores', { type: 3 });
});

// AntiNuke: Kicks
client.on('guildMemberRemove', async (member) => {
  if (member.user.bot || !config.antinuke.enabled) return;
  const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.target.id !== member.id) return;
  const count = antinuke.checkLimit(member.guild.id, entry.executor.id, 'kicks');
  if (count > 0) await antinuke.punish(member.guild, entry.executor.id, 'kick');
});

// AntiNuke: Bans
client.on('guildBanAdd', async (ban) => {
  if (ban.user.bot || !config.antinuke.enabled) return;
  const audit = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry) return;
  const count = antinuke.checkLimit(ban.guild.id, entry.executor.id, 'bans');
  if (count > 0) await antinuke.punish(ban.guild, entry.executor.id, 'ban');
});

// AntiNuke: Canales eliminados
client.on('channelDelete', async (channel) => {
  if (!channel.guild || !config.antinuke.enabled) return;
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry) return;
  const count = antinuke.checkLimit(channel.guild.id, entry.executor.id, 'channelDeletes');
  if (count > 0) await antinuke.punish(channel.guild, entry.executor.id, 'channel');
});

// ========== ROLES POR REACCIONES ==========
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  if (reaction.message.id !== config.reactionRoles.messageId) return;

  const roleId = config.reactionRoles.roles[reaction.emoji.name];
  if (!roleId) return;

  const member = reaction.message.guild.members.cache.get(user.id);
  const role = reaction.message.guild.roles.cache.get(roleId);
  if (member && role) await member.roles.add(role).catch(() => null);
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  if (reaction.message.id !== config.reactionRoles.messageId) return;

  const roleId = config.reactionRoles.roles[reaction.emoji.name];
  if (!roleId) return;

  const member = reaction.message.guild.members.cache.get(user.id);
  const role = reaction.message.guild.roles.cache.get(roleId);
  if (member && role) await member.roles.remove(role).catch(() => null);
});

// ========== COMANDOS ==========
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // HELP
  if (cmd === 'help' || cmd === 'cmd') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🤖 Comandos del Bot')
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: '🛡️ AntiNuke', value: '`,antinuke enable` — Activar protección\n`,antinuke disable` — Desactivar\n`,whitelist add/remove @user` — Administrar whitelist' },
        { name: '🎭 Roles por Reacciones', value: 'Sistema automático activo' },
        { name: '⚙️ Utilidad', value: '`,help` — Mostrar este menú' }
      );
    return message.reply({ embeds: [embed] });
  }

  // ANTINUKE ON/OFF
  if (cmd === 'antinuke') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) 
      return message.reply('❌ Necesitas permisos de Administrador');
    
    const sub = args[0]?.toLowerCase();
    if (sub === 'enable') {
      config.antinuke.enabled = true;
      return message.reply('✅ AntiNuke activado y protegiendo el servidor');
    }
    if (sub === 'disable') {
      config.antinuke.enabled = false;
      return message.reply('⚠️ AntiNuke desactivado — ¡El servidor está sin protección!');
    }
    return message.reply(`🛡️ AntiNuke está ${config.antinuke.enabled ? '✅ ACTIVADO' : '❌ DESACTIVADO'}`);
  }

  // WHITELIST
  if (cmd === 'whitelist') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const sub = args[0]?.toLowerCase();
    const user = message.mentions.users.first();

    if (sub === 'add' && user) {
      if (!config.antinuke.whitelistedUsers.includes(user.id)) {
        config.antinuke.whitelistedUsers.push(user.id);
        return message.reply(`✅ <@${user.id}> añadido a la whitelist`);
      }
      return message.reply('❌ Ya está en la whitelist');
    }
    if (sub === 'remove' && user) {
      config.antinuke.whitelistedUsers = config.antinuke.whitelistedUsers.filter(id => id !== user.id);
      return message.reply(`✅ <@${user.id}> eliminado de la whitelist`);
    }
    const list = config.antinuke.whitelistedUsers.length > 0 
      ? config.antinuke.whitelistedUsers.map(id => `<@${id}>`).join(', ') 
      : 'Vacía';
    return message.reply(`📋 Whitelist:\n${list}`);
  }
});

// ========== INICIAR BOT ==========
client.login(process.env.TOKEN)
  .then(() => logger.success('Bot iniciado correctamente'))
  .catch(err => logger.error(`Error al iniciar: ${err.message}`));
