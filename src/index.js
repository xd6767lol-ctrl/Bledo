require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder } = require('discord.js');
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
        punishment: 'remove_roles'
    }
};

const whitelist = new Set();
const roleOwners = new Set();
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
    return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: 'Made by chingones' }).setTimestamp();
}
function isOwner(userId, guild) { return userId === guild.ownerId; }
function isRoleOwner(userId, guild) { return isOwner(userId, guild) || roleOwners.has(userId); }

async function punishExecutor(member, reason) {
    if (!member || isOwner(member.id, member.guild)) return;
    const roles = member.roles.cache.filter(r => r.id !== member.guild.id);
    if (roles.size > 0) await member.roles.remove(roles, reason).catch(() => null);
    console.log(`[ROLE PROTECTION] ${member.user.tag} — ${reason} — Roles removed`);
}

client.on('ready', () => console.log(`Logged in as ${client.user.tag}`));

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
        
        const executorMember = await newMember.guild.members.fetch(executor.id).catch(() => null);
        if (executorMember) await punishExecutor(executorMember, 'Modified roles manually without whitelist');
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild || !message.content.startsWith(config.prefix)) return;
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
                if (roleOwners.size === 0) return message.reply({ embeds: [createEmbed('Role Whitelist', 'No users in whitelist.', 0x99AAB5)] });
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
        if (args.length < 2) return message.reply({ embeds: [createEmbed('Usage', `\`${config.prefix}r <@User/ID> <Role Name/ID>\``)] });
        const targetId = args[0].replace(/[<@!>]/g, '');
        const roleQuery = args.slice(1).join(' ');
        const member = await message.guild.members.fetch(targetId).catch(() => null);
        if (!member) return message.reply({ embeds: [createEmbed('Error', 'User not found.', '#ED4245')] });
        let role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleQuery.toLowerCase() || r.id === roleQuery.replace(/[<@&>]/g, ''));
        if (!role) return message.reply({ embeds: [createEmbed('Error', 'Role not found.', '#ED4245')] });
        const rolesArray = [...message.guild.roles.cache.sort((a, b) => b.position - a.position).values()];
        if (rolesArray.findIndex(r => r.id === role.id) === 1) {
            return message.reply({ embeds: [createEmbed('Restricted', 'Role 2 can only be assigned manually.', '#ED4245')] });
        }
        if (role.position >= message.member.roles.highest.position && !isOwner(message.author.id, message.guild)) {
            return message.reply({ embeds: [createEmbed('Error', 'You cannot assign a role higher than your own.', '#ED4245')] });
        }
        await member.roles.add(role).catch(err => {
            return message.reply({ embeds: [createEmbed('Error', `Failed to assign role: ${err.message}`, '#ED4245')] });
        });
        return message.reply({ embeds: [createEmbed('Role Assigned', `Successfully assigned **${role.name}** to ${member.user}.`, '#57F287')] });
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
        return message.reply({ embeds: [createEmbed('Commands', `Prefix: \`${config.prefix}\``)
            .addFields(
                { name: 'Roles', value: `\`${config.prefix}r <@User/ID> <Role>\` — Assign role (Role 2 only manual)\n\`${config.prefix}wl own @User/ID\` — Toggle manual role permission (Owner only)\n\`${config.prefix}wl own list\` — View whitelist (Owner only)\n\`${config.prefix}roles\` — List all server roles` }
            )
        ]});
    }
});

client.login(process.env.TOKEN).catch(err => console.log(`Login Error: ${err.message}`));
