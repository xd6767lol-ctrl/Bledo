require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, UserSelectMenuBuilder } = require('discord.js');
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
  },
  rolesPorPagina: 10
};

// 📦 ALMACENAMIENTO DE CANALES DE VOZ
const canalesVoz = new Map(); // canalId -> { propietarioId, canalPanelId }

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

// 📝 REGISTRO
const log = {
  info: m => console.log(`[INFO] ${m}`),
  listo: m => console.log(`[LISTO] ${m}`),
  error: m => console.log(`[ERROR] ${m}`)
};

// 🛡️ SISTEMA DE WHITELIST Y PERMISOS
const sistema = {
  admins: new Set(),
  whitelist: new Set(),
  whitelistPings: new Set(),
  whitelistAll: new Set(),
  contadores: new Map(),

  nivelPermiso(usuarioId, servidorId) {
    const servidor = client.guilds.cache.get(servidorId);
    if (servidor && usuarioId === servidor.ownerId) return 'dueno';
    if (this.whitelistAll.has(`${usuarioId}-${servidorId}`)) return 'all';
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

// 📡 EVENTOS
client.on('ready', () => {
  log.listo(`${client.user.tag} — ${config.nombre} en línea`);
  client.user.setActivity(',help | Protegiendo el servidor', { type: 3 });
});

// 🎙️ SISTEMA JOIN TO CREATE — CUANDO ALGUIEN ENTRE AL PANEL
client.on('voiceStateUpdate', async (estadoAntiguo, estadoNuevo) => {
  const usuario = estadoNuevo.member.user;
  const canalEntrada = estadoNuevo.channel;
  const canalSalida = estadoAntiguo.channel;

  // Si se desconectó de un canal personal → borrarlo
  if (canalSalida && canalesVoz.has(canalSalida.id)) {
    const datos = canalesVoz.get(canalSalida.id);
    if (estadoAntiguo.channel.members.size === 0) {
      await canalSalida.delete().catch(() => null);
      canalesVoz.delete(canalSalida.id);
      log.info(`Canal de voz de ${datos.propietarioNombre} eliminado — vacío`);
    }
  }

  // Si no entró a ningún canal → ignorar
  if (!canalEntrada) return;

  // Si el canal se llama "panel" → crear canal personal
  if (canalEntrada.name.toLowerCase() === 'panel') {
    // Evitar crear canales duplicados si ya tiene uno
    const canalExistente = Array.from(canalesVoz.entries()).find(([id, d]) => d.propietarioId === usuario.id);
    if (canalExistente) {
      await estadoNuevo.setChannel(canalExistente[0]).catch(() => null);
      return;
    }

    // Crear canal de voz personal
    const canalPersonal = await canalEntrada.guild.channels.create({
      name: usuario.username,
      type: ChannelType.GuildVoice,
      parent: canalEntrada.parent,
      permissionOverwrites: [
        {
          id: usuario.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
          ]
        }
      ]
    });

    // Guardar datos del canal
    canalesVoz.set(canalPersonal.id, {
      propietarioId: usuario.id,
      propietarioNombre: usuario.username,
      canalPanelId: canalEntrada.id
    });

    // Mover al usuario a su nuevo canal
    await estadoNuevo.setChannel(canalPersonal).catch(() => null);

    // Enviar mensaje de control con TODOS los botones (igual a la imagen)
    const embedControl = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('VoiceMaster Interface')
      .setDescription('Use the buttons below to control your voice channel.\n\n' +
        '**Button Usage**\n' +
        '🔒 — Lock the voice channel\n' +
        '🔓 — Unlock the voice channel\n' +
        '👁️‍🗨️ — Ghost the voice channel\n' +
        '👁️ — Reveal the voice channel\n' +
        '🎙️ — Claim the voice channel\n' +
        '🔌 — Disconnect a member\n' +
        '🎮 — Start an activity\n' +
        'ℹ️ — View channel information\n' +
        '➕ — Increase the user limit\n' +
        '➖ — Decrease the user limit');

    const fila1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc_lock').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_unlock').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_ghost').setEmoji('👁️‍🗨️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_reveal').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_claim').setEmoji('🎙️').setStyle(ButtonStyle.Secondary)
    );

    const fila2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc_disconnect').setEmoji('🔌').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_activity').setEmoji('🎮').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_info').setEmoji('ℹ️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_plus').setEmoji('➕').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_minus').setEmoji('➖').setStyle(ButtonStyle.Secondary)
    );

    // Enviar mensaje al canal de voz
    await canalPersonal.send({ embeds: [embedControl], components: [fila1, fila2] }).catch(() => null);
    log.info(`Canal de voz creado para ${usuario.username}`);
  }
});

// 🎛️ MANEJAR LOS BOTONES DEL VOICE MASTER
client.on('interactionCreate', async (interaccion) => {
  if (!interaccion.isButton()) return;
  const canal = interaccion.channel;
  if (!canalesVoz.has(canal.id)) return;

  const datos = canalesVoz.get(canal.id);
  const propietarioId = datos.propietarioId;
  const usuarioId = interaccion.user.id;

  // Verificar si es el dueño o admin
  const esDueno = usuarioId === propietarioId;
  const esAdmin = sistema.nivelPermiso(usuarioId, interaccion.guild.id) === 'admin' || 
                  interaccion.member.permissions.has(PermissionFlagsBits.ManageChannels);

  if (!esDueno && !esAdmin) {
    return interaccion.reply({ content: '❌ No eres el dueño de este canal', ephemeral: true });
  }

  // Ejecutar la acción del botón
  switch (interaccion.customId) {
    case 'vc_lock':
      await canal.permissionOverwrites.edit(interaccion.guild.id, { Connect: false });
      await interaccion.reply({ content: '🔒 Canal bloqueado', ephemeral: true });
      break;
    case 'vc_unlock':
      await canal.permissionOverwrites.edit(interaccion.guild.id, { Connect: true });
      await interaccion.reply({ content: '🔓 Canal desbloqueado', ephemeral: true });
      break;
    case 'vc_ghost':
      await canal.permissionOverwrites.edit(interaccion.guild.id, { ViewChannel: false });
      await interaccion.reply({ content: '👁️‍🗨️ Canal oculto', ephemeral: true });
      break;
    case 'vc_reveal':
      await canal.permissionOverwrites.edit(interaccion.guild.id, { ViewChannel: true });
      await interaccion.reply({ content: '👁️ Canal visible', ephemeral: true });
      break;
    case 'vc_claim':
      datos.propietarioId = usuarioId;
      canalesVoz.set(canal.id, datos);
      await canal.permissionOverwrites.edit(usuarioId, { ManageChannels: true, Connect: true });
      await interaccion.reply({ content: `🎙️ Ahora eres el dueño del canal`, ephemeral: true });
      break;
    case 'vc_plus':
      await canal.setUserLimit(Math.min(canal.userLimit + 1, 99)).catch(() => null);
      await interaccion.reply({ content: `➕ Límite: ${canal.userLimit + 1}`, ephemeral: true });
      break;
    case 'vc_minus':
      await canal.setUserLimit(Math.max(canal.userLimit - 1, 0)).catch(() => null);
      await interaccion.reply({ content: `➖ Límite: ${Math.max(canal.userLimit - 1, 0)}`, ephemeral: true });
      break;
    case 'vc_info':
      await interaccion.reply({
        content: `ℹ️ **Información del canal**\nNombre: ${canal.name}\nDueño: <@${propietarioId}>\nID: ${canal.id}\nMiembros: ${canal.members.size}`,
        ephemeral: true
      });
      break;
    case 'vc_disconnect':
      await interaccion.reply({ content: '🔌 Selecciona a quién desconectar (próximamente)', ephemeral: true });
      break;
    case 'vc_activity':
      await interaccion.reply({ content: '🎮 Actividades próximamente', ephemeral: true });
      break;
  }
});

// 🚨 VIGILAR @everyone / @here
client.on('messageCreate', async (mensaje) => {
  if (mensaje.author.bot || !mensaje.guild) return;
  
  const nivel = sistema.nivelPermiso(mensaje.author.id, mensaje.guild.id);
  
  if ((mensaje.mentions.everyone) && nivel !== 'all' && nivel !== 'pings' && nivel !== 'dueno') {
    await mensaje.delete().catch(() => null);
    log.info(`${mensaje.author.tag} intentó mencionar everyone sin permiso`);
    return;
  }
});

// VIGILAR CREACIÓN DE CANALES
client.on('channelCreate', async (canal) => {
  if (!canal.guild) return;
  const audit = await canal.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 1 }).catch(() => null);
  const creador = audit?.entries.first()?.executor;
  if (!creador || creador.bot) return;

  const nivel = sistema.nivelPermiso(creador.id, canal.guild.id);
  const clave = `${creador.id}-${canal.guild.id}`;

  if (nivel === 'dueno' || nivel === 'admin' || nivel === 'all') return;

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
  if (nivel === 'dueno' || nivel === 'admin' || nivel === 'all') return;

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
  if (nivel === 'dueno' || nivel === 'admin' || nivel === 'all') return;

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

  // ========== COMANDO ,vc master — CREAR CANAL PANEL ==========
  if (cmd === 'vc' && args[0]?.toLowerCase() === 'master') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return mensaje.reply('Permisos insuficientes — Necesitas gestionar canales');

    // Verificar si ya existe un canal "panel"
    const panelExistente = mensaje.guild.channels.cache.find(c => c.name.toLowerCase() === 'panel' && c.type === ChannelType.GuildVoice);
    if (panelExistente)
      return mensaje.reply(`⚠️ Ya existe un canal llamado "panel": <#${panelExistente.id}>`);

    // Crear el canal panel
    const canalPanel = await mensaje.guild.channels.create({
      name: 'panel',
      type: ChannelType.GuildVoice,
      reason: 'VoiceMaster — Canal de creación automática'
    });

    return mensaje.reply(`✅ Canal **panel** creado exitosamente\n<#${canalPanel.id}>\nCuando alguien se una, se creará su canal automáticamente`);
  }

  // ========== COMANDO ,roles — ESTILO EXACTO DE LA FOTO ==========
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

      const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('Roles')
        .setDescription(rolesPagina)
        .setFooter({ text: `Page ${pagina}/${totalPaginas}` });

      const botones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('anterior').setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(pagina === 1),
        new ButtonBuilder().setCustomId('siguiente').setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(pagina === totalPaginas),
        new ButtonBuilder().setCustomId('orden').setLabel('↕').setStyle(ButtonStyle.Secondary),
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
      if (i.customId === 'cerrar') {
        await mensajeRoles.delete();
        return;
      }
      await i.update(generarPagina(paginaActual));
    });

    return;
  }

  // ========== SISTEMA DE WHITELIST ==========
  if (cmd === 'whitelist') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Solo Administradores');

    const accion = args[0]?.toLowerCase();
    const idUsuario = args[1];
    const tipo = args[2]?.toLowerCase();

    if (accion === 'add' && idUsuario && tipo) {
      const clave = `${idUsuario}-${mensaje.guild.id}`;
      sistema.whitelistAll.delete(clave);
      sistema.whitelist.delete(clave);
      sistema.whitelistPings.delete(clave);
      sistema.admins.delete(clave);

      if (tipo === 'all') {
        sistema.whitelistAll.add(clave);
        return mensaje.reply(`✅ <@${idUsuario}> añadido a **WHITELIST ALL** — Puede hacer todo sin límite`);
      }
      if (tipo === 'pings') {
        sistema.whitelistPings.add(clave);
        return mensaje.reply(`✅ <@${idUsuario}> añadido a **WHITELIST PINGS** — Solo puede usar @everyone`);
      }
      return mensaje.reply('❌ Tipo inválido. Usa: all o pings');
    }

    if (accion === 'remove' && idUsuario) {
      const clave = `${idUsuario}-${mensaje.guild.id}`;
      sistema.whitelistAll.delete(clave);
      sistema.whitelist.delete(clave);
      sistema.whitelistPings.delete(clave);
      return mensaje.reply(`✅ <@${idUsuario}> eliminado de la whitelist`);
    }

    const listaAll = Array.from(sistema.whitelistAll).map(c => `<@${c.split('-')[0]}> — all`).join('\n') || 'Vacía';
    const listaPings = Array.from(sistema.whitelistPings).map(c => `<@${c.split('-')[0]}> — pings`).join('\n') || 'Vacía';
    const listaWL = Array.from(sistema.whitelist).map(c => `<@${c.split('-')[0]}> — wl`).join('\n') || 'Vacía';
    const listaAdmin = Array.from(sistema.admins).map(c => `<@${c.split('-')[0]}> — admin`).join('\n') || 'Vacía';

    return mensaje.reply(`📋 **Lista Blanca:**\n\n**ALL:**\n${listaAll}\n\n**PINGS:**\n${listaPings}\n\n**AN WL:**\n${listaWL}\n\n**AN ADMIN:**\n${listaAdmin}`);
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
    sistema.whitelistAll.delete(clave);
    sistema.whitelistPings.delete(clave);

    return mensaje.reply(`✅ <@${idUsuario}> ahora tiene permiso **AN ADMIN** — Sin límites de creación`);
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
    sistema.whitelistAll.delete(clave);
    sistema.whitelistPings.delete(clave);

    return mensaje.reply(`✅ <@${idUsuario}> ahora está en **AN WL** — Límite: 1 categoría, 2 canales`);
  }

  // Comando: ,help
  if (cmd === 'help' || cmd === 'cmd') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`${config.nombre} — Comandos`)
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: 'VoiceMaster', value: '`,vc master` — Crear canal "panel" para canales automáticos' },
        { name: 'Roles', value: '`,roles` — Mostrar lista de roles con paginación' },
        { name: 'Whitelist', value: '`,whitelist add <ID> all` — Todo sin límite\n`,whitelist add <ID> pings` — Solo @everyone\n`,whitelist remove <ID>` — Quitar de whitelist' },
        { name: 'AntiNuke', value: '`,an admin <ID>` — Permiso completo\n`,an wl <ID>` — Permiso limitado' }
      );
    return mensaje.reply({ embeds: [embed] });
  }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
  .then(() => log.listo('Bot iniciado correctamente — Sistema VoiceMaster + Whitelist Activo'))
  .catch(err => log.error(`Error de inicio: ${err.message}`));
