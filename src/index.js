require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const http = require('http');
const chalk = require('chalk');

// ========== CARGAR CONFIGURACIÓN (RENDER VARIABLES) ==========
let config;
if (!process.env.CONFIG_JSON) {
    console.error(chalk.red('[ERROR] CONFIG_JSON no configurado. Ve a Render Dashboard y agrega una variable de entorno llamada "CONFIG_JSON".'));
    process.exit(1);
}
try {
    config = JSON.parse(process.env.CONFIG_JSON);
} catch (e) {
    console.error(chalk.red('[ERROR] El formato del JSON en CONFIG_JSON es inválido.'));
    process.exit(1);
}

// ========== CLIENTE DISCORD ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ========== LOGGER ==========
const logger = {
    info: (msg) => console.log(chalk.blue(`[INFO] ${msg}`)),
    warn: (msg) => console.log(chalk.yellow(`[WARN] ${msg}`)),
    error: (msg) => console.log(chalk.red(`[ERROR] ${msg}`)),
    success: (msg) => console.log(chalk.green(`[SUCCESS] ${msg}`))
};

// ========== SISTEMA ANTINUKE ==========
const antinuke = {
    kicks: new Map(),
    bans: new Map(),
    channelDeletes: new Map(),

    async punishOffenders(guild, action, client) {
        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL);
        if (!logChannel) return logger.error('Canal de logs no encontrado.');

        for (const [memberId, member] of guild.members.cache) {
            if (member.user.bot) continue;
            if (member.roles.cache.some(role => config.antinuke.whitelistedRoles.includes(role.id))) continue;

            try {
                if (action === 'kick') await member.kick({ reason: 'AntiNuke: Exceso de kicks' });
                if (action === 'ban') await member.ban({ reason: 'AntiNuke: Exceso de bans' });
                if (action === 'channel') await member.ban({ reason: 'AntiNuke: Exceso de eliminaciones de canales' });
            } catch (err) {
                logger.error(`Error al sancionar a ${member.user.tag}: ${err.message}`);
            }
        }
        await logChannel.send(`[SYSTEM] AntiNuke activado en ${guild.name} por ${action} excesivo.`);
    },

    checkLimits(guild, type) {
        const now = Date.now();
        const cooldown = 60000;

        if (!this[type].has(guild.id)) {
            this[type].set(guild.id, { count: 0, lastReset: now });
        }

        const data = this[type].get(guild.id);
        if (now - data.lastReset > cooldown) {
            data.count = 0;
            data.lastReset = now;
        }

        data.count++;
        this[type].set(guild.id, data);

        return data.count > config.antinuke[`max${type.charAt(0).toUpperCase() + type.slice(1)}PerMinute`];
    }
};

// ========== EVENTOS ==========
client.on('ready', () => {
    logger.success(`Bot conectado como ${client.user.tag}`);
    client.user.setActivity('Bleed Bot | v5.2', { type: 'WATCHING' });
});

client.on('guildMemberRemove', async (member) => {
    if (antinuke.checkLimits(member.guild, 'kicks')) {
        await antinuke.punishOffenders(member.guild, 'kick', client);
    }
});

client.on('guildBanAdd', async (ban) => {
    if (antinuke.checkLimits(ban.guild, 'bans')) {
        await antinuke.punishOffenders(ban.guild, 'ban', client);
    }
});

client.on('channelDelete', async (channel) => {
    if (antinuke.checkLimits(channel.guild, 'channelDeletes')) {
        await antinuke.punishOffenders(channel.guild, 'channel', client);
    }
});

// ========== ROLES POR REACCIONES ==========
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (reaction.message.id !== config.reactionRoles.messageId) return;
    const roleId = config.reactionRoles.roles[reaction.emoji.name];
    if (!roleId) return;

    const member = reaction.message.guild.members.cache.get(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);

    if (member && role) {
        await member.roles.add(role);
        logger.info(`Role ${role.name} assigned to ${member.user.tag}`);
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    if (reaction.message.id !== config.reactionRoles.messageId) return;
    const roleId = config.reactionRoles.roles[reaction.emoji.name];
    if (!roleId) return;

    const member = reaction.message.guild.members.cache.get(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);

    if (member && role) {
        await member.roles.remove(role);
        logger.info(`Role ${role.name} removed from ${member.user.tag}`);
    }
});

// ========== SERVIDOR HTTP ==========
const server = http.createServer((req, res) => {
    res.writeHead(200).end('Bleed Bot is Running');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`HTTP Server listening on port ${PORT}`);
    client.login(process.env.TOKEN).catch(err => {
        logger.error(`Login Failed: ${err.message}`);
        process.exit(1);
    });
});
