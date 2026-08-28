const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, AuditLogEvent, AttachmentBuilder } = require('discord.js');
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
  defaultThreshold: 3,
  defaultPunishment: 'stripstaff',
  actionWindow: 15000
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

let lastClearedMessages = [];
let deletedMessagesLog = [];
let lastClearedUserId = null;

class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try {
            if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8'));
        } catch (e) {}
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

class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try {
            if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8'));
        } catch (e) {}
        return {
            enabled: true,
            threshold: CONFIG.defaultThreshold,
            punishment: CONFIG.defaultPunishment,
            admins: [],
            whitelist: [],
            modules: {
                ban: true, unban: true, channelCreate: true, channelDelete: true,
                roleCreate: true, roleDelete: true, guildUpdate: true, vanity: true, botAdd: true
            }
        };
    }
    save() { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
    isWhitelisted(userId) {
        return this.data.whitelist.includes(userId) || whitelist.isAll(userId);
    }
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
    addWhitelist(userId) {
        if (!this.data.whitelist.includes(userId)) {
            this.data.whitelist.push(userId);
            this.save();
        }
    }
    removeWhitelist(userId) {
        this.data.whitelist = this.data.whitelist.filter(id => id !== userId);
        this.save();
    }
    setThreshold(value) { this.data.threshold = value; this.save(); }
    setPunishment(punish) { this.data.punishment = punish; this.save(); }
    toggleModule(module, state) {
        if (this.data.modules.hasOwnProperty(module)) {
            this.data.modules[module] = state;
            this.save();
        }
    }
    checkAction(guildId, userId, module) {
        if (!this.data.enabled) return { allowed: true, bypass: 'System Disabled' };
        if (userId === client.user.id) return { allowed: true, bypass: 'Bot' };
        if (this.isAdmin(userId) || this.isWhitelisted(userId)) return { allowed: true, bypass: 'Privileged' };
        if (!this.data.modules[module]) return { allowed: true, bypass: 'Module Disabled' };
        const now = Date.now();
        if (!this.actionTracker[guildId]) this.actionTracker[guildId] = {};
        if (!this.actionTracker[guildId][userId]) this.actionTracker[guildId][userId] = [];
        const actions = this.actionTracker[guildId][userId].filter(t => now - t < CONFIG.actionWindow);
        actions.push(now);
        this.actionTracker[guildId][userId] = actions;
        return {
            allowed: actions.length <= this.data.threshold,
            count: actions.length,
            limit: this.data.threshold,
            punishment: this.data.punishment
        };
    }
    resetUser(guildId, userId) {
        if (this.actionTracker[guildId]) delete this.actionTracker[guildId][userId];
    }
}
const antinuke = new AntiNukeManager();

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

async function applyPunishment(member, punishment, reason) {
    try {
        if (punishment === 'ban') {
            await member.ban({ reason, deleteMessageSeconds: 0 });
        } else if (punishment === 'kick') {
            await member.kick(reason);
        } else if (punishment === 'stripstaff') {
            const rolesToRemove = member.roles.cache.filter(r => 
                r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator)
            );
            if (rolesToRemove.size > 0) await member.roles.set([], reason);
        }
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

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;
    if (msg.author.id === msg.guild.ownerId) return;
    if (msg.mentions.everyone && !whitelist.canPingEveryone(msg.author.id)) {
        try { await msg.delete(); } catch {}
    }
});

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const args = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    if (cmd === 'help' || cmd === 'cmd') {
        return msg.reply(`=== COMANDOS DEL BOT ===

> ANTINUKE
,antinuke on/off              → Activar/desactivar sistema
,antinuke threshold <n>      → Establecer límite de acciones
,antinuke punishment <tipo>  → Establecer castigo
,antinuke whitelist add <ID> → Agregar a lista blanca
,antinuke whitelist remove <ID> → Eliminar de lista blanca
,antinuke admin add <ID>     → Agregar Admin AntiNuke
,antinuke admin remove <ID>  → Eliminar Admin AntiNuke
,antinuke module <nombre> on/off → Activar/desactivar módulo
,antinuke status             → Ver configuración actual

> ROLES
,r add <@usuario> <@rol>     → Asignar rol
,r remove <@usuario> <@rol> → Quitar rol

> WHITELIST
,whitelist add <ID> all      → Agregar a Whitelist (Todo)
,whitelist add <ID> pings    → Agregar a Whitelist (Pings)
,whitelist remove <ID>       → Eliminar de Whitelist
,whitelist list              → Ver Whitelist

> SEGURIDAD
,hb / hardban <usuario> [razón] → Banear
,lock / papi                 → Bloquear canal
,unlock / unpapi             → Desbloquear canal

> LIMPIEZA
,c <cantidad>                → Borrar mensajes
,s                           → Ver contenido eliminado
,cs                          → Limpiar historial

> GENERAL
,help / ,cmd                 → Mostrar esta lista`);
    }

    if (cmd === 'antinuke') {
        if (!isOwnerOrAdmin(msg.member)) return msg.reply('Permisos insuficientes.');
        const subCmd = args[0]?.toLowerCase();
        if (subCmd === 'on') {
            antinuke.data.enabled = true;
            antinuke.save();
            return msg.reply('AntiNuke enabled.');
        }
        if (subCmd === 'off') {
            antinuke.data.enabled = false;
            antinuke.save();
            return msg.reply('AntiNuke disabled.');
        }
        if (subCmd === 'threshold' && args[1]) {
            const val = parseInt(args[1]);
            if (isNaN(val) || val < 1) return msg.reply('Valor inválido.');
            antinuke.setThreshold(val);
            return msg.reply(`Threshold set to ${val}.`);
        }
        if (subCmd === 'punishment' && args[1]) {
            const valid = ['ban', 'kick', 'stripstaff'];
            if (!valid.includes(args[1])) return msg.reply('Castigo válido: ban, kick, stripstaff.');
            antinuke.setPunishment(args[1]);
            return msg.reply(`Punishment set to ${args[1]}.`);
        }
        if (subCmd === 'whitelist' && args[1]?.toLowerCase() === 'add' && args[2]) {
            antinuke.addWhitelist(args[2]);
            return msg.reply(`<@${args[2]}> added to AntiNuke whitelist.`);
        }
        if (subCmd === 'whitelist' && args[1]?.toLowerCase() === 'remove' && args[2]) {
            antinuke.removeWhitelist(args[2]);
            return msg.reply(`<@${args[2]}> removed from AntiNuke whitelist.`);
        }
        if (subCmd === 'admin' && args[1]?.toLowerCase() === 'add' && args[2]) {
            antinuke.addAdmin(args[2]);
            return msg.reply(`<@${args[2]}> added as AntiNuke Admin.`);
        }
        if (subCmd === 'admin' && args[1]?.toLowerCase() === 'remove' && args[2]) {
            antinuke.removeAdmin(args[2]);
            return msg.reply(`<@${args[2]}> removed from AntiNuke Admins.`);
        }
        if (subCmd === 'module' && args[1] && ['on','off'].includes(args[2]?.toLowerCase())) {
            antinuke.toggleModule(args[1], args[2] === 'on');
            return msg.reply(`Module ${args[1]} set to ${args[2]}.`);
        }
        if (subCmd === 'status') {
            return msg.reply(`AntiNuke Status:
Enabled: ${antinuke.data.enabled}
Threshold: ${antinuke.data.threshold}
Punishment: ${antinuke.data.punishment}
Admins: ${antinuke.data.admins.length}
Whitelist: ${antinuke.data.whitelist.length}`);
        }
        return msg.reply('Uso: ,antinuke on/off | threshold <n> | punishment <tipo> | whitelist add/remove <ID> | admin add/remove <ID> | module <nombre> on/off | status');
    }

    if (cmd === 'hardban' || cmd === 'hb') {
        if (!isOwnerOrAdmin(msg.member)) return msg.reply('Permisos insuficientes.');
        if (args.length === 0) return msg.reply('Uso: ,hb <usuario> [razón]');
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
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

    if (cmd === 'r') {
        const action = args[0]?.toLowerCase();
        if (!action || !['add', 'remove'].includes(action)) {
            return msg.reply('Uso: ,r add <@usuario> <@rol> | ,r remove <@usuario> <@rol>');
        }
        const userInput = args[1];
        const roleInput = args[2];
        if (!userInput || !roleInput) return msg.reply('Faltan argumentos.');
        let member = null;
        const userMatch = userInput.match(/^<@!?(\d+)>$/);
        if (userMatch) member = await msg.guild.members.fetch(userMatch[1]).catch(() => null);
        else if (/^\d+$/.test(userInput)) member = await msg.guild.members.fetch(userInput).catch(() => null);
        if (!member) return msg.reply('Usuario no encontrado.');
        let role = null;
        const roleMatch = roleInput.match(/^<@&(\d+)>$/);
        if (roleMatch) role = msg.guild.roles.cache.get(roleMatch[1]);
        else if (/^\d+$/.test(roleInput)) role = msg.guild.roles.cache.get(roleInput);
        if (!role) return msg.reply('Rol no encontrado.');
        if (role.id === CONFIG.ownerRoleId) return msg.reply('Rol protegido.');
        if (action === 'add') {
            await member.roles.add(role, `By ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} : Set ${role.name} as an award role`);
        } else {
            await member.roles.remove(role, `By ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} : Removed ${role.name} as an award role`);
        }
    }

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

client.on(Events.ChannelCreate, async (channel) => {
    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelCreate);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(channel.guild.id, entry.executor.id, 'channelCreate');
    if (!check.allowed) {
        try { await channel.delete(); } catch {}
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Canal no autorizado');
        await logSecurity(channel.guild, entry.executor, 'Creación de canal', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.ChannelDelete, async (channel) => {
    const entry = await getAuditEntry(channel.guild, AuditLogEvent.ChannelDelete);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(channel.guild.id, entry.executor.id, 'channelDelete');
    if (!check.allowed) {
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Eliminación de canal');
        await logSecurity(channel.guild, entry.executor, 'Eliminación de canal', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.RoleCreate, async (role) => {
    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleCreate);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(role.guild.id, entry.executor.id, 'roleCreate');
    if (!check.allowed) {
        try { await role.delete(); } catch {}
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Rol no autorizado');
        await logSecurity(role.guild, entry.executor, 'Creación de rol', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.RoleDelete, async (role) => {
    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleDelete);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(role.guild.id, entry.executor.id, 'roleDelete');
    if (!check.allowed) {
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Eliminación de rol');
        await logSecurity(role.guild, entry.executor, 'Eliminación de rol', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.GuildBanAdd, async (ban) => {
    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(ban.guild.id, entry.executor.id, 'ban');
    if (!check.allowed) {
        const member = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Ban masivo');
        await logSecurity(ban.guild, entry.executor, 'Ban detectado', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.GuildBanRemove, async (ban) => {
    const entry = await getAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(ban.guild.id, entry.executor.id, 'unban');
    if (!check.allowed) {
        const member = await ban.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Unban masivo');
        await logSecurity(ban.guild, entry.executor, 'Unban detectado', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const entry = await getAuditEntry(oldGuild, AuditLogEvent.GuildUpdate);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(oldGuild.id, entry.executor.id, 'guildUpdate');
    if (!check.allowed) {
        const member = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Modificación del servidor');
        await logSecurity(oldGuild, entry.executor, 'Modificación del servidor', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.login(CONFIG.token);
