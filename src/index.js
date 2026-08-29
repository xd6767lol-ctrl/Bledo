require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// 🌐 Servidor Web — Mantener activo 24/7
app.get('/', (req, res) => res.send('System Online — Bleed Style'));
app.listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT} — Service Running`));

// ⚙️ CONFIGURACIÓN COMPLETA — ESTILO BLEED
const config = {
    prefix: ',',
    rolesPerPage: 10,
    antinuke: {
        enabled: true,
        protection: {
            bans: true,
            kicks: true,
            channels: true,
            roles: true,
            webhooks: true,
            serverName: true,
            serverIcon: true,
            permissions: true
        },
        limits: {
            bansPerMinute: 3,
            kicksPerMinute: 5,
            channelsPerMinute: 3,
            rolesPerMinute: 3
        },
        punishment: 'remove_roles' // remove_roles | ban | kick | none
    },
    voicemaster: {
        enabled: true,
        defaultLimit: 0,
        categoryName: 'Voice Channels'
    },
    moderation: {
        logChannel: null,
        autoDeleteCmd: false
    }
};

// 📦 ALMACENAMIENTO
const voiceChannels = new Map(); // canalId → { ownerId, ownerName }
const antinukeCounters = new Map();
const whitelist = new Set(); // userId
const antinukeAdmins = new Set(); // userId
const protectedRoles = new Set(); // roleId
const deletedMessages = new Map(); // canalId → mensajes borrados

// 🤖 CLIENTE DISCORD
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// 🛠️ UTILIDADES
function createEmbed(title, description, color = '#2B2D31') {
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
}

function isOwner(userId, guild) {
    return userId === guild.ownerId;
}

function isWhitelisted(userId) {
    return whitelist.has(userId);
}

function isAntinukeAdmin(userId) {
    return antinukeAdmins.has(userId);
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

// 📡 EVENTO: BOT LISTO
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity({ type: 3, name: 'for unauthorized activity' });
});

// ==============================================
// 🛡️ SISTEMA ANTINUKE — PROTECCIÓN CONTRA ATAQUES
// ==============================================

// Protección: Baneos masivos
client.on('guildBanAdd', async ban => {
    if (!config.antinuke.enabled) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === ban.guild.ownerId || isWhitelisted(executor.id)) return;
    const exceeded = trackAction(executor.id, 'bans', config.antinuke.limits.bansPerMinute);
    if (exceeded) await punish(ban.guild, executor, 'Exceeded ban limit');
});

// Protección: Expulsiones masivas
client.on('guildMemberRemove', async member => {
    if (!config.antinuke.enabled) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    const executor = entry.executor;
    if (!executor || executor.bot) return;
    if (executor.id === member.guild.ownerId || isWhitelisted(executor.id)) return;
    const exceeded = trackAction(executor.id, 'kicks', config.antinuke.limits.kicksPerMinute);
    if (exceeded) await punish(member.guild, executor, 'Exceeded kick limit');
});

// Protección: Creación de canales
client.on('channelCreate', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === channel.guild.ownerId || isWhitelisted(executor.id)) return;
    const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
    if (exceeded) {
        await punish(channel.guild, executor, 'Exceeded channel creation limit');
        await channel.delete().catch(() => null);
    }
});

// Protección: Eliminación de canales
client.on('channelDelete', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === channel.guild.ownerId || isWhitelisted(executor.id)) return;
    const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
    if (exceeded) await punish(channel.guild, executor, 'Exceeded channel delete limit');
});

// Protección: Creación de roles
client.on('roleCreate', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === role.guild.ownerId || isWhitelisted(executor.id)) return;
    const exceeded = trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute);
    if (exceeded) {
        await punish(role.guild, executor, 'Exceeded role creation limit');
        await role.delete().catch(() => null);
    }
});

// Protección: Eliminación de roles
client.on('roleDelete', async role => {
    if (!config.antinuke.enabled) return;
    if (protectedRoles.has(role.id)) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === role.guild.ownerId || isWhitelisted(executor.id)) return;
    await punish(role.guild, executor, 'Role deletion without permission');
});

// Protección: Cambios en el servidor (nombre, ícono)
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!config.antinuke.enabled) return;
    const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot) return;
    if (executor.id === newGuild.ownerId || isWhitelisted(executor.id)) return;

    if (oldGuild.name !== newGuild.name && config.antinuke.protection.serverName) {
        await newGuild.setName(oldGuild.name).catch(() => null);
        await punish(newGuild, executor, 'Server name changed without permission');
    }
    if (oldGuild.icon !== newGuild.icon && config.antinuke.protection.serverIcon) {
        await newGuild.setIcon(oldGuild.iconURL()).catch(() => null);
        await punish(newGuild, executor, 'Server icon changed without permission');
    }
});

// Protección: @everyone / @here
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (message.mentions.everyone && !isWhitelisted(message.author.id) && message.author.id !== message.guild.ownerId) {
        await message.delete().catch(() => null);
    }
});

// ==============================================
// 🎙️ SISTEMA VOICEMASTER — CANALES DE VOZ AUTOMÁTICOS
// ==============================================

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!config.voicemaster.enabled) return;
    const user = newState.member?.user;
    const joinedChannel = newState.channel;
    const leftChannel = oldState.channel;

    // Eliminar canal vacío
    if (leftChannel && voiceChannels.has(leftChannel.id)) {
        if (leftChannel.members.size === 0) {
            await leftChannel.delete().catch(() => null);
            voiceChannels.delete(leftChannel.id);
        }
    }

    if (!joinedChannel || !user) return;

    // Crear canal personal al entrar al panel
    if (joinedChannel.name.toLowerCase() === 'panel') {
        const existing = Array.from(voiceChannels.entries()).find(([_, data]) => data.ownerId === user.id);
        if (existing) {
            await newState.setChannel(existing[0]).catch(() => null);
            return;
        }

        const voiceChannel = await joinedChannel.guild.channels.create({
            name: user.username,
            type: ChannelType.GuildVoice,
            parent: joinedChannel.parent,
            userLimit: config.voicemaster.defaultLimit,
            permissionOverwrites: [
                { id: user.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
                { id: joinedChannel.guild.id, allow: [PermissionFlagsBits.Connect] }
            ]
        });

        voiceChannels.set(voiceChannel.id, { ownerId: user.id, ownerName: user.username });
        await newState.setChannel(voiceChannel).catch(() => null);

        // Mensaje de control con botones — Estilo Bleed
        const controlEmbed = createEmbed('VoiceMaster Interface', 
            'Use the buttons below to control your voice channel.\n\n' +
            '🔒 Lock — Prevent new members from joining\n' +
            '🔓 Unlock — Allow new members to join\n' +
            '👁️‍🗨️ Ghost — Hide the channel\n' +
            '👁️ Reveal — Show the channel\n' +
            '🎙️ Claim — Take ownership\n' +
            '🔌 Disconnect — Remove a member\n' +
            '➕ Increase — Increase user limit\n' +
            '➖ Decrease — Decrease user limit');

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vc_lock').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_unlock').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_ghost').setEmoji('👁️‍🗨️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_reveal').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_claim').setEmoji('🎙️').setStyle(ButtonStyle.Secondary)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vc_disconnect').setEmoji('🔌').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_plus').setEmoji('➕').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vc_minus').setEmoji('➖').setStyle(ButtonStyle.Secondary)
        );

        await voiceChannel.send({ embeds: [controlEmbed], components: [row1, row2] }).catch(() => null);
    }
});

// 🎛️ BOTONES DE VOICEMASTER
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const channel = interaction.channel;
    if (!voiceChannels.has(channel.id)) return;
    const data = voiceChannels.get(channel.id);
    const isOwner = interaction.user.id === data.ownerId;
    const isAdmin = isAntinukeAdmin(interaction.user.id) || interaction.user.id === interaction.guild.ownerId;

    if (!isOwner && !isAdmin) {
        return interaction.reply({ embeds: [createEmbed('Access Denied', 'You do not own this channel.', '#ED4245')], ephemeral: true });
    }

    switch (interaction.customId) {
        case 'vc_lock':
            await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: false });
            await interaction.reply({ content: 'Channel locked.', ephemeral: true });
            break;
        case 'vc_unlock':
            await channel.permissionOverwrites.edit(interaction.guild.id, { Connect: true });
            await interaction.reply({ content: 'Channel unlocked.', ephemeral: true });
            break;
        case 'vc_ghost':
            await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: false });
            await interaction.reply({ content: 'Channel hidden.', ephemeral: true });
            break;
        case 'vc_reveal':
            await channel.permissionOverwrites.edit(interaction.guild.id, { ViewChannel: true });
            await interaction.reply({ content: 'Channel visible.', ephemeral: true });
            break;
        case 'vc_claim':
            data.ownerId = interaction.user.id;
            voiceChannels.set(channel.id, data);
            await channel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: true, Connect: true });
            await interaction.reply({ content: 'Ownership transferred.', ephemeral: true });
            break;
        case 'vc_plus':
            await channel.setUserLimit(Math.min(channel.userLimit + 1, 99)).catch(() => null);
            await interaction.reply({ content: `User limit: ${channel.userLimit}`, ephemeral: true });
            break;
        case 'vc_minus':
            await channel.setUserLimit(Math.max(channel.userLimit - 1, 0)).catch(() => null);
            await interaction.reply({ content: `User limit: ${Math.max(channel.userLimit - 1, 0)}`, ephemeral: true });
            break;
        case 'vc_disconnect':
            await interaction.reply({ content: 'Use the command ,disconnect @user in chat.', ephemeral: true });
            break;
    }
});

// ==============================================
// ⌨️ COMANDOS — TODOS LOS SISTEMAS
// ==============================================

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    // ========== 🔧 CONFIGURACIÓN — SOLO DUEÑO ==========
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
                { name: 'Server', value: config.antinuke.protection.serverName ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Limits', value: `Bans: ${config.antinuke.limits.bansPerMinute}/min\nKicks: ${config.antinuke.limits.kicksPerMinute}/min\nChannels: ${config.antinuke.limits.channelsPerMinute}/min\nRoles: ${config.antinuke.limits.rolesPerMinute}/min` },
                { name: 'Punishment', value: config.antinuke.punishment },
                { name: 'Commands', value: `\`${config.prefix}an enable\` — Toggle antinuke\n\`${config.prefix}an wl add <id>\` — Whitelist\n\`${config.prefix}an wl remove <id>\` — Remove whitelist\n\`${config.prefix}an admin add <id>\` — Add admin\n\`${config.prefix}an admin remove <id>\` — Remove admin` }
            );
        return message.reply({ embeds: [embed] });
    }

    // ,an enable — SOLO DUEÑO
    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'enable') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can modify this setting.', '#ED4245')] });
        }
        config.antinuke.enabled = !config.antinuke.enabled;
        return message.reply({ embeds: [createEmbed('Antinuke Updated', `Antinuke protection has been ${config.antinuke.enabled ? '**enabled**' : '**disabled**'}.`, '#57F287')] });
    }

    // ,an wl add / remove — SOLO DUEÑO
    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'wl') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can manage whitelist.', '#ED4245')] });
        }
        const action = args[1]?.toLowerCase();
        const userId = args[2]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply({ embeds: [createEmbed('Error', 'Provide a valid user ID.', '#ED4245')] });
        
        if (action === 'add') {
            whitelist.add(userId);
            return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> added to whitelist.`, '#57F287')] });
        }
        if (action === 'remove') {
            whitelist.delete(userId);
            return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> removed from whitelist.`, '#FEE75C')] });
        }
    }

    // ,an admin add / remove — SOLO DUEÑO
    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'admin') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can manage antinuke admins.', '#ED4245')] });
        }
        const action = args[1]?.toLowerCase();
        const userId = args[2]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply({ embeds: [createEmbed('Error', 'Provide a valid user ID.', '#ED4245')] });
        
        if (action === 'add') {
            antinukeAdmins.add(userId);
            return message.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is now an antinuke admin.`, '#57F287')] });
        }
        if (action === 'remove') {
            antinukeAdmins.delete(userId);
            return message.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is no longer an antinuke admin.`, '#FEE75C')] });
        }
    }

    // ========== 🎙️ VOICEMASTER ==========
    if (cmd === 'vc' && args[0]?.toLowerCase() === 'master') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const existing = message.guild.channels.cache.find(c => c.name.toLowerCase() === 'panel' && c.type === ChannelType.GuildVoice);
        if (existing) return message.reply({ embeds: [createEmbed('VoiceMaster', `Panel already exists: <#${existing.id}>`)] });
        const panel = await message.guild.channels.create({ name: 'panel', type: ChannelType.GuildVoice });
        return message.reply({ embeds: [createEmbed('VoiceMaster', `Panel created: <#${panel.id}>\nUsers will get a personal channel when joining.`, '#57F287')] });
    }

    // ========== 🎭 GESTIÓN DE ROLES ==========
    if (cmd === 'roles') {
        const allRoles = message.guild.roles.cache
            .filter(r => r.id !== message.guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => `@${r.name} (${r.id})`);
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

    // ,r add — Dar rol
    if (cmd === 'r' && args[0]?.toLowerCase() === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        const roleName = args.slice(2).join(' ');
        if (!targetId || !roleName) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}r add @User RoleName\``)] });
        const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) return message.reply({ embeds: [createEmbed('Error', 'Role not found.', '#ED4245')] });
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        await member.roles.add(role);
        return message.reply({ embeds: [createEmbed('Role Added', `**${role.name}** added to <@${targetId}>`, '#57F287')] });
    }

    // ,r remove — Quitar rol
    if (cmd === 'r' && args[0]?.toLowerCase() === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        const roleName = args.slice(2).join(' ');
        if (!targetId || !roleName) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}r remove @User RoleName\``)] });
        const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
        if (!role) return message.reply({ embeds: [createEmbed('Error', 'Role not found.', '#ED4245')] });
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        await member.roles.remove(role);
        return message.reply({ embeds: [createEmbed('Role Removed', `**${role.name}** removed from <@${targetId}>`, '#FEE75C')] });
    }

    // ========== 🔨 MODERACIÓN ==========
    // ,clear / ,c — Borrar mensajes
    if (cmd === 'clear' || cmd === 'c') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const amount = parseInt(args[0]) || 5;
        if (amount < 1 || amount > 100) return message.reply({ embeds: [createEmbed('Error', 'Use 1-100 messages.', '#ED4245')] });
        await message.delete().catch(() => null);
        const messages = await message.channel.bulkDelete(amount, true).catch(() => null);
        return message.reply({ embeds: [createEmbed('Messages Cleared', `${messages?.size || 0} messages deleted.`, '#57F287')], ephemeral: true });
    }

    // ,ban — Banear
    if (cmd === 'ban' || cmd === 'hb') {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const targetId = args[0]?.replace(/[<@!>]/g, '');
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}ban @User [reason]\``)] });
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        if (member.roles.highest.position >= message.member.roles.highest.position && !isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Error', 'Cannot ban a user with higher or equal role.', '#ED4245')] });
        }
        await member.ban({ reason });
        return message.reply({ embeds: [createEmbed('User Banned', `<@${targetId}> has been banned.\nReason: ${reason}`, '#ED4245')] });
    }

    // ,kick — Expulsar
    if (cmd === 'kick') {
        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        const targetId = args[0]?.replace(/[<@!>]/g, '');
        const reason = args.slice(1).join(' ') || 'No reason provided';
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}kick @User [reason]\``)] });
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        if (member.roles.highest.position >= message.member.roles.highest.position && !isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Error', 'Cannot kick a user with higher or equal role.', '#ED4245')] });
        }
        await member.kick(reason);
        return message.reply({ embeds: [createEmbed('User Kicked', `<@${targetId}> has been kicked.\nReason: ${reason}`, '#FEE75C')] });
    }

    // ,lock — Bloquear canal
    if (cmd === 'lock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        return message.reply({ embeds: [createEmbed('Channel Locked', 'This channel has been locked.', '#ED4245')] });
    }

    // ,unlock — Desbloquear canal
    if (cmd === 'unlock') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        }
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true });
        return message.reply({ embeds: [createEmbed('Channel Unlocked', 'This channel has been unlocked.', '#57F287')] });
    }

    // ========== 📋 HELP ==========
    if (cmd === 'help' || cmd === 'cmd') {
        const embed = createEmbed('Commands', `Prefix: \`${config.prefix}\``)
            .addFields(
                { name: 'Antinuke (Owner Only)', value: `\`${config.prefix}an config\` — View configuration\n\`${config.prefix}an enable\` — Toggle antinuke\n\`${config.prefix}an wl add <id>\` — Whitelist user\n\`${config.prefix}an admin add <id>\` — Add antinuke admin` },
                { name: 'VoiceMaster', value: `\`${config.prefix}vc master\` — Create voice panel` },
                { name: 'Roles', value: `\`${config.prefix}roles\` — List all roles\n\`${config.prefix}r add @User Role\` — Add role\n\`${config.prefix}r remove @User Role\` — Remove role` },
                { name: 'Moderation', value: `\`${config.prefix}c <amount>\` — Clear messages\n\`${config.prefix}ban @User [reason]\` — Ban user\n\`${config.prefix}kick @User [reason]\` — Kick user\n\`${config.prefix}lock\` — Lock channel\n\`${config.prefix}unlock\` — Unlock channel` }
            );
        return message.reply({ embeds: [embed] });
    }
});

// 🔑 INICIAR BOT
client.login(process.env.TOKEN)
    .then(() => console.log('Bot Online — Full Bleed System Active'))
    .catch(err => console.log(`Login Error: ${err.message}`));
