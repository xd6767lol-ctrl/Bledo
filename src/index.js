require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 🌐 SERVIDOR WEB — MANTIENE EL BOT ACTIVO 24/7
// ==========================================
app.get('/', (req, res) => {
  res.send('Bledo Bot — Online | Sistema activo');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Puerto ${PORT} abierto — Bot en línea 24/7`);
});

// ==========================================
// ⚙️ CONFIGURACIÓN PRINCIPAL
// ==========================================
const config = {
  prefix: ',',
  name: 'Bledo',
  antinuke: {
    enabled: true,
    maxKicksPerMinute: 5,
    maxBansPerMinute: 3,
    maxChannelDeletes: 2,
    whitelistedUsers: [],
    whitelistedRoles: [],
    logChannel: 'seguridad'
  }
};

// ==========================================
// 🤖 CLIENTE DE DISCORD
// ==========================================
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

// ==========================================
// 📝 LOGGER — ESTILO LIMPIO
// ==========================================
const log = {
  info: (m) => console.log(`[INFO] ${m}`),
  success: (m) => console.log(`[SUCCESS] ${m}`),
  error: (m) => console.log(`[ERROR] ${m}`)
};

// ==========================================
// 🛡️ SISTEMA ANTINUKE
// ==========================================
const antinuke = {
  kicks: new Map(),
  bans: new Map(),
  channels: new Map(),

  isWhitelisted(member) {
    if (!config.antinuke.enabled) return true;
    if (member.id === member.guild.ownerId) return true;
    if (config.antinuke.whitelistedUsers.includes(member.id)) return true;
    return member.roles.cache.some(r => config.antinuke.whitelistedRoles.includes(r.id));
  },

  async punish(guild, userId, action) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || this.isWhitelisted(member)) return;

      if (action === 'ban') await member.ban({ reason: 'AntiNuke: Acciones masivas detectadas' });
      else if (action === 'kick') await member.kick('AntiNuke: Acciones masivas detectadas');
      else if (action === 'channel') await member.roles.set([], 'AntiNuke: Eliminación masiva de canales');

      const logCh = guild.channels.cache.find(c => c.name === config.antinuke.logChannel);
      if (logCh) await logCh.send(`**AntiNuke Activado**\nUsuario: <@${userId}>\nAcción: ${action}\nCastigo aplicado`);
    } catch (e) { log.error(`No se pudo sancionar a ${userId}`); }
  },

  check(guildId, userId, type) {
    const now = Date.now();
    const window = 60000;
    const map = this[type];
    if (!map.has(guildId)) map.set(guildId, new Map());
    const userMap = map.get(guildId);
    if (!userMap.has(userId)) userMap.set(userId, []);

    const actions = userMap.get(userId).filter(t => now - t < window);
    actions.push(now);
    userMap.set(userId, actions);

    const limit = config.antinuke[`max${type.charAt(0).toUpperCase() + type.slice(1)}PerMinute`];
    return actions.length > limit;
  }
};

// ==========================================
// 📡 EVENTOS
// ==========================================
client.on('ready', () => {
  log.success(`${client.user.tag} está en línea`);
  client.user.setActivity(',help | Protegiendo servidores', { type: 3 });
});

// Protección contra Kicks
client.on('guildMemberRemove', async (member) => {
  if (member.user.bot || !config.antinuke.enabled) return;
  const audit = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.target.id !== member.id) return;
  if (antinuke.check(member.guild.id, entry.executor.id, 'kicks')) {
    await antinuke.punish(member.guild, entry.executor.id, 'kick');
  }
});

// Protección contra Bans
client.on('guildBanAdd', async (ban) => {
  if (ban.user.bot || !config.antinuke.enabled) return;
  const audit = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry) return;
  if (antinuke.check(ban.guild.id, entry.executor.id, 'bans')) {
    await antinuke.punish(ban.guild, entry.executor.id, 'ban');
  }
});

// Protección contra eliminación de canales
client.on('channelDelete', async (channel) => {
  if (!channel.guild || !config.antinuke.enabled) return;
  const audit = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry) return;
  if (antinuke.check(channel.guild.id, entry.executor.id, 'channels')) {
    await antinuke.punish(channel.guild, entry.executor.id, 'channel');
  }
});

// ==========================================
// ⌨️ COMANDOS
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Ayuda
  if (cmd === 'help' || cmd === 'cmd') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${config.name} — Comandos`)
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: 'AntiNuke', value: '`,antinuke enable` — Activar protección\n`,antinuke disable` — Desactivar\n`,whitelist add/remove @usuario` — Administrar lista blanca' },
        { name: 'Información', value: '`,help` — Mostrar este menú' }
      );
    return message.reply({ embeds: [embed] });
  }

  // Activar/Desactivar AntiNuke
  if (cmd === 'antinuke') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator))
      return message.reply('Permisos insuficientes — Se requiere Administrador');

    const sub = args[0]?.toLowerCase();
    if (sub === 'enable') {
      config.antinuke.enabled = true;
      return message.reply('AntiNuke activado — Protección en línea');
    }
    if (sub === 'disable') {
      config.antinuke.enabled = false;
      return message.reply('AntiNuke desactivado — El servidor no está protegido');
    }
    return message.reply(`AntiNuke: ${config.antinuke.enabled ? 'Activado' : 'Desactivado'}`);
  }

  // Whitelist
  if (cmd === 'whitelist') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const sub = args[0]?.toLowerCase();
    const user = message.mentions.users.first();

    if (sub === 'add' && user) {
      if (config.antinuke.whitelistedUsers.includes(user.id))
        return message.reply('El usuario ya está en la lista blanca');
      config.antinuke.whitelistedUsers.push(user.id);
      return message.reply(`${user.tag} añadido a la lista blanca`);
    }
    if (sub === 'remove' && user) {
      config.antinuke.whitelistedUsers = config.antinuke.whitelistedUsers.filter(id => id !== user.id);
      return message.reply(`${user.tag} eliminado de la lista blanca`);
    }
    const list = config.antinuke.whitelistedUsers.length > 0
      ? config.antinuke.whitelistedUsers.map(id => `<@${id}>`).join(', ')
      : 'Vacía';
    return message.reply(`Lista Blanca:\n${list}`);
  }
});

// ==========================================
// 🔑 INICIAR BOT
// ==========================================
client.login(process.env.TOKEN)
  .then(() => log.success('Bot iniciado correctamente'))
  .catch(err => log.error(`Error de inicio: ${err.message}`));
