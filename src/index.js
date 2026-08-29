const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

// Configuración
const config = {
  prefix: ',',
  colors: { main: 0x5865F2, success: 0x57F287, error: 0xED4245, warning: 0xFEE75C },
  emojis: { success: '✅', error: '❌', shield: '🛡️', warn: '⚠️' }
};

// Validación de variables de entorno
if (!process.env.TOKEN) {
  console.error('ERROR: Falta TOKEN en el archivo .env');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('ERROR: Falta MONGODB_URI en el archivo .env');
  process.exit(1);
}

// MongoDB Schema
const guildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  antinuke: {
    enabled: { type: Boolean, default: false },
    whitelist: [{ type: String }],
    limits: {
      bans: { type: Number, default: 3 },
      kicks: { type: Number, default: 3 },
      channelDelete: { type: Number, default: 3 },
      roleDelete: { type: Number, default: 3 }
    },
    punishment: { type: String, default: 'ban' },
    logChannel: { type: String, default: null }
  },
  autorole: {
    enabled: { type: Boolean, default: false },
    roleId: { type: String, default: null }
  },
  reactionRoles: [{
    messageId: String,
    channelId: String,
    emoji: String,
    roleId: String
  }]
});

const Guild = mongoose.model('Guild', guildSchema);

// Sistema Antinuke
client.antinuke = new Map();

async function checkAntinuke(guild, user, actionType) {
  try {
    const guildData = await Guild.findOne({ guildId: guild.id });
    if (!guildData?.antinuke?.enabled) return false;
    if (guildData.antinuke.whitelist.includes(user.id)) return false;
    if (user.id === guild.ownerId) return false;

    if (!client.antinuke.has(guild.id)) client.antinuke.set(guild.id, new Map());
    const guildActions = client.antinuke.get(guild.id);

    if (!guildActions.has(user.id)) guildActions.set(user.id, []);
    const userActions = guildActions.get(user.id);
    const now = Date.now();

    userActions.push({ action: actionType, time: now });
    const recent = userActions.filter(a => now - a.time < 10000);
    guildActions.set(user.id, recent);

    const limit = guildData.antinuke.limits[actionType] || 3;
    const count = recent.filter(a => a.action === actionType).length;

    if (count >= limit) {
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (member) {
        if (guildData.antinuke.punishment === 'ban') {
          await member.ban({ reason: 'Antinuke: Acciones masivas detectadas' }).catch(() => null);
        } else if (guildData.antinuke.punishment === 'kick') {
          await member.kick('Antinuke: Acciones masivas detectadas').catch(() => null);
        } else if (guildData.antinuke.punishment === 'strip') {
          await member.roles.set([], 'Antinuke: Acciones masivas detectadas').catch(() => null);
        }
      }

      if (guildData.antinuke.logChannel) {
        const logCh = guild.channels.cache.get(guildData.antinuke.logChannel);
        if (logCh) {
          await logCh.send(`${config.emojis.shield} **Antinuke Activado**\nUsuario: ${user.tag} (${user.id})\nAcción: ${actionType}\nCastigo aplicado: ${guildData.antinuke.punishment}`).catch(() => null);
        }
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error('Error en checkAntinuke:', err);
    return false;
  }
}

// Eventos
client.on('ready', () => {
  console.log(`✅ Bot conectado como: ${client.user.tag}`);
  client.user.setActivity(',help | Protegiendo servidores', { type: 3 });
});

client.on('guildMemberAdd', async (member) => {
  try {
    const data = await Guild.findOne({ guildId: member.guild.id });
    if (data?.autorole?.enabled && data.autorole.roleId) {
      const role = member.guild.roles.cache.get(data.autorole.roleId);
      if (role) await member.roles.add(role).catch(() => null);
    }
  } catch (err) {
    console.error('Error en autorole:', err);
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  try {
    const audit = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 });
    const entry = audit.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 5000) {
      await checkAntinuke(channel.guild, entry.executor, 'channelDelete');
    }
  } catch (err) {}
});

client.on('roleDelete', async (role) => {
  try {
    const audit = await role.guild.fetchAuditLogs({ type: 32, limit: 1 });
    const entry = audit.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 5000) {
      await checkAntinuke(role.guild, entry.executor, 'roleDelete');
    }
  } catch (err) {}
});

client.on('guildMemberRemove', async (member) => {
  try {
    const audit = await member.guild.fetchAuditLogs({ type: 20, limit: 1 });
    const entry = audit.entries.first();
    if (entry && entry.target.id === member.id && Date.now() - entry.createdTimestamp < 5000) {
      await checkAntinuke(member.guild, entry.executor, 'kicks');
    }
  } catch (err) {}
});

// Comandos
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  let data = await Guild.findOne({ guildId: message.guild.id });
  if (!data) data = await Guild.create({ guildId: message.guild.id });

  const prefix = config.prefix;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ANTINUKE
  if (cmd === 'antinuke') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply(`${config.emojis.error} Necesitas permisos de Administrador`);
    }

    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'status') {
      return message.reply(`${config.emojis.shield} **Antinuke Estado:** ${data.antinuke.enabled ? '✅ Activado' : '❌ Desactivado'}\nCastigo: ${data.antinuke.punishment}\nWhitelist: ${data.antinuke.whitelist.length} usuarios`);
    }
    if (sub === 'enable') {
      data.antinuke.enabled = true;
      await data.save();
      return message.reply(`${config.emojis.success} Antinuke activado correctamente`);
    }
    if (sub === 'disable') {
      data.antinuke.enabled = false;
      await data.save();
      return message.reply(`${config.emojis.error} Antinuke desactivado`);
    }
    if (sub === 'punishment') {
      const p = args[1]?.toLowerCase();
      if (!['ban', 'kick', 'strip'].includes(p)) {
        return message.reply(`${config.emojis.error} Opciones válidas: ban, kick, strip`);
      }
      data.antinuke.punishment = p;
      await data.save();
      return message.reply(`${config.emojis.success} Castigo establecido: ${p}`);
    }
    if (sub === 'logs') {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply(`${config.emojis.error} Menciona un canal: ,antinuke logs #canal`);
      data.antinuke.logChannel = ch.id;
      await data.save();
      return message.reply(`${config.emojis.success} Canal de logs establecido: ${ch}`);
    }
    if (sub === 'limit') {
      const action = args[1]?.toLowerCase();
      const value = parseInt(args[2]);
      if (!['bans', 'kicks', 'channelDelete', 'roleDelete'].includes(action) || isNaN(value)) {
        return message.reply(`${config.emojis.error} Uso: ,antinuke limit <bans/kicks/channelDelete/roleDelete> <numero>`);
      }
      data.antinuke.limits[action] = value;
      await data.save();
      return message.reply(`${config.emojis.success} Límite de ${action}: ${value}`);
    }
  }

  // WHITELIST
  if (cmd === 'whitelist') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const sub = args[0]?.toLowerCase();
    const user = message.mentions.users.first();

    if (sub === 'add' && user) {
      if (data.antinuke.whitelist.includes(user.id)) {
        return message.reply(`${config.emojis.error} El usuario ya está en la whitelist`);
      }
      data.antinuke.whitelist.push(user.id);
      await data.save();
      return message.reply(`${config.emojis.success} ${user.tag} añadido a la whitelist`);
    }
    if (sub === 'remove' && user) {
      data.antinuke.whitelist = data.antinuke.whitelist.filter(id => id !== user.id);
      await data.save();
      return message.reply(`${config.emojis.success} ${user.tag} eliminado de la whitelist`);
    }
    const list = data.antinuke.whitelist.length > 0
      ? data.antinuke.whitelist.map(id => `<@${id}>`).join(', ')
      : 'Vacía';
    return message.reply(`📋 Whitelist:\n${list}`);
  }

  // MODERACIÓN
  if (cmd === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return;
    const user = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
    if (!user) return message.reply(`${config.emojis.error} Usuario no encontrado`);
    const reason = args.slice(1).join(' ') || 'Sin razón especificada';
    await message.guild.members.ban(user, { reason }).catch(() => message.reply(`${config.emojis.error} No pude banear al usuario`));
    return message.reply(`${config.emojis.success} ${user.tag} ha sido baneado`);
  }

  if (cmd === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return;
    const member = message.mentions.members.first();
    if (!member) return message.reply(`${config.emojis.error} Menciona un miembro`);
    await member.kick().catch(() => message.reply(`${config.emojis.error} No pude expulsar al usuario`));
    return message.reply(`${config.emojis.success} ${member.user.tag} ha sido expulsado`);
  }

  if (cmd === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
      return message.reply(`${config.emojis.error} Usa: ,purge <1-100>`);
    }
    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const msg = await message.channel.send(`${config.emojis.success} ${deleted?.size || 0} mensajes eliminados`);
    setTimeout(() => msg.delete().catch(() => null), 3000);
  }

  // ROLES
  if (cmd === 'autorole') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    const sub = args[0]?.toLowerCase();
    if (sub === 'set') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply(`${config.emojis.error} Menciona un rol: ,autorole set @rol`);
      data.autorole = { enabled: true, roleId: role.id };
      await data.save();
      return message.reply(`${config.emojis.success} Auto-role establecido: ${role.name}`);
    }
    if (sub === 'disable') {
      data.autorole.enabled = false;
      await data.save();
      return message.reply(`${config.emojis.success} Auto-role desactivado`);
    }
    return message.reply(`Auto-role: ${data.autorole.enabled ? `✅ <@&${data.autorole.roleId}>` : '❌ Desactivado'}`);
  }

  // UTILIDAD
  if (cmd === 'ping') {
    return message.reply(`🏓 Pong!\nLatencia: ${Date.now() - message.createdTimestamp}ms\nAPI: ${client.ws.ping}ms`);
  }

  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(config.colors.main)
      .setTitle('🤖 Comandos del Bot')
      .setDescription(`Prefijo: \`${config.prefix}\``)
      .addFields(
        { name: '🛡️ Antinuke', value: '`,antinuke enable/disable`\n`,antinuke punishment ban/kick/strip`\n`,antinuke logs #canal`\n`,antinuke limit <acción> <número>`\n`,whitelist add/remove @user` },
        { name: '🔨 Moderación', value: '`,ban @user [razón]`\n`,kick @user`\n`,purge <cantidad>`' },
        { name: '👥 Roles', value: '`,autorole set @rol`\n`,autorole disable`' },
        { name: '⚙️ Utilidad', value: '`,ping`\n`,help`' }
      );
    return message.reply({ embeds: [embed] });
  }
});

// Conectar MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB conectado correctamente'))
  .catch(err => console.error('❌ Error de conexión MongoDB:', err));

client.login(process.env.TOKEN);
