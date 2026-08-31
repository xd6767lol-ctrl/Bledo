require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionFlagsBits,
    AuditLogEvent,
    EmbedBuilder,
    ChannelType
} = require('discord.js');
const express = require('express');
const app = express();
const PUERTO = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Sistema En Línea'));
app.listen(PUERTO, '0.0.0.0', () => console.log(`Puerto ${PUERTO} — Servicio Activo`));

const config = {
    prefijo: ',',
    rolesPorPagina: 10,
    diasRetencionHistorial: 7,
    antinuke: {
        activado: true,
        proteccion: { baneos: true, expulsiones: true, canales: true, roles: true, webhooks: true, nombreServidor: true, iconoServidor: true, permisos: true },
        limites: { baneosPorMinuto: 3, expulsionesPorMinuto: 5, canalesPorMinuto: 3, rolesPorMinuto: 3 },
        castigo: 'quitar_roles'
    },
    vozMaestra: { activado: true, limitePredeterminado: 0, nombreCategoria: 'Canales de Voz' }
};

const canalesVoz = new Map();
const contadoresAntinuke = new Map();
const listaBlanca = new Set();
const listaDueños = new Set();
const listaBlancaRol2 = new Set();
const administradoresAntinuke = new Set();
const historialAvatares = new Map();
const historialNombres = new Map();

const cliente = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildPresences
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

function esDueñoOListaBlanca(idUsuario, servidor) {
    return esDueñoServidor(idUsuario, servidor) || listaDueños.has(idUsuario);
}

function puedeDarRol2(idUsuario, servidor) {
    return esDueñoServidor(idUsuario, servidor) || listaDueños.has(idUsuario) || listaBlancaRol2.has(idUsuario);
}

function estaEnListaBlanca(idUsuario) {
    return listaBlanca.has(idUsuario);
}

function esAdministradorAntinuke(idUsuario) {
    return administradoresAntinuke.has(idUsuario);
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

function registrarAccion(idUsuario, accion, limite) {
    const ahora = Date.now();
    if (!contadoresAntinuke.has(idUsuario)) contadoresAntinuke.set(idUsuario, {});
    const datosUsuario = contadoresAntinuke.get(idUsuario);
    if (!datosUsuario[accion]) datosUsuario[accion] = [];
    datosUsuario[accion] = datosUsuario[accion].filter(tiempo => ahora - tiempo < 60000);
    datosUsuario[accion].push(ahora);
    return datosUsuario[accion].length > limite;
}

async function castigar(servidor, usuario, razon) {
    if (usuario.id === servidor.ownerId || listaDueños.has(usuario.id) || estaEnListaBlanca(usuario.id)) return;
    const miembro = await servidor.members.fetch(usuario.id).catch(() => null);
    if (!miembro) return;
    if (config.antinuke.castigo === 'quitar_roles') {
        const roles = miembro.roles.cache.filter(r => r.id !== servidor.id);
        await miembro.roles.remove(roles, razon).catch(() => null);
    } else if (config.antinuke.castigo === 'ban') {
        await miembro.ban({ reason: razon }).catch(() => null);
    } else if (config.antinuke.castigo === 'expulsar') {
        await miembro.kick(razon).catch(() => null);
    }
    console.log(`[ANTINUKE] ${usuario.tag} — ${razon}`);
}

setInterval(() => {
    const limite = Date.now() - (config.diasRetencionHistorial * 24 * 60 * 60 * 1000);
    for (const [idUsuario, avatares] of historialAvatares) {
        historialAvatares.set(idUsuario, avatares.filter(a => a.fecha > limite));
        if (historialAvatares.get(idUsuario).length === 0) historialAvatares.delete(idUsuario);
    }
    for (const [idUsuario, nombres] of historialNombres) {
        historialNombres.set(idUsuario, nombres.filter(n => n.fecha > limite));
        if (historialNombres.get(idUsuario).length === 0) historialNombres.delete(idUsuario);
    }
}, 60 * 60 * 1000);

cliente.on('ready', () => {
    console.log(`Conectado como ${cliente.user.tag}`);
    cliente.user.setActivity({ type: 3, name: 'actividad no autorizada' });
});

cliente.on('userUpdate', async (usuarioAntiguo, usuarioNuevo) => {
    if (usuarioAntiguo.avatar !== usuarioNuevo.avatar) {
        if (!historialAvatares.has(usuarioNuevo.id)) historialAvatares.set(usuarioNuevo.id, []);
        const historial = historialAvatares.get(usuarioNuevo.id);
        const limite = Date.now() - (config.diasRetencionHistorial * 24 * 60 * 60 * 1000);
        const ultimaEntrada = historial[historial.length - 1];
        const urlAvatarNuevo = usuarioNuevo.displayAvatarURL({ size: 512, dynamic: true });
        if (!ultimaEntrada || ultimaEntrada.url !== urlAvatarNuevo && Date.now() - ultimaEntrada.fecha > 5000) {
            historial.push({ url: urlAvatarNuevo, fecha: Date.now() });
            historialAvatares.set(usuarioNuevo.id, historial.filter(a => a.fecha > limite));
        }
    }
    if (usuarioAntiguo.username !== usuarioNuevo.username) {
        if (!historialNombres.has(usuarioNuevo.id)) historialNombres.set(usuarioNuevo.id, []);
        const historial = historialNombres.get(usuarioNuevo.id);
        const limite = Date.now() - (config.diasRetencionHistorial * 24 * 60 * 60 * 1000);
        const ultimaEntrada = historial[historial.length - 1];
        if (!ultimaEntrada || ultimaEntrada.nombre !== usuarioNuevo.username && Date.now() - ultimaEntrada.fecha > 5000) {
            historial.push({ nombre: usuarioNuevo.username, fecha: Date.now() });
            historialNombres.set(usuarioNuevo.id, historial.filter(n => n.fecha > limite));
        }
    }
});

cliente.on('guildBanAdd', async prohibicion => {
    if (!config.antinuke.activado) return;
    const registro = await prohibicion.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot) return;
    if (ejecutor.id === prohibicion.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (registrarAccion(ejecutor.id, 'baneos', config.antinuke.limites.baneosPorMinuto)) await castigar(prohibicion.guild, ejecutor, 'Limite de baneos alcanzado');
});

cliente.on('guildMemberRemove', async miembro => {
    if (!config.antinuke.activado) return;
    const registro = await miembro.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberKick }).catch(() => null);
    const entrada = registro?.entries.first();
    if (!entrada || entrada.target.id !== miembro.id) return;
    const ejecutor = entrada.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === miembro.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (registrarAccion(ejecutor.id, 'expulsiones', config.antinuke.limites.expulsionesPorMinuto)) await castigar(miembro.guild, ejecutor, 'Limite de expulsiones alcanzado');
});

cliente.on('channelCreate', async canal => {
    if (!config.antinuke.activado) return;
    const registro = await canal.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === canal.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (registrarAccion(ejecutor.id, 'canales', config.antinuke.limites.canalesPorMinuto)) {
        await castigar(canal.guild, ejecutor, 'Limite de creacion de canales alcanzado');
        await canal.delete().catch(() => null);
    }
});

cliente.on('channelDelete', async canal => {
    if (!config.antinuke.activado) return;
    const registro = await canal.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === canal.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (registrarAccion(ejecutor.id, 'canales', config.antinuke.limites.canalesPorMinuto)) await castigar(canal.guild, ejecutor, 'Limite de eliminacion de canales alcanzado');
});

cliente.on('roleCreate', async rol => {
    if (!config.antinuke.activado) return;
    const registro = await rol.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === rol.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (registrarAccion(ejecutor.id, 'roles', config.antinuke.limites.rolesPorMinuto)) {
        await castigar(rol.guild, ejecutor, 'Limite de creacion de roles alcanzado');
        await rol.delete().catch(() => null);
    }
});

cliente.on('roleDelete', async rol => {
    if (!config.antinuke.activado) return;
    const registro = await rol.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === rol.guild.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    await castigar(rol.guild, ejecutor, 'Eliminacion de rol sin permiso');
});

cliente.on('guildUpdate', async (servidorAntiguo, servidorNuevo) => {
    if (!config.antinuke.activado) return;
    const registro = await servidorNuevo.fetchAuditLogs({ limit: 1, type: AuditLogEvent.GuildUpdate }).catch(() => null);
    const ejecutor = registro?.entries.first()?.executor;
    if (!ejecutor || ejecutor.bot || ejecutor.id === servidorNuevo.ownerId || listaDueños.has(ejecutor.id) || estaEnListaBlanca(ejecutor.id)) return;
    if (servidorAntiguo.name !== servidorNuevo.name && config.antinuke.proteccion.nombreServidor) {
        await servidorNuevo.setName(servidorAntiguo.name).catch(() => null);
        await castigar(servidorNuevo, ejecutor, 'Cambio de nombre del servidor sin permiso');
    }
    if (servidorAntiguo.icon !== servidorNuevo.icon && config.antinuke.proteccion.iconoServidor) {
        await servidorNuevo.setIcon(servidorAntiguo.iconURL()).catch(() => null);
        await castigar(servidorNuevo, ejecutor, 'Cambio de icono del servidor sin permiso');
    }
});

cliente.on('messageCreate', async mensaje => {
    if (mensaje.author.bot || !mensaje.guild) return;
    if (!mensaje.content.startsWith(config.prefijo)) return;
    const argumentos = mensaje.content.slice(config.prefijo.length).trim().split(/ +/);
    const comando = argumentos.shift()?.toLowerCase();
    const servidor = mensaje.guild;
    const roles = await obtenerRolesPorNivel(servidor);

    if (comando === 'ayuda' || comando === 'cmd' || comando === 'comandos') {
        const embed = crearEmbed('Lista de Comandos', `Prefijo: \`${config.prefijo}\``)
            .addFields(
                { name: 'Lista Blanca (Solo Dueno)', value: `\`${config.prefijo}wl own @Usuario/ID\` — Agregar Dueno\n\`${config.prefijo}wl own lista\` — Ver Duenos\n\`${config.prefijo}wl own quitar @Usuario/ID\` — Quitar Dueno\n\`${config.prefijo}wl r2 agregar @Usuario/ID\` — Dar permiso Rol2 (SOLO DUENOS)\n\`${config.prefijo}wl r2 quitar @Usuario/ID\` — Quitar permiso Rol2 (SOLO DUENOS)\n\`${config.prefijo}wl r2 lista\` — Ver lista Rol2\n\`${config.prefijo}an wl agregar/quitar <ID>\` — Lista Blanca Antinuke\n\`${config.prefijo}an admin agregar/quitar <ID>\` — Admin Antinuke` },
                { name: 'Roles', value: `\`${config.prefijo}r @Usuario NombreRol\` — Dar Rol\n\`${config.prefijo}roles\` — Lista de Roles\nRol1: ${roles.rol1?.nombre || 'No detectado'}\nRol2 (Protegido): ${roles.rol2?.nombre || 'No detectado'}\nRol3: ${roles.rol3?.nombre || 'No detectado'}\nRol4: ${roles.rol4?.nombre || 'No detectado'}` },
                { name: 'Historial', value: `\`${config.prefijo}avatares [@Usuario]\` — Historial de Avatares\n\`${config.prefijo}nombres [@Usuario]\` — Historial de Nombres\n\`${config.prefijo}limpiar avatares [@Usuario]\` — Borrar Avatares\n\`${config.prefijo}limpiar nombres [@Usuario]\` — Borrar Nombres` },
                { name: 'Moderacion', value: `\`${config.prefijo}bloquear\` — Bloquear Canal\n\`${config.prefijo}desbloquear\` — Desbloquear Canal\n\`${config.prefijo}c <cantidad>\` — Borrar Mensajes\n\`${config.prefijo}ban @Usuario [razon]\` — Expulsar\n\`${config.prefijo}hb @Usuario [razon]\` — Banear` },
                { name: 'Antinuke', value: `\`${config.prefijo}an config\` — Configuracion\n\`${config.prefijo}an activar/desactivar\` — Activar/Desactivar\n\`${config.prefijo}vc master\` — Crear Canal de Voz Automatico` }
            );
        return mensaje.reply({ embeds: [embed] });
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'own') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede gestionar esto.', '#ED4245')] });
        }
        const subComando = argumentos[1]?.toLowerCase();
        if (!subComando || !['lista', 'quitar'].includes(subComando)) {
            const idUsuario = subComando?.replace(/[<@!>]/g, '') || argumentos[1]?.replace(/[<@!>]/g, '');
            if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}wl own @Usuario/ID\` — Agregar Dueno\n\`${config.prefijo}wl own lista\` — Ver Lista\n\`${config.prefijo}wl own quitar @Usuario/ID\` — Quitar Dueno`)] });
            if (idUsuario === servidor.ownerId) return mensaje.reply({ embeds: [crearEmbed('Informacion', 'Ese usuario ya es el dueno del servidor.', '#FEE75C')] });
            listaDueños.add(idUsuario);
            return mensaje.reply({ embeds: [crearEmbed('Dueno Agregado', `<@${idUsuario}> ha sido agregado como Dueno del servidor.`, '#57F287')] });
        }
        if (subComando === 'lista') {
            if (listaDueños.size === 0) return mensaje.reply({ embeds: [crearEmbed('Lista de Duenos', 'No hay duenos extra registrados.')] });
            const lista = Array.from(listaDueños).map(id => `<@${id}> — \`${id}\``).join('\n');
            return mensaje.reply({ embeds: [crearEmbed('Lista de Duenos', `**Dueno del Servidor:** <@${servidor.ownerId}>\n**Duenos Extra:**\n${lista}`)] });
        }
        if (subComando === 'quitar') {
            const idUsuario = argumentos[2]?.replace(/[<@!>]/g, '');
            if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}wl own quitar @Usuario/ID\``)] });
            if (!listaDueños.has(idUsuario)) return mensaje.reply({ embeds: [crearEmbed('Error', 'Ese usuario no esta en la lista de duenos.', '#ED4245')] });
            listaDueños.delete(idUsuario);
            return mensaje.reply({ embeds: [crearEmbed('Dueno Quitado', `<@${idUsuario}> ya no es Dueno del servidor.`, '#FEE75C')] });
        }
    }

    if (comando === 'wl' && argumentos[0]?.toLowerCase() === 'r2') {
        if (!esDueñoOListaBlanca(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo los Duenos pueden gestionar la lista blanca de Rol2.', '#ED4245')] });
        }
        const accion = argumentos[1]?.toLowerCase();
        if (accion === 'agregar') {
            const idUsuario = argumentos[2]?.replace(/[<@!>]/g, '');
            if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}wl r2 agregar @Usuario/ID\``)] });
            listaBlancaRol2.add(idUsuario);
            return mensaje.reply({ embeds: [crearEmbed('Permiso Otorgado', `<@${idUsuario}> ahora puede dar el Rol2.`, '#57F287')] });
        }
        if (accion === 'quitar') {
            const idUsuario = argumentos[2]?.replace(/[<@!>]/g, '');
            if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}wl r2 quitar @Usuario/ID\``)] });
            listaBlancaRol2.delete(idUsuario);
            return mensaje.reply({ embeds: [crearEmbed('Permiso Revocado', `<@${idUsuario}> ya no puede dar el Rol2.`, '#FEE75C')] });
        }
        if (accion === 'lista') {
            if (listaBlancaRol2.size === 0) return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Rol2', 'No hay usuarios con permiso para dar Rol2.')] });
            const lista = Array.from(listaBlancaRol2).map(id => `<@${id}> — \`${id}\``).join('\n');
            return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Rol2', lista)] });
        }
        return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}wl r2 agregar @Usuario/ID\` — Dar permiso\n\`${config.prefijo}wl r2 quitar @Usuario/ID\` — Quitar permiso\n\`${config.prefijo}wl r2 lista\` — Ver lista`)] });
    }

    if (comando === 'r') {
        const mencion = mensaje.mentions.members.first();
        const nombreRol = argumentos.slice(1).join(' ');
        if (!mencion || !nombreRol) {
            return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}r @Usuario NombreRol\``, '#FEE75C')] });
        }
        const rol = servidor.roles.cache.find(r => r.name.toLowerCase() === nombreRol.toLowerCase());
        if (!rol) {
            return mensaje.reply({ embeds: [crearEmbed('Error', 'Rol no encontrado.', '#ED4245')] });
        }
        if (roles.rol2 && rol.id === roles.rol2.id && !puedeDarRol2(mensaje.author.id, servidor)) {
            return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'No tienes permiso para dar el Rol2. Requiere lista blanca de Rol2.', '#ED4245')] });
        }
        await mencion.roles.add(rol);
        return mensaje.reply({ embeds: [crearEmbed('Rol Asignado', `${mencion.user.tag} recibio el rol **${rol.name}**.`, '#57F287')] });
    }

    if (comando === 'roles') {
        const todosRoles = servidor.roles.cache
            .filter(r => r.id !== servidor.id)
            .sort((a, b) => b.position - a.position)
            .map((r, i) => `${i + 1}. **${r.name}** — \`${r.id}\``)
            .join('\n');
        const infoRoles = `\n\n**Niveles Detectados Automaticamente:**\n` +
            `${roles.rol1 ? 'Rol1: **' + roles.rol1.nombre + '**' : 'Rol1: No detectado'}\n` +
            `${roles.rol2 ? 'Rol2 (Protegido): **' + roles.rol2.nombre + '**' : 'Rol2: No detectado'}\n` +
            `${roles.rol3 ? 'Rol3: **' + roles.rol3.nombre + '**' : 'Rol3: No detectado'}\n` +
            `${roles.rol4 ? 'Rol4: **' + roles.rol4.nombre + '**' : 'Rol4: No detectado'}`;
        return mensaje.reply({ embeds: [crearEmbed('Lista de Roles', todosRoles + infoRoles)] });
    }

    if (comando === 'avatars') {
        const idObjetivo = argumentos[0]?.replace(/[<@!>]/g, '') || mensaje.author.id;
        const usuario = await cliente.users.fetch(idObjetivo).catch(() => null);
        if (!usuario) return mensaje.reply({ embeds: [crearEmbed('Error', 'Usuario no encontrado.', '#ED4245')] });
        const historial = historialAvatares.get(idObjetivo) || [];
        if (historial.length === 0) return mensaje.reply({ embeds: [crearEmbed('Historial de Avatares', `<@${idObjetivo}> no tiene cambios de avatar registrados en los ultimos ${config.diasRetencionHistorial} dias.`)] });
        const embed = crearEmbed('Historial de Avatares', `**Usuario:** <@${idObjetivo}>\n**Cambios en ${config.diasRetencionHistorial} dias:** ${historial.length}`);
        embed.setImage(historial[historial.length - 1].url);
        return mensaje.reply({ embeds: [embed] });
    }

    if (comando === 'nombres') {
        const idObjetivo = argumentos[0]?.replace(/[<@!>]/g, '') || mensaje.author.id;
        const usuario = await cliente.users.fetch(idObjetivo).catch(() => null);
        if (!usuario) return mensaje.reply({ embeds: [crearEmbed('Error', 'Usuario no encontrado.', '#ED4245')] });
        const historial = historialNombres.get(idObjetivo) || [];
        if (historial.length === 0) return mensaje.reply({ embeds: [crearEmbed('Historial de Nombres', `<@${idObjetivo}> no tiene cambios de nombre registrados en los ultimos ${config.diasRetencionHistorial} dias.`)] });
        const listaNombres = historial.map((entrada, i) => {
            const fecha = new Date(entrada.fecha).toLocaleDateString('es-MX');
            return `\`${i + 1}.\` **${entrada.nombre}** — ${fecha}`;
        }).join('\n');
        return mensaje.reply({ embeds: [crearEmbed('Historial de Nombres', `**Usuario:** <@${idObjetivo}>\n**Cambios en ${config.diasRetencionHistorial} dias:** ${historial.length}\n\n${listaNombres}`)] });
    }

    if (comando === 'limpiar' && argumentos[0]?.toLowerCase() === 'avatares') {
        const idObjetivo = argumentos[1]?.replace(/[<@!>]/g, '') || mensaje.author.id;
        historialAvatares.delete(idObjetivo);
        return mensaje.reply({ embeds: [crearEmbed('Historial Limpiado', `Historial de avatares de <@${idObjetivo}> eliminado.`, '#57F287')] });
    }

    if (comando === 'limpiar' && argumentos[0]?.toLowerCase() === 'nombres') {
        const idObjetivo = argumentos[1]?.replace(/[<@!>]/g, '') || mensaje.author.id;
        historialNombres.delete(idObjetivo);
        return mensaje.reply({ embeds: [crearEmbed('Historial Limpiado', `Historial de nombres de <@${idObjetivo}> eliminado.`, '#57F287')] });
    }

    if ((comando === 'an' || comando === 'antinuke') && argumentos[0]?.toLowerCase() === 'config') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede configurar el antinuke.', '#ED4245')] });
        const embed = crearEmbed('Configuracion de Antinuke', 'Solo el dueno del servidor puede modificar estos ajustes.')
            .addFields(
                { name: 'Estado', value: config.antinuke.activado ? 'Activado' : 'Desactivado', inline: true },
                { name: 'Baneos', value: config.antinuke.proteccion.baneos ? 'Activado' : 'Desactivado', inline: true },
                { name: 'Expulsiones', value: config.antinuke.proteccion.expulsiones ? 'Activado' : 'Desactivado', inline: true },
                { name: 'Canales', value: config.antinuke.proteccion.canales ? 'Activado' : 'Desactivado', inline: true },
                { name: 'Roles', value: config.antinuke.proteccion.roles ? 'Activado' : 'Desactivado', inline: true },
                { name: 'Limites', value: `Baneos: ${config.antinuke.limites.baneosPorMinuto}/min\nExpulsiones: ${config.antinuke.limites.expulsionesPorMinuto}/min\nCanales: ${config.antinuke.limites.canalesPorMinuto}/min\nRoles: ${config.antinuke.limites.rolesPorMinuto}/min` },
                { name: 'Comandos', value: `\`${config.prefijo}an activar/desactivar\` — Cambiar estado\n\`${config.prefijo}an wl agregar/quitar <ID>\` — Lista Blanca\n\`${config.prefijo}an admin agregar/quitar <ID>\` — Administrador Antinuke` }
            );
        return mensaje.reply({ embeds: [embed] });
    }

    if ((comando === 'an' || comando === 'antinuke') && argumentos[0]?.toLowerCase() === 'activar') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede modificar este ajuste.', '#ED4245')] });
        config.antinuke.activado = !config.antinuke.activado;
        return mensaje.reply({ embeds: [crearEmbed('Antinuke Actualizado', `La proteccion antinuke ha sido ${config.antinuke.activado ? '**activada**' : '**desactivada**'}.`, '#57F287')] });
    }

    if ((comando === 'an' || comando === 'antinuke') && argumentos[0]?.toLowerCase() === 'wl') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede gestionar la lista blanca.', '#ED4245')] });
        const accion = argumentos[1]?.toLowerCase();
        const idUsuario = argumentos[2]?.replace(/[<@!>]/g, '');
        if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Error', 'Proporciona un ID de usuario valido.', '#ED4245')] });
        if (accion === 'agregar') { listaBlanca.add(idUsuario); return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Actualizada', `<@${idUsuario}> agregado a la lista blanca.`, '#57F287')] }); }
        if (accion === 'quitar') { listaBlanca.delete(idUsuario); return mensaje.reply({ embeds: [crearEmbed('Lista Blanca Actualizada', `<@${idUsuario}> eliminado de la lista blanca.`, '#FEE75C')] }); }
    }

    if ((comando === 'an' || comando === 'antinuke') && argumentos[0]?.toLowerCase() === 'admin') {
        if (!esDueñoServidor(mensaje.author.id, servidor)) return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Solo el dueno del servidor puede gestionar administradores antinuke.', '#ED4245')] });
        const accion = argumentos[1]?.toLowerCase();
        const idUsuario = argumentos[2]?.replace(/[<@!>]/g, '');
        if (!idUsuario) return mensaje.reply({ embeds: [crearEmbed('Error', 'Proporciona un ID de usuario valido.', '#ED4245')] });
        if (accion === 'agregar') { administradoresAntinuke.add(idUsuario); return mensaje.reply({ embeds: [crearEmbed('Administrador Actualizado', `<@${idUsuario}> ahora es administrador antinuke.`, '#57F287')] }); }
        if (accion === 'quitar') { administradoresAntinuke.delete(idUsuario); return mensaje.reply({ embeds: [crearEmbed('Administrador Actualizado', `<@${idUsuario}> ya no es administrador antinuke.`, '#FEE75C')] }); }
    }

    if (comando === 'vc' && argumentos[0]?.toLowerCase() === 'master') {
        if (!mensaje.member.permissions.has(PermissionFlagsBits.ManageChannels)) return mensaje.reply({ embeds: [crearEmbed('Acceso Denegado', 'Permisos insuficientes.', '#ED4245')] });
        const existente = mensaje.guild.channels.cache.find(c => c.name === 'Voice Create' && c.type === ChannelType.GuildVoice);
        if (existente) return mensaje.reply({ embeds: [crearEmbed('Voice Master', `El panel ya existe: <#${existente.id}>`)] });
        const panel = await mensaje.guild.channels.create({ name: 'Voice Create', type: ChannelType.GuildVoice });
        return mensaje.reply({ embeds: [crearEmbed('Voice Master', `Panel creado: <#${panel.id}>\nAl unirse al canal, se creara un canal de voz personal automaticamente.`, '#57F287')] });
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
            return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}ban @Usuario [razon]\``, '#FEE75C')] });
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
            return mensaje.reply({ embeds: [crearEmbed('Uso', `\`${config.prefijo}hb @Usuario [razon]\``, '#FEE75C')] });
        }
        const razon = argumentos.slice(1).join(' ') || 'Sin razon';
        await mencion.ban({ reason: razon });
        return mensaje.reply({ embeds: [crearEmbed('Usuario Baneado', `${mencion.user.tag} fue baneado.\nRazon: ${razon}`, '#ED4245')] });
    }
});

cliente.login(process.env.TOKEN)
    .then(() => console.log('Bot En Linea — Sistema Completo Activado'))
    .catch(error => console.log(`Error de inicio de sesion: ${error.message}`));
