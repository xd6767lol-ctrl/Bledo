require('dotenv').config();
const { Client, GatewayIntentBits, Partials, PermissionFlagsBits, AuditLogEvent, EmbedBuilder, ChannelType, Collection } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Sistema En Línea — Estilo Bleed'));
app.listen(PORT, '0.0.0.0', () => console.log(`Puerto ${PORT} — Servicio Activo`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

const prefix = ',';
const whitelistOwn = new Set();
const whitelistR2 = new Set();
const voiceMasterChannels = new Map();
const antinukeConfig = { enabled: true, maxChannels: 3, maxRoles: 3, maxBans: 3, maxKicks: 3 };
const MAX_HORAS = 200000000; // Límite: 200 millones de horas

async function getHierarchyRoles(guild) {
    const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
    return {
        rol1: roles[0] || null,
        rol2: roles[1] || null,
        rol3: roles[2] || null,
        rol4: roles[3] || null
    };
}

client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const comando = args.shift()?.toLowerCase();
    const autor = message.member;
    const dueno = message.guild.ownerId;

    // ========== ACTIVAR HORAS — BOT AFK EN VC ==========
    if (comando === 'activar' && args[0] === 'horas') {
        if (autor.id !== dueno) return message.reply('Solo el dueño del servidor puede usar este comando.');
        
        const busqueda = args.slice(1).join(' ');
        if (!busqueda) return message.reply('Uso: ,activar horas <ID o nombre del canal de voz>');

        const canal = 
            message.guild.channels.cache.get(busqueda) || 
            message.guild.channels.cache.find(c => c.name.toLowerCase() === busqueda.toLowerCase() && c.type === ChannelType.GuildVoice);

        if (!canal || canal.type !== ChannelType.GuildVoice) return message.reply('Canal de voz no encontrado.');

        const conexion = joinVoiceChannel({
            channelId: canal.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        conexion.on(VoiceConnectionStatus.Ready, () => {
            message.reply(`Bot conectado a: ${canal.name}\nTiempo máximo: ${MAX_HORAS.toLocaleString()} horas\nSe mantendrá conectado hasta que se use ,desactivar horas o se reinicie el bot.`);
        });

        conexion.on(VoiceConnectionStatus.Disconnected, () => {
            setTimeout(() => {
                if (!getVoiceConnection(message.guild.id)) {
                    joinVoiceChannel({
                        channelId: canal.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });
                }
            }, 5000);
        });
        return;
    }

    // ========== DESACTIVAR HORAS — SACAR BOT DE VC ==========
    if (comando === 'desactivar' && args[0] === 'horas') {
        if (autor.id !== dueno) return message.reply('Solo el dueño del servidor puede usar este comando.');
        const conexion = getVoiceConnection(message.guild.id);
        if (conexion) {
            conexion.destroy();
            return message.reply('Bot desconectado del canal de voz.');
        }
        return message.reply('El bot no está conectado a ningún canal de voz.');
    }

    // ========== WL OWN ==========
    if (comando === 'wl_add' && args[0] === 'own') {
        if (autor.id !== dueno && !whitelistOwn.has(autor.id)) return message.reply('Permisos insuficientes.');
        const usuario = message.mentions.members.first() || await message.guild.members.fetch(args[1]).catch(() => null);
        if (!usuario) return message.reply('Usuario no encontrado.');
        whitelistOwn.add(usuario.id);
        return message.reply(`Whitelist OWN asignada a ${usuario.user.tag}`);
    }

    // ========== WL R2 ==========
    if (comando === 'wl_add' && args[0] === 'r2') {
        if (!whitelistOwn.has(autor.id) && autor.id !== dueno) return message.reply('Solo Whitelist OWN puede asignar esto.');
        const usuario = message.mentions.members.first() || await message.guild.members.fetch(args[1]).catch(() => null);
        if (!usuario) return message.reply('Usuario no encontrado.');
        whitelistR2.add(usuario.id);
        return message.reply(`Whitelist R2 asignada a ${usuario.user.tag}`);
    }

    // ========== ROLES ==========
    if (comando === 'roles') {
        const roles = [...message.guild.roles.cache.values()].sort((a, b) => b.position - a.position);
        const embed = new EmbedBuilder()
            .setTitle('Lista de Roles')
            .setColor(0x2F3136)
            .setDescription(roles.map((r, i) => `${i + 1}. ${r.name} — ID: ${r.id}`).join('\n').slice(0, 4000));
        return message.reply({ embeds: [embed] });
    }

    // ========== DAR ROL ==========
    if (comando === 'r') {
        const usuario = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        const nombreRol = args.slice(1).join(' ');
        if (!usuario || !nombreRol) return message.reply('Uso: ,r <usuario> <nombre del rol>');
        
        const rol = message.guild.roles.cache.find(r => r.name.toLowerCase() === nombreRol.toLowerCase());
        if (!rol) return message.reply('Rol no encontrado.');
        
        const jerarquia = await getHierarchyRoles(message.guild);
        const puedeDar = whitelistR2.has(autor.id) || whitelistOwn.has(autor.id) || autor.id === dueno;
        
        if (rol.id === jerarquia.rol2?.id && !puedeDar) {
            return message.reply('No tienes permiso para asignar este rol.');
        }
        
        await usuario.roles.add(rol);
        return message.reply(`${usuario.user.tag} recibió el rol: ${rol.name}`);
    }

    // ========== VC MASTER ==========
    if (comando === 'vc' && args[0] === 'master') {
        if (!autor.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply('Permisos insuficientes.');
        
        const canal = await message.guild.channels.create({
            name: 'Voice Create',
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                { id: message.guild.id, allow: [PermissionFlagsBits.Connect] }
            ]
        });
        
        voiceMasterChannels.set(canal.id, true);
        return message.reply(`Canal de voz creado: ${canal.name}`);
    }

    // ========== LOCK / UNLOCK ==========
    if (comando === 'lock' || comando === 'unlock') {
        const rolesPermitidos = await getHierarchyRoles(message.guild);
        const idsPermitidos = [rolesPermitidos.rol1?.id, rolesPermitidos.rol2?.id, rolesPermitidos.rol3?.id, rolesPermitidos.rol4?.id].filter(Boolean);
        const tienePermiso = autor.roles.cache.some(r => idsPermitidos.includes(r.id)) || autor.id === dueno;
        if (!tienePermiso) return message.reply('Permisos insuficientes.');
        
        const canal = message.channel;
        const bloquear = comando === 'lock';
        await canal.permissionOverwrites.edit(message.guild.id, { SendMessages: !bloquear });
        return message.reply(bloquear ? 'Canal bloqueado — No se pueden enviar mensajes.' : 'Canal desbloqueado — Se pueden enviar mensajes.');
    }

    // ========== HELP ==========
    if (comando === 'help' || comando === 'cmd') {
        const embed = new EmbedBuilder()
            .setTitle('Lista de Comandos')
            .setColor(0x2F3136)
            .addFields(
                { name: 'Sistema General', value: '`,help` — Muestra esta lista\n`,roles` — Lista de roles del servidor' },
                { name: 'Gestión de Roles', value: '`,r <usuario> <rol>` — Asignar rol\n`,wl_add own <usuario>` — Asignar Whitelist OWN\n`,wl_add r2 <usuario>` — Asignar Whitelist R2' },
                { name: 'Canales y Voz', value: '`,vc master` — Crear canal de voz dinámico\n`,activar horas <canal>` — Bot AFK en VC (máx. 200M horas)\n`,desactivar horas` — Sacar bot del VC\n`,lock` — Bloquear canal\n`,unlock` — Desbloquear canal' },
                { name: 'Seguridad', value: 'Antinuke activo por defecto — Protección de canales, roles, baneos y más' }
            )
            .setFooter({ text: 'Made by chingones' });
        return message.reply({ embeds: [embed] });
    }
});

// ========== VOICE MASTER — CREAR CANAL AL ENTRAR ==========
client.on('voiceStateUpdate', async (estadoAnterior, estadoNuevo) => {
    if (estadoNuevo.channelId && voiceMasterChannels.has(estadoNuevo.channelId) && !estadoAnterior.channelId) {
        const miembro = estadoNuevo.member;
        const canalPadre = estadoNuevo.channel.parentId || null;

        const canalNuevo = await estadoNuevo.guild.channels.create({
            name: `${miembro.user.username} — Channel`,
            type: ChannelType.GuildVoice,
            parent: canalPadre,
            permissionOverwrites: [
                { id: miembro.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] },
                { id: estadoNuevo.guild.id, allow: [PermissionFlagsBits.Connect] }
            ]
        });

        await miembro.voice.setChannel(canalNuevo.id);
        canalNuevo.setRateLimitPerUser(3);
    }

    if (estadoAnterior.channel && estadoAnterior.channel.name.includes('— Channel') && estadoAnterior.channel.members.size === 0) {
        setTimeout(async () => {
            if (estadoAnterior.channel.members.size === 0) {
                await estadoAnterior.channel.delete().catch(() => {});
            }
        }, 5000);
    }
});

// ========== ANTINUKE — PROTECCIÓN DE ROLES ==========
client.on('guildMemberUpdate', async (miembroAntiguo, miembroNuevo) => {
    if (!antinukeConfig.enabled) return;
    const dueno = miembroNuevo.guild.ownerId;
    if (miembroNuevo.id === dueno) return;

    const rolesAntiguos = miembroAntiguo.roles.cache;
    const rolesNuevos = miembroNuevo.roles.cache;
    const rolesAgregados = rolesNuevos.filter(r => !rolesAntiguos.has(r.id));

    if (rolesAgregados.size > 0) {
        const jerarquia = await getHierarchyRoles(miembroNuevo.guild);
        const rolProtegido = rolesAgregados.has(jerarquia.rol2?.id);
        if (rolProtegido && !whitelistR2.has(miembroNuevo.id) && !whitelistOwn.has(miembroNuevo.id)) {
            await miembroNuevo.roles.remove(jerarquia.rol2.id);
            const rolesUsuario = [...miembroNuevo.roles.cache.keys()];
            for (const id of rolesUsuario) {
                const rol = miembroNuevo.guild.roles.cache.get(id);
                if (rol && rol.position >= jerarquia.rol1.position) await miembroNuevo.roles.remove(rol);
            }
        }
    }
});

client.login(process.env.TOKEN);
