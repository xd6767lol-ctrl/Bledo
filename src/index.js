require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

// 🤖 CLIENTE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction]
});

// 📝 REGISTRO
const log = {
  info: m => console.log(`[INFO] ${m}`),
  listo: m => console.log(`[LISTO] ${m}`),
  error: m => console.log(`[ERROR] ${m}`)
};

// 🛡️ SISTEMA DE WHITELIST Y PERMISOS — EXACTO COMO LO PEDISTE
const sistema = {
  admins: new Set(),      // ,an admin → TODO sin límite
  whitelist: new Set(),   // ,an wl → 1 categoría + 2 canales máximo
  whitelistPings: new Set(), // ,whitelist add <ID> pings → solo puede @everyone
  whitelistAll: new Set(),   // ,whitelist add <ID> all → todo sin límite
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

// 🚨 VIGILAR @everyone / @here — SÓLO SI TIENEN whitelist pings o all
client.on('messageCreate', async (mensaje) => {
  if (mensaje.author.bot || !mensaje.guild) return;
  
  const nivel = sistema.nivelPermiso(mensaje.author.id, mensaje.guild.id);
  
  // Si menciona @everyone o @here y NO tiene permiso → borrar el mensaje
  if ((mensaje.mentions.everyone) && nivel !== 'all' && nivel !== 'pings' && nivel !== 'dueno') {
    await mensaje.delete().catch(() => null);
    log.info(`${mensaje.author.tag} intentó mencionar everyone sin permiso — mensaje borrado`);
    return;
  }
});

// VIGILAR CREACIÓN DE CANALES Y CATEGORÍAS
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

  // ========== SISTEMA DE WHITELIST COMPLETO ==========
  // ,whitelist add <ID> all → todo sin límite
  // ,whitelist add <ID> pings → solo @everyone
  if (cmd === 'whitelist') {
    if (!mensaje.member.permissions.has(PermissionFlagsBits.Administrator))
      return mensaje.reply('Permisos insuficientes — Solo Administradores');

    const accion = args[0]?.toLowerCase();
    const idUsuario = args[1];
    const tipo = args[2]?.toLowerCase();

    if (accion === 'add' && idUsuario && tipo) {
      const clave = `${idUsuario}-${mensaje.guild.id}`;
      // Quitar de todos primero
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

    // Ver lista
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
        { name: 'Roles', value: '`,roles` — Mostrar lista de roles con paginación' },
        { name: 'Whitelist', value: '`,whitelist add <ID> all` — Todo sin límite\n`,whitelist add <ID> pings` — Solo @everyone\n`,whitelist remove <ID>` — Quitar de whitelist\n`,whitelist` — Ver lista completa' },
        { name: 'AntiNuke', value: '`,an admin <ID>` — Permiso completo\n`,an wl <ID>` — Permiso limitado (1 categoría, 2 canales)' }
      );
    return mensaje.reply({ embeds: [embed] });
  }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
  .then(() => log.listo('Bot iniciado correctamente — Sistema de whitelist activo'))
  .catch(err => log.error(`Error de inicio: ${err.message}`));
