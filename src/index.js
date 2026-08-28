// ==========================================
// CONFIGURATION
// ==========================================
const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Online — Bleed System'));
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  prefix: ',',
  whitelistFile: './whitelist_data.json',
  antinukeFile: './antinuke_data.json',
  ownerRoleId: 'OWNER_ROLE_ID_HERE',
  lockAllowedRoleIds: [
    'ROLE_ID_1',
    'ROLE_ID_2',
    'ROLE_ID_3',
    'ROLE_ID_4'
  ],
  logChannel: 'seguridad',
  maxChannelsCreate: 3,
  maxActionsWindow: 15000
};

// ==========================================
// CLIENT INIT
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
// DATA STORAGE
// ==========================================
let lastClearedUserId = null;
let deletedMessagesLog = [];
let lastClearedMessages = [];

// ==========================================
// WHITELIST
// ==========================================
class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try {
            if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8'));
        } catch (e) { console.error(e); }
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
// ANTINUKE
// ==========================================
class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try {
            if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8'));
        } catch (e) { console.error(e); }
        return { whitelist: [], admins: [] };
    }
    save() { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
    isWhitelisted(userId) { return this.data.whitelist.includes(userId) || whitelist.isAll(userId); }
    isAdmin(userId) { return this.data.admins.includes(userId); }
    addAdmin(userId) {
        if (!this.data.admins.includes(userId)) {
            this.data.admins.push(userId);
            this.save();
        }
    }
    removeAdmin(userId) {
        this.data.admins = this.data.admins.filter(id => id !== userId);
        this.save();
    }
    checkLimit(guildId, userId) {
        if (this.isAdmin(userId) || whitelist.isAll(userId)) return { allowed: true, count: 0, limit: 'Infinity' };
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
// PERMISSIONS
// ==========================================
function isOwnerOrAdmin(member) {
  if (member.id === member.guild.ownerId) return true;
  if (antinuke.isAdmin(member.id)) return true;
  return false;
}

function canUseLockCommands(member) {
  if (member.id === member.guild.ownerId) return true;
  if (whitelist.isAll(member.id)) return true;
  return CONFIG.lockAllowedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

// ==========================================
// UTILS
// ==========================================
async function punishRemoveAllRoles(member, reason) {
    try {
        const rolesToRemove = member.roles.cache.filter(r => 
            r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator)
        );
        if (rolesToRemove.size === 0) return;
        await member.roles.set([], reason);
    } catch (e) {}
}

async function getAuditEntry(guild, actionType, limit = 5) {
    try {
        const logs = await guild.fetchAuditLogs({ limit, type: actionType });
        return logs.entries.first();
    } catch { return null; }
}

async function logSecurity(guild, user, action, details) {
    const channel = guild.channels.cache.find(c => c.name === CONFIG.logChannel && c.isTextBased());
    if (!channel) return;
    await channel.send(`[SECURITY] ${action} | ${user.tag} (${user.id})\n${details}`);
}

// ==========================================
// PING PROTECTION — Owner Exempt, Delete Only
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;
    if (msg.author.id === msg.guild.ownerId) return;
    if (msg.mentions.everyone && !whitelist.canPingEveryone(msg.author.id)) {
        try { await msg.delete(); } catch {}
    }
});

// ==========================================
// READY
// ==========================================
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ==========================================
// COMMANDS — ESTILO BLEED + HELP / CMD
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const args = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    // ======================================
    // HELP / CMD — TODOS LOS COMANDOS 🆕
    // ======================================
    if (cmd === 'help' || cmd === 'cmd') {
        return msg.reply(`
=== COMANDOS DEL BOT ===

> ANTINUKE
,antinuke addadmin <ID>    → Agregar Admin AntiNuke
,antinuke removeadmin <ID> → Eliminar Admin AntiNuke
,antinuke listadmins       → Ver lista de Admins

> ROLES
,r add <usuario> <rol>     → Asignar rol
,r remove <usuario> <rol> → Quitar rol

> WHITELIST
,whitelist add <ID> all    → Agregar a Whitelist (Todo)
,whitelist add <ID> pings  → Agregar a Whitelist (Pings)
,whitelist remove <ID>     → Eliminar de Whitelist
,whitelist list            → Ver Whitelist

> SEGURIDAD
,hb / hardban <usuario> [razón] → Banear (solo reacción 👍)
,lock / papi              → Bloquear canal
,unlock / unpapi          → Desbloquear canal

> LIMPIEZA
,c <cantidad>             → Borrar mensajes (1-100)
,s                        → Ver contenido eliminado
,cs                       → Limpiar historial

> GENERAL
,help / ,cmd              → Mostrar esta lista
        `);
    }

    // ======================================
    // HARDBAN / HB — Solo reacción 👍
    // ======================================
    if (cmd === 'hardban' || cmd === 'hb') {
        if (!isOwnerOrAdmin(msg.member)) return msg.reply('Permisos insuficientes.');
        if (args.length === 0) return msg.reply('Uso: ,hb <usuario> <razón>');
        
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'Sin razón';
        let userId = null;
        const mentionMatch = target.match(/^<@!?(\d+)>$/);
        if (mentionMatch) userId = mentionMatch[1];
        else if (/^\d+$/.test(target)) userId = target;
        else return msg.reply('Usuario inválido.');

        if (userId === msg.author.id) return msg.reply('No puedes banearte a ti mismo.');
        if (userId === msg.guild.ownerId) return msg.reply('No puedes banear al dueño.');

        await msg.guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
        await msg.react('👍').catch(() => {});
        return;
    }

    // ======================================
    // ANTINUKE
    // ======================================
    if (cmd === 'antinuke') {
        if (!isOwnerOrAdmin(msg.member)) return msg.reply('Permisos insuficientes.');
        const action = args[0]?.toLowerCase();
        const id = args[1];
        if (action === 'addadmin' && id) {
            antinuke.addAdmin(id);
            return msg.reply(`Agregado: <@${id}> como Admin AntiNuke.`);
        }
        if (action === 'removeadmin' && id) {
            antinuke.removeAdmin(id);
            return msg.reply(`Eliminado: <@${id}> de Admins.`);
        }
        if (action === 'listadmins') {
            return msg.reply(`Admins: ${antinuke.data.admins.map(i => `<@${i}>`).join(', ') || 'Ninguno'}`);
        }
        return msg.reply('Uso: ,antinuke addadmin <ID> | removeadmin <ID> | listadmins');
    }

    // ======================================
    // LOCK / UNLOCK
    // ======================================
    if (cmd === 'lock' || cmd === 'papi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        if (msg.channel.type !== ChannelType.GuildText) return;
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false
        });
        return msg.reply('Canal bloqueado.');
    }
    if (cmd === 'unlock' || cmd === 'unpapi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: true, CreatePublicThreads: true, CreatePrivateThreads: true
        });
        return msg.reply('Canal desbloqueado.');
    }

    // ======================================
    // WHITELIST
    // ======================================
    if (cmd === 'whitelist') {
        if (msg.author.id !== msg.guild.ownerId && !antinuke.isAdmin(msg.author.id)) {
            return msg.reply('Permisos insuficientes.');
        }
        const action = args[0]?.toLowerCase();
        if (action === 'add' && args[2]?.toLowerCase() === 'all') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('Uso: ,whitelist add <ID> all');
            whitelist.addAll(id);
            return msg.reply(`<@${id}> → Whitelist (All).`);
        }
        if (action === 'add' && args[2]?.toLowerCase() === 'pings') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('Uso: ,whitelist add <ID> pings');
            whitelist.addPings(id);
            return msg.reply(`<@${id}> → Whitelist (Pings).`);
        }
        if (action === 'remove') {
            const id = args[1];
            whitelist.remove(id);
            return msg.reply(`<@${id}> → Eliminado de Whitelist.`);
        }
        if (action === 'list') {
            return msg.reply(`All: ${whitelist.data.all.map(i => `<@${i}>`).join(', ') || 'Ninguno'}\nPings: ${whitelist.data.pings.map(i => `<@${i}>`).join(', ') || 'Ninguno'}`);
        }
    }

    // ======================================
    // ROLES — Formato Bleed
    // ======================================
    if (cmd === 'r') {
        const action = args[0]?.toLowerCase();
        if (!action || !['add', 'remove'].includes(action)) {
            return msg.reply('Uso: ,r add <usuario> <rol> | ,r remove <usuario> <rol>');
        }
        const userInput = args[1];
        const roleInput = args.slice(2).join(' ');
        if (!userInput || !roleInput) return msg.reply('Faltan argumentos.');
        
        let member = null;
        const userMatch = userInput.match(/^<@!?(\d+)>$/);
        if (userMatch) member = await msg.guild.members.fetch(userMatch[1]).catch(() => null);
        else if (/^\d+$/.test(userInput)) member = await msg.guild.members.fetch(userInput).catch(() => null);
        else member = msg.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === userInput.toLowerCase() ||
            m.displayName.toLowerCase() === userInput.toLowerCase()
        );
        if (!member) return msg.reply('Usuario no encontrado.');

        let role = null;
        const roleMatch = roleInput.match(/^<@&(\d+)>$/);
        if (roleMatch) role = msg.guild.roles.cache.get(roleMatch[1]);
        else if (/^\d+$/.test(roleInput)) role = msg.guild.roles.cache.get(roleInput);
        else role = msg.guild.roles.cache.find(r => r.name.toLowerCase() === roleInput.toLowerCase());
        if (!role) return msg.reply('Rol no encontrado.');
        if (role.id === CONFIG.ownerRoleId) return msg.reply('Rol protegido.');

        if (action === 'add') {
            await member.roles.add(role, `Por ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} — Asignado: ${role.name}`);
        } else {
            await member.roles.remove(role, `Por ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} — Removido: ${role.name}`);
        }
    }

    // ======================================
    // CLEAR
    // ======================================
    if (cmd === 'c') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) return msg.reply('Cantidad: 1-100.');
        try {
            await msg.delete();
            const messages = await msg.channel.messages.fetch({ limit: amount });
            lastClearedMessages = Array.from(messages.values()).map(m => ({
                id: m.id,
                authorTag: m.author.tag,
                authorId: m.author.id,
                content: m.content || 'Sin contenido',
                attachments: m.attachments.map(a => ({ url: a.url, name: a.name })),
                timestamp: m.createdAt
            }));
            if (lastClearedMessages.length > 0) {
                lastClearedUserId = lastClearedMessages[0].authorId;
                deletedMessagesLog = [...lastClearedMessages, ...deletedMessagesLog].slice(0, 50);
            }
            await msg.channel.bulkDelete(messages, true);
            return msg.reply(`Eliminados: ${messages.size} mensajes. Usa ,s para ver.`);
        } catch (e) { return msg.reply('Error al borrar.'); }
    }

    if (cmd === 'cs') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        deletedMessagesLog = [];
        lastClearedMessages = [];
        lastClearedUserId = null;
        return msg.reply('Historial limpiado.');
    }

    // ======================================
    // SHOW LOGS
    // ======================================
    if (cmd === 's') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        if (!lastClearedMessages || lastClearedMessages.length === 0) {
            return msg.reply('Sin registros. Usa ,c primero.');
        }
        try {
            let output = `=== ${lastClearedMessages.length} mensajes eliminados ===\n\n`;
            const files = [];
            lastClearedMessages.forEach((m, i) => {
                output += `${i + 1}. ${m.authorTag} | ${new Date(m.timestamp).toLocaleString('es-MX')}\n`;
                output += `${m.content}\n`;
                if (m.attachments.length > 0) {
                    m.attachments.forEach(a => output += `Archivo: ${a.name}\n`);
                }
                output += `---\n`;
            });
            const images = lastClearedMessages.flatMap(m => m.attachments).filter(a => 
                /\.(png|jpg|jpeg|gif|webp)$/i.test(a.url)
            );
            if (images.length > 0) {
                for (const img of images.slice(0, 5)) {
                    files.push(new AttachmentBuilder(img.url, { name: img.name }));
                }
            }
            if (output.length > 1900) {
                const fileName = `deleted_${Date.now()}.txt`;
                fs.writeFileSync(fileName, output);
                const file = new AttachmentBuilder(fileName);
                await msg.channel.send({ files: files.length > 0 ? [file, ...files] : [file] });
                fs.unlinkSync(fileName);
            } else {
                await msg.channel.send({ content: output, files });
            }
        } catch (e) { return msg.reply('Error al leer registros.'); }
        return;
    }
});

// ==========================================
// ANTINUKE EVENTS
// ==========================================
client.on(Events.ChannelCreate, async (channel) => {
    const entry = await getAuditEntry(channel.guild, 10);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkLimit(channel.guild.id, entry.executor.id);
    if (check.noPermit || !check.allowed) {
        try { await channel.delete(); } catch {}
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Canal no autorizado');
        await logSecurity(channel.guild, entry.executor, 'Creación de canal', 'Bloqueado');
    }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const entry = await getAuditEntry(oldGuild, 1);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        const member = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Modificación del servidor');
        await logSecurity(oldGuild, entry.executor, 'Modificación del servidor', 'Bloqueado');
    }
});

client.on(Events.RoleCreate, async (role) => {
    const entry = await getAuditEntry(role.guild, 30);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        try { await role.delete(); } catch {}
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Creación de rol');
        await logSecurity(role.guild, entry.executor, 'Creación de rol', 'Bloqueado');
    }
});

client.login(CONFIG.token);
