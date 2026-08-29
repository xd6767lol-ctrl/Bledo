require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder } = require('discord.js');
const express = require('express');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// 🌐 Servidor Web — 24/7
app.get('/', (req, res) => res.send('System Online — Bleed Style'));
app.listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT} — Service Running`));

// ⚙️ CONFIGURACIÓN
const config = {
    prefix: ',',
    rolesPerPage: 10,
    historyRetentionDays: 7,
    antinuke: {
        enabled: true,
        protection: { bans: true, kicks: true, channels: true, roles: true, webhooks: true, serverName: true, serverIcon: true, permissions: true },
        limits: { bansPerMinute: 3, kicksPerMinute: 5, channelsPerMinute: 3, rolesPerMinute: 3 },
        punishment: 'remove_roles'
    },
    voicemaster: { enabled: true, defaultLimit: 0, categoryName: 'Voice Channels' }
};

// 📦 ALMACENAMIENTO
const voiceChannels = new Map();
const antinukeCounters = new Map();
const whitelist = new Set();
const antinukeAdmins = new Set();
const avatarHistory = new Map();
const nameHistory = new Map();

// 🤖 CLIENTE
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction, Partials.GuildMember]
});

// 🛠️ UTILIDADES
function createEmbed(title, description, color = '#2B2D31') {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}
function isOwner(userId, guild) { return userId === guild.ownerId; }
function isWhitelisted(userId) { return whitelist.has(userId); }
function isAntinukeAdmin(userId) { return antinukeAdmins.has(userId); }

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
    if (user.id === guild.ownerId || isWhitelisted(user.id)) return;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (config.antinuke.punishment === 'remove_roles') {
        const roles = member.roles.cache.filter(r => r.id !== guild.id);
        await member.roles.remove(roles, reason).catch(() => null);
    } else if (config.antinuke.punishment === 'ban') {
        await member.ban({ reason }).catch(() => null);
    } else if (config.antinuke.punishment === 'kick') {
        await member.kick(reason).catch(() => null);
    }
    console.log(`[ANTINUKE] ${user.tag} — ${reason}`);
}

// 🧹 Limpieza automática cada hora
setInterval(() => {
    const cutoff = Date.now() - (config.historyRetentionDays * 24 * 60 * 60 * 1000);
    for (const [userId, avatars] of avatarHistory) {
        avatarHistory.set(userId, avatars.filter(a => a.timestamp > cutoff));
        if (avatarHistory.get(userId).length === 0) avatarHistory.delete(userId);
    }
    for (const [userId, names] of nameHistory) {
        nameHistory.set(userId, names.filter(n => n.timestamp > cutoff));
        if (nameHistory.get(userId).length === 0) nameHistory.delete(userId);
    }
}, 60 * 60 * 1000);

// 📡 READY
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity({ type: 3, name: 'for unauthorized activity' });
});

// ==============================================
// 📸 HISTORIAL DE AVATARES Y NOMBRES
// ==============================================

client.on('userUpdate', async (oldUser, newUser) => {
    if (oldUser.avatar !== newUser.avatar) {
        if (!avatarHistory.has(newUser.id)) avatarHistory.set(newUser.id, []);
        const history = avatarHistory.get(newUser.id);
        const cutoff = Date.now() - (config.historyRetentionDays * 24 * 60 * 60 * 1000);
        const lastEntry = history[history.length - 1];
        if (!lastEntry || lastEntry.url !== newUser.displayAvatarURL({ size: 512 }) && Date.now() - lastEntry.timestamp > 5000) {
            history.push({ url: newUser.displayAvatarURL({ size: 512 }), timestamp: Date.now() });
            avatarHistory.set(newUser.id, history.filter(a => a.timestamp > cutoff));
        }
    }
    if (oldUser.username !== newUser.username) {
        if (!nameHistory.has(newUser.id)) nameHistory.set(newUser.id, []);
        const history = nameHistory.get(newUser.id);
        const cutoff = Date.now() - (config.historyRetentionDays * 24 * 60 * 60 * 1000);
        const lastEntry = history[history.length - 1];
        if (!lastEntry || lastEntry.name !== newUser.username && Date.now() - lastEntry.timestamp > 5000) {
            history.push({ name: newUser.username, timestamp: Date.now() });
            nameHistory.set(newUser.id, history.filter(n => n.timestamp > cutoff));
        }
    }
});

// 🖼️ Collage de avatares
async function generateAvatarCollage(user, avatars) {
    const size = 128;
    const perRow = 4;
    const rows = Math.ceil(avatars.length / perRow);
    const canvas = createCanvas(perRow * size, rows * size);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < avatars.length; i++) {
        try {
            const img = await loadImage(avatars[i].url);
            const x = (i % perRow) * size;
            const y = Math.floor(i / perRow) * size;
            ctx.drawImage(img, x, y, size, size);
            ctx.strokeStyle = '#2B2D31';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, size, size);
        } catch (e) {}
    }
    return canvas.toBuffer('image/png');
}

// ==============================================
// 🛡️ ANTINUKE
// ==============================================

client.on('guildBanAdd', async ban => {
    if (!config.antinuke.enabled) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === ban.guild.ownerId || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'bans', config.antinuke.limits.bansPerMinute)) await punish(ban.guild, executor, 'Exceeded ban limit');
});

client.on('guildMemberRemove', async member => {
    if (!config.antinuke.enabled) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    const executor = entry.executor;
    if (!executor || executor.bot || executor.id === member.guild.ownerId || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'kicks', config.antinuke.limits.kicksPerMinute)) await punish(member.guild, executor, 'Exceeded kick limit');
});

client.on('channelCreate', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || executor.id === channel.guild.ownerId || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute)) {
        await punish(channel.guild, executor, 'Exceeded channel creation limit');
        await channel.delete().catch(() => null);
    }
});

client.on('channelDelete', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || executor.id === channel.guild.ownerId || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute)) await punish(channel.guild, executor, 'Exceeded channel delete limit');
});

client.on('roleCreate', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || executor.id === role.guild.ownerId || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute)) {
        await punish(role.guild, executor, 'Exceeded role creation limit');
        await role.delete().catch(() => null);
    }
});

client.on('roleDelete', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || executor.id === role.guild.ownerId || isWhitelisted(executor.id)) return;
    await punish(role.guild, executor, 'Role deletion without permission');
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!config.antinuke.enabled) return;
    const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || executor.id === newGuild.ownerId || isWhitelisted(executor.id)) return;
    if (oldGuild.name !== newGuild.name && config.antinuke.protection.serverName) {
        await newGuild.setName(oldGuild.name).catch(() => null);
        await punish(newGuild, executor, 'Server name changed without permission');
    }
    if (oldGuild.icon !== newGuild.icon && config.antinuke.protection.serverIcon) {
        await newGuild.setIcon(oldGuild.iconURL()).catch(() => null);
        await punish(newGuild, executor, 'Server icon changed without permission');
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (message.mentions.everyone && !isWhitelisted(message.author.id) && message.author.id !== message.guild.ownerId) {
        await message.delete().catch(() => null);
    }
});

// ==============================================
// 🎙️ VOICEMASTER
// ==============================================

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!config.voicemaster.enabled) return;
    const user = newState.member?.user;
    const joinedChannel = newState.channel;
    const leftChannel = oldState.channel;
    if (leftChannel && voiceChannels.has(leftChannel.id) && leftChannel.members.size === 0) {
        await leftChannel.delete().catch(() => null);
        voiceChannels.delete(leftChannel.id);
    }
    if (!joinedChannel || !user) return;
    if (joinedChannel.name.toLowerCase() === 'panel') {
        const existing = Array.from(voiceChannels.entries()).find(([_, d]) => d.ownerId === user.id);
        if (existing) return await newState.setChannel(existing[0]).catch(() => null);
        const voiceChannel = await joinedChannel.guild.channels.create({
            name: user.username, type: ChannelType.GuildVoice, parent: joinedChannel.parent,
            permissionOverwrites: [{ id: user.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }]
        });
        voiceChannels.set(voiceChannel.id, { ownerId: user.id, ownerName: user.username });
        await newState.setChannel(voiceChannel).catch(() => null);
    }
});

// ==============================================
// ⌨️ COMANDOS — TODOS PUEDEN LIMPIAR AHORA
// ==============================================

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    // ========== 📸 AVATARES — TODOS PUEDEN VER Y LIMPIAR ==========
    if (cmd === 'avatars') {
        const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
        const target = await client.users.fetch(targetId).catch(() => null);
        if (!target) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        const history = avatarHistory.get(targetId) || [];
        if (history.length === 0) {
            return message.reply({ embeds: [createEmbed('Avatar History', `No avatar changes recorded for <@${targetId}> in the last ${config.historyRetentionDays} days.`)] });
        }
        const buffer = await generateAvatarCollage(target, history);
        const attachment = new AttachmentBuilder(buffer, { name: 'avatars.png' });
        const embed = createEmbed('Avatar History', `**User:** <@${targetId}>\n**Changes in last ${config.historyRetentionDays} days:** ${history.length}`).setImage('attachment://avatars.png');
        return message.reply({ embeds: [embed], files: [attachment] });
    }

    // ========== 🏷️ NOMBRES — TODOS PUEDEN VER ==========
    if (cmd === 'names') {
        const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
        const target = await client.users.fetch(targetId).catch(() => null);
        if (!target) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        const history = nameHistory.get(targetId) || [];
        if (history.length === 0) {
            return message.reply({ embeds: [createEmbed('Username History', `No username changes recorded for <@${targetId}> in the last ${config.historyRetentionDays} days.`)] });
        }
        const nameList = history.map((entry, i) => {
            const date = new Date(entry.timestamp).toLocaleDateString('es-MX');
            return `\`${i + 1}.\` **${entry.name}** — ${date}`;
        }).join('\n');
        return message.reply({ embeds: [createEmbed('Username History', `**User:** <@${targetId}>\n**Changes in last ${config.historyRetentionDays} days:** ${history.length}\n\n${nameList}`)] });
    }

    // ========== 🧹 CLEAR AVATARS — TODOS PUEDEN USARLO ✅ ==========
    if (cmd === 'clear' && args[0]?.toLowerCase() === 'avatars') {
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}clear avatars @User\``)] });
        avatarHistory.delete(targetId);
        return message.reply({ embeds: [createEmbed('History Cleared', `Avatar history cleared for <@${targetId}>.`, '#57F287')] });
    }

    // ========== 🧹 CLEAR NAMES — TODOS PUEDEN USARLO ✅ ==========
    if (cmd === 'clear' && args[0]?.toLowerCase() === 'names') {
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}clear names @User\``)] });
        nameHistory.delete(targetId);
        return message.reply({ embeds: [createEmbed('History Cleared', `Username history cleared for <@${targetId}>.`, '#57F287')] });
    }

    // ========== 🔧 ANTINUKE CONFIG — SOLO DUEÑO ==========
    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'config') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can configure antinuke.', '#ED4245')] });
        }
        const embed = createEmbed('Antinuke Configuration', 'Only the server owner can modify these settings.')
            .addFields(
                { name: 'Status', value: config.antinuke.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Bans', value: config.antinuke.protection.bans ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Kicks', value: config.antinuke.protection.kicks ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Channels', value: config.antinuke.protection.channels ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Roles', value: config.antinuke.protection.roles ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Limits', value: `Bans: ${config.antinuke.limits.bansPerMinute}/min\nKicks: ${config.antinuke.limits.kicksPerMinute}/min` },
                { name: 'Commands', value: `\`${config.prefix}an enable\` — Toggle\n\`${config.prefix}an wl add <id>\` — Whitelist\n\`${config.prefix}an admin add <id>\` — Add admin` }
            );
        return message.reply({ embeds: [embed] });
    }

    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'enable') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can modify this setting.', '#ED4245')] });
        }
        config.antinuke.enabled = !config.antinuke.enabled;
        return message.reply({ embeds: [createEmbed('Antinuke Updated', `Antinuke protection has been ${config.antinuke.enabled ? '**enabled**' : '**disabled**'}.`, '#57F287')] });
    }

    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'wl') {
        if (!isOwner(message.author.id, message.guild)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can manage whitelist.', '#ED4245')] });
        const action = args[1]?.toLowerCase();
        const userId = args[2]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply({ embeds: [createEmbed('Error', 'Provide a valid user ID.', '#ED4245')] });
        if (action === 'add') { whitelist.add(userId); return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> added to whitelist.`, '#57F287')] }); }
        if (action === 'remove') { whitelist.delete(userId); return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> removed from whitelist.`, '#FEE75C')] }); }
    }

    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'admin') {
        if (!isOwner(message.author.id, message.guild)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can manage antinuke admins.', '#ED4245')] });
        const action = args[1]?.toLowerCase();
        const userId = args[2]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply({ embeds: [createEmbed('Error', 'Provide a valid user ID.', '#ED4245')] });
        if (action === 'add') { antinukeAdmins.add(userId); return message.reply({ embeds: [createEmbed('Admin Updated', `<@${userId}> is now an antinuke admin.`, '#57F287')] }); }
        if (action === 'remove') { antinukeAdmins.delete(userId); return message.reply({ embeds: [createEmbed('Admin Updated', `<@${userId}> is no longer an antinuke admin.`, '#FEE75C')] }); }
    }

    // ========== 🎙️ VOICEMASTER ==========
    if (cmd === 'vc' && args[0]?.toLowerCase() === 'master') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        const existing = message.guild.channels.cache.find(c => c.name.toLowerCase() === 'panel' && c.type === ChannelType.GuildVoice);
        if (existing) return message.reply({ embeds: [createEmbed('VoiceMaster', `Panel already exists: <#${existing.id}>`)] });
        const panel = await message.guild.channels.create({ name: 'panel', type: ChannelType.GuildVoice });
        return message.reply({ embeds: [createEmbed('VoiceMaster', `Panel created: <#${panel.id}>`, '#57F287')] });
    }

    // ========== 🎭 ROLES ==========
    if (cmd === 'roles') {
        const allRoles = message.guild.roles.cache.filter(r => r.id !== message.guild.id).sort((a, b) => b.position - a.position).map(r => `@${r.name} (${r.id})`);
        const totalPages = Math.ceil(allRoles.length / config.rolesPerPage);
        let page = 1;
        const generatePage = (p) => {
            const start = (p - 1) * config.rolesPerPage;
            const end = start + config.rolesPerPage;
            const list = allRoles.slice(start, end).join('\n');
            const embed = createEmbed('Roles', list).setFooter({ text: `Page ${p}/${totalPages}` });
            const btns = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(p === 1),
                new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(p === totalPages),
                new ButtonBuilder().setCustomId('close').setLabel('✕').setStyle(ButtonStyle.Danger)
            );
            return { embeds: [embed], components: [btns] };
        };
        const rolesMsg = await message.reply(generatePage(page));
        const collector = rolesMsg.createMessageComponentCollector({ time: 300000 });
        collector.on('collect', async i => {
            if (i.user.id !== message.author.id) return;
            if (i.customId === 'prev' && page > 1) page--;
            if (i.customId === 'next' && page < totalPages) page++;
            if (i.customId === 'close') { await rolesMsg.delete(); return; }
            await i.update(generatePage(page));
        });
        return;
    }

    // ========== 🔨 MODERACIÓN ==========
    if (cmd === 'clear' || cmd === 'c') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        const amount = parseInt(args[0]) || 5;
        if (amount < 1 || amount > 100) return message.reply({ embeds: [createEmbed('Error', 'Use 1-100 messages.', '#ED4245')] });
        await message.delete().catch(() => null);
        const messages = await message.channel.bulkDelete(amount, true).catch(() => null);
        return message.reply({ embeds: [createEmbed('Messages Cleared', `${messages?.size || 0} messages deleted.`, '#57F287')] });
    }

    if (cmd === 'ban' || cmd === 'hb') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        const targetId = args[0]?.replace(/[<@!>]/g, '');
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}ban @User [reason]\``)] });
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        await member.ban({ reason: args.slice(1).join(' ') || 'No reason' });
        return message.reply({ embeds: [createEmbed('User Banned', `<@${targetId}> has been banned.`, '#ED4245')] });
    }

    if (cmd === 'lock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        return message.reply({ embeds: [createEmbed('Channel Locked', 'This channel has been locked.', '#ED4245')] });
    }

    if (cmd === 'unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true });
        return message.reply({ embeds: [createEmbed('Channel Unlocked', 'This channel has been unlocked.', '#57F287')] });
    }

    // ========== 📋 HELP ==========
    if (cmd === 'help' || cmd === 'cmd') {
        const embed = createEmbed('Commands', `Prefix: \`${config.prefix}\``)
            .addFields(
                { name: 'Avatar & Name History', value: `\`${config.prefix}avatars [@User]\` — Show avatar collage\n\`${config.prefix}names [@User]\` — Show username history\n\`${config.prefix}clear avatars @User\` — Clear avatar history ✅ (Anyone)\n\`${config.prefix}clear names @User\` — Clear name history ✅ (Anyone)` },
                { name: 'Antinuke (Owner Only 👑)', value: `\`${config.prefix}an config\` — Panel\n\`${config.prefix}an enable\` — Toggle\n\`${config.prefix}an wl add/remove <id>\` — Whitelist` },
                { name: 'Moderation', value: `\`${config.prefix}c <amount>\` — Clear messages\n\`${config.prefix}ban @User\` — Ban\n\`${config.prefix}lock/unlock\` — Channel lock` }
            );
        return message.reply({ embeds: [embed] });
    }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
    .then(() => console.log('Bot Online — Full System Active'))
    .catch(err => console.log(`Login Error: ${err.message}`));
