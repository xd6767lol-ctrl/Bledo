require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ChannelType } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// Web Server — Mantener activo
app.get('/', (req, res) => res.send('System Online'));
app.listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT} — Service Running`));

// Configuración
const config = {
    prefix: ',',
    ownerId: 'PON_AQUI_TU_ID',
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
        punishment: 'remove_roles',
        logChannel: null
    }
};

// Almacenamiento
const antinukeCounters = new Map();
const whitelist = new Set();
const antinukeAdmins = new Set();

// Cliente
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Utilidades
function isOwner(userId) { return userId === config.ownerId; }
function isWhitelisted(userId) { return whitelist.has(userId) || isOwner(userId); }
function isAntinukeAdmin(userId) { return antinukeAdmins.has(userId) || isOwner(userId); }

function createEmbed(title, description, color = '#2B2D31') {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

// Contador AntiNuke
function trackAction(userId, action, limit) {
    const now = Date.now();
    if (!antinukeCounters.has(userId)) antinukeCounters.set(userId, {});
    const userData = antinukeCounters.get(userId);
    if (!userData[action]) userData[action] = [];
    userData[action] = userData[action].filter(time => now - time < 60000);
    userData[action].push(now);
    return userData[action].length > limit;
}

// Evento: Ready
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity({ type: 3, name: 'for unauthorized activity' });
});

// Evento: Bans
client.on('guildBanAdd', async ban => {
    if (!config.antinuke.enabled) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'bans', config.antinuke.limits.bansPerMinute);
    if (exceeded) {
        await punish(ban.guild, executor, 'Exceeded ban limit');
    }
});

// Evento: Kicks
client.on('guildMemberRemove', async member => {
    if (!config.antinuke.enabled) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick });
    const entry = audit.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    const executor = entry.executor;
    if (isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'kicks', config.antinuke.limits.kicksPerMinute);
    if (exceeded) {
        await punish(member.guild, executor, 'Exceeded kick limit');
    }
});

// Evento: Canales
client.on('channelCreate', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
    if (exceeded) {
        await punish(channel.guild, executor, 'Exceeded channel creation limit');
        await channel.delete().catch(() => {});
    }
});

client.on('channelDelete', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute);
    if (exceeded) await punish(channel.guild, executor, 'Exceeded channel delete limit');
});

// Evento: Roles
client.on('roleCreate', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute);
    if (exceeded) {
        await punish(role.guild, executor, 'Exceeded role creation limit');
        await role.delete().catch(() => {});
    }
});

client.on('roleDelete', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    const exceeded = trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute);
    if (exceeded) await punish(role.guild, executor, 'Exceeded role delete limit');
});

// Evento: Servidor
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!config.antinuke.enabled) return;
    const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate });
    const executor = audit.entries.first()?.executor;
    if (!executor || isWhitelisted(executor.id)) return;
    
    if (oldGuild.name !== newGuild.name && config.antinuke.protection.serverName) {
        await newGuild.setName(oldGuild.name).catch(() => {});
        await punish(newGuild, executor, 'Server name changed without permission');
    }
    if (oldGuild.icon !== newGuild.icon && config.antinuke.protection.serverIcon) {
        await newGuild.setIcon(oldGuild.iconURL()).catch(() => {});
        await punish(newGuild, executor, 'Server icon changed without permission');
    }
});

// Sistema de Sanción
async function punish(guild, user, reason) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    
    if (config.antinuke.punishment === 'remove_roles') {
        const roles = member.roles.cache.filter(r => r.id !== guild.id);
        await member.roles.remove(roles, reason).catch(() => {});
    } else if (config.antinuke.punishment === 'ban') {
        await member.ban({ reason }).catch(() => {});
    }
    
    console.log(`[ANTINUKE] ${user.tag} — ${reason}`);
}

// Comandos
client.on('messageCreate', async message => {
    if (!message.content.startsWith(config.prefix) || message.author.bot) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // ,an config — Panel de configuración
    if (command === 'an' && args[0]?.toLowerCase() === 'config') {
        if (!isOwner(message.author.id)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can configure antinuke.', '#ED4245')] });
        }
        const embed = createEmbed('Antinuke Configuration', 'Use the commands below to configure protection.')
            .addFields(
                { name: 'Status', value: config.antinuke.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Bans', value: config.antinuke.protection.bans ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Kicks', value: config.antinuke.protection.kicks ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Channels', value: config.antinuke.protection.channels ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Roles', value: config.antinuke.protection.roles ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Server', value: config.antinuke.protection.serverName ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Limits', value: `Bans: ${config.antinuke.limits.bansPerMinute}/min\nKicks: ${config.antinuke.limits.kicksPerMinute}/min\nChannels: ${config.antinuke.limits.channelsPerMinute}/min\nRoles: ${config.antinuke.limits.rolesPerMinute}/min` },
                { name: 'Commands', value: `\`\`\`,an enable — Toggle antinuke\n,an bans — Toggle ban protection\n,an kicks — Toggle kick protection\n,an channels — Toggle channel protection\n,an roles — Toggle role protection\n,an wl add <id> — Add to whitelist\n,an wl remove <id> — Remove from whitelist\n,an admin add <id> — Add antinuke admin\n,an admin remove <id> — Remove antinuke admin\`\`\`` }
            );
        return message.reply({ embeds: [embed] });
    }

    // ,an enable — Activar/Desactivar
    if (command === 'an' && args[0]?.toLowerCase() === 'enable') {
        if (!isOwner(message.author.id)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the owner can modify this setting.', '#ED4245')] });
        config.antinuke.enabled = !config.antinuke.enabled;
        return message.reply({ embeds: [createEmbed('Antinuke Updated', `Antinuke protection has been ${config.antinuke.enabled ? '**enabled**' : '**disabled**'}.`, '#57F287')] });
    }

    // ,an wl add / remove
    if (command === 'an' && args[0]?.toLowerCase() === 'wl' && args[1]?.toLowerCase() === 'add') {
        if (!isAntinukeAdmin(message.author.id)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        const userId = args[2]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply({ embeds: [createEmbed('Error', 'Please provide a valid user ID.', '#ED4245')] });
        whitelist.add(userId);
        return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> has been added to the whitelist.`, '#57F287')] });
    }

    if (command === 'an' && args[0]?.toLowerCase() === 'wl' && args[1]?.toLowerCase() === 'remove') {
        if (!isAntinukeAdmin(message.author.id)) return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions.', '#ED4245')] });
        const userId = args[2]?.replace(/[<@!>]/g, '');
        whitelist.delete(userId);
        return message.reply({ embeds: [createEmbed('Whitelist Updated', `<@${userId}> has been removed from the whitelist.`, '#FEE75C')] });
    }

    // ,an admin add / remove
    if (command === 'an' && args[0]?.toLowerCase() === 'admin' && args[1]?.toLowerCase() === 'add') {
        if (!isOwner(message.author.id)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the owner can add antinuke admins.', '#ED4245')] });
        const userId = args[2]?.replace(/[<@!>]/g, '');
        antinukeAdmins.add(userId);
        return message.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is now an antinuke admin.`, '#57F287')] });
    }

    if (command === 'an' && args[0]?.toLowerCase() === 'admin' && args[1]?.toLowerCase() === 'remove') {
        if (!isOwner(message.author.id)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the owner can remove antinuke admins.', '#ED4245')] });
        const userId = args[2]?.replace(/[<@!>]/g, '');
        antinukeAdmins.delete(userId);
        return message.reply({ embeds: [createEmbed('Antinuke Admin Updated', `<@${userId}> is no longer an antinuke admin.`, '#FEE75C')] });
    }
});

// Login
client.login(process.env.TOKEN);
