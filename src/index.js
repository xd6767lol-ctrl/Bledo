const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, AuditLogEvent } = require('discord.js');
const fs = require('fs');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Online — Grid AntiNuke System'));
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));

const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  prefix: ',',
  antinukeFile: './antinuke_data.json',
  whitelistFile: './whitelist_data.json',
  logChannel: 'seguridad',
  actionWindow: 15000,
  defaultThreshold: 3,
  defaultPunishment: 'stripstaff'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildEmojisAndStickers
  ]
});

let lastClearedMessages = [], deletedMessagesLog = [], lastClearedUserId = null;

class WhitelistManager {
    constructor() { this.data = this.load(); }
    load() {
        try { if (fs.existsSync(CONFIG.whitelistFile)) return JSON.parse(fs.readFileSync(CONFIG.whitelistFile, 'utf8')); } catch (e) {}
        return { all: [], pings: [] };
    }
    save() { fs.writeFileSync(CONFIG.whitelistFile, JSON.stringify(this.data, null, 4)); }
    isAll(userId) { return this.data.all.includes(userId); }
    isPings(userId) { return this.data.pings.includes(userId); }
    canPingEveryone(userId) { return this.isAll(userId) || this.isPings(userId); }
    addAll(userId) { if (!this.data.all.includes(userId)) { this.data.all.push(userId); this.data.pings = this.data.pings.filter(id => id !== userId); this.save(); } }
    addPings(userId) { if (!this.data.pings.includes(userId) && !this.data.all.includes(userId)) { this.data.pings.push(userId); this.save(); } }
    remove(userId) { this.data.all = this.data.all.filter(id => id !== userId); this.data.pings = this.data.pings.filter(id => id !== userId); this.save(); }
}
const whitelist = new WhitelistManager();

class AntiNukeManager {
    constructor() { this.data = this.load(); this.actionTracker = {}; }
    load() {
        try { if (fs.existsSync(CONFIG.antinukeFile)) return JSON.parse(fs.readFileSync(CONFIG.antinukeFile, 'utf8')); } catch (e) {}
        return {
            enabled: false,
            admins: [],
            whitelist: [],
            modules: {
                ban: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                kick: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                channelCreate: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                channelDelete: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                roleCreate: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                roleDelete: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                webhookCreate: { enabled: false, threshold: 1, punishment: 'ban' },
                emojiDelete: { enabled: false, threshold: 3, punishment: 'stripstaff' },
                vanity: { enabled: false, punishment: 'ban' },
                botAdd: { enabled: false, threshold: 1, punishment: 'kick' }
            }
        };
    }
    save() { fs.writeFileSync(CONFIG.antinukeFile, JSON.stringify(this.data, null, 4)); }
    isAdmin(userId) { return this.data.admins...
