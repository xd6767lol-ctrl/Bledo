require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField, 
    PermissionsFlagsBitField 
} = require('discord.js');

// ==========================================
// CONFIGURACIÓN Y BASE DE DATOS EN MEMORIA
// ==========================================
const config = {
    prefix: '!', // Prefijo para comandos de texto
    token: process.env.TOKEN,
    ownerId: process.env.OWNER_ID || 'TU_ID_AQUI', // Pon tu ID aquí si no está en env
    antinube: true,
    logChannelId: null, // Se setea auto si no está
    reactionMenu: {
        channelId: null, // ID del canal donde se publica el menú
        roleId1: null,
        roleId2: null
    }
};

// Base de datos en memoria (simulada)
const db = {
    settings: {}, // guildId -> { prefix, logChannelId, antinube }
    logs: [],
    reactions: {} // guildId -> { channelId, roles: [{id, emoji}] }
};

function getGuildSettings(guildId) {
    if (!db.settings[guildId]) {
        db.settings[guildId] = {
            prefix: config.prefix,
            logChannelId: null,
            antinuke: true,
            reactionMenu: null
        };
    }
    return db.settings[guildId];
}

// ==========================================
// CLIENTE DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers, // Necesario para antinuke
        GatewayIntentBits.MessageContent // Para leer contenido si es necesario
    ]
});

client.commands = new Collection();
client.cooldowns = new Map();

// ==========================================
// HELPER: LOGS
// ==========================================
async function sendLog(guild, embed) {
    const settings = getGuildSettings(guild.id);
    let channelId = settings.logChannelId;
    
    if (!channelId) {
        // Buscar canal de logs o crear uno si no existe
        const channel = guild.channels.cache.find(c => c.name.includes('logs') || c.name.includes('log'));
        if (channel) {
            channelId = channel.id;
            settings.logChannelId = channelId;
        }
    }

    if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.permissionsFor(guild.members.me).has('SendMessages')) {
            channel.send({ embeds: [embed] });
        }
    }
}

// ==========================================
// COMANDOS
// ==========================================

// 1. CONFIGURACIÓN
client.commands.set('setprefix', {
    name: 'setprefix',
    description: 'Configura el prefijo del bot',
    adminOnly: false,
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.channel.send('❌ Necesitas **Administrador**.');
        
        const prefix = args[0];
        if (!prefix) return message.channel.send('❌ Uso: `setprefix <prefijo>`');
        
        getGuildSettings(message.guild.id).prefix = prefix;
        message.channel.send(`✅ Prefijo cambiado a: \`${prefix}\``);
    }
});

client.commands.set('setlog', {
    name: 'setlog',
    description: 'Configura el canal de logs',
    adminOnly: false,
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.channel.send('❌ Necesitas **Administrador**.');
        
        getGuildSettings(message.guild.id).logChannelId = message.channel.id;
        message.channel.send('✅ Canal de logs configurado.');
    }
});

// 2. ROLES (BASICO)
client.commands.set('role', {
    name: 'role',
    description: 'Da o quita un rol',
    adminOnly: true,
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) 
            return message.channel.send('❌ Necesitas **Gestionar Roles**.');
        
        const member = message.mentions.members.first();
        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
        
        if (!member || !role) return message.channel.send('❌ Mención a usuario y rol: `!role @usuario @rol`');
        
        const action = args[0] === 'remover' || args[0] === 'remove' ? 'remove' : 'add';
        
        if (action === 'add') {
            await member.roles.add(role);
            message.channel.send(`✅ Rol ${role.name} añadido a ${member.user.tag}.`);
        } else {
            await member.roles.remove(role);
            message.channel.send(`✅ Rol ${role.name} quitado de ${member.user.tag}.`);
        }
    }
});

// 3. REACCIONES (MENÚ)
client.commands.set('reactionmenu', {
    name: 'reactionmenu',
    description: 'Crea un menú de reacciones',
    adminOnly: true,
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return message.channel.send('❌ Necesitas **Administrador**.');
        
        const role1 = message.mentions.roles.first();
        const role2 = message.mentions.roles.last();
        
        if (!role1 || !role2) return message.channel.send('❌ Uso: `!reactionmenu @rol1 @rol2`');

        const embed = new EmbedBuilder()
            .setTitle('📜 Menú de Reacciones')
            .setDescription('Reacciona para obtener tus roles:')
            .setColor('Blue');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`role_${role1.id}`)
                    .setLabel(role1.name)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`role_${role2.id}`)
                    .setLabel(role2.name)
                    .setStyle(ButtonStyle.Secondary)
            );

        const msg = await message.channel.send({ embeds: [embed], components: [row] });
        
        // Guardar en DB
        getGuildSettings(message.guild.id).reactionMenu = {
            channelId: msg.channel.id,
            messageId: msg.id,
            roles: [role1.id, role2.id]
        };

        message.channel.send('✅ Menú de reacciones creado.');
    }
});

// 4. ANTI NUKE (Lógica Completa)
const antiNukeEvents = [
    'GuildChannelUpdate',
    'GuildBanAdd',
    'GuildBanRemove',
    'GuildMemberUpdate',
    'GuildMemberRemove',
    'GuildMemberAdd',
    'RoleDelete',
    'ChannelDelete',
    'ChannelCreate'
];

// ==========================================
// EVENTOS
// ==========================================

client.once('ready', async () => {
    console.log(`✅ Bot conectado como: ${client.user.tag}`);
    client.user.setActivity('!help | Antinube ON', { type: 'WATCHING' });
    
    // Iniciar health check para render
    const express = require('express');
    const app = express();
    app.get('/', (req, res) => {
        res.send('OK');
    });
    app.listen(3000);
    console.log('🚀 Health check iniciado en puerto 3000');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const settings = getGuildSettings(message.guild.id);
    const prefix = settings.prefix || '!';
    
    if (!message.content.startsWith(prefix)) return;
    
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const command = client.commands.get(commandName);
    
    if (command) {
        // Verificar permisos
        if (command.adminOnly && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.channel.send('❌ Necesitas **Administrador** para este comando.');
        }
        
        // Cooldown simple
        const now = Date.now();
        const timestamps = client.cooldowns.get(command.name) || new Map();
        const cooldownAmount = 3; // 3 segundos
        
        if (timestamps.has(message.author.id)) {
            const expirationTime = timestamps.get(message.author.id) + cooldownAmount * 1000;
            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                return message.reply(`⏳ Espera ${timeLeft.toFixed(1)} segundos.`).then(msg => {
                    setTimeout(() => msg.delete().catch(() => {}), timeLeft * 1000);
                });
            }
        }
        
        timestamps.set(message.author.id, now);
        client.cooldowns.set(command.name, timestamps);
        
        command.execute(message, args);
    }
});

// ANTI NUKE LOGIC
client.on('GuildChannelCreate', async (channel) => {
    const settings = getGuildSettings(channel.guild.id);
    if (!settings.antinuke) return;
    
    const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: 'ChannelCreate' });
    const logEntry = auditLogs.entries.first();
    
    if (!logEntry) return;
    
    const creator = logEntry.executor;
    if (creator.id === config.ownerId || channel.guild.members.me.permissions.has(PermissionsBitField.Flags.Administrator)) return;
    
    // Si no tiene admin, borrar canal
    if (!creator.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await channel.delete();
        await sendLog(channel.guild, new EmbedBuilder()
            .setTitle('🚫 Canal Creado')
            .setDescription(`El canal ${channel.name} fue eliminado por no-admin.\nCreado por: ${creator.user.tag}`)
            .setColor('Red')
        );
    }
});

client.on('GuildChannelDelete', async (channel) => {
    const settings = getGuildSettings(channel.guild.id);
    if (!settings.antinuke) return;
    
    const auditLogs = await channel.guild.fetchAuditLogs({ limit: 1, type: 'ChannelDelete' });
    const logEntry = auditLogs.entries.first();
    
    if (!logEntry) return;
    
    const creator = logEntry.executor;
    if (creator.id === config.ownerId) return;
    
    // Restaurar canal
    try {
        const restored = await channel.guild.channels.create({
            name: channel.name,
            type: channel.type,
            parent: channel.parentId,
            position: channel.rawPosition
        });
        
        await sendLog(channel.guild, new EmbedBuilder()
            .setTitle('🔄 Canal Restaurado')
            .setDescription(`El canal ${channel.name} fue restaurado.\nEliminado por: ${creator.user.tag}`)
            .setColor('Green')
        );
    } catch (e) {
        console.error('Error restaurando canal:', e);
    }
});

client.on('GuildBanAdd', async (guild, user) => {
    const settings = getGuildSettings(guild.id);
    if (!settings.antinuke) return;
    
    const auditLogs = await guild.fetchAuditLogs({ limit: 1, type: 'MemberBanAdd' });
    const logEntry = auditLogs.entries.first();
    if (!logEntry) return;
    
    const creator = logEntry.executor;
    if (creator.id === config.ownerId) return;
    
    await guild.members.unban(user.id);
    await sendLog(guild, new EmbedBuilder()
        .setTitle('🚫 Ban Anti-Nuke')
        .setDescription(`${user.tag} fue baneado por ${creator.tag}. Se deshizo.`)
        .setColor('Yellow')
    );
});

client.on('GuildMemberUpdate', async (oldMember, newMember) => {
    const settings = getGuildSettings(newMember.guild.id);
    if (!settings.antinuke) return;
    
    // Detectar cambio de roles masivo o cambio de role de alto rango
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
        const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: 'MemberRoleUpdate' });
        const logEntry = auditLogs.entries.first();
        if (logEntry && logEntry.executor.id !== config.ownerId) {
            // Aquí podrías revertir el rol si no tiene permisos
            if (!logEntry.executor.permissions.has(PermissionsBitField.Flags.Administrator)) {
                // Revertir roles añadidos
                const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
                if (addedRoles.size > 0) {
                    await newMember.roles.remove(addedRoles.first());
                    await sendLog(newMember.guild, new EmbedBuilder()
                        .setTitle('🔄 Role Anti-Nuke')
                        .setDescription(`Se removió ${addedRoles.first().name} a ${newMember.user.tag}.`)
                        .setColor('Red')
                    );
                }
            }
        }
    }
});

client.on('guildMemberAdd', async (member) => {
    // Log simple al entrar
    // const logChannel = member.guild.channels.cache.get(getGuildSettings(member.guild.id).logChannelId);
    // if(logChannel) logChannel.send(`✅ ${member.user.tag} se unió.`);
});

// ==========================================
// INTERACCIÓN DE BOTONES (REACTIONS)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const settings = getGuildSettings(interaction.guild.id);
    if (!settings.reactionMenu) return;
    
    // Verificar si es el canal correcto
    if (interaction.channel.id !== settings.reactionMenu.channelId) return;
    
    const customId = interaction.customId;
    const roleId = customId.replace('role_', '');
    
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return;
    
    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
        await interaction.update({ content: `✅ Rol ${role.name} removido.` });
    } else {
        await member.roles.add(role);
        await interaction.update({ content: `✅ Rol ${role.name} añadido.` });
    }
});

// ==========================================
// START
// ==========================================
client.login(config.token);
