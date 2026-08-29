require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// 🌐 SERVIDOR WEB — 24/7 ACTIVO
app.get('/', (req, res) => res.send('System Online'));
app.listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT} — Service Running`));

// ⚙️ CONFIGURACIÓN COMPLETA
const config = {
  prefix: ',',
  nombre: 'Willy Santino',
  ownerId: 'PON_AQUI_TU_ID_DE_DISCORD',
  limites: { wl: { categoriasMax: 1, canalesMax: 2 } },
  rolesPorPagina: 10,
  // 🛡️ ANTINUKE ESTILO BLEED
  antinuke: {
    enabled: true,
    protection: {
      bans: true,
      kicks: true,
      channels: true,
      roles: true,
      webhooks: true,
      serverName: true,
      serverIcon: true
    },
    limits: {
      bansPerMinute: 3,
      kicksPerMinute: 5,
      channelsPerMinute: 3,
      rolesPerMinute: 3
    },
    punishment: 'remove_roles'
  }
};

// 📦 ALMACENAMIENTO
const canalesVoz = new Map();
const antinukeCounters = new Map();
const sistema = {
  admins: new Set(),
  whitelist: new Set(),
  whitelistPings: new Set(),
  whitelistAll: new Set(),
  antinukeAdmins: new Set(),
  contadores: new Map(),

  isOwner(userId) { return userId === config.ownerId; },
  isWhitelisted(userId, guildId) {
    const clave = `${userId}-${guildId}`;
    return this.isOwner(userId) || this.whitelistAll.has(clave) || this.antinukeAdmins.has(clave);
  },
  isAntinukeAdmin(userId) {
    return this.isOwner(userId) || this.antinukeAdmins.has(userId);
  },

  nivelPermiso(usuarioId, servidorId) {
    if (this.isOwner(usuarioId)) return 'dueno';
    if (this.whitelistAll.has(`${usuarioId}-${servidorId}`)) return 'all';
    if (this.antinukeAdmins.has(`${usuarioId}-${servidorId}`)) return 'antinuke_admin';
    if (this.admins.has(`${usuarioId}-${servidorId}`)) return 'admin';
    if (this.whitelist.has(`${usuarioId}-${servidorId}`)) return 'wl';
    if (this.whitelistPings.has(`${usuarioId}-${servidorId}`)) return 'pings';
    return 'ninguno';
  },

  reiniciarContadores() {
    setInterval(() => this.contadores.clear(), 5 * 60 * 1000);
  }
};
sistema.reiniciarContadores();

// 🤖 CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction]
});

// 📝 UTILIDADES
function createEmbed(title, description, color = '#2B2D31') {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

function trackAction(userId, action, limit) {
  const now = Date.now();
  if (!antinukeCounters.has(userId)) antinukeCounters.set(userId, {});
  const userData = antinukeCounters.get(userId);
  if (!userData[action]) userData[action] = [];
  userData[action] = userData[action].filter(time => now - time < 60000);
  userData[action].push(now);
  return userData[action].length > limit;
}

async function punish(guild, user, reason) {
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if (sistema.isWhitelisted(user.id, guild.id)) return;

  if (config.antinuke.punishment === 'remove_roles') {
    const roles = member.roles.cache.filter(r => r.id !== guild.id);
    await member.roles.remove(roles, reason).catch(() => null);
  } else if (config.antinuke.punishment === 'ban') {
    await member.ban({ reason }).catch(() => null);
  }
  console.log(`[ANTINUKE] ${user.tag} — ${reason}`);
}

// 📡 EVENTOS — ANTINUKE
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity({ type: 3, name: 'for unauthorized activity' });
});

// Protección: Bans
client.on('guildBanAdd', async ban => {
  if (!config.antinuke.enabled) return;
  const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || executor.bot || sistema.isWhitelisted(executor.id, ban.guild.id)) return;
  const exceeded = trackAction(executor.id, 'bans', config.antinuke.limits.bansPerMinute);
  if (exceeded) await punish(ban.guild, executor, 'Exceeded ban limit');
});

// Protección: Kicks
client.on('guildMemberRemove', async member => {
  if (!config.antinuke.enabled) return;
  const audit = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
  const entry = audit?.entries.first();
  if (!entry || entry.target.id !== member.id) return;
  const executor = entry.executor;
  if (!executor || sistema.isWhitelisted(executor.id, member.guild.id)) return;
  const exceeded = trackAction(executor.id, 'kicks', config.antinuke.limits.kicksPerMinute);
  if (exceeded) await punish(member.guild, executor, 'Exceeded kick limit');
});

// Protección: Canales
client.on('channelCreate', async channel => {
  if (!config.antinuke.enabled) return;
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || sistema.isWhitelisted(executor.id, channel.guild.id)) return;
  const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
  if (exceeded) {
    await punish(channel.guild, executor, 'Exceeded channel creation limit');
    await channel.delete().catch(() => null);
  }
});

client.on('channelDelete', async channel => {
  if (!config.antinuke.enabled) return;
  const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || sistema.isWhitelisted(executor.id, channel.guild.id)) return;
  const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
  if (exceeded) await punish(channel.guild, executor, 'Exceeded channel delete limit');
});

// Protección: Roles
client.on('roleCreate', async role => {
  if (!config.antinuke.enabled) return;
  const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || sistema.isWhitelisted(executor.id, role.guild.id)) return;
  const exceeded = trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute);
  if (exceeded) {
    await punish(role.guild, executor, 'Exceeded role creation limit');
    await role.delete().catch(() => null);
  }
});

client.on('roleDelete', async role => {
  if (!config.antinuke.enabled) return;
  const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || sistema.isWhitelisted(executor.id, role.guild.id)) return;
  const exceeded = trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute);
  if (exceeded) await punish(role.guild, executor, 'Exceeded role delete limit');
});

// Protección: Servidor
client.on('guildUpdate', async (oldGuild, newGuild) => {
  if (!config.antinuke.enabled) return;
  const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
  const executor = audit?.entries.first()?.executor;
  if (!executor || sistema.isWhitelisted(executor.id, newGuild.id)) return;

  if (oldGuild.name !== newGuild.name && config.antinuke.protection.serverName) {
    await newGuild.setName(oldGuild.name).catch(() => null);
    await punish(newGuild, executor, 'Server name changed without permission');
  }
  if (oldGuild.icon !== newGuild.icon && config.antinuke.protection.serverIcon) {
    await newGuild.setIcon(oldGuild.iconURL()).catch(() => null);
    await punish(newGuild, executor, 'Server icon changed without permission');
  }
});

// 🎙️ VOICEMASTER
client.on('voiceStateUpdate', async (estadoAntiguo, estadoNuevo) => {
  const usuario = estadoNuevo.member?.user;
  const canalEntrada = estadoNuevo.channel;
  const canalSalida = estadoAntiguo.channel;

  if (canalSalida && canalesVoz.has(canalSalida.id)) {
    if (canalSalida.members.size === 0) {
      await canalSalida.delete().catch(() => null);
      canalesVoz.delete(canalSalida.id);
    }
  }

  if (!canalEntrada || !usuario) return;
  if (canalEntrada.name.toLowerCase() === 'panel') {
    const existente = Array.from(canalesVoz.entries()).find(([_, d]) => d.propietarioId === usuario.id);
    if (existente) { await estadoNuevo.setChannel(existente[0]).catch(() => null); return; }

    const canalPersonal = await canalEntrada.guild.channels.create({
      name: usuario.username,
      type: ChannelType.GuildVoice,
      parent: canalEntrada.parent,
      permissionOverwrites: [{ id: usuario.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }]
    });

    canalesVoz.set(canalPersonal.id, { propietarioId: usuario.id, propietarioNombre: usuario.username });
    await estadoNuevo.setChannel(canalPersonal).catch(() => null);
  }
});

// 🚨 PROTECCIÓN @everyone
client.on('messageCreate', async mensaje => {
  if (mensaje.author.bot || !mensaje.guild) return;
  const nivel = sistema.nivelPermiso(mensaje.author.id, mensaje.guild.id);
  if (mensaje.mentions.everyone && !['dueno','all','pings'].includes(nivel)) {
    await mensaje.delete().catch(() => null);
  }
});

// ⌨️ COMANDOS
client.on('messageCreate', async mensaje => {
  if (mensaje.author.bot || !mensaje.guild) return;
  if (!mensaje.content.startsWith(config.prefix)) return;
  const args = mensaje.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ========== ANTINUKE CONFIG — ,an config / ,antinuke config ==========
  if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'config') {
    if (!sistema.isOwner(mensaje.author.id)) {
      return mensaje.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can configure antinuke.', '#ED4245')] });
    }
    const embed = createEmbed('Antinuke Configuration', 'Use the commands below to configure protection.')
      .addFields(
        { name: 'Status', value: config.antinuke.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Bans', value: config.antinuke.protection.bans ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Kicks', value: config.antinuke.protection.kicks ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Channels', value: config.antinuke.protection.channels ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Roles', value: config.antinuke.protection.roles ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Limits', value: `Bans: ${config.antinuke.limits.bansPerMinute}/min\nKicks: ${config.antinuke.limits.kicksPerMinute}/min\nChannels: ${config.antinuke.limits.channelsPerMinute}/min\nRoles: ${config.antinuke.limits.rolesPerMinute}/min` },
        { name: 'Commands', value: `\`${config.prefix}an enable\` — Toggle antinuke\n\`${config.prefix}an wl add <id>\` — Whitelist user\n\`${config.prefix}an wl remove <id>\` — Remove whitelist\n\`${config.prefix}an admin add <id>\` — Add antinuke admin\n\`${config.prefix}an admin remove <id>\` — Remove admin` }
      );
    return mensaje.reply({ embeds: [embed] });
  }

  // ,an enable / ,antinuke enable
  if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'enable') {
    if (!sistema.isOwner(mensaje.author.id)) return mensaje.reply({ embeds: [createEmbed('Access Denied', 'Only the owner can modify this setting.', '#ED4245')] });
    config.antinuke.enabled = !config.antinuke.enabled;
    return mensaje.reply({ embeds: [createEmbed('Antinuke Updated', `Antinuke protection has been ${config.antinuke.enabled ? '**enabled**' : '**disabled**'}.`, '#57F287')] });
  }

  // ,an wl add / remove
  if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'wl') {
    if (!sistema.isAntinukeAdmin(mensaje.author.id)) return mensaje.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
    const accion = args[1]?.toLowerCase();
    const userId = args[2]?.replace(/[<@!>]/g, '');
    if (!userId) return mensaje.reply({ embeds: [createEmbed('Error', 'Please provide a valid user ID.', '#ED4245')] });
    const clave = `${userId}-${mensaje.guild.id}`;
    
    if (accion === 'add') {
      sistema.whitelistAll.add(clave);
      return mensaje.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> has been added to the whitelist.`, '#57F287')] });
    }
    if (accion === 'remove') {
      sistema.whitelistAll.delete(clave);
      return mensaje.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> has been removed from the whitelist.`, '#FEE75C')] });
    }
  }

  // ,an admin add / remove
  if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'admin') {
    if (!sistema.isOwner(mensaje.author.id)) return mensaje.reply({ embeds: [createEmbed('Access Denied', 'Only the owner can manage antinuke admins.', '#ED4245')] });
    const accion = args[1]?.toLowerCase();
    const userId = args[2]?.replace(/[<@!>]/g, '');
    if (!userId) return mensaje.reply({ embeds: [createEmbed('Error', 'Please provide a valid user ID.', '#ED4245')] });
    
    if (accion === 'add') {
      sistema.antinukeAdmins.add(userId);
      return mensaje.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is now an antinuke admin.`, '#57F287')] });
    }
    if (accion === 'remove') {
      sistema.antinukeAdmins.delete(userId);
      return mensaje.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is no longer an antinuke admin.`, '#FEE75C')] });
    }
  }

  // ========== VOICEMASTER ==========
  if (cmd === 'vc' && args[0]?.toLowerCase() === 'master') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return mensaje.reply('Permisos insuficientes — Necesitas gestionar canales');
    const panelExistente = mensaje.guild.channels.cache.find(c => c.name.toLowerCase() === 'panel' && c.type === ChannelType.GuildVoice);
    if (panelExistente) return mensaje.reply(`Ya existe el canal panel: <#${panelExistente.id}>`);
    const canalPanel = await mensaje.guild.channels.create({ name: 'panel', type: ChannelType.GuildVoice });
    return mensaje.reply(`Canal panel creado: <#${canalPanel.id}>\nCuando alguien se una, se creará su canal automáticamente`);
  }

  // ========== ROLES — ESTILO BLEED ==========
  if (cmd === 'roles') {
    const todosRoles = mensaje.guild.roles.cache
      .filter(r => r.id !== mensaje.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(rol => `@${rol.name} (${rol.id})`);
    const totalPaginas = Math.ceil(todosRoles.length / config.rolesPorPagina);
    let paginaActual = 1;

    const generarPagina = (pagina) => {
      const inicio = (pagina - 1) * config.rolesPorPagina;
      const fin = inicio + config.rolesPorPagina;
      const rolesPagina = todosRoles.slice(inicio, fin).join('\n');
      const embed = new EmbedBuilder().setColor('#2B2D31').setTitle('Roles').setDescription(rolesPagina).setFooter({ text: `Page ${pagina}/${totalPaginas}` });
      const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('anterior').setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(pagina === 1),
        new ButtonBuilder().setCustomId('siguiente').setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(pagina === totalPaginas),
        new ButtonBuilder().setCustomId('cerrar').setLabel('✕').setStyle(ButtonStyle.Danger)
      );
      return { embeds: [embed], components: [botones] };
    };

    const mensajeRoles = await mensaje.reply(generarPagina(paginaActual));
    const filtro = i => i.user.id === mensaje.author.id;
    const colector = mensajeRoles.createMessageComponentCollector({ filter: filtro, time: 300000 });
    colector.on('collect', async i => {
      if (i.customId === 'anterior' && paginaActual > 1) paginaActual--;
      if (i.customId === 'siguiente' && paginaActual < totalPaginas) paginaActual++;
      if (i.customId === 'cerrar') { await mensajeRoles.delete(); return; }
      await i.update(generarPagina(paginaActual));
    });
    return;
  }

  // ========== WHITELIST ==========
  if (cmd === 'whitelist') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Solo Administradores');
    const accion = args[0]?.toLowerCase();
    const idUsuario = args[1];
    const tipo = args[2]?.toLowerCase();

    if (accion === 'add' && idUsuario && tipo) {
      const clave = `${idUsuario}-${mensaje.guild.id}`;
      sistema.whitelistAll.delete(clave); sistema.whitelist.delete(clave); sistema.whitelistPings.delete(clave); sistema.admins.delete(clave);
      if (tipo === 'all') { sistema.whitelistAll.add(clave); return mensaje.reply(`<@${idUsuario}> añadido a WHITELIST ALL`); }
      if (tipo === 'pings') { sistema.whitelistPings.add(clave); return mensaje.reply(`<@${idUsuario}> añadido a WHITELIST PINGS`); }
      return mensaje.reply('Tipo inválido: all o pings');
    }
    if (accion === 'remove' && idUsuario) {
      const clave = `${idUsuario}-${mensaje.guild.id}`;
      sistema.whitelistAll.delete(clave); sistema.whitelist.delete(clave); sistema.whitelistPings.delete(clave);
      return mensaje.reply(`<@${idUsuario}> eliminado de whitelist`);
    }
  }

  // ========== HELP ==========
  if (cmd === 'help' || cmd === 'cmd') {
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('Comandos')
      .addFields(
        { name: 'Antinuke', value: `\`${config.prefix}an config\` — Ver configuración\n\`${config.prefix}an enable\` — Activar/desactivar\n\`${config.prefix}an wl add <id>\` — Whitelist\n\`${config.prefix}an admin add <id>\` — Admin antinuke` },
        { name: 'Voice', value: `\`${config.prefix}vc master\` — Crear canal panel` },
        { name: 'Roles', value: `\`${config.prefix}roles\` — Lista de roles` }
      );
    return mensaje.reply({ embeds: [embed] });
  }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
  .then(() => console.log('Bot Online — AntiNuke Active'))
  .catch(err => console.log(`Error: ${err.message}`));
