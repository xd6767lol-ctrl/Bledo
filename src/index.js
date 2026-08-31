require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    AuditLogEvent,
    EmbedBuilder
} = require('discord.js');
const express = require('express');
const app = express();
const PUERTO = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Sistema En Línea'));
app.listen(PUERTO, '0.0.0.0', () => console.log(`Puerto ${PUERTO} — Servicio Activo`));

const servidores = new Map();

function obtenerServidor(idServidor) {
    if (!servidores.has(idServidor)) {
        servidores.set(idServidor, {
            listaBlancaR2: new Set(),
            listaDueños: new Set(),
            proteccionR2: true,
            antinukeActivado: true,
            contadorAcciones: {},
            historialAvatares: new Map(),
            historialNombres: new Map()
        });
    }
    return servidores.get(idServidor);
}

async function obtenerRolesPorNivel(servidor) {
    const rolesOrdenados = servidor.roles.cache
        .filter(rol => rol.id !== servidor.id)
        .sort((a, b) => b.position - a.position)
        .map(rol => ({ id: rol.id, nombre: rol.name, posicion: rol.position }));

    return {
        rol1: rolesOrdenados[0] || null,
        rol2: rolesOrdenados[1] || null,
        rol3: rolesOrdenados[2] || null,
        rol4: rolesOrdenados[3] || null,
        todos: rolesOrdenados
    };
}

const cliente = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction, Partials.GuildMember]
});

function crearEmbed(titulo, descripcion, color = '#2B2D31') {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(titulo)
        .setDescription(descripcion)
        .setFooter({ text: 'Hecho por chingones' })
        .setTimestamp();
}

function esDueñoServidor(idUsuario, servidor) {
    return idUsuario === servidor.ownerId;
}

function tienePermisoAdmin(idUsuario, servidor) {
    const datos = obtenerServidor(servidor.id);
    return esDueñoServidor(idUsuario, servidor) || datos.listaDueños.has(idUsuario);
}

async function puedeDarRol2(idUsuario, servidor) {
    const datos = obtenerServidor(servidor.id);
    if (esDueñoServidor(idUsuario, servidor)) return true;
    return datos.listaBlancaR2.has(idUsuario);
}

cliente.on('guildAuditLogEntryCreate', async (entrada, servidor) => {
    const datos = obtenerServidor(servidor.id);
    if (!datos.antinukeActivado) return;

    const ejecutor = entrada.user;
    if (!ejecutor || ejecutor.bot) return;
    if (esDueñoServidor(ejecutor.id, servidor)) return;
    if (datos.listaDueños.has(ejecutor.id)) return;

    const accionesPeligrosas = [
        AuditLogEvent.MemberBanAdd,
        AuditLogEvent.MemberKick,
        AuditLogEvent.ChannelDelete,
        AuditLogEvent.ChannelCreate,
        AuditLogEvent.RoleDelete,
        AuditLogEvent.RoleCreate,
        AuditLogEvent.WebhookCreate,
        AuditLogEvent.GuildUpdate
    ];

    if (!accionesPeligrosas.includes(entrada.action)) return;

    if (!datos.contadorAcciones[ejecutor.id]) {
        datos.contadorAcciones[ejecutor.id] = { cantidad: 0, tiempo: Date.now() };
    }

    const limiteTiempo = 60000;
    if (Date.now() - datos.contadorAcciones[ejecutor.id].tiempo > limiteTiempo) {
        datos.contadorAcciones[ejecutor.id] = { cantidad: 1, tiempo: Date.now() };
    } else {
        datos.contadorAcciones[ejecutor.id].cantidad++;
    }

    const limiteAcciones = 5;
    if (datos.contadorAcciones[ejecutor.id].cantidad >= limiteAcciones) {
        try {
            const miembro = await servidor.members.fetch(ejecutor.id);
            if (miembro && miembro.kickable) {
                await miembro.kick('Antinuke: Limite de acciones alcanzado');
            }
        } catch (error) {}
    }
});

cliente.on('guildMemberUpdate', async (miembroAntiguo, miembroNuevo) => {
    const servidor = miembroNuevo.guild;
    const datos = obtenerServidor(servidor.id);
    const rolesAntiguos = miembroAntiguo.roles.cache;
    const rolesNuevos = miembroNuevo.roles.cache;

    const rolesAgregados = rolesNuevos.filter(rol => !rolesAntiguos.has(rol.id));
    if (rolesAgregados.size === 0) return;

    const registros = await servidor.fetchAuditLogs({ limit: 5, type: AuditLogEvent.MemberRoleUpdate });
    const registro = registros.entries.find(entrada => entrada.target.id === miembroNuevo.id);
    if (!registro || !registro.executor) return;

    const ejecutor = registro.executor;
    if (esDueñoServidor(ejecutor.id, servidor)) return;
    if (datos.listaDueños.has(ejecutor.id)) return;

    const roles = await obtenerRolesPorNivel(servidor);

    if (roles.rol2 && rolesAgregados.has(roles.rol2.id) && !datos.listaBlancaR2.has(ejecutor.id)) {
        try {
            const miembroEjecutor = await servidor.members.fetch(ejecutor.id);
            if (miembroEjecutor) {
                await miembroNuevo.roles.remove(roles.rol2.id, 'Proteccion: Rol2 requiere permiso de lista blanca');
            }
        } catch (error) {}
    }
});

cliente.on('userUpdate', (usuarioAntiguo, usuarioNuevo) => {
    const ahora = Date.now();
    const limite = 7 * 24 * 60 * 60 * 1000;
    const datos = obtenerServidor('global');

    if (usuarioAntiguo.avatar !== usuarioNuevo.avatar) {
        if (!datos.historialAvatares.has(usuarioNuevo.id)) {
            datos.historialAvatares.set(usuarioNuevo.id, []);
        }
        const historial = datos.historialAvatares.get(usuarioNuevo.id);
        historial.push({ url: usuarioNuevo.displayAvatarURL({ size: 4096 }), fecha: ahora });
        datos.historialAvatares.set(usuarioNuevo.id, historial.filter(e => ahora - e.fecha < limite));
    }

    if (usuarioAntiguo.username !== usuarioNuevo.username) {
        if (!datos.historialNombres.has(usuarioNuevo.id)) {
            datos.historialNombres.set(usuarioNuevo.id, []);
        }
        const historial = datos.historialNombres.get(usuarioNuevo.id);
        historial.push({ nombre: usuarioNuevo.username, fecha: ahora });
        datos.historialNombres.set(usuarioNuevo.id, historial.filter(e => ahora - e.fecha < limite));
    }
});

cliente.on('messageCreate', async mensaje => {
    if (mensaje.author.bot || !mensaje.guild) return;
    if (!mensaje.content.startsWith(',')) return;

    const argumentos = mensaje.content.slice(1).trim().split(/\s+/);
    const comando = argumentos.shift()?.toLowerCase();
    const servidor = mensaje.guild;
    const datos = obtenerServidor(servidor.id);
    const roles = await obtenerRolesPorNivel(servidor);

    if (comando === 'ayuda' || comando === 'comandos' || comando === 'cmd') {
        const embed = crearEmbed('Lista de Comandos', 'Prefijo: ,')
            .addFields(
                { name: 'Lista Blanca', value: [
                    ',wl own @Usuario — Agregar a Lista Blanca de Duenos',
                    ',wl own quitar @Usuario — Quitar de Lista Blanca',
                    ',wl own lista — Ver Lista Blanca de Duenos',
                    ',wl agregar @Usuario r2 — Dar permiso para dar Rol2',
                    ',wl quitar @Usuario r2 — Quitar permiso de Rol2',
                    ',wl lista r2 — Ver quienes pueden dar Rol2',
                    ',antinuke activar/desactivar — Controlar proteccion antinuke'
                ].join('\n') },
                { name: 'Roles', value: [
                    ',r @Usuario NombreRol — Dar rol a un usuario',
                    ',roles — Ver lista de roles del servidor'
                ].join('\n') },
                { name: 'Historial', value: [
                    ',avatares [@Usuario] — Ver historial de avatares',
                    ',nombres [@Usuario] — Ver historial de nombres',
                    ',limpiar avatares [@Usuario] — Borrar historial de avatares',
                    ',limpiar nombres [@Usuario] — Borrar historial de nombres'
                ].join('\n') },
                { name: 'Moderacion', value: [
                    ',bloquear — Bloquear canal',
                    ',desbloquear — Desbloquear canal',
                    ',c cantidad — Borrar mensajes',
                    ',ban @Usuario [razon] — Expulsar usuario',
                    ',hb @Usuario [razon] — Banear usuario'
                ].join('\n') }
            );
        return mensaje.reply({ embeds: [embed] });
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'own') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede gestionar esto.', '#ED4245')] });
        }

        const accion = argumentos[1]?.toLowerCase();

        if (accion === 'lista') {
            if (datos.listaDueños.size === 0) {
                return mensaje.reply({ embeds: [crearEmbed('Lista Blanca de Duenos', 'No hay usuarios en la lista blanca.')] });
            }
            const lista = Array.from(datos.listaDueños).map(id => `<@${id}> — ${id}`).join('\n');
            return mensaje.reply({ embeds: [crearEmbed('Lista Blanca de Duenos', lista)] });
        }

        if (accion === 'quitar') {
            const mencion = mensaje.mentions.users.first();
            const idUsuario = mencion?.id || argumentos[2];
            if (!idUsuario || !datos.listaDueños.has(idUsuario)) {
                return mensaje.reply({ embeds: [crearEmbed('Error', 'Usuario no esta en la lista blanca.', '#ED4245')] });
            }
            datos.listaDueños.delete(idUsuario);
            return mensaje.reply({ embeds: [crearEmbed('Quitado', `<@${idUsuario}> fue removido de la lista blanca de duenos.`, '#FEE75C')] });
        }

        const mencion = mensaje.mentions.users.first();
        const idUsuario = mencion?.id || argumentos[1];
        if (!idUsuario) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', ',wl own @Usuario', '#FEE75C')] });
        }
        if (idUsuario === servidor.ownerId) {
            return mensaje.reply({ embeds: [crearEmbed('Informacion', 'Ese usuario ya es el dueno del servidor.', '#FEE75C')] });
        }
        datos.listaDueños.add(idUsuario);
        return mensaje.reply({ embeds: [crearEmbed('Agregado', `<@${idUsuario}> fue agregado a la Lista Blanca de Duenos.`, '#57F287')] });
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'agregar' && argumentos[2]?.toLowerCase() === 'r2') {
        if (!tienePermisoAdmin(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para gestionar esto.', '#ED4245')] });
        }
        const mencion = mensaje.mentions.users.first();
        const idUsuario = mencion?.id || argumentos[1];
        if (!idUsuario) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', ',wl agregar @Usuario r2', '#FEE75C')] });
        }
        datos.listaBlancaR2.add(idUsuario);
        return mensaje.reply({ embeds: [crearEmbed('Agregado', `<@${idUsuario}> ahora puede dar el Rol2.`, '#57F287')] });
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'quitar' && argumentos[2]?.toLowerCase() === 'r2') {
        if (!tienePermisoAdmin(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para gestionar esto.', '#ED4245')] });
        }
        const mencion = mensaje.mentions.users.first();
        const idUsuario = mencion?.id || argumentos[1];
        if (!idUsuario || !datos.listaBlancaR2.has(idUsuario)) {
            return mensaje.reply({ embeds: [crearEmbed('Error', 'Usuario no esta en la lista blanca.', '#ED4245')] });
        }
        datos.listaBlancaR2.delete(idUsuario);
        return mensaje.reply({ embeds: [crearEmbed('Quitado', `<@${idUsuario}> ya no puede dar el Rol2.`, '#FEE75C')] });
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'lista' && argumentos[1]?.toLowerCase() === 'r2') {
        if (!tienePermisoAdmin(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para ver esto.', '#ED4245')] });
        }
        if (datos.listaBlancaR2.size === 0) {
            return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Rol2', 'No hay usuarios con permiso para dar Rol2.')] });
        }
        const lista = Array.from(datos.listaBlancaR2).map(id => `<@${id}> — ${id}`).join('\n');
        return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Rol2', lista)] });
    }

    if (comando === 'antinuke') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede controlar el antinuke.', '#ED4245')] });
        }
        const accion = argumentos[0]?.toLowerCase();
        if (accion === 'activar') {
            datos.antinukeActivado = true;
            return mensaje.reply({ embeds: [crearEmbed('Antinuke Activado', 'La proteccion antinuke esta activada.', '#57F287')] });
        }
        if (accion === 'desactivar') {
            datos.antinukeActivado = false;
            return mensaje.reply({ embeds: [crearEmbed('Antinuke Desactivado', 'La proteccion antinuke esta desactivada.', '#FEE75C')] });
        }
        return mensaje.reply({ embeds: [crearEmbed('Antinuke', `Estado actual: ${datos.antinukeActivado ? 'Activado' : 'Desactivado'}\nUsa: ,antinuke activar o ,antinuke desactivar`)] });
    }

    if (comando === 'r') {
        const mencion = mensaje.mentions.members.first();
        const nombreRol = argumentos.slice(1).join(' ');
        if (!mencion || !nombreRol) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', ',r @Usuario NombreRol', '#FEE75C')] });
        }
        const rol = servidor.roles.cache.find(r => r.name.toLowerCase() === nombreRol.toLowerCase());
        if (!rol) {
            return mensaje.reply({ embeds: [crearEmbed('Error', 'Rol no encontrado.', '#ED4245')] });
        }
        if (roles.rol2 && rol.id === roles.rol2.id && !await puedeDarRol2(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para dar el Rol2. Requiere lista blanca.', '#ED4245')] });
        }
        await mencion.roles.add(rol);
        return mensaje.reply({ embeds: [crearEmbed('Rol Asignado', `${mencion.user.tag} recibio el rol ${rol.name}.`, '#57F287')] });
    }

    if (comando === 'roles') {
        const todosRoles = servidor.roles.cache
            .filter(r => r.id !== servidor.id)
            .sort((a, b) => b.position - a.position)
            .map((r, i) => `${i + 1}. ${r.name} — ${r.id}`)
            .join('\n');
        const infoRoles = roles.rol1 || roles.rol2 || roles.rol3 || roles.rol4
            ? `\n\nNiveles detectados automaticamente:\n` +
              `${roles.rol1 ? 'Rol1: ' + roles.rol1.nombre : ''}\n` +
              `${roles.rol2 ? 'Rol2 (Protegido): ' + roles.rol2.nombre : ''}\n` +
              `${roles.rol3 ? 'Rol3: ' + roles.rol3.nombre : ''}\n` +
              `${roles.rol4 ? 'Rol4: ' + roles.rol4.nombre : ''}`
            : '';
        return mensaje.reply({ embeds: [crearEmbed('Lista de Roles', todosRoles + infoRoles)] });
    }

    if (comando === 'bloquear') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para gestionar canales.', '#ED4245')] });
        }
        await mensaje.channel.permissionOverwrites.edit(servidor.id, { SendMessages: false });
        return mensaje.reply({ embeds: [crearEmbed('Canal Bloqueado', 'Ya no se pueden enviar mensajes en este canal.', '#ED4245')] });
    }

    if (comando === 'desbloquear') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para gestionar canales.', '#ED4245')] });
        }
        await mensaje.channel.permissionOverwrites.edit(servidor.id, { SendMessages: null });
        return mensaje.reply({ embeds: [crearEmbed('Canal Desbloqueado', 'Ya se pueden enviar mensajes en este canal.', '#57F287')] });
    }

    if (comando === 'c' || comando === 'borrar') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para borrar mensajes.', '#ED4245')] });
        }
        const cantidad = parseInt(argumentos[0]) || 5;
        if (cantidad < 1 || cantidad > 100) {
            return mensaje.reply({ embeds: [crearEmbed('Error', 'Usa un numero entre 1 y 100.', '#ED4245')] });
        }
        await mensaje.delete();
        const borrados = await mensaje.channel.bulkDelete(cantidad, true);
        return mensaje.reply({ embeds: [crearEmbed('Mensajes Borrados', `Se borraron ${borrados.size} mensajes.`, '#57F287')] });
    }

    if (comando === 'ban') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para expulsar.', '#ED4245')] });
        }
        const mencion = mensaje.mentions.members.first();
        if (!mencion) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', ',ban @Usuario [razon]', '#FEE75C')] });
        }
        if (mencion.permissions.has(PermissionFlagsBits.Administrator)) {
            return mensaje.reply({ embeds: [crearEmbed('Error', 'No puedes expulsar a un administrador.', '#ED4245')] });
        }
        const razon = argumentos.slice(1).join(' ') || 'Sin razon';
        await mencion.kick(razon);
        return mensaje.reply({ embeds: [crearEmbed('Usuario Expulsado', `${mencion.user.tag} fue expulsado.\nRazon: ${razon}`, '#FEE75C')] });
    }

    if (comando === 'hb') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para banear.', '#ED4245')] });
        }
        const mencion = mensaje.mentions.members.first();
        if (!mencion) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', ',hb @Usuario [razon]', '#FEE75C')] });
        }
        const razon = argumentos.slice(1).join(' ') || 'Sin razon';
        await mencion.ban({ reason: razon });
        return mensaje.reply({ embeds: [crearEmbed('Usuario Baneado', `${mencion.user.tag} fue baneado.\nRazon: ${razon}`, '#ED4245')] });
    }

    if (comando === 'avatares') {
        const mencion = mensaje.mentions.users.first();
        const usuario = mencion || mensaje.author;
        const historial = datos.historialAvatares.get(usuario.id) || [];
        if (historial.length === 0) {
            return mensaje.reply({ embeds: [crearEmbed('Historial de Avatares', `${usuario.tag} no tiene cambios de avatar registrados en los ultimos 7 dias.`)] });
        }
        const embed = crearEmbed('Historial de Avatares', `${usuario.tag} — ${historial.length} cambios en los ultimos 7 dias`);
        embed.setImage(historial[historial.length - 1].url);
        return mensaje.reply({ embeds: [embed] });
    }

    if (comando === 'nombres') {
        const mencion = mensaje.mentions.users.first();
        const usuario = mencion || mensaje.author;
        const historial = datos.historialNombres.get(usuario.id) || [];
        if (historial.length === 0) {
            return mensaje.reply({ embeds: [crearEmbed('Historial de Nombres', `${usuario.tag} no tiene cambios de nombre registrados en los ultimos 7 dias.`)] });
        }
        const lista = historial.map((cambio, i) => `${i + 1}. ${cambio.nombre}`).join('\n');
        return mensaje.reply({ embeds: [crearEmbed('Historial de Nombres', `${usuario.tag}\n\n${lista}`)] });
    }

    if (comando === 'limpiar') {
        const tipo = argumentos[0]?.toLowerCase();
        const mencion = mensaje.mentions.users.first();
        const usuario = mencion || mensaje.author;
        if (tipo === 'avatares') {
            datos.historialAvatares.delete(usuario.id);
            return mensaje.reply({ embeds: [crearEmbed('Limpiado', `Historial de avatares de ${usuario.tag} eliminado.`, '#57F287')] });
        }
        if (tipo === 'nombres') {
            datos.historialNombres.delete(usuario.id);
            return mensaje.reply({ embeds: [crearEmbed('Limpiado', `Historial de nombres de ${usuario.tag} eliminado.`, '#57F287')] });
        }
        return mensaje.reply({ embeds: [crearEmbed('Uso', ',limpiar avatares o ,limpiar nombres', '#FEE75C')] });
    }
});

cliente.login(process.env.TOKEN)
    .then(() => console.log('Bot En Linea — Sistema Completo Activado'))
    .catch(error => console.log(`Error de inicio de sesion: ${error.message}`));
