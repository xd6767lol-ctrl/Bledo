require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const http = require('http');
const chalk = require('chalk');

// ========== VALIDACIÓN DE ARCHIVOS ==========
if (!fs.existsSync('./config.json')) {
    console.error(chalk.red('[ERROR] config.json no encontrado. Crea el archivo en la raíz del repositorio.'));
    process.exit(1);
}

if (!process.env.TOKEN) {
    console.error(chalk.red('[ERROR] TOKEN no configurado en .env.'));
    process.exit(1);
}

// ========== CONFIGURACIÓN ==========
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

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

// ========== LOGGER PROFESIONAL ==========
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
        const cooldown = 60000; // 1 minuto

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
    if (r
