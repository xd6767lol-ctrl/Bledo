// ==========================================
// CONFIGURATION
// ==========================================
const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Bot Online — Hardban + AntiNuke + Clear + Ping Protection + Fixed Logs'));
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

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
// CLIENT INITIALIZATION
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
// DATA STORAGE — ALMACENAMIENTO DE MENSAJES
// ==========================================
let lastClearedUserId = null;
let deletedMessagesLog = [];
let lastClearedMessages = [];

// ==========================================
// WHITELIST MANAGEMENT
// ==========================================
class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try {
            if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8'));
        } catch (e) { console.error('Whitelist load error:', e); }
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
// ANTINUKE MANAGEMENT
// ==========================================
class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try {
            if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8'));
        } catch (e) { console.error('AntiNuke load error:', e); }
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
// PERMISSION CHECKS
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
// UTILITY FUNCTIONS
// ==========================================
async function punishRemoveAllRoles(member, reason) {
    try {
        const rolesToRemove = member.roles.cache.filter(r => 
            r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator)
        );
        if (rolesToRemove.size === 0) return;
        await member.roles.set([], reason);
        console.log(`Removed ${rolesToRemove.size} roles from ${member.user.tag}`);
    } catch (e) { console.error('Role removal error:', e); }
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
    await channel.send(`[SECURITY] ${action}\nUser: ${user} (${user.id})\nDetails: ${details}`);
}

// ==========================================
// PING PROTECTION — DUEÑO EXENTO, BORRA SIN REENVIAR
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    // Dueño del servidor SIEMPRE exento
    if (msg.author.id === msg.guild.ownerId) return;

    // Borra menciones everyone sin permiso — SIN reenviar
    if (msg.mentions.everyone && !whitelist.canPingEveryone(msg.author.id)) {
        try { await msg.delete(); } catch (e) { console.error('Delete error:', e); }
    }
});

// ==========================================
// BOT READY
// ==========================================
client.once(Events.ClientReady, () => {
    console.log(`Bot Ready — Logged in as ${client.user.tag}`);
    console.log(`Whitelist (All): ${whitelist.data.all.length} entries`);
    console.log(`Whitelist (Pings): ${whitelist.data.pings.length} entries`);
    console.log(`AntiNuke Admins: ${antinuke.data.admins.length} entries`);
    console.log('Commands Active: hardban, hb, clear, cs, s, lock, whitelist, r');
    console.log('Log System Fixed — ,s shows deleted messages correctly');
});

// ==========================================
// COMMAND HANDLER
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const args = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift()?.toLowerCase();

    // ======================================
    // HARDBAN / HB — SOLO REACCIÓN 👍
    // ======================================
    if (cmd === 'hardban' || cmd === 'hb') {
        if (!isOwnerOrAdmin(msg.member)) {
            return msg.reply('You do not have admin privileges. Request admin access from an owner.');
        }
        if (args.length === 0) {
            return msg.reply('Command: hardban\nKeep a member banned\n\nSyntax: ,hardban (member) (reason)\nExample: ,hardban derek spaming');
        }
        const target = args[0];
        const reason = args.slice(1).join(' ') || 'No reason provided';
        try {
            let userId = null;
            const mentionMatch = target.match(/^<@!?(\d+)>$/);
            if (mentionMatch) userId = mentionMatch[1];
            else if (/^\d+$/.test(target)) userId = target;
            else return msg.reply('Command: hardban\nKeep a member banned\n\nSyntax: ,hardban (member) (reason)\nExample: ,hardban derek spaming');

            if (userId === msg.author.id) return msg.reply('You cannot ban yourself.');
            if (userId === msg.guild.ownerId) return msg.reply('You cannot ban the server owner.');

            await msg.guild.members.ban(userId, { reason: reason, deleteMessageSeconds: 0 });
            await msg.react('👍').catch(() => {});
            return;
        } catch (e) {
            console.error('Ban error:', e);
            return msg.reply('Failed to ban the specified user.');
        }
    }

    // ======================================
    // ANTINUKE ADMIN MANAGEMENT
    // ======================================
    if (cmd === 'antinuke') {
        if (!isOwnerOrAdmin(msg.member)) {
            return msg.reply('You do not have admin privileges. Request admin access from an owner.');
        }
        const action = args[0]?.toLowerCase();
        const id = args[1];
        if (action === 'addadmin' && id) {
            antinuke.addAdmin(id);
            return msg.reply(`User <@${id}> added as AntiNuke Admin.`);
        }
        if (action === 'removeadmin' && id) {
            antinuke.removeAdmin(id);
            return msg.reply(`User <@${id}> removed from AntiNuke Admins.`);
        }
        if (action === 'listadmins') {
            return msg.reply(`AntiNuke Admins: ${antinuke.data.admins.map(i => `<@${i}>`).join(', ') || 'None'}`);
        }
        return msg.reply('Usage: ,antinuke addadmin <ID> | ,antinuke removeadmin <ID> | ,antinuke listadmins');
    }

    // ======================================
    // LOCK / UNLOCK
    // ======================================
    if (cmd === 'lock' || cmd === 'papi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Insufficient permissions.');
        if (msg.channel.type !== ChannelType.GuildText) return;
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        });
        return msg.reply('Channel locked.');
    }
    if (cmd === 'unlock' || cmd === 'unpapi') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Insufficient permissions.');
        await msg.channel.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: true,
            CreatePublicThreads: true,
            CreatePrivateThreads: true
        });
        return msg.reply('Channel unlocked.');
    }

    // ======================================
    // WHITELIST MANAGEMENT
    // ======================================
    if (cmd === 'whitelist') {
        if (msg.author.id !== msg.guild.ownerId && !antinuke.isAdmin(msg.author.id)) {
            return msg.reply('Insufficient permissions.');
        }
        const action = args[0]?.toLowerCase();
        if (action === 'add' && args[2]?.toLowerCase() === 'all') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('Usage: ,whitelist add <ID> all');
            whitelist.addAll(id);
            return msg.reply(`User <@${id}> added to whitelist (All).`);
        }
        if (action === 'add' && args[2]?.toLowerCase() === 'pings') {
            const id = args[1];
            if (!/^\d+$/.test(id)) return msg.reply('Usage: ,whitelist add <ID> pings');
            whitelist.addPings(id);
            return msg.reply(`User <@${id}> added to whitelist (Pings).`);
        }
        if (action === 'remove') {
            const id = args[1];
            whitelist.remove(id);
            return msg.reply(`User <@${id}> removed from whitelist.`);
        }
        if (action === 'list') {
            return msg.reply(`Whitelist (All): ${whitelist.data.all.map(i => `<@${i}>`).join(', ') || 'None'}\nWhitelist (Pings): ${whitelist.data.pings.map(i => `<@${i}>`).join(', ') || 'None'}`);
        }
    }

    // ======================================
    // ROLE MANAGEMENT
    // ======================================
    if (cmd === 'r') {
        const action = args[0]?.toLowerCase();
        if (!action || !['add', 'remove'].includes(action)) {
            return msg.reply('Usage: ,r add <@user> <@role> | ,r remove <@user> <@role>');
        }
        const userInput = args[1];
        const roleInput = args.slice(2).join(' ');
        if (!userInput || !roleInput) {
            return msg.reply('Usage: ,r add <@user> <@role> | ,r remove <@user> <@role>');
        }
        let member = null;
        const userMatch = userInput.match(/^<@!?(\d+)>$/);
        if (userMatch) member = await msg.guild.members.fetch(userMatch[1]).catch(() => null);
        else if (/^\d+$/.test(userInput)) member = await msg.guild.members.fetch(userInput).catch(() => null);
        else member = msg.guild.members.cache.find(m => 
            m.user.username.toLowerCase() === userInput.toLowerCase() ||
            m.displayName.toLowerCase() === userInput.toLowerCase()
        );
        if (!member) return msg.reply('User not found.');
        let role = null;
        const roleMatch = roleInput.match(/^<@&(\d+)>$/);
        if (roleMatch) role = msg.guild.roles.cache.get(roleMatch[1]);
        else if (/^\d+$/.test(roleInput)) role = msg.guild.roles.cache.get(roleInput);
        else role = msg.guild.roles.cache.find(r => r.name.toLowerCase() === roleInput.toLowerCase());
        if (!role) return msg.reply('Role not found.');
        if (role.id === CONFIG.ownerRoleId) return msg.reply('This role cannot be assigned.');
        if (action === 'add') {
            await member.roles.add(role, `By ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} : Set ${role} as an award role`);
        } else {
            await member.roles.remove(role, `By ${msg.author.tag}`);
            return msg.channel.send(`${msg.author} : Removed ${role} as an award role`);
        }
    }

    // ======================================
    // CLEAR — GUARDA TODO EL CONTENIDO
    // ======================================
    if (cmd === 'c') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Insufficient permissions.');
        const amount = parseInt(args[0]);
        if (!amount || amount < 1 || amount > 100) {
            return msg.reply('Usage: ,c <amount> (1-100)');
        }
        try {
            await msg.delete();
            const messages = await msg.channel.messages.fetch({ limit: amount });
            
            // ✅ GUARDA TODO: CONTENIDO, AUTORES, ADJUNTOS
            lastClearedMessages = Array.from(messages.values()).map(m => ({
                id: m.id,
                authorTag: m.author.tag,
                authorId: m.author.id,
                content: m.content || 'No text content',
                attachments: m.attachments.map(a => ({ url: a.url, name: a.name })),
                timestamp: m.createdAt
            }));
            
            if (lastClearedMessages.length > 0) {
                lastClearedUserId = lastClearedMessages[0].authorId;
                deletedMessagesLog = [...lastClearedMessages, ...deletedMessagesLog].slice(0, 50);
            }
            
            await msg.channel.bulkDelete(messages, true);
            return msg.reply(`Cleared ${messages.size} messages. Use ,s to view content.`);
        } catch (e) { 
            console.error('Clear error:', e); 
            return msg.reply('Failed to clear messages.');
        }
    }

    if (cmd === 'cs') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Insufficient permissions.');
        deletedMessagesLog = [];
        lastClearedMessages = [];
        lastClearedUserId = null;
        return msg.reply('Message history cleared.');
    }

    // ======================================
    // S — MUESTRA LOS MENSAJES ELIMINADOS ✅ CORREGIDO
    // ======================================
    if (cmd === 's') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Insufficient permissions.');
        
        if (!lastClearedMessages || lastClearedMessages.length === 0) {
            return msg.reply('No deleted messages recorded. Use ,c first.');
        }

        try {
            let output = `Deleted Messages (${lastClearedMessages.length}):\n\n`;
            const files = [];

            lastClearedMessages.forEach((m, i) => {
                output += `${i + 1}. ${m.authorTag} — ${new Date(m.timestamp).toLocaleString('es-MX')}\n`;
                output += `Content: ${m.content}\n`; // ✅ MUESTRA EL CONTENIDO REAL
                if (m.attachments.length > 0) {
                    m.attachments.forEach(a => {
                        output += `Attachment: ${a.name} — ${a.url}\n`;
                    });
                }
                output += '----------------------------------------\n';
            });

            // Manejar imágenes
            const images = lastClearedMessages.flatMap(m => m.attachments).filter(a => 
                /\.(png|jpg|jpeg|gif|webp)$/i.test(a.url)
            );
            if (images.length > 0) {
                for (const img of images.slice(0, 5)) {
                    files.push(new AttachmentBuilder(img.url, { name: img.name }));
                }
            }

            // Enviar como archivo si es muy largo
            if (output.length > 1900) {
                const fileName = `deleted_messages_${Date.now()}.txt`;
                fs.writeFileSync(fileName, output);
                const file = new AttachmentBuilder(fileName);
                if (files.length > 0) {
                    await msg.channel.send({ files: [file, ...files] });
                } else {
                    await msg.channel.send({ files: [file] });
                }
                fs.unlinkSync(fileName);
            } else {
                if (files.length > 0) {
                    await msg.channel.send({ content: output, files: files });
                } else {
                    await msg.channel.send(output);
                }
            }
        } catch (e) { 
            console.error('Log error:', e); 
            return msg.reply('Failed to retrieve message logs.');
        }
        return;
    }
});

// ==========================================
// ANTINUKE EVENT HANDLERS
// ==========================================
client.on(Events.ChannelCreate, async (channel) => {
    const entry = await getAuditEntry(channel.guild, 10);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkLimit(channel.guild.id, entry.executor.id);
    if (check.noPermit || !check.allowed) {
        try { await channel.delete(); } catch {}
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Unauthorized channel creation');
        await logSecurity(channel.guild, entry.executor, 'Channel Creation', 'Blocked');
    }
});

client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const entry = await getAuditEntry(oldGuild, 1);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        const member = await oldGuild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Unauthorized server modification');
        await logSecurity(oldGuild, entry.executor, 'Server Modification', 'Blocked');
    }
});

client.on(Events.RoleCreate, async (role) => {
    const entry = await getAuditEntry(role.guild, 30);
    if (!entry || !entry.executor || entry.executor.bot) return;
    if (!antinuke.isAdmin(entry.executor.id)) {
        try { await role.delete(); } catch {}
        const member = await role.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await punishRemoveAllRoles(member, 'Unauthorized role creation');
        await logSecurity(role.guild, entry.executor, 'Role Creation', 'Blocked');
    }
});

client.login(CONFIG.token);
