// ==== AGREGA ESTO AL PRINCIPIO DE index.js ====
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('✅ Bot activo — Niño 6,6,6,6'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Puerto abierto — Render me detecta bien`);
});
// ==== FIN DE LO QUE AGREGAS ====

// RESTO DE TU CÓDIGO SIGUE IGUAL 👇const { Client, GatewayIntentBits, Events, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Configuración
const CONFIG = {
token: process.env.DISCORD_TOKEN,
    prefix: ',',
    whitelistFile: './whitelist.json',
    // Roles que el bot NUNCA quitará (protección para admins/owner)
    protectedRoles: ['ADMINISTRATOR'], // o poner IDs específicos: ['123456789', '987654321']
    // Canal donde se enviarán logs de seguridad (opcional, puede ser null)
    logChannel: 'seguridad' // nombre del canal o null para desactivar
};

// Intents necesarios
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration // Para audit logs
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

        // Si es "all", puede dar cualquier rol
        if (userData === 'all') return true;
        
        // Si es array, verificar si el rol específico está permitido
        if (Array.isArray(userData)) {
            return roleId ? userData.includes(roleId) : true;
        }
        
        return false;
    }

    add(guildId, userId, roles = 'all') {
        if (!this.data[guildId]) {
            this.data[guildId] = {};
        }
        
        // Si ya existe y es array, agregar el nuevo rol
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

async function getAuditLogEntry(guild, targetId, action = 24) { // 24 = MEMBER_ROLE_UPDATE
    try {
        const auditLogs = await guild.fetchAuditLogs({
            limit: 10,
            type: action
        });
        
        return auditLogs.entries.find(entry => 
            entry.targetId === targetId && 
            Date.now() - entry.createdTimestamp < 10000 // Últimos 10 segundos
        );
    } catch (error) {
        console.error('Error obteniendo audit log:', error);
        return null;
    }
}

async function punishUser(member, reason) {
    try {
        // Obtener roles quitables (excluyendo @everyone y roles protegidos)
        const rolesToRemove = member.roles.cache.filter(role => 
            role.name !== '@everyone' && 
            !role.permissions.has(PermissionsBitField.Flags.Administrator)
        );

        if (rolesToRemove.size === 0) return;

        // Quitar todos los roles
        await member.roles.set([], reason);
        
        console.log(`[CASTIGO] Se quitaron ${rolesToRemove.size} roles a ${member.user.tag} (${member.id})`);

        // Intentar enviar DM
        try {
            await member.send({
                embeds: [{
                    title: '⚠️ ALERTA DE SEGURIDAD',
                    description: `Se te han quitado todos tus roles en **${member.guild.name}** por intentar asignar roles manualmente sin estar en la whitelist.\n\nContacta a un administrador si crees que esto es un error.`,
                    color: 0xFF0000,
                    timestamp: new Date()
                }]
            });
        } catch {
            // No se pudo enviar DM
        }

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

// Detectar cambios de roles
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    // Ignorar bots
    if (newMember.user.bot) return;

    // Obtener diferencias de roles
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

    // Solo procesar si se agregaron roles (no si se quitaron)
    if (addedRoles.size === 0) return;

    // Esperar un poco para que el audit log se actualice
    await new Promise(resolve => setTimeout(resolve, 500));

    // Buscar en audit log quién hizo el cambio
    const auditEntry = await getAuditLogEntry(newMember.guild, newMember.id);
    
    if (!auditEntry) return;

    const executor = auditEntry.executor;
    
    // Ignorar si el ejecutor es un bot o es el mismo usuario
    if (!executor || executor.bot || executor.id === newMember.id) return;

    // Procesar cada rol agregado
    for (const [, role] of addedRoles) {
        // Verificar si el ejecutor está en whitelist para este rol
        if (whitelist.isWhitelisted(newMember.guild.id, executor.id, role.id)) {
            console.log(`✅ ${executor.tag} autorizado para dar rol ${role.name} a ${newMember.user.tag}`);
            continue;
        }

        // 🚨 NO ESTÁ EN WHITELIST - ACTIVAR PROTECCIÓN
        
        console.log(`🚨 ${executor.tag} intentó dar rol ${role.name} sin autorización`);

        // 1. Quitar el rol que asignó ilegalmente
        try {
            await newMember.roles.remove(role, `Protección de seguridad: ${executor.tag} no tiene permiso`);
            console.log(`✅ Rol ${role.name} revertido de ${newMember.user.tag}`);
        } catch (error) {
            console.error('Error quitando rol:', error);
        }

        // 2. CASTIGAR al que intentó dar el rol
        const executorMember = await newMember.guild.members.fetch(executor.id).catch(() => null);
        if (executorMember) {
            await punishUser(executorMember, 'Protección de seguridad: Intento de asignar roles sin autorización');
        }

        // 3. Log de seguridad
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

    // Comando: whitelist_add
    if (command === 'whitelist_add') {
        // Verificar permisos de administrador
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }

        if (args.length < 1) {
            return message.reply('❌ Uso: `,whitelist_add <user_id> [rol]`\nEjemplo: `,whitelist_add 123456789 all`\nEjemplo: `,whitelist_add 123456789 @Admin`');
        }

        const userId = args[0];
        const roleInput = args.slice(1).join(' ') || 'all';

        try {
            // Buscar usuario
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) {
                return message.reply('❌ No se encontró ningún usuario con ese ID.');
            }

            let roles = 'all';
            
            // Si se especificó un rol específico
            if (roleInput.toLowerCase() !== 'all') {
                // Buscar por mención, nombre o ID
                const roleMention = roleInput.match(/<@&(\d+)>/);
                const roleId = roleMention ? roleMention[1] : 
                              message.guild.roles.cache.find(r => 
                                  r.name.toLowerCase() === roleInput.toLowerCase() || 
                                  r.id === roleInput
                              )?.id;

                if (!roleId) {
                    return message.reply(`❌ No se encontró el rol \`${roleInput}\`. Usa \`all\` para permitir todos los roles.`);
                }
                
                roles = [roleId];
            }

            // Agregar a whitelist
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

    // Comando: whitelist_remove
    if (command === 'whitelist_remove') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }

        if (args.length < 1) {
            return message.reply('❌ Uso: `,whitelist_remove <user_id>`');
        }

        const userId = args[0];
        const success = whitelist.remove(message.guild.id, userId);

        if (success) {
            const user = await client.users.fetch(userId).catch(() => null);
            message.reply(`✅ ${user ? user.toString() : userId} ha sido removido de la whitelist.`);
        } else {
            message.reply('❌ Ese usuario no estaba en la whitelist.');
        }
    }

    // Comando: whitelist_list
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
            if (roles === 'all') {
                roleStr = 'Todos los roles';
            } else if (Array.isArray(roles)) {
                const roleNames = roles.map(rid => {
                    const role = message.guild.roles.cache.get(rid);
                    return role ? role.name : `ID:${rid}`;
                });
                roleStr = roleNames.join(', ') || 'Ninguno';
            } else {
                roleStr = 'Desconocido';
            }
            
            description += `• ${userStr} → ${roleStr}\n`;
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Whitelist de Asignación de Roles')
            .setColor(0x3498DB)
            .setDescription(description)
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    }

    // Comando: whitelist_clear (emergencia - quita todos los roles a todos)
    if (command === 'emergency_clear') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Solo administradores pueden usar este comando.');
        }

        const confirmMessage = await message.reply('⚠️ Esto quitará TODOS los roles de TODOS los usuarios (excepto @everyone). Escribe `CONFIRMAR` para proceder.');

        const filter = m => m.author.id === message.author.id && m.content === 'CONFIRMAR';
        const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] }).catch(() => null);

        if (!collected) {
            return message.reply('❌ Operación cancelada (timeout).');
        }

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

// Manejo de errores
client.on(Events.Error, (error) => {
    console.error('Error del cliente:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// Iniciar bot
client.login(CONFIG.token);
