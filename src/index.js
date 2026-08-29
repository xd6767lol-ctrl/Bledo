require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// 🌐 SERVIDOR WEB — SIEMPRE ACTIVO 24/7
// ==========================================
app.get('/', (req, res) => {
  res.send('Willy Santino — Sistema Activo | Protección 24/7');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Puerto ${PORT} — Bot en línea y sin apagarse`);
});

// ==========================================
// ⚙️ CONFIGURACIÓN — WILLY SANTINO
// ==========================================
const config = {
  prefix: ',',
  nombre: 'Willy Santino',
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
// 🤖 CLIENTE DISCORD
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
// 📝 REGISTRO EN CONSOLA
// ==========================================
const log = {
  info: (m) => console.log(`[INFO] ${m}`),
  listo: (m) => console.log(`[LISTO] ${m}`),
  error: (m) => console.log(`[ERROR] ${m}`)
};

// ==========================================
// 🛡️ SISTEMA ANTINUKE
// ==========================================
const antinuke = {
  accionesKicks: new Map(),
  accionesBans: new Map(),
  accionesCanales: new Map(),

  esPermitido(miembro) {
    if (!config.antinuke.enabled) return true;
    if (miembro.id === miembro.guild.ownerId) return true;
    if (config.antinuke.whitelistedUsers.includes(miembro.id)) return true;
    return miembro.roles.cache.some(rol => config.antinuke.whitelistedRoles.includes(rol.id));
  },

  async sancionar(servidor, usuarioId, accion) {
    try {
      const miembro = await servidor.members.fetch(usuarioId).catch(() => null);
      if (!miembro || this.esPermitido(miembro)) return;

      if (accion === 'ban') await miembro.ban({ reason: 'AntiNuke: Acciones masivas detectadas' });
      else if (accion === 'kick') await miembro.kick('AntiNuke: Acciones masivas detectadas');
      else if (accion === 'canal') await miembro.roles.set([], 'AntiNuke: Eliminación masiva de canales');

      const canalLog = servidor.channels.cache.find(c => c.name === config.antinuke.logChannel);
      if (canalLog) await canalLog.send(`**AntiNuke Activado**\nUsuario: <@${usuarioId}>\nAcción: ${accion}\nCastigo aplicado`);
    } catch (e) { log.error(`No se pudo sancionar a ${usuarioId}`); }
  },

  revisarLimite(servidorId, usuarioId, tipo) {
    const ahora = Date.now();
    const minuto = 60000;
    const mapa = this[tipo];
    if (!mapa.has(servidorId)) mapa.set(servidorId, new Map());
    const usuario = mapa.get(servidorId);
    if (!usuario.has(usuarioId)) usuario.set(usuarioId, []);

    const acciones = usuario.get(usuarioId).filter(t => ahora - t < minuto);
    acciones.push(ahora);
    usuario.set(usuarioId, acciones);

    const limite = config.antinuke[`max${tipo.charAt(0).toUpperCase() + tipo.slice(1)}PerMinute`];
    return acciones.length > limite;
  }
};

// ==========================================
// 📡 EVENTOS DEL BOT
// ==========================================
client.on('ready', () => {
  log.listo(`${client.user.tag} está en línea — Sistema Willy Santino`);
  client.user.setActivity(',help | Protegiendo el servidor', { type: 3 });
});

// Protección contra Kicks
client.on('guildMemberRemove', async (miembro) => {
  if (miembro.user.bot || !config.antinuke.enabled) return;
  const auditoria = await miembro.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 }).catch(() => null);
  const entrada = auditoria?.entries.first();
  if (!entrada || entrada.target.id !== miembro.id) return;
  if (antinuke.revisarLimite(miembro.guild.id, entrada.executor.id, 'accionesKicks')) {
    await antinuke.sancionar(miembro.guild, entrada.executor.id, 'kick');
  }
});

// Protección contra Bans
client.on('guildBanAdd', async (baneo) => {
  if (baneo.user.bot || !config.antinuke.enabled) return;
  const auditoria = await baneo.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 }).catch(() => null);
  const entrada = auditoria?.entries.first();
  if (!entrada) return;
  if (antinuke.revisarLimite(baneo.guild.id, entrada.executor.id, 'accionesBans')) {
    await antinuke.sancionar(baneo.guild, entrada.executor.id, 'ban');
  }
});

// Protección contra eliminación de canales
client.on('channelDelete', async (canal) => {
  if (!canal.guild || !config.antinuke.enabled) return;
  const auditoria = await canal.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 }).catch(() => null);
  const entrada = auditoria?.entries.first();
  if (!entrada) return;
  if (antinuke.revisarLimite(canal.guild.id, entrada.executor.id, 'accionesCanales')) {
    await antinuke.sancionar(canal.guild, entrada.executor.id, 'canal');
  }
});

// ==========================================
// ⌨️ COMANDOS
// ==========================================
client.on('messageCreate', async (mensaje) => {
  if (mensaje.author.bot || !mensaje.guild) return;
  if (!mensaje.content.startsWith(config.prefix)) return;

  const args = mensaje.content.slice(config.prefix.length).trim().split(/ +/);
  const comando = args.shift()?.toLowerCase();

  // Menú de ayuda
  if (comando === 'help' || comando === 'cmd') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${config.nombre} — Comandos`)
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: 'AntiNuke', value: '`,antinuke enable` — Activar protección\n`,antinuke disable` — Desactivar\n`,whitelist add/remove @usuario` — Administrar lista blanca' },
        { name: 'Roles', value: '`,rol dar @usuario @rol` — Asignar rol\n`,rol quitar @usuario @rol` — Quitar rol' },
        { name: 'Información', value: '`,help` — Mostrar este menú' }
      );
    return mensaje.reply({ embeds: [embed] });
  }

  // Activar/Desactivar AntiNuke
  if (comando === 'antinuke') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Se requiere Administrador');

    const sub = args[0]?.toLowerCase();
    if (sub === 'enable') {
      config.antinuke.enabled = true;
      return mensaje.reply('AntiNuke activado — Protección en línea');
    }
    if (sub === 'disable') {
      config.antinuke.enabled = false;
      return mensaje.reply('AntiNuke desactivado — El servidor no está protegido');
    }
    return mensaje.reply(`AntiNuke: ${config.antinuke.enabled ? 'Activado' : 'Desactivado'}`);
  }

  // Lista Blanca
  if (comando === 'whitelist') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const sub = args[0]?.toLowerCase();
    const usuario = mensaje.mentions.users.first();

    if (sub === 'add' && usuario) {
      if (config.antinuke.whitelistedUsers.includes(usuario.id))
        return mensaje.reply('El usuario ya está en la lista blanca');
      config.antinuke.whitelistedUsers.push(usuario.id);
      return mensaje.reply(`${usuario.tag} añadido a la lista blanca`);
    }
    if (sub === 'remove' && usuario) {
      config.antinuke.whitelistedUsers = config.antinuke.whitelistedUsers.filter(id => id !== usuario.id);
      return mensaje.reply(`${usuario.tag} eliminado de la lista blanca`);
    }
    const lista = config.antinuke.whitelistedUsers.length > 0
      ? config.antinuke.whitelistedUsers.map(id => `<@${id}>`).join(', ')
      : 'Vacía';
    return mensaje.reply(`Lista Blanca:\n${lista}`);
  }

  // Sistema de Roles
  if (comando === 'rol' || comando === 'r') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageRoles))
      return mensaje.reply('No tienes permiso para gestionar roles');

    const accion = args[0]?.toLowerCase();
    const miembro = mensaje.mentions.members.first();
    const rol = mensaje.mentions.roles.first();

    if (!miembro || !rol)
      return mensaje.reply('Uso: ,rol dar @usuario @rol  o  ,rol quitar @usuario @rol');

    if (accion === 'dar' || accion === 'add') {
      await miembro.roles.add(rol).catch(() => mensaje.reply('No pude dar el rol'));
      return mensaje.reply(`Rol **${rol.name}** asignado a ${miembro.user.tag}`);
    }
    if (accion === 'quitar' || accion === 'remove') {
      await miembro.roles.remove(rol).catch(() => mensaje.reply('No pude quitar el rol'));
      return mensaje.reply(`Rol **${rol.name}** quitado a ${miembro.user.tag}`);
    }
  }
});

// ==========================================
// 🔑 INICIAR BOT
// ==========================================
client.login(process.env.TOKEN)
  .then(() => log.listo('Bot iniciado correctamente — Willy Santino'))
  .catch(err => log.error(`Error de inicio: ${err.message}`));
