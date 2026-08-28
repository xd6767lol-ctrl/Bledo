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
  lockAllowedRoleIds: ['ROLE_ID_1','ROLE_ID_2','ROLE_ID_3','ROLE_ID_4'],
  logChannel: 'seguridad',
  defaultThreshold: 3,
  defaultPunishment: 'stripstaff',
  actionWindow: 15000
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

let lastClearedMessages = [], deletedMessagesLog = [], lastClearedUserId = null;

class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try { if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8')); } catch (e) {}
        return { all: [], pings: [] };
    }
    save() { fs.writeFileSync(CONFIG.whitelistFile, JSON.stringify(this.data, null, 4)); }
    isAll(userId) { return this.data.all.includes(userId); }
    isPings(userId) { return this.data.pings.includes(userId); }
    canPingEveryone(userId) { return this.isAll(userId) || this.isPings(userId); }
    addAll(userId) { if (!this.data.all.includes(userId)) { this.data.all.push(userId); this.data.pings = this.data.pings.filter(id => id !== userId); this.save(); } }
    addPings(userId) { if (!this.data.pings.includes(userId) && !this.data.all.includes(userId)) { this.data.pings.push(userId); this.save(); } }
    remove(userId) { this.data.all = this.data.all.filter(id => id !== userId); this.data.pings = this.data.pings.filter(id => id !== userId); this.save(); }
}
const whitelist = new WhitelistManager();

class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try { if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8')); } catch (e) {}
        return {
            enabled: true,
            admins: [],
            whitelist: [],
            modules: {
                ban: { enabled: false, threshold: 3, punishment: 'stripstaff', commandDetection: true },
                kick: { enabled: false, threshold: 3, punishment: 'stripstaff', commandDetection: true },
                role_delete: { enabled: false, threshold: 3, punishment: 'stripstaff', commandDetection: true },
                channel_create: { enabled: false, threshold: 3, punishment: 'stripstaff', commandDetection: true },
                channel_delete: { enabled: false, threshold: 3, punishment: 'stripstaff', commandDetection: true },
                vanity: { enabled: false, punishment: 'stripstaff' },
                bot_add: { enabled: false, threshold: 1, punishment: 'kick' },
                emoji_delete: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                webhook_create: { enabled: false, threshold: 3, punishment: 'stripstaff' }
            }
        };
    }
    save() { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
    isAdmin(userId) { return this.data.admins.includes(userId); }
    addAdmin(userId) { if (!this.data.admins.includes(userId)) { this.data.admins.push(userId); this.save(); } }
    removeAdmin(userId) { this.data.admins = this.data.admins.filter(id => id !== userId); this.save(); }
    isWhitelisted(userId) { return this.data.whitelist.includes(userId) || whitelist.isAll(userId); }
    addWhitelist(userId) { if (!this.data.whitelist.includes(userId)) { this.data.whitelist.push(userId); this.save(); } }
    removeWhitelist(userId) { this.data.whitelist = this.data.whitelist.filter(id => id !== userId); this.save(); }
    setModule(mod, enabled, threshold, punishment, commandDetection) {
        if (!this.data.modules[mod]) return false;
        if (typeof enabled === 'boolean') this.data.modules[mod].enabled = enabled;
        if (threshold) this.data.modules[mod].threshold = threshold;
        if (punishment) this.data.modules[mod].punishment = punishment;
        if (typeof commandDetection === 'boolean') this.data.modules[mod].commandDetection = commandDetection;
        this.save();
        return true;
    }
    checkAction(guildId, userId, module, isCommand = false) {
        const guild = client.guilds.cache.get(guildId);
        if (!this.data.enabled) return { allowed: true, bypass: 'System Disabled' };
        if (userId === client.user.id) return { allowed: true, bypass: 'Bot' };
        if (guild && userId === guild.ownerId) return { allowed: true, bypass: 'Owner' };
        if (this.isWhitelisted(userId)) return { allowed: true, bypass: 'Whitelisted' };
        const mod = this.data.modules[module];
        if (!mod || !mod.enabled) return { allowed: true, bypass: 'Module Disabled' };
        if (isCommand && mod.commandDetection === false) return { allowed: true, bypass: 'Command Detection Off' };
        const now = Date.now();
        if (!this.actionTracker[guildId]) this.actionTracker[guildId] = {};
        if (!this.actionTracker[guildId][userId]) this.actionTracker[guildId][userId] = [];
        const actions = this.actionTracker[guildId][userId].filter(t => now - t < CONFIG.actionWindow);
        actions.push(now);
        this.actionTracker[guildId][userId] = actions;
        return {
            allowed: actions.length <= mod.threshold,
            count: actions.length,
            limit: mod.threshold,
            punishment: mod.punishment
        };
    }
}
const antinuke = new AntiNukeManager();

function canConfigure(member) {
  if (member.id === member.guild.ownerId) return true;
  return antinuke.isAdmin(member.id);
}

function canUseLockCommands(member) {
  if (member.id === member.guild.ownerId) return true;
  if (whitelist.isAll(member.id)) return true;
  return CONFIG.lockAllowedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

async function applyPunishment(member, punishment, reason) {
    try {
        if (punishment === 'ban') await member.ban({ reason, deleteMessageSeconds: 0 });
        else if (punishment === 'kick') await member.kick(reason);
        else if (punishment === 'stripstaff') {
            const rolesToRemove = member.roles.cache.filter(r => r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator));
            if (rolesToRemove.size > 0) await member.roles.set([], reason);
        }
    } catch (e) {}
}

async function getAuditEntry(guild, actionType, limit = 5) {
    try { const logs = await guild.fetchAuditLogs({ limit, type: actionType }); return logs.entries.first(); }
    catch { return null; }
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
    if (msg.mentions.everyone && !whitelist.canPingEveryone(msg.author.id)) try { await msg.delete(); } catch {}
});

client.once(Events.ClientReady, () => console.log(`Logged in as ${client.user.tag}`));

function parseFlags(args) {
    const flags = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            const val = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : true;
            flags[key] = val;
        } else positional.push(args[i]);
    }
    return { positional, flags };
}

client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const rawArgs = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = rawArgs.shift()?.toLowerCase();
    const { positional, flags } = parseFlags(rawArgs);
    const subCmd = positional[0]?.toLowerCase();

    if (cmd === 'help' || cmd === 'cmd') {
        return msg.reply(`=== COMANDOS DEL BOT ===

> ANTINUKE
,antinuke admin <user>                 → Agregar/quitar Admin AntiNuke
,antinuke whitelist <user>             → Eximir usuario del AntiNuke
,antinuke ban on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke kick on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke roledelete on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke channelcreate on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke channeldelete on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke vanity on/off [--do castigo]
,antinuke botadd on/off [--threshold N] [--do castigo]
,antinuke emojidelete on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke webhookcreate on/off [--threshold N] [--do castigo] [--command on/off]
,antinuke config                       → Ver configuración actual
,antinuke list                          → Ver módulos activos y whitelist
,antinuke admins                        → Ver lista de Admins AntiNuke

> ROLES
,r add <@usuario> <@rol>               → Asignar rol
,r remove <@usuario> <@rol>           → Quitar rol

> WHITELIST
,whitelist add <ID> all                 → Agregar a Whitelist (Todo)
,whitelist add <ID> pings               → Agregar a Whitelist (Pings)
,whitelist remove <ID>                  → Eliminar de Whitelist
,whitelist list                         → Ver Whitelist

> SEGURIDAD
,hb / hardban <usuario> [razón]         → Banear
,lock / papi                            → Bloquear canal
,unlock / unpapi                        → Desbloquear canal

> LIMPIEZA
,c <cantidad>                           → Borrar mensajes
,s                                      → Ver contenido eliminado
,cs                                     → Limpiar historial

> GENERAL
,help / ,cmd                            → Mostrar esta lista`);
    }

    if (cmd === 'antinuke') {
        if (!canConfigure(msg.member)) return msg.reply('Permisos insuficientes. Solo el dueño y Admins AntiNuke pueden configurar.');
        const target = positional[1];

        if (subCmd === 'admin') {
            if (!target) return msg.reply('Uso: ,antinuke admin <@usuario>');
            const userId = target.replace(/[<@!>]/g, '');
            if (antinuke.data.admins.includes(userId)) {
                antinuke.removeAdmin(userId);
                return msg.reply(`<@${userId}> removed from AntiNuke Admins.`);
            } else {
                antinuke.addAdmin(userId);
                return msg.reply(`<@${userId}> added as AntiNuke Admin.`);
            }
        }

        if (subCmd === 'whitelist') {
            if (!target) return msg.reply('Uso: ,antinuke whitelist <@usuario>');
            const userId = target.replace(/[<@!>]/g, '');
            if (antinuke.data.whitelist.includes(userId)) {
                antinuke.removeWhitelist(userId);
                return msg.reply(`<@${userId}> removed from AntiNuke Whitelist.`);
            } else {
                antinuke.addWhitelist(userId);
                return msg.reply(`<@${userId}> added to AntiNuke Whitelist.`);
            }
        }

        if (['ban','kick','roledelete','channelcreate','channeldelete','vanity','botadd','emojidelete','webhookcreate'].includes(subCmd)) {
            const state = positional[1]?.toLowerCase();
            if (!['on','off'].includes(state)) return msg.reply(`Uso: ,antinuke ${subCmd} on/off [--threshold N] [--do castigo] [--command on/off]`);
            const modMap = {
                ban: 'ban', kick: 'kick', roledelete: 'role_delete',
                channelcreate: 'channel_create', channeldelete: 'channel_delete',
                vanity: 'vanity', botadd: 'bot_add', emojidelete: 'emoji_delete',
                webhookcreate: 'webhook_create'
            };
            const mod = modMap[subCmd];
            const enabled = state === 'on';
            const threshold = flags.threshold ? parseInt(flags.threshold) : undefined;
            const punishment = flags.do || flags.punishment;
            const commandDetection = flags.command !== undefined ? flags.command === 'on' : undefined;
            antinuke.setModule(mod, enabled, threshold, punishment, commandDetection);
            return msg.reply(`${subCmd} module ${state}.`);
        }

        if (subCmd === 'config') {
            let out = '=== AntiNuke Configuration ===\n';
            for (const [name, m] of Object.entries(antinuke.data.modules)) {
                out += `${name}: enabled=${m.enabled}, threshold=${m.threshold ?? 'N/A'}, punishment=${m.punishment}, commandDetection=${m.commandDetection ?? 'N/A'}\n`;
            }
            return msg.reply(out);
        }

        if (subCmd === 'list') {
            const mods = Object.entries(antinuke.data.modules).filter(([,m]) => m.enabled).map(([n]) => n).join(', ') || 'None';
            const wl = antinuke.data.whitelist.map(id => `<@${id}>`).join(', ') || 'None';
            return msg.reply(`Active Modules: ${mods}\nWhitelist: ${wl}`);
        }

        if (subCmd === 'admins') {
            const admins = antinuke.data.admins.map(id => `<@${id}>`).join(', ') || 'None';
            return msg.reply(`AntiNuke Admins: ${admins}`);
        }

        return msg.reply('Uso: ,antinuke admin <user> | whitelist <user> | config | list | admins');
    }

    if (cmd === 'hardban' || cmd === 'hb') {
        if (!canConfigure(msg.member)) return msg.reply('Permisos insuficientes.');
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
        if (msg.author.id !== msg.guild.ownerId) return msg.reply('Permisos insuficientes.');
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
                id: m.id, authorTag: m.author.tag, authorId: m.author.id,
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
        deletedMessagesLog = []; lastClearedMessages = []; lastClearedUserId = null;
        return msg.reply('Historial limpiado.');
    }

    if (cmd === 's') {
        if (!canUseLockCommands(msg.member)) return msg.reply('Permisos insuficientes.');
        if (!lastClearedMessages || lastClearedMessages.length === 0) return msg.reply('Sin registros. Usa ,c primero.');
        try {
            let output = `=== ${lastClearedMessages.length} mensajes eliminados ===\n\n`;
            const files = [];
            lastClearedMessages.forEach((m, i) => {
                output += `${i + 1}. ${m.authorTag} | ${new Date(m.timestamp).toLocaleString('es-MX')}\n${m.content}\n`;
                if (m.attachments.length > 0) m.attachments.forEach(a => output += `Archivo: ${a.name}\n`);
                output += `---\n`;
            });
            const images = lastClearedMessages.flatMap(m => m.attachments).filter(a => /\.(png|jpg|jpeg|gif|webp)$/i.test(a.url));
            if (images.length > 0) for (const img of images.slice(0, 5)) files.push(new AttachmentBuilder(img.url, { name: img.name }));
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
    const check = antinuke.checkAction(channel.guild.id, entry.executor.id, 'channel_create');
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
    const check = antinuke.checkAction(channel.guild.id, entry.executor.id, 'channel_delete');
    if (!check.allowed) {
        const member = await channel.guild.members.fetch(entry.executor.id).catch(() => null);
        if (member) await applyPunishment(member, check.punishment, 'AntiNuke: Eliminación de canal');
        await logSecurity(channel.guild, entry.executor, 'Eliminación de canal', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.on(Events.RoleDelete, async (role) => {
    const entry = await getAuditEntry(role.guild, AuditLogEvent.RoleDelete);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(role.guild.id, entry.executor.id, 'role_delete');
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

client.on(Events.GuildMemberRemove, async (member) => {
    const entry = await getAuditEntry(member.guild, AuditLogEvent.MemberKick);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const check = antinuke.checkAction(member.guild.id, entry.executor.id, 'kick');
    if (!check.allowed) {
        const modMember = await member.guild.members.fetch(entry.executor.id).catch(() => null);
        if (modMember) await applyPunishment(modMember, check.punishment, 'AntiNuke: Kick masivo');
        await logSecurity(member.guild, entry.executor, 'Kick detectado', `Bloqueado — Límite: ${check.limit}`);
    }
});

client.login(CONFIG.token);
