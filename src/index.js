const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
  prefix: '!',
  colors: { main: 0x5865F2, success: 0x57F287, error: 0xED4245, warning: 0xFEE75C },
  emojis: { success: '✅', error: '❌', shield: '🛡️', warn: '⚠️' }
};

// MongoDB Schema
const guildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  antinuke: {
    enabled: { type: Boolean, default: false },
    whitelist: [{ type: String }],
    limits: { bans: 3, kicks: 3, channelDelete: 3, roleDelete: 3 },
    punishment: { type: String, default: 'ban' },
    logChannel: { type: String }
  },
  autorole: { enabled: false, roleId: null },
  reactionRoles: []
});

const Guild = mongoose.model('Guild', guildSchema);

// Sistema Antinuke
client.antinuke = new Map();

async function checkAntinuke(guild, user, actionType) {
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
      if (guildData.antinuke.punishment === 'ban') await member.ban({ reason: 'Antinuke triggered' });
      else if (guildData.antinuke.punishment === 'kick') await member.kick('Antinuke triggered');
      else if (guildData.antinuke.punishment === 'strip') await member.roles.set([]);
    }
    
    if (guildData.antinuke.logChannel) {
      const logCh = guild.channels.cache.get(guildData.antinuke.logChannel);
      if (logCh) logCh.send(`${config.emojis.shield} **Antinuke:** ${user.tag} sancionado por ${actionType}`);
    }
    return true;
  }
  return false;
}

// Eventos
client.on('ready', () => {
  console.log(`🤖 ${client.user.tag} online`);
  client.user.setActivity('!help | Protegiendo servidores', { type: 3 });
  
  setInterval(() => {
    const now = Date.now();
    for (const [guildId, data] of client.antinuke) {
      for (const [userId, actions] of data) {
        const filtered = actions.filter(time => now - time < 10000);
        if (filtered.length === 0) data.delete(userId);
        else data.set(userId, filtered);
      }
      if (data.size === 0) client.antinuke.delete(guildId);
    }
  }, 10000);
});

client.on('guildMemberAdd', async (member) => {
  const data = await Guild.findOne({ guildId: member.guild.id });
  if (data?.autorole?.enabled && data.autorole.roleId) {
    const role = member.guild.roles.cache.get(data.autorole.roleId);
    if (role) await member.roles.add(role).catch(() => null);
  }
});

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const audit = await channel.guild.fetchAuditLogs({ type: 12, limit: 1 }).catch(() => null);
  if (!audit) return;
  const entry = audit.entries.first();
  if (entry && Date.now() - entry.createdTimestamp < 5000) {
    await checkAntinuke(channel.guild, entry.executor, 'channelDelete');
  }
});

client.on('roleDelete', async (role) => {
  const audit = await role.guild.fetchAuditLogs({ type: 32, limit: 1 }).catch(() => null);
  if (!audit) return;
  const entry = audit.entries.first();
  if (entry && Date.now() - entry.createdTimestamp < 5000) {
    await checkAntinuke(role.guild, entry.executor, 'roleDelete');
  }
});

client.on('guildMemberRemove', async (member) => {
  const audit = await member.guild.fetchAuditLogs({ type: 20, limit: 1 }).catch(() => null);
  if (!audit) return;
  const entry = audit.entries.first();
  if (entry && entry.target.id === member.id && Date.now() - entry.createdTimestamp < 5000) {
    await checkAntinuke(member.guild, entry.executor, 'kicks');
  }
});

// Comandos
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  
  let data = await Guild.findOne({ guildId: message.guild.id });
  if (!data) data = await Guild.create({ guildId: message.guild.id });
  
  const prefix = config.prefix;
  if (!message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  
  // ANTINUKE
  if (cmd === 'antinuke') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ Necesitas permisos de Administrador');
    
    const sub = args[0]?.toLowerCase();
    if (!sub || sub === 'status') {
      return message.reply(`🛡️ **Antinuke:** ${data.antinuke.enabled ? '✅ Activado' : '❌ Desactivado'}\nCastigo: ${data.antinuke.punishment}\nWhitelist: ${data.antinuke.whitelist.length} usuarios`);
    }
    if (sub === 'enable') { data.antinuke.enabled = true; await data.save(); return message.reply('✅ Antinuke activado'); }
    if (sub === 'disable') { data.antinuke.enabled = false; await data.save(); return message.reply('❌ Antinuke desactivado'); }
    if (sub === 'punishment') {
      const p = args[1]?.toLowerCase();
      if (!['ban','kick','strip'].includes(p)) return message.reply('❌ Opciones: ban, kick, strip');
      data.antinuke.punishment = p; await data.save();
      return message.reply(`✅ Castigo: ${p}`);
    }
    if (sub === 'logs') {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply('❌ Menciona un canal');
      data.antinuke.logChannel = ch.id; await data.save();
      return message.reply(`✅ Logs en ${ch}`);
    }
  }
  
  // WHITELIST
  if (cmd === 'whitelist') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    const sub = args[0]?.toLowerCase();
    const user = message.mentions.users.first();
    
    if (sub === 'add' && user) {
      if (data.antinuke.whitelist.includes(user.id)) return message.reply('❌ Ya está en whitelist');
      data.antinuke.whitelist.push(user.id); await data.save();
      return message.reply(`✅ ${user.tag} añadido`);
    }
    if (sub === 'remove' && user) {
      data.antinuke.whitelist = data.antinuke.whitelist.filter(id => id !== user.id);
      await data.save(); return message.reply(`✅ ${user.tag} removido`);
    }
    const list = data.antinuke.whitelist.length > 0 ? data.antinuke.whitelist.map(id => `<@${id}>`).join(', ') : 'Vacía';
    return message.reply(`📋 Whitelist: ${list}`);
  }
  
  // MODERACIÓN
  if (cmd === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return;
    const user = message.mentions.users.first() || await client.users.fetch(args[0]).catch(() => null);
    if (!user) return message.reply('❌ Usuario no encontrado');
    const reason = args.slice(1).join(' ') || 'Sin razón';
    await message.guild.members.ban(user, { reason }).catch(() => message.reply('❌ No pude banear'));
    return message.reply(`✅ ${user.tag} baneado`);
  }
  
  if (cmd === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return;
    const member = message.mentions.members.first();
    if (!member) return message.reply('❌ Menciona un miembro');
    await member.kick().catch(() => message.reply('❌ No pude expulsar'));
    return message.reply(`✅ ${member.user.tag} expulsado`);
  }
  
  if (cmd === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply('❌ Usa: !purge <1-100>');
    const deleted = await message.channel.bulkDelete(amount + 1, true).catch(() => null);
    const msg = await message.channel.send(`✅ ${deleted?.size - 1 || 0} mensajes borrados`);
    setTimeout(() => msg.delete(), 3000);
  }
  
  // ROLES
  if (cmd === 'autorole') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    const sub = args[0]?.toLowerCase();
    if (sub === 'set') {
      const role = message.mentions.roles.first();
      if (!role) return message.reply('❌ Menciona un rol');
      data.autorole = { enabled: true, roleId: role.id };
      await data.save(); return message.reply(`✅ Auto-role: ${role.name}`);
    }
    if (sub === 'disable') {
      data.autorole.enabled = false; await data.save();
      return message.reply('✅ Auto-role desactivado');
    }
    return message.reply(`Auto-role: ${data.autorole.enabled ? `✅ <@&${data.autorole.roleId}>` : '❌ Desactivado'}`);
  }
  
  // UTILIDAD
  if (cmd === 'ping') {
    return message.reply(`🏓 Pong! ${Date.now() - message.createdTimestamp}ms | API: ${client.ws.ping}ms`);
  }
  
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(config.colors.main)
      .setTitle('🤖 Comandos del Bot')
      .addFields(
        { name: '🛡️ Antinuke', value: '`!antinuke enable/disable/status`\n`!antinuke punishment ban/kick/strip`\n`!antinuke logs #canal`\n`!whitelist add/remove @user`' },
        { name: '🔨 Moderación', value: '`!ban @user`\n`!kick @user`\n`!purge <cantidad>`' },
        { name: '👥 Roles', value: '`!autorole set @rol`\n`!autorole disable`' },
        { name: '⚙️ Utilidad', value: '`!ping`\n`!help`' }
      );
    return message.reply({ embeds: [embed] });
  }
});

// Conectar
mongoose.connect(process.env.MONGODB_URI).then(() => console.log('✅ MongoDB conectado')).catch(err => console.error('❌ MongoDB error:', err));
client.login(process.env.TOKEN);
