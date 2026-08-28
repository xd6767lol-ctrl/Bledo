// ==========================================
// IMPORTACIONES
// ==========================================
const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// SERVIDOR PARA RENDER
// ==========================================
app.get('/', (req, res) => res.send('✅ Bot activo — ,c [n] + ,cs + ,s + FORMATO BLEED + WHITELIST + ANTINUKE'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Puerto listo — Bot estable`));

// ==========================================
// CONFIGURACIÓN — PON LOS IDs DE TUS ROLES
// ==========================================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  prefix: ',',
  whitelistFile: './whitelist_data.json',
  antinukeFile: './antinuke_data.json',
  ownerRoleId: 'PON_AQUÍ_ID_ROL_OWNER',
  lockAllowedRoleIds: [
    'PON_AQUÍ_ID_ROL_1',
    'PON_AQUÍ_ID_ROL_2',
    'PON_AQUÍ_ID_ROL_3',
    'PON_AQUÍ_ID_ROL_4'
  ],
  logChannel: 'seguridad',
  maxChannelsCreate: 3,
  maxActionsWindow: 15000
};

// ==========================================
// CLIENTE DE DISCORD
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

// ==========================================
// ALMACENAMIENTO DE DATOS EN MEMORIA
// ==========================================
let lastClearedUserId = null;   // ID de la última persona cuyos mensajes se borraron
let deletedMessagesLog = [];    // Registro de mensajes borrados
let lastClearedMessages = [];   // Mensajes que se borraron con el último comando ,c

// ==========================================
// SISTEMA DE WHITELIST (all + pings)
// ==========================================
class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try {
            if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8'));
        } catch (e) { console.error('Error whitelist:', e); }
        return { all: [], pings: [] };
    }
    save() { fs.writeFileSync(CONFIG.whitelistFile, JSON.stringify(this.data, null, 4)); }
    isAll(userId) { return this.data.all.includes(userId); }
    isPings(userId) { return this.data.pings.includes(userId); }
    canPingEveryone(userId) { return this.isAll(userId) || this.isPings(userId); }
    addAll(userId) {
        if (!this.data.all.includes(userId)) this.data.all.push(userId);
        this.data.pings = this.data.pings.filter(id => id !== userId);
        this.save();
    }
    addPings(userId) {
        if (!this.data.pings.includes(userId) && !this.data.all.includes(userId)) {
            this.data.pings.push(userId);
            this.save();
        }
    }
    remove(userId) {
        this.data.all = this.data.all.filter(id => id !== userId);
        this.data.pings = this.data.pings.filter(id => id !== userId);
        this.save();
    }
}
const whitelist = new WhitelistManager();

// ==========================================
// SISTEMA ANTINUKE
// ==========================================
class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try {
            if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8'));
        } catch (e) { console.error('Error antinuke:', e); }
        return { whitelist: [], admins: [] };
    }
    save() { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
    isWhitelisted(userId) { return this.data.whitelist.includes(userId) || whitelist.isAll(userId); }
    isAdmin(userId) { return this.data.admins.includes(userId); }
    checkLimit(guildId, userId) {
        if (this.isAdmin(userId) || whitelist.isAll(userId)) return { allowed: true, count: 0, limit: '∞' };
        if (!this.isWhitelisted(userId)) return { allowed: false, count: 1, limit: 0, noPermit: true };
        const now = Date.now();
        if (!this.actionTracker[guildId]) this.actionTracker[guildId] = {};
        if (!this.actionTracker[guildId][userId]) this.actionTracker[guildId][userId] = [];
        const userActions = this.actionTracker[guildId][userId].filter(t => now - t < CONFIG.maxActionsWindow);
        userActions.push(now);
        this.actionTracker[guildId][userId] = userActions;
        return { allowed: userActions.length <= CONFIG.maxChannelsCreate, count: userActions.length, limit: CONFIG.maxChannelsCreate };
    }
}
const antinuke = new AntiNukeManager();

// ==========================================
// LOCK/UNLOCK PERMISSIONS
// ==========================================
function canUseLockCommands(member) {
  if (member.id === member.guild.ownerId) return true;
  if (whitelist.isAll(member.id)) return true;
  return CONFIG.lockAllowedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

// ==========================================
// FUNCIÓN DE SANCIÓN
// ==========================================
async function punishRemoveAllRoles(member, motivo) {
    try {
        const rolesQuitar = member.roles.cache.filter(r => 
            r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator)
        );
        if (rolesQuitar.size === 0) return;
        await member.roles.set([], motivo);
        console.log(`⚠️ Se quitaron ${rolesQuitar.size} roles a ${member.user.tag}`);
    } catch (e) { console.error('Error:', e); }
}

async function getAuditEntry(guild, actionType, limit = 5) {
    try {
        const logs = await guild.fetchAuditLogs({ limit, type: actionType });
        return logs.entries.first();
    } catch { return null; }
}

async function logSeguridad(guild, usuario, accion, detalle) {
    const canal = guild.channels.cache.find(c => c.name === CONFIG.logChannel && c.isTextBased());
    if (!canal) return;
    await canal.send(`🛡️ **ANTINUKE — ${accion}**\nUsuario: ${usuario} (${usuario.id})\nDetalle: ${detalle}`);
}

// ==========================================
// BORRAR @everyone SI NO TIENE PERMISO
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (msg.mentions.everyone && !whitelist.canPingEveryone(msg.author.id)) {
        try { await msg.delete(); } catch {}
    }
});

// ==========================================
// READY
// ==========================================
client.once(Events.ClientReady, () => {
    console.log(`✅ Bot listo — ${client.user.tag}`);
    console.log(`🌟 Whitelist ALL: ${whitelist.data.all.length} | 🔔 PINGS: ${whitelist.data.pings.length}`);
    console.log(`🧹 Limpieza: ,c [n] | ,cs | ,s`);
});

// ==========================================
// COMANDOS PRINCIPALES
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const args = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    // 🔒 LOCK / UNLOCK
    if (cmd === 'lock' || cmd === 'papi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('🚫 No tienes permiso.');
        if (msg.channel.type !== ChannelType.GuildText) return;
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false
        });
        return msg.reply('🔒 Canal bloqueado.');
    }
    if (cmd === 'unlock' || cmd === 'unpapi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('🚫 No tienes permiso.');
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: true, CreatePublicThreads: true, CreatePrivateThreads: true
        });
        return msg.reply('🔓 Canal desbloqueado.');
    }

    // 📋 WHITELIST
    if (cmd === 'whitelist') {
        if (msg.author.id !== msg.guild.ownerId && !antinuke.isAdmin(msg.author.id)) {
            return msg.reply('🚫 Solo Owner o Admin.');
        }
        const accion = args[0]?.toLowerCase();
        if (accion === 'add' && args[2]?.toLowerCase() === 'all') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('❌ Uso: `,whitelist add <ID> all`');
            whitelist.addAll(id);
            return msg.reply(`🌟 <@${id}> agregado a whitelist **all**`);
        }
        if (accion === 'add' && args[2]?.toLowerCase() === 'pings') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('❌ Uso: `,whitelist add <ID> pings`');
            whitelist.addPings(id);
            return msg.reply(`🔔 <@${id}> agregado a whitelist **pings**`);
        }
        if (accion === 'remove') {
            const id = args[1];
            whitelist.remove(id);
            return msg.reply(`✅ <@${id}> eliminado de whitelist`);
        }
        if (accion === 'list') {
            return msg.reply(`🌟 ALL: ${whitelist.data.all.map(i => `<@${i}>`).join(', ') || 'Nadie'}\n🔔 PINGS: ${whitelist.data.pings.map(i => `<@${i}>`).join(', ') || 'Nadie'}`);
        }
    }

    // 🎮 COMANDO R — FORMATO BLEED ✅
    if (cmd === 'r') {
        const accion = args[0]?.toLowerCase();
        if (!accion || !['add', 'remove'].includes(accion)) {
            return msg.reply('❌ Uso: `,r add <@usuario> <@rol>` o `,r remove <@usuario> <@rol>`');
        }
        const usuarioEntrada = args[1];
        const rolEntrada = args.slice(2).join(' ');
        if (!usuarioEntrada || !rolEntrada) {
            return msg.reply('❌ Uso: `,r add <@usuario> <@rol>` o `,r remove <@usuario> <@rol>`');
        }
        // Buscar usuario
        let miembro = null;
        const mUsuario = usuarioEntrada.match(/^<@!?(\d+)>$/);
        if (mUsuario) miembro = await msg.guild.members.fetch(mUsuario[1]).catch(() => null);
        else if (/^\d+$/.test(usuarioEntrada)) miembro = await msg.guild.members.fetch(usuarioEntrada).catch(() => null);
        else miembro = msg.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === usuarioEntrada.toLowerCase() ||
            m.displayName.toLowerCase() === usuarioEntrada.toLowerCase()
        );
        if (!miembro) return msg.reply('❌ Usuario no encontrado.');
        // Buscar rol
        let rol = null;
        const mRol = rolEntrada.match(/^<@&(\d+)>$/);
        if (mRol) rol = msg.guild.roles.cache.get(mRol[1]);
        else if (/^\d+$/.test(rolEntrada)) rol = msg.guild.roles.cache.get(rolEntrada);
        else rol = msg.guild.roles.cache.find(r => r.name.toLowerCase() === rolEntrada.toLowerCase());
        if (!rol) return msg.reply('❌ Rol no encontrado.');
        // Proteger rol de Owner
        if (rol.id === CONFIG.ownerRoleId) return msg.reply('🚫 No puedes dar ese rol.');
        // Dar o quitar rol + mensaje FORMATO BLEED 🟢
        if (accion === 'add') {
            await miembro.roles.add(rol, `Por ${msg.author.tag}`);
            return msg.channel.send(`✅ ${msg.author} : Set ${rol} as an award role`);
        } else {
            await miembro.roles.remove(rol, `Por ${msg.author.tag}`);
            return msg.channel.send(`✅ ${msg.author} : Removed ${rol} as an award role`);
        }
    }

    // 🧹 COMANDOS DE LIMPIEZA
    // ,c [cantidad] — Borra N mensajes
    if (cmd === 'c') {
        if (!canUseLockCommands(msg.member)) return msg.reply('🚫 No tienes permiso.');
        const cantidad = parseInt(args[0]);
        if (!cantidad || cantidad < 1 || cantidad > 100) {
            return msg.reply('❌ Uso: `,c 50` (número entre 1 y 100)');
        }
        try {
            // Borrar el mensaje del comando primero
            await msg.delete();
            // Obtener mensajes antes de borrar para guardar el log
            const mensajes = await msg.channel.messages.fetch({ limit: cantidad });
            // Guardar datos para el log
            lastClearedMessages = Array.from(mensajes.values()).map(m => ({
                id: m.id,
                autor: m.author,
                contenido: m.content,
                adjuntos: m.attachments.map(a => ({ url: a.url, nombre: a.name })),
                fecha: m.createdAt
            }));
            if (lastClearedMessages.length > 0) {
                lastClearedUserId = lastClearedMessages[0].autor.id;
                deletedMessagesLog = [...lastClearedMessages, ...deletedMessagesLog].slice(0, 50);
            }
            // Borrar los mensajes
            await msg.channel.bulkDelete(mensajes, true);
        } catch (e) { console.error('Error borrando:', e); }
        return;
    }

    // 🧹 ,cs — Borra el historial/log de mensajes borrados
    if (cmd === 'cs') {
        if (!canUseLockCommands(msg.member)) return msg.reply('🚫 No tienes permiso.');
        deletedMessagesLog = [];
        lastClearedMessages = [];
        lastClearedUserId = null;
        return msg.reply('✅ Historial de mensajes borrados limpiado.');
    }

    // 🔍 ,s — Muestra lo que se borró antes
    if (cmd === 's') {
        if (!canUseLockCommands(msg.member)) return msg.reply('🚫 No tienes permiso.');
        if (!lastClearedMessages || lastClearedMessages.length === 0) {
            return msg.reply('❌ No hay mensajes borrados registrados.');
        }
        try {
            // Preparar texto del log
            let texto = `📋 **Últimos mensajes borrados (${lastClearedMessages.length}):**\n\n`;
            const archivos = [];
            lastClearedMessages.forEach((m, i) => {
                texto += `**${i + 1}.** ${m.autor.tag} — ${m.fecha.toLocaleString('es-MX')}\n`;
                texto += `${m.contenido || '(sin texto)'}\n`;
                if (m.adjuntos.length > 0) {
                    m.adjuntos.forEach(a => {
                        texto += `📎 ${a.nombre}: ${a.url}\n`;
                    });
                }
                texto += '---\n';
            });
            // Si hay imágenes, mandarlas como archivos
            const imagenes = lastClearedMessages.flatMap(m => m.adjuntos.filter(a => /\.(png|jpg|jpeg|gif|webp)$/i.test(a.url))));
            if (imagenes.length > 0) {
                for (const img of imagenes.slice(0, 5)) {
                    archivos.push(new AttachmentBuilder(img.url, { name: img.nombre }));
                }
            }
            // Mandar el log
            if (texto.length > 1900) {
                const fs = require('fs');
                const path = require('path');
                const nombreArchivo = `borrados_${Date.now()}.txt`;
                fs.writeFileSync(nombreArchivo, texto);
                const archivo = new AttachmentBuilder(nombreArchivo);
                if (archivos.length > 0) {
                    await msg.channel.send({ files: [archivo, ...archivos] });
                } else {
                    await msg.channel.send({ files: [archivo] });
                }
                fs.unlinkSync(nombreArchivo);
            } else {
                if (archivos.length > 0) {
                    await msg.channel.send({ content: texto, files: archivos });
                } else {
                    await msg.channel.send(texto);
                }
            }
        } catch (e) { console.error('Error mostrando log:', e); }
        return;
    }
});

// ==========================================
// EVENTOS ANTINUKE
// ==========================================
client.on(Events.ChannelCreate, async (canal) => {
    const entry = await getAuditEntry(canal.guild, 10);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkLimit(canal.guild.id, entry.executor.id);
    if (check.noPermit || !check.allowed) {
        try { await canal.delete(); } catch {}
        const miembro = await canal.guild.members.fetch(entry.executor.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Creación sin permiso');
        await logSeguridad(canal.guild, entry.executor, 'Creación de canal', 'Bloqueado');
    }
});

client.on(Events.GuildUpdate, async (viejo, nuevo) => {
    const entry = await getAuditEntry(viejo, 1);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        const miembro = await viejo.members.fetch(entry.executor.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Cambios al servidor sin permiso');
        await logSeguridad(viejo, entry.executor, 'Modificación del servidor', 'Bloqueado');
    }
});

client.on(Events.RoleCreate, async (rol) => {
    const entry = await getAuditEntry(rol.guild, 30);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        try { await rol.delete(); } catch {}
        const miembro = await rol.guild.members.fetch(entry.executor.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Creación de rol sin permiso');
        await logSeguridad(rol.guild, entry.executor, 'Creación de rol', 'Bloqueado');
    }
});

client.login(CONFIG.token);
