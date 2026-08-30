require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('System Online — Bleed Style'));
app.listen(PORT, '0.0.0.0', () => console.log(`Port ${PORT} — Service Running`));

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

const voiceChannels = new Map();
const antinukeCounters = new Map();
const whitelist = new Set();
const roleOwners = new Set(); // Lista autorizados para roles manuales
const antinukeAdmins = new Set();
const avatarHistory = new Map();
const nameHistory = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember]
});

function createEmbed(title, description, color = '#2B2D31') {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: 'Made by chingones' })
        .setTimestamp();
}
function isOwner(userId, guild) { return userId === guild.ownerId; }
function isWhitelisted(userId) { return whitelist.has(userId); }
function isRoleOwner(userId, guild) { return isOwner(userId, guild) || roleOwners.has(userId); }
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

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    client.user.setActivity({ type: 3, name: 'for unauthorized activity' });
});

client.on('userUpdate', async (oldUser, newUser) => {
    if (oldUser.avatar !== newUser.avatar) {
        if (!avatarHistory.has(newUser.id)) avatarHistory.set(newUser.id, []);
        const history = avatarHistory.get(newUser.id);
        const cutoff = Date.now() - (config.historyRetentionDays * 24 * 60 * 60 * 1000);
        const lastEntry = history[history.length - 1];
        const newAvatarUrl = newUser.displayAvatarURL({ size: 512, dynamic: true });
        if (!lastEntry || lastEntry.url !== newAvatarUrl || Date.now() - lastEntry.timestamp > 5000) {
            history.push({ url: newAvatarUrl, timestamp: Date.now() });
            avatarHistory.set(newUser.id, history.filter(a => a.timestamp > cutoff));
        }
    }
    if (oldUser.username !== newUser.username) {
        if (!nameHistory.has(newUser.id)) nameHistory.set(newUser.id, []);
        const history = nameHistory.get(newUser.id);
        const cutoff = Date.now() - (config.historyRetentionDays * 24 * 60 * 60 * 1000);
        const lastEntry = history[history.length - 1];
        if (!lastEntry || lastEntry.name !== newUser.username || Date.now() - lastEntry.timestamp > 5000) {
            history.push({ name: newUser.username, timestamp: Date.now() });
            nameHistory.set(newUser.id, history.filter(n => n.timestamp > cutoff));
        }
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!config.antinuke.enabled) return;
    if (oldMember.roles.cache.size === newMember.roles.cache.size) return;
    const audit = await newMember.guild.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberRoleUpdate }).catch(() => null);
    if (!audit) return;
    const entry = audit.entries.find(e => e.target.id === newMember.id && e.createdTimestamp > Date.now() - 5000);
    if (!entry) return;
    const executor = entry.executor;
    if (!executor || executor.bot || isRoleOwner(executor.id, newMember.guild)) return;
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (addedRoles.size > 0 || removedRoles.size > 0) {
        for (const [roleId] of addedRoles) await newMember.roles.remove(roleId).catch(() => null);
        for (const [roleId] of removedRoles) await newMember.roles.add(roleId).catch(() => null);
        await punish(newMember.guild, executor, 'Role modified manually without permission');
    }
});

client.on('guildBanAdd', async ban => {
    if (!config.antinuke.enabled) return;
    const audit = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'bans', config.antinuke.limits.bansPerMinute)) await punish(ban.guild, executor, 'Exceeded ban limit');
});

client.on('guildMemberRemove', async member => {
    if (!config.antinuke.enabled) return;
    const audit = await member.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry || entry.target.id !== member.id) return;
    const executor = entry.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'kicks', config.antinuke.limits.kicksPerMinute)) await punish(member.guild, executor, 'Exceeded kick limit');
});

client.on('channelCreate', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute)) {
        await punish(channel.guild, executor, 'Exceeded channel creation limit');
        await channel.delete().catch(() => null);
    }
});

client.on('channelDelete', async channel => {
    if (!config.antinuke.enabled) return;
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'channels', config.antinuke.limits.channelsPerMinute)) await punish(channel.guild, executor, 'Exceeded channel delete limit');
});

client.on('roleCreate', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    if (trackAction(executor.id, 'roles', config.antinuke.limits.rolesPerMinute)) {
        await punish(role.guild, executor, 'Exceeded role creation limit');
        await role.delete().catch(() => null);
    }
});

client.on('roleDelete', async role => {
    if (!config.antinuke.enabled) return;
    const audit = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
    await punish(role.guild, executor, 'Role deletion without permission');
});

client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (!config.antinuke.enabled) return;
    const audit = await newGuild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
    const executor = audit?.entries.first()?.executor;
    if (!executor || executor.bot || isWhitelisted(executor.id)) return;
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
    if (message.mentions.everyone && !isWhitelisted(message.author.id) && !isOwner(message.author.id, message.guild)) {
        await message.delete().catch(() => null);
        return;
    }
    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    if (cmd === 'wl') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can use this command.', '#ED4245')] });
        }
        const subCmd = args[0]?.toLowerCase();
        if (subCmd === 'own') {
            const target = args[1];
            if (!target) {
                return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}wl own @User/ID\` — Toggle role permission\n\`${config.prefix}wl own list\` — View list`, '#ED4245')] });
            }
            if (target.toLowerCase() === 'list') {
                if (roleOwners.size === 0) {
                    return message.reply({ embeds: [createEmbed('Role Whitelist', 'No users in whitelist.', 0x99AAB5)] });
                }
                const list = [...roleOwners].map(id => `<@${id}> — \`${id}\``).join('\n');
                return message.reply({ embeds: [createEmbed('Role Whitelist — Authorized Users', list, 0x5865F2)] });
            }
            const targetId = target.replace(/[<@!>]/g, '');
            if (roleOwners.has(targetId)) {
                roleOwners.delete(targetId);
                return message.reply({ embeds: [createEmbed('Role Whitelist Removed', `<@${targetId}> can no longer modify roles manually.`, '#FEE75C')] });
            } else {
                roleOwners.add(targetId);
                return message.reply({ embeds: [createEmbed('Role Whitelist Added', `<@${targetId}> can now modify roles manually.`, '#57F287')] });
            }
        }
        return;
    }

    if (cmd === 'r') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Insufficient permissions — Need Manage Roles.', '#ED4245')] });
        }
        if (args.length < 2) {
            return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}r <@User/ID> <Role Name/ID>\``)] });
        }
        const targetId = args[0].replace(/[<@!>]/g, '');
        const roleQuery = args.slice(1).join(' ');
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        let role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleQuery.toLowerCase() || r.id === roleQuery.replace(/[<@&>]/g, ''));
        if (!role) return message.reply({ embeds: [createEmbed('Error', 'Role not found.', '#ED4245')] });
        const rolesArray = [...message.guild.roles.cache.sort((a, b) => b.position - a.position).values()];
        const roleIndex = rolesArray.findIndex(r => r.id === role.id);
        if (roleIndex === 1) {
            return message.reply({ embeds: [createEmbed('Restricted', 'Role 2 can only be assigned manually.', '#ED4245')] });
        }
        if (role.position >= message.member.roles.highest.position && !isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Error', 'You cannot assign a role higher than your own.', '#ED4245')] });
        }
        if (role.position >= message.guild.members.me.roles.highest.position) {
            return message.reply({ embeds: [createEmbed('Error', 'I cannot assign this role — it is higher than my highest role.', '#ED4245')] });
        }
        await member.roles.add(role).catch(err => {
            return message.reply({ embeds: [createEmbed('Error', `Failed to assign role: ${err.message}`, '#ED4245')] });
        });
        return message.reply({ embeds: [createEmbed('Role Assigned', `Successfully assigned **${role.name}** to ${member.user}.`, '#57F287')] });
    }

    if (cmd === 'avatars') {
        const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
        const target = await client.users.fetch(targetId).catch(() => null);
        if (!target) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        const history = avatarHistory.get(targetId) || [];
        if (history.length === 0) {
            return message.reply({ embeds: [createEmbed('Avatar History', `No avatar changes recorded for <@${targetId}> in the last ${config.historyRetentionDays} days.`)] });
        }
        const embed = createEmbed('Avatar History', `**User:** <@${targetId}>\n**Changes in last ${config.historyRetentionDays} days:** ${history.length}`);
        embed.setImage(history[history.length - 1].url);
        return message.reply({ embeds: [embed] });
    }

    if (cmd === 'names') {
        const targetId = args[0]?.replace(/[<@!>]/g, '') || message.author.id;
        const target = await client.users.fetch(targetId).catch(() => null);
        if (!target) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        const history = nameHistory.get(targetId) || [];
        if (history.length === 0) {
            return message.reply({ embeds: [createEmbed('Username History', `No username changes recorded for <@${targetId}> in the last ${config.historyRetentionDays} days.`)] });
        }
        const nameList = history.map((entry, i) => `\`${i + 1}.\` **${entry.name}**`).join('\n');
        return message.reply({ embeds: [createEmbed('Username History', `**User:** <@${targetId}>\n**Changes in last ${config.historyRetentionDays} days:** ${history.length}\n\n${nameList}`)] });
    }

    if (cmd === 'clear' && args[0]?.toLowerCase() === 'avatars') {
        if (!isOwner(message.author.id, message.guild)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can use this command.', '#ED4245')] });
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}clear avatars @User\``)] });
        avatarHistory.delete(targetId);
        return message.reply({ embeds: [createEmbed('History Cleared', `Avatar history cleared for <@${targetId}>.`, '#57F287')] });
    }

    if (cmd === 'clear' && args[0]?.toLowerCase() === 'names') {
        if (!isOwner(message.author.id, message.guild)) return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can use this command.', '#ED4245')] });
        const targetId = args[1]?.replace(/[<@!>]/g, '');
        if (!targetId) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}clear names @User\``)] });
        nameHistory.delete(targetId);
        return message.reply({ embeds: [createEmbed('History Cleared', `Username history cleared for <@${targetId}>.`, '#57F287')] });
    }

    if ((cmd === 'an' || cmd === 'antinuke') && args[0]?.toLowerCase() === 'config') {
        if (!isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Access Denied', 'Only the server owner can configure antinuke.', '#ED4245')] });
        }
        const embed = createEmbed('Antinuke Configuration', 'Only the server owner can modify these settings.')
            .addFields(
                { name: 'Status', value: config.antinuke.enabled ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Role Whitelist', value: `${roleOwners.size} users`, inline: true },
                { name: 'Limits', value: `Bans: ${config.antinuke.limits.bansPerMinute}/min\nKicks: ${config.antinuke.limits.kicksPerMinute}/min` },
                { name: 'Commands', value: `\`${config.prefix}wl own @User\` — Toggle role permission\n\`${config.prefix}wl own list\` — View list` }
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

    if (cmd === 'roles') {
        const allRoles = message.guild.roles.cache.filter(r => r.id !== message.guild.id).sort((a, b) => b.position - a.position).map((r, i) => `\`${i + 1}.\` ${r.name}`);
        const totalPages = Math.ceil(allRoles.length / config.rolesPerPage);
        let page = 1;
        const generatePage = (p) => {
            const start = (p - 1) * config.rolesPerPage;
            const end = start + config.rolesPerPage;
            const list = allRoles.slice(start, end).join('\n');
            return { embeds: [createEmbed(`Roles — Page ${p}/${totalPages}`, list).setFooter({ text: `Page ${p}/${totalPages} | Made by chingones` })] };
        };
        return message.reply(generatePage(page));
    }

    if (cmd === 'help' || cmd === 'cmd') {
        const embed = createEmbed('Commands', `Prefix: \`${config.prefix}\``)
            .addFields(
                { name: 'Roles', value: `\`${config.prefix}r <@User/ID> <Role>\` — Assign role (Role 2 only manual)\n\`${config.prefix}wl own @User/ID\` — Toggle manual role permission (Owner only)\n\`${config.prefix}wl own list\` — View whitelist (Owner only)\n\`${config.prefix}roles\` — List all server roles` },
                { name: 'Antinuke', value: `\`${config.prefix}an config\` — Panel\n\`${config.prefix}an enable\` — Toggle` }
            );
        return message.reply({ embeds: [embed] });
    }
});

client.login(process.env.TOKEN)
    .then(() => console.log('Bot Online — Full System Active'))
    .catch(err => console.log(`Login Error: ${err.message}`));
