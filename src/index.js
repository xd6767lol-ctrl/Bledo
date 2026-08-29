require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// 🌐 SERVIDOR WEB — 24/7 ACTIVO
app.get('/', (req, res) => res.send('Willy Santino — Sistema Activo'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Puerto ${PORT} — Bot en línea 24/7`));

// ⚙️ CONFIGURACIÓN
const config = {
  prefix: ',',
  nombre: 'Willy Santino',
  limites: {
    wl: {
      categoriasMax: 1,
      canalesMax: 2
    }
  }
};

// 🤖 CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildChannels,
    GatewayIntentBits.GuildRoles
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// 📝 REGISTRO
const log = {
  info: m => console.log(`[INFO] ${m}`),
  listo: m => console.log(`[LISTO] ${m}`),
  error: m => console.log(`[ERROR] ${m}`)
};

// 🛡️ SISTEMA DE PERMISOS EXACTO
const sistema = {
  admins: new Set(),      // ,an admin → TODO sin límite
  whitelist: new Set(),   // ,an wl → 1 categoría + 2 canales máximo
  contadores: new Map(),

  nivelPermiso(usuarioId, servidorId) {
    const servidor = client.guilds.cache.get(servidorId);
    if (servidor && usuarioId === servidor.ownerId) return 'dueno';
    if (this.admins.has(`${usuarioId}-${servidorId}`)) return 'admin';
    if (this.whitelist.has(`${usuarioId}-${servidorId}`)) return 'wl';
    return 'ninguno';
  },

  reiniciarContadores() {
    setInterval(() => this.contadores.clear(), 5 * 60 * 1000);
  }
};
sistema.reiniciarContadores();

// 📡 EVENTOS
client.on('ready', () => {
  log.listo(`${client.user.tag} — ${config.nombre} en línea`);
  client.user.setActivity(',help | Protegiendo el servidor', { type: 3 });
});

// VIGILAR CREACIÓN DE CANALES
client.on('channelCreate', async (canal) => {
  if (!canal.guild) return;
  const audit = await canal.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null);
  const creador = audit?.entries.first()?.executor;
  if (!creador || creador.bot) return;

  const nivel = sistema.nivelPermiso(creador.id, canal.guild.id);
  const clave = `${creador.id}-${canal.guild.id}`;

  if (nivel === 'dueno' || nivel === 'admin') return;

  if (nivel === 'wl') {
    if (!sistema.contadores.has(clave)) sistema.contadores.set(clave, { categorias: 0, canales: 0 });
    const cont = sistema.contadores.get(clave);
    if (canal.type === 4) cont.categorias++;
    else cont.canales++;

    const limite = canal.type === 4 ? config.limites.wl.categoriasMax : config.limites.wl.canalesMax;
    if ((canal.type === 4 && cont.categorias > limite) || (canal.type !== 4 && cont.canales > limite)) {
      await canal.delete().catch(() => null);
      const miembro = await canal.guild.members.fetch(creador.id).catch(() => null);
      if (miembro) await miembro.roles.set([], 'Límite excedido').catch(() => null);
      sistema.whitelist.delete(clave);
    }
    return;
  }

  await canal.delete().catch(() => null);
  const miembro = await canal.guild.members.fetch(creador.id).catch(() => null);
  if (miembro) await miembro.roles.set([], 'Sin permiso').catch(() => null);
});

// VIGILAR CREACIÓN DE ROLES
client.on('roleCreate', async (rol) => {
  const audit = await rol.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 1 }).catch(() => null);
  const creador = audit?.entries.first()?.executor;
  if (!creador || creador.bot) return;

  const nivel = sistema.nivelPermiso(creador.id, rol.guild.id);
  if (nivel === 'dueno' || nivel === 'admin') return;

  await rol.delete().catch(() => null);
  const miembro = await rol.guild.members.fetch(creador.id).catch(() => null);
  if (miembro) await miembro.roles.set([], 'Creación sin permiso').catch(() => null);
});

// VIGILAR CAMBIO DE NOMBRE DEL SERVIDOR
client.on('guildUpdate', async (antiguo, nuevo) => {
  if (antiguo.name === nuevo.name) return;
  const audit = await nuevo.fetchAuditLogs({ type: AuditLogEvent.GuildUpdate, limit: 1 }).catch(() => null);
  const editor = audit?.entries.first()?.executor;
  if (!editor || editor.bot) return;

  const nivel = sistema.nivelPermiso(editor.id, nuevo.id);
  if (nivel === 'dueno' || nivel === 'admin') return;

  await nuevo.setName(antiguo.name).catch(() => null);
  const miembro = await nuevo.members.fetch(editor.id).catch(() => null);
  if (miembro) await miembro.roles.set([], 'Cambio sin permiso').catch(() => null);
});

// ⌨️ COMANDOS
client.on('messageCreate', async (mensaje) => {
  if (mensaje.author.bot || !mensaje.guild) return;
  if (!mensaje.content.startsWith(config.prefix)) return;

  const args = mensaje.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ========== COMANDO ,roles — MUESTRA TODOS LOS ROLES NUMERADOS ==========
  if (cmd === 'roles' || cmd === 'rol') {
    const roles = mensaje.guild.roles.cache
      .filter(r => r.id !== mensaje.guild.id) // Quita el rol de @everyone
      .sort((a, b) => b.position - a.position) // Ordena de arriba hacia abajo
      .map((rol, index) => `**${index + 1}.** ${rol.name} — <@&${rol.id}>`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`📋 Lista de Roles — ${mensaje.guild.name}`)
      .setDescription(roles)
      .setFooter({ text: `Total: ${mensaje.guild.roles.cache.size - 1} roles` });

    return mensaje.reply({ embeds: [embed] });
  }

  // Comando: ,an admin <ID>
  if (cmd === 'an' && args[0]?.toLowerCase() === 'admin') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Solo Administradores');

    const idUsuario = args[1];
    if (!idUsuario) return mensaje.reply('Uso: ,an admin <ID_DEL_USUARIO>');

    const clave = `${idUsuario}-${mensaje.guild.id}`;
    sistema.admins.add(clave);
    sistema.whitelist.delete(clave);

    return mensaje.reply(`✅ <@${idUsuario}> ahora tiene permiso **ADMIN** — Sin límites de creación`);
  }

  // Comando: ,an wl <ID>
  if (cmd === 'an' && args[0]?.toLowerCase() === 'wl') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Solo Administradores');

    const idUsuario = args[1];
    if (!idUsuario) return mensaje.reply('Uso: ,an wl <ID_DEL_USUARIO>');

    const clave = `${idUsuario}-${mensaje.guild.id}`;
    sistema.whitelist.add(clave);
    sistema.admins.delete(clave);

    return mensaje.reply(`✅ <@${idUsuario}> ahora está en **WHITELIST** — Límite: 1 categoría, 2 canales`);
  }

  // Comando: ,help
  if (cmd === 'help' || cmd === 'cmd') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${config.nombre} — Comandos`)
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: 'Roles', value: '`,roles` — Mostrar lista de roles numerados' },
        { name: 'Administración de Permisos', value: '`,an admin <ID>` — Permiso completo (sin límites)\n`,an wl <ID>` — Permiso limitado (1 categoría, 2 canales)' }
      );
    return mensaje.reply({ embeds: [embed] });
  }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
  .then(() => log.listo('Bot iniciado correctamente — Sistema de permisos activo'))
  .catch(err => log.error(`Error de inicio: ${err.message}`));
