// ==========================================
// IMPORTACIONES
// ==========================================
const { Client, GatewayIntentBits, Events, PermissionsBitField, EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

// ==========================================
// SERVIDOR PARA RENDER
// ==========================================
app.get('/', (req, res) => res.send('✅ Niño 6,6,6,6 — ANTINUKE + LOCK + COMANDO R MEJORADO'));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Puerto listo — Bot estable`));

// ==========================================
// CONFIGURACIÓN — PON LOS IDs DE TUS ROLES
// ==========================================
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  prefix: ',',
  whitelistFile: './whitelist.json',
  antinukeFile: './antinuke_data.json',
  ownerRoleId: 'PON_AQUÍ_EL_ID_DEL_ROL_OWNER', // 👈 ROL DE OWNER
  // 🔒 ROLES QUE PUEDEN BLOQUEAR/DESBLOQUEAR
  lockAllowedRoleIds: [
    'PON_AQUÍ_ID_ROL_1',  // 👈 ROL 1
    'PON_AQUÍ_ID_ROL_2',  // 👈 ROL 2
    'PON_AQUÍ_ID_ROL_3',  // 👈 ROL 3
    'PON_AQUÍ_ID_ROL_4'   // 👈 ROL 4
  ],
  logChannel: 'seguridad',
  maxChannelsCreate: 3,
  maxActionsWindow: 15000
};

// ==========================================
// CLIENTE DE DISCORD
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

// ==========================================
// FUNCIÓN: VERIFICAR SI PUEDE USAR LOCK/UNLOCK
// ==========================================
function canUseLockCommands(member) {
  if (member.id === member.guild.ownerId) return true;
  const antinukeData = JSON.parse(fs.existsSync(CONFIG.antinukeFile) ? fs.readFileSync(CONFIG.antinukeFile, 'utf8') : '{"whitelist":[],"admins":[]}');
  if (antinukeData.admins.includes(member.id)) return true;
  return CONFIG.lockAllowedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

// ==========================================
// SISTEMA ANTINUKE — WL y ADMIN SEPARADOS
// ==========================================
class AntiNukeManager {
    constructor() {
        this.data = this.load();
        this.actionTracker = {};
    }

    load() {
        try {
            if (fs.existsSync(CONFIG.antinukeFile)) {
                const data = fs.readFileSync(CONFIG.antinukeFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) { console.error('Error cargando antinuke:', e); }
        return { whitelist: [], admins: [] };
    }

    save() {
        try { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
        catch (e) { console.error('Error guardando:', e); }
    }

    isWhitelisted(userId) { return this.data.whitelist.includes(userId); }
    isAdmin(userId) { return this.data.admins.includes(userId); }
    isAuthorized(userId) { return this.isWhitelisted(userId) || this.isAdmin(userId); }

    addToWhitelist(userId) {
        if (!this.data.whitelist.includes(userId)) { this.data.whitelist.push(userId); this.save(); }
    }
    removeFromWhitelist(userId) {
        this.data.whitelist = this.data.whitelist.filter(id => id !== userId); this.save();
    }
    addAdmin(userId) {
        if (!this.data.admins.includes(userId)) { this.data.admins.push(userId); this.save(); }
    }
    removeAdmin(userId) {
        this.data.admins = this.data.admins.filter(id => id !== userId); this.save();
    }

    checkLimit(guildId, userId) {
        if (this.isAdmin(userId)) return { allowed: true, count: 0, limit: '∞' };
        if (!this.isWhitelisted(userId)) return { allowed: false, count: 1, limit: 0, noPermit: true };

        const now = Date.now();
        if (!this.actionTracker[guildId]) this.actionTracker[guildId] = {};
        if (!this.actionTracker[guildId][userId]) this.actionTracker[guildId][userId] = [];

        const userActions = this.actionTracker[guildId][userId].filter(t => now - t < CONFIG.maxActionsWindow);
        userActions.push(now);
        this.actionTracker[guildId][userId] = userActions;

        return {
            allowed: userActions.length <= CONFIG.maxChannelsCreate,
            count: userActions.length,
            limit: CONFIG.maxChannelsCreate
        };
    }
}

const antinuke = new AntiNukeManager();

// ==========================================
// ALMACENAR ESTADO DE CANALES BLOQUEADOS
// ==========================================
const lockedChannels = new Map();

// ==========================================
// FUNCIONES DE CASTIGO — QUITAR TODOS LOS ROLES
// ==========================================
async function punishRemoveAllRoles(member, motivo) {
    try {
        const rolesQuitar = member.roles.cache.filter(r => 
            r.name !== '@everyone' && !r.permissions.has(PermissionsBitField.Flags.Administrator)
        );
        if (rolesQuitar.size === 0) return;

        await member.roles.set([], motivo);
        console.log(`⚠️ CASTIGO: Se quitaron ${rolesQuitar.size} roles a ${member.user.tag} — ${motivo}`);

        try {
            await member.send({ embeds: [{
                title: '🚨 ACCIÓN BLOQUEADA — SE TE QUITARON TODOS LOS ROLES',
                description: `No tienes permiso para realizar esa acción en **${member.guild.name}**.\nSolicita acceso con el Owner.`,
                color: 0xFF0000, timestamp: new Date()
            }]});
        } catch {}
    } catch (e) { console.error('Error al castigar:', e); }
}

async function getAuditEntry(guild, actionType, limit = 5) {
    try {
        const logs = await guild.fetchAuditLogs({ limit, type: actionType });
        return logs.entries.first();
    } catch { return null; }
}

async function logSeguridad(guild, usuario, accion, detalle) {
    const canal = guild.channels.cache.find(c => c.name === CONFIG.logChannel && c.isTextBased());
    if (!canal) return;
    await canal.send({ embeds: [new EmbedBuilder()
        .setTitle('🛡️ ANTINUKE — ACCIÓN BLOQUEADA')
        .setColor(0xFF0000)
        .addFields(
            { name: 'Usuario', value: `${usuario} (${usuario.id})`, inline: false },
            { name: 'Acción', value: accion, inline: false },
            { name: 'Detalle', value: detalle, inline: false }
        )
        .setTimestamp()
    ]});
}

// ==========================================
// EVENTOS DE PROTECCIÓN ANTINUKE
// ==========================================
client.once(Events.ClientReady, () => {
    console.log(`✅ Bot ${client.user.tag} CONECTADO — ANTINUKE + LOCK + ,r MEJORADO`);
    console.log(`🔒 Roles permitidos para Lock/Unlock: ${CONFIG.lockAllowedRoleIds.length} roles`);
    console.log(`🛡️ WL: ${antinuke.data.whitelist.length} | Admins: ${antinuke.data.admins.length} | Límite canales: ${CONFIG.maxChannelsCreate}`);
    console.log(`🎮 Comando ,r acepta: @usuario / ID / nombre + @rol / ID / nombre`);
});

// 🚨 CREACIÓN DE CANALES / CATEGORÍAS
client.on(Events.ChannelCreate, async (canal) => {
    const guild = canal.guild;
    const entry = await getAuditEntry(guild, 10);
    if (!entry || !entry.executor || entry.executor.bot) return;

    const usuario = entry.executor;
    const check = antinuke.checkLimit(guild.id, usuario.id);

    if (check.noPermit) {
        console.log(`🚫 ${usuario.tag} intentó crear canal SIN PERMISO — QUITANDO ROLES`);
        try { await canal.delete('Antinuke: Sin autorización'); } catch {}
        const miembro = await guild.members.fetch(usuario.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Creó canal sin estar en WL ni ser Admin');
        await logSeguridad(guild, usuario, 'Creación de canal SIN PERMISO', 'Canal eliminado — Roles removidos');
        return;
    }

    if (!check.allowed) {
        console.log(`⚠️ ${usuario.tag} superó límite de canales (${check.count}/${check.limit})`);
        try { await canal.delete('Antinuke: Límite alcanzado'); } catch {}
        const miembro = await guild.members.fetch(usuario.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, `Superó límite de ${check.limit} canales`);
        await logSeguridad(guild, usuario, 'Límite de canales superado', `${check.count}/${check.limit} — Roles removidos`);
    }
});

// 🚨 CAMBIOS AL SERVIDOR (nombre, foto)
client.on(Events.GuildUpdate, async (viejo, nuevo) => {
    const entry = await getAuditEntry(viejo, 1);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const usuario = entry.executor;

    if (!antinuke.isAdmin(usuario.id)) {
        const cambios = [];
        if (viejo.name !== nuevo.name) cambios.push('Nombre del servidor');
        if (viejo.icon !== nuevo.icon) cambios.push('Foto del servidor');
        if (cambios.length === 0) return;

        console.log(`🚫 ${usuario.tag} cambió servidor SIN PERMISO — QUITANDO ROLES`);
        const miembro = await viejo.members.fetch(usuario.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, `Cambió: ${cambios.join(', ')} — Solo Admin puede`);
        await logSeguridad(viejo, usuario, 'Modificación del servidor SIN PERMISO', `${cambios.join(', ')} — Roles removidos`);
    }
});

// 🚨 CREACIÓN DE ROLES
client.on(Events.RoleCreate, async (rol) => {
    const guild = rol.guild;
    const entry = await getAuditEntry(guild, 30);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const usuario = entry.executor;

    if (!antinuke.isAdmin(usuario.id)) {
        console.log(`🚫 ${usuario.tag} creó rol SIN PERMISO — QUITANDO ROLES`);
        try { await rol.delete('Antinuke: Creación sin autorización'); } catch {}
        const miembro = await guild.members.fetch(usuario.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Creó rol sin permiso — Solo Admin');
        await logSeguridad(guild, usuario, 'Creación de rol SIN PERMISO', 'Rol eliminado — Roles removidos');
    }
});

// 🚨 CAMBIO DE NOMBRE DE CANAL
client.on(Events.ChannelUpdate, async (viejo, nuevo) => {
    if (viejo.name === nuevo.name) return;
    const guild = viejo.guild;
    const entry = await getAuditEntry(guild, 11);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const usuario = entry.executor;

    if (!antinuke.isAdmin(usuario.id)) {
        console.log(`🚫 ${usuario.tag} renombró canal SIN PERMISO — QUITANDO ROLES`);
        const miembro = await guild.members.fetch(usuario.id).catch(() => null);
        if (miembro) await punishRemoveAllRoles(miembro, 'Renombró canal sin permiso — Solo Admin');
        await logSeguridad(guild, usuario, 'Renombrar canal SIN PERMISO', `${viejo.name} → ${nuevo.name} — Roles removidos`);
    }
});

// 🚨 PROTECCIÓN ROL DE OWNER
client.on(Events.GuildMemberUpdate, async (viejo, nuevo) => {
    if (nuevo.user.bot) return;
    const rolNuevo = nuevo.roles.cache.find(r => !viejo.roles.cache.has(r.id));
    if (!rolNuevo) return;

    const entry = await getAuditEntry(nuevo.guild, 24);
    if (!entry || !entry.executor || entry.executor.bot) return;
    const usuario = entry.executor;

    if (rolNuevo.id === CONFIG.ownerRoleId) {
        console.log(`🚫 ${usuario.tag} intentó dar ROL DE OWNER — BLOQUEADO`);
        try { await nuevo.roles.remove(rolNuevo, 'PROTECCIÓN: Solo Owner puede asignarlo'); } catch {}
        await logSeguridad(nuevo.guild, usuario, 'INTENTO ASIGNAR ROL DE OWNER', 'Bloqueado — Requiere permiso de Owner');
    }
});

// ==========================================
// COMANDOS
// ==========================================
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(CONFIG.prefix)) return;
    const args = msg.content.slice(CONFIG.prefix.length).trim().split(/\s+/);
    const cmd = args.shift().toLowerCase();

    // 🔒 ==================================================
    // COMANDO LOCK / PAPI — BLOQUEAR CANAL
    // ==================================================
    if (cmd === 'lock' || cmd === 'papi') {
        if (!canUseLockCommands(msg.member)) {
            return msg.reply('🚫 **NO TIENES PERMISO** — Solo los roles autorizados pueden bloquear el canal.');
        }

        const canal = msg.channel;
        if (canal.type !== ChannelType.GuildText) {
            return msg.reply('❌ Solo se pueden bloquear canales de texto.');
        }

        const permisosOriginales = canal.permissionOverwrites.cache.map(po => ({
            id: po.id,
            type: po.type,
            allow: po.allow.bitfield.toString(),
            deny: po.deny.bitfield.toString()
        }));

        lockedChannels.set(canal.id, {
            permisosOriginales,
            bloqueadoPor: msg.author.id
        });

        await canal.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        });

        return msg.reply({ embeds: [new EmbedBuilder()
            .setTitle('🔒 CANAL BLOQUEADO')
            .setColor(0xFF0000)
            .setDescription(`Este canal ha sido bloqueado por **${msg.author}**.\nYa no se pueden enviar mensajes.`)
            .setTimestamp()
        ]});
    }

    // 🔓 ==================================================
    // COMANDO UNLOCK / UNPAPI — DESBLOQUEAR CANAL
    // ==================================================
    if (cmd === 'unlock' || cmd === 'unpapi') {
        if (!canUseLockCommands(msg.member)) {
            return msg.reply('🚫 **NO TIENES PERMISO** — Solo los roles autorizados pueden desbloquear el canal.');
        }

        const canal = msg.channel;
        const datosBloqueo = lockedChannels.get(canal.id);

        if (!datosBloqueo) {
            return msg.reply('❌ Este canal no está bloqueado.');
        }

        await canal.permissionOverwrites.edit(msg.guild.roles.everyone, {
            SendMessages: true,
            CreatePublicThreads: true,
            CreatePrivateThreads: true
        });

        lockedChannels.delete(canal.id);

        return msg.reply({ embeds: [new EmbedBuilder()
            .setTitle('🔓 CANAL DESBLOQUEADO')
            .setColor(0x00FF00)
            .setDescription(`Este canal ha sido desbloqueado por **${msg.author}**.\n¡Ya se pueden enviar mensajes!`)
            .setTimestamp()
        ]});
    }

    // 🛡️ COMANDOS ANTINUKE
    if (cmd === 'an' && args[0] === 'wl') {
        if (!antinuke.isAdmin(msg.author.id) && msg.author.id !== msg.guild.ownerId) {
            return msg.reply('🚫 No tienes permiso. Solo Admin AntiNuke o Owner.');
        }
        if (!args[1]) return msg.reply('❌ Uso: `,an wl <ID>`');
        const usuario = await client.users.fetch(args[1]).catch(() => null);
        if (!usuario) return msg.reply('❌ Usuario no encontrado.');
        antinuke.addToWhitelist(args[1]);
        return msg.reply(`✅ **${usuario}** agregado a WL.\nPuede crear hasta ${CONFIG.maxChannelsCreate} canales/categorías.`);
    }

    if (cmd === 'an' && args[0] === 'admin') {
        if (msg.author.id !== msg.guild.ownerId) {
            return msg.reply('🚫 **SOLO EL OWNER DEL SERVIDOR puede usar este comando.**');
        }
        if (!args[1]) return msg.reply('❌ Uso: `,an admin <ID>`');
        const usuario = await client.users.fetch(args[1]).catch(() => null);
        if (!usuario) return msg.reply('❌ Usuario no encontrado.');
        antinuke.addAdmin(args[1]);
        return msg.reply(`✅ **${usuario}** ahora es Admin AntiNuke.\nPuede: renombrar servidor, cambiar foto, crear roles, crear canales sin límite.`);
    }

    if (cmd === 'an' && args[0] === 'rwl') {
        if (!antinuke.isAdmin(msg.author.id) && msg.author.id !== msg.guild.ownerId) {
            return msg.reply('🚫 No tienes permiso.');
        }
        if (!args[1]) return msg.reply('❌ Uso: `,an rwl <ID>`');
        antinuke.removeFromWhitelist(args[1]);
        return msg.reply('✅ Removido de la Whitelist.');
    }

    if (cmd === 'an' && args[0] === 'list') {
        const wl = antinuke.data.whitelist.map(id => `<@${id}>`).join('\n') || 'Nadie';
        const admins = antinuke.data.admins.map(id => `<@${id}>`).join('\n') || 'Nadie';
        return msg.reply({ embeds: [new EmbedBuilder()
            .setTitle('🛡️ AntiNuke — Listas')
            .setColor(0x2ECC71)
            .addFields(
                { name: `Whitelist (máx ${CONFIG.maxChannelsCreate} canales)`, value: wl, inline: true },
                { name: 'Admin AntiNuke (todo sin límite)', value: admins, inline: true }
            )
            .setTimestamp()
        ]});
    }

    // 🎮 COMANDO DAR ROL — MEJORADO ✨
    if (cmd === 'r') {
        if (args.length < 2) {
            return msg.reply('❌ **Uso:** `,r <@usuario / ID / nombre> <@rol / ID / nombre del rol>`\n\nEjemplos:\n`,r @Juan Moderador`\n`,r 123456789 @Moderador`');
        }

        // 🔍 BUSCAR AL USUARIO (mención, ID o nombre)
        let usuarioObjetivo = null;
        const entradaUsuario = args[0];
        
        // Caso 1: Es mención @usuario
        const mencionUsuario = entradaUsuario.match(/^<@!?(\d+)>$/);
        if (mencionUsuario) {
            usuarioObjetivo = await msg.guild.members.fetch(mencionUsuario[1]).catch(() => null);
        }
        // Caso 2: Es un ID
        else if (/^\d+$/.test(entradaUsuario)) {
            usuarioObjetivo = await msg.guild.members.fetch(entradaUsuario).catch(() => null);
        }
        // Caso 3: Es nombre de usuario
        else {
            const busqueda = entradaUsuario.toLowerCase();
            usuarioObjetivo = msg.guild.members.cache.find(m => 
                m.user.username.toLowerCase() === busqueda ||
                m.displayName.toLowerCase() === busqueda ||
                m.user.tag.toLowerCase() === busqueda
            );
        }

        if (!usuarioObjetivo) {
            return msg.reply(`❌ No encontré al usuario: **${entradaUsuario}**\nUsa una mención, un ID o el nombre exacto.`);
        }

        // 🔍 BUSCAR EL ROL (mención, ID o nombre)
        const entradaRol = args.slice(1).join(' ');
        let rolEncontrado = null;

        // Caso 1: Es mención @rol
        const mencionRol = entradaRol.match(/^<@&(\d+)>$/);
        if (mencionRol) {
            rolEncontrado = msg.guild.roles.cache.get(mencionRol[1]);
        }
        // Caso 2: Es un ID
        else if (/^\d+$/.test(entradaRol)) {
            rolEncontrado = msg.guild.roles.cache.get(entradaRol);
        }
        // Caso 3: Es nombre del rol
        else {
            const busquedaRol = entradaRol.toLowerCase();
            rolEncontrado = msg.guild.roles.cache.find(r => 
                r.name.toLowerCase() === busquedaRol
            );
        }

        if (!rolEncontrado) {
            return msg.reply(`❌ No encontré el rol: **${entradaRol}**\nUsa una mención, un ID o el nombre exacto.`);
        }

        // 🔒 PROTECCIÓN ROL DE OWNER
        if (rolEncontrado.id === CONFIG.ownerRoleId) {
            return msg.reply('🚫 **NO PUEDES DAR ESTE ROL**\n🔒 Este rol requiere permiso del Owner.');
        }

        // ✅ ASIGNAR EL ROL
        await usuarioObjetivo.roles.add(rolEncontrado, `Asignado por ${msg.author.tag}`);
        
        return msg.reply({ embeds: [new EmbedBuilder()
            .setTitle('✅ ROL ASIGNADO CON ÉXITO')
            .setColor(0x00FF00)
            .addFields(
                { name: '👤 Usuario', value: `${usuarioObjetivo.user}`, inline: true },
                { name: '🏷️ Rol', value: `${rolEncontrado}`, inline: true },
                { name: '👮 Por', value: `${msg.author}`, inline: true }
            )
            .setTimestamp()
        ]});
    }
});

client.on(Events.Error, e => console.error('Error:', e));
process.on('unhandledRejection', e => console.error('Error:', e));

// INICIAR BOT
client.login(CONFIG.token);
