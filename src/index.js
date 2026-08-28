// ==========================================
// PASO 1: PRIMERO IMPORTAR TODO DE DISCORD
// ==========================================
const { Client, GatewayIntentBits, Events, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ==========================================
// PASO 2: SERVIDOR DE EXPRESS (para Render)
// ==========================================
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('✅ Niño 6,6,6,6 — Activo y Protegiendo Roles'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Puerto listo — Bot estable en Render`);
});

// ==========================================
// PASO 3: CONFIGURACIÓN
// ==========================================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  prefix: ',',
  whitelistFile: './whitelist.json',
  // Roles que el bot NUNCA quitará (protección para admins/owner)
  protectedRoles: ['ADMINISTRATOR'],
  // Canal donde se enviarán logs de seguridad (opcional, puede ser null)
  logChannel: 'seguridad'
};

// ==========================================
// PASO 4: INICIAR CLIENTE DE DISCORD
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

// ==================== SISTEMA DE WHITELIST ====================

class WhitelistManager {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            if (fs.existsSync(CONFIG.whitelistFile)) {
                const data = fs.readFileSync(CONFIG.whitelistFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Error cargando whitelist:', error);
        }
        return {};
    }

    save() {
        try {
            fs.writeFileSync(CONFIG.whitelistFile, JSON.stringify(this.data, null, 4));
        } catch (error) {
            console.error('Error guardando whitelist:', error);
        }
    }

    isWhitelisted(guildId, userId, roleId = null) {
        const guildData = this.data[guildId];
        if (!guildData) return false;
        
        const userData = guildData[userId];
        if (!userData) return false;

        if (userData === 'all') return true;
        if (Array.isArray(userData)) {
            return roleId ? userData.includes(roleId) : true;
        }
        return false;
    }

    add(guildId, userId, roles = 'all') {
        if (!this.data[guildId]) {
            this.data[guildId] = {};
        }
        if (Array.isArray(this.data[guildId][userId]) && Array.isArray(roles)) {
            roles.forEach(role => {
                if (!this.data[guildId][userId].includes(role)) {
                    this.data[guildId][userId].push(role);
                }
            });
        } else {
            this.data[guildId][userId] = roles;
        }
        this.save();
    }

    remove(guildId, userId) {
        if (this.data[guildId] && this.data[guildId][userId]) {
            delete this.data[guildId][userId];
            this.save();
            return true;
        }
        return false;
    }

    getList(guildId) {
        return this.data[guildId] || {};
    }
}

const whitelist = new WhitelistManager();

// ==================== FUNCIONES DE SEGURIDAD ====================

async function getAuditLogEntry(guild, targetId, action = 24) {
    try {
        const auditLogs = await guild.fetchAuditLogs({
            limit: 10,
            type: action
        });
        return auditLogs.entries.find(entry => 
            entry.targetId === targetId && 
            Date.now() - entry.createdTimestamp < 10000
        );
    } catch (error) {
        console.error('Error obteniendo audit log:', error);
        return null;
    }
}

async function punishUser(member, reason) {
    try {
        const rolesToRemove = member.roles.cache.filter(role => 
            role.name !== '@everyone' && 
            !role.permissions.has(PermissionsBitField.Flags.Administrator)
        );

        if (rolesToRemove.size === 0) return;

        await member.roles.set([], reason);
        console.log(`[CASTIGO] Se quitaron ${rolesToRemove.size} roles a ${member.user.tag} (${member.id})`);

        try {
            await member.send({
                embeds: [{
                    title: '⚠️ ALERTA DE SEGURIDAD',
                    description: `Se te han quitado todos tus roles en **${member.guild.name}** por intentar asignar roles manualmente sin estar en la whitelist.\n\nContacta a un administrador si crees que esto es un error.`,
                    color: 0xFF0000,
                    timestamp: new Date()
                }]
            });
        } catch {}

    } catch (error) {
        console.error('Error castigando usuario:', error);
    }
}

async function logSecurityAction(guild, offender, victim, role, action) {
    if (!CONFIG.logChannel) return;
    
    const logChannel = guild.channels.cache.find(
        ch => ch.name === CONFIG.logChannel && ch.isTextBased()
    );
    
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setTitle('🚨 Intento de Asignación de Rol Ilegal')
        .setColor(0xFF0000)
        .addFields(
            { name: 'Usuario Sancionado', value: `${offender} (${offender.id})`, inline: false },
            { name: 'Víctima', value: `${victim} (${victim.id})`, inline: false },
            { name: 'Rol Intentado', value: `${role} (${role.id})`, inline: false },
            { name: 'Acción Tomada', value: action, inline: false }
        )
        .setTimestamp();

    await logChannel.send({ embeds: [embed] });
}

// ==================== EVENTOS ====================

client.once(Events.ClientReady, () => {
    console.log(`✅ Bot ${client.user.tag} conectado y protegiendo roles!`);
    console.log(`📊 Servidores: ${client.guilds.cache.size}`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    if (newMember.user.bot) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    if (addedRoles.size === 0) return;

    await new Promise(resolve => setTimeout(resolve, 500));

    const auditEntry = await getAuditLogEntry(newMember.guild, newMember.id);
    if (!auditEntry) return;

    const executor = auditEntry.executor;
    if (!executor || executor.bot || executor.id === newMember.id) return;

    for (const [, role] of addedRoles) {
        if (whitelist.isWhitelisted(newMember.guild.id, executor.id, role.id)) {
            console.log(`✅ ${executor.tag} autorizado para dar rol ${role.name} a ${newMember.user.tag}`);
            continue;
        }

        console.log(`🚨 ${executor.tag} intentó dar rol ${role.name} sin autorización`);

        try {
            await newMember.roles.remove(role, `Protección de seguridad: ${executor.tag} no tiene permiso`);
            console.log(`✅ Rol ${role.name} revertido de ${newMember.user.tag}`);
        } catch (error) {
            console.error('Error quitando rol:', error);
        }

        const executorMember = await newMember.guild.members.fetch(executor.id).catch(() => null);
        if (executorMember) {
            await punishUser(executorMember, 'Protección de seguridad: Intento de asignar roles sin autorización');
        }

        await logSecurityAction(
            newMember.guild, 
            executor, 
            newMember.user, 
            role, 
            'Rol revertido + Sanción aplicada (roles removidos al ofensor)'
        );
    }
});

// ==================== COMANDOS ====================

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.startsWith(CONFIG.prefix)) return;

    const args = message.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === 'whitelist_add') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }
        if (args.length < 1) {
            return message.reply('❌ Uso: `,whitelist_add <user_id> [rol]`\nEjemplo: `,whitelist_add 123456789 all`');
        }

        const userId = args[0];
        const roleInput = args.slice(1).join(' ') || 'all';

        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) return message.reply('❌ No se encontró ningún usuario con ese ID.');

            let roles = 'all';
            if (roleInput.toLowerCase() !== 'all') {
                const roleMention = roleInput.match(/<@&(\d+)>/);
                const roleId = roleMention ? roleMention[1] : 
                              message.guild.roles.cache.find(r => 
                                  r.name.toLowerCase() === roleInput.toLowerCase() || 
                                  r.id === roleInput
                              )?.id;
                if (!roleId) return message.reply(`❌ No se encontró el rol \`${roleInput}\`.`);
                roles = [roleId];
            }

            whitelist.add(message.guild.id, userId, roles);

            const embed = new EmbedBuilder()
                .setTitle('✅ Usuario Agregado a Whitelist')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Usuario', value: `${user} (${user.id})`, inline: false },
                    { name: 'Permiso para asignar', value: roles === 'all' ? 'Todos los roles' : `<@&${roles[0]}>`, inline: false }
                )
                .setTimestamp();

            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            message.reply('❌ Error al procesar el comando.');
        }
    }

    if (command === 'whitelist_remove') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }
        if (args.length < 1) return message.reply('❌ Uso: `,whitelist_remove <user_id>`');

        const userId = args[0];
        const success = whitelist.remove(message.guild.id, userId);

        if (success) {
            const user = await client.users.fetch(userId).catch(() => null);
            message.reply(`✅ ${user ? user.toString() : userId} ha sido removido de la whitelist.`);
        } else {
            message.reply('❌ Ese usuario no estaba en la whitelist.');
        }
    }

    if (command === 'whitelist_list') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }

        const list = whitelist.getList(message.guild.id);
        const entries = Object.entries(list);

        if (entries.length === 0) {
            return message.reply('📋 No hay usuarios en la whitelist.');
        }

        let description = '';
        for (const [userId, roles] of entries) {
            const user = await client.users.fetch(userId).catch(() => null);
            const userStr = user ? user.toString() : `ID: ${userId}`;
            
            let roleStr;
            if (roles === 'all') roleStr = 'Todos los roles';
            else if (Array.isArray(roles)) {
                roleStr = roles.map(rid => {
                    const role = message.guild.roles.cache.get(rid);
                    return role ? role.name : `ID:${rid}`;
                }).join(', ');
            } else roleStr = 'Desconocido';
            
            description += `• ${userStr} → ${roleStr}\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Whitelist de Asignación de Roles')
            .setColor(0x3498DB)
            .setDescription(description)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }

    if (command === 'emergency_clear') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }

        const confirmMessage = await message.reply('⚠️ Esto quitará TODOS los roles de TODOS los usuarios. Escribe `CONFIRMAR` para proceder.');

        const filter = m => m.author.id === message.author.id && m.content === 'CONFIRMAR';
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);

        if (!collected) return message.reply('❌ Operación cancelada.');

        message.reply('🔄 Procesando... Esto puede tardar.');

        const members = await message.guild.members.fetch();
        let count = 0;

        for (const [, member] of members) {
            if (member.user.bot) continue;
            const rolesToRemove = member.roles.cache.filter(r => r.name !== '@everyone');
            if (rolesToRemove.size > 0) {
                try {
                    await member.roles.set([]);
                    count++;
                } catch (error) {
                    console.error(`Error quitando roles de ${member.user.tag}:`, error);
                }
            }
        }

        message.reply(`✅ Se quitaron roles de ${count} usuarios.`);
    }
});

client.on(Events.Error, (error) => {
    console.error('Error del cliente:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// Iniciar bot
client.login(CONFIG.token);
