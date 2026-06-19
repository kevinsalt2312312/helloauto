const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ─────────────────────────────────────
// CONFIG
// ─────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = "1517632985342541864";
const OWNER_ROLE_ID = "1517636202801529033"; // ROLE ID
// ─────────────────────────────────────

const DB_FILE = "./data.json";
const KEYS_FILE = "./keys.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(KEYS_FILE));
}

function saveKeys(k) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2));
}

const activeJobs = {};

function stopJob(uid) {
  if (activeJobs[uid]) {
    clearTimeout(activeJobs[uid].timer);
    delete activeJobs[uid];
  }
}

async function sendSelfMsg(userToken, channelId, message) {
  try {
    const res = await fetch(`https://discord.com/api/v9/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': userToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({ content: message })
    });

    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || JSON.stringify(data) };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim key')
    .addStringOption(o =>
      o.setName('key').setRequired(true)
    ),

  new SlashCommandBuilder().setName('panel').setDescription('Panel'),
  new SlashCommandBuilder().setName('status').setDescription('Status'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop'),

  new SlashCommandBuilder()
    .setName('genkey')
    .setDescription('[ROLE ONLY] generate keys')
    .addIntegerOption(o =>
      o.setName('amount').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('[ROLE ONLY] list keys'),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('[ROLE ONLY] revoke key')
    .addUserOption(o =>
      o.setName('user').setRequired(true)
    )
].map(c => c.toJSON());

// ─────────────────────────────────────

client.once('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

  console.log('Commands registered');
});

// ─────────────────────────────────────

client.on('interactionCreate', async interaction => {

  const isOwner = interaction.member?.roles?.cache?.has(OWNER_ROLE_ID);

  // CLAIM
  if (interaction.commandName === 'claim') {
    const key = interaction.options.getString('key').toUpperCase();
    const keys = loadKeys();
    const db = loadDB();

    if (db.users[interaction.user.id]?.key)
      return interaction.reply({ content: 'Already have key', ephemeral: true });

    if (!keys[key])
      return interaction.reply({ content: 'Invalid key', ephemeral: true });

    if (keys[key].claimed)
      return interaction.reply({ content: 'Already claimed', ephemeral: true });

    const expiry = new Date(Date.now() + 10 * 86400000).toISOString();

    keys[key] = {
      claimed: true,
      claimedBy: interaction.user.id,
      claimedAt: new Date().toISOString(),
      expiry
    };

    db.users[interaction.user.id] = { key, expiry, config: null };

    saveKeys(keys);
    saveDB(db);

    return interaction.reply({ content: 'Key claimed!', ephemeral: true });
  }

  // GENKEY (ROLE ONLY)
  if (interaction.commandName === 'genkey') {
    if (!isOwner)
      return interaction.reply({ content: 'Role only.', ephemeral: true });

    const amount = Math.min(interaction.options.getInteger('amount'), 100);
    const keys = loadKeys();
    const out = [];

    for (let i = 0; i < amount; i++) {
      const r = () => Math.random().toString(36).substring(2, 6).toUpperCase();
      const key = `PIKE-${r()}-${r()}-${r()}`;

      keys[key] = { claimed: false, claimedBy: null, expiry: null };
      out.push(key);
    }

    saveKeys(keys);
    fs.writeFileSync('./keys.txt', out.join('\n'));

    return interaction.reply({
      content: `Generated ${amount} keys`,
      files: ['./keys.txt'],
      ephemeral: true
    });
  }

  // LIST (ROLE ONLY)
  if (interaction.commandName === 'list') {
    if (!isOwner)
      return interaction.reply({ content: 'Role only.', ephemeral: true });

    const keys = loadKeys();

    const text = Object.entries(keys)
      .map(([k, v]) => `${k} | ${v.claimed ? 'CLAIMED' : 'FREE'}`)
      .join('\n');

    fs.writeFileSync('./list.txt', text);

    return interaction.reply({
      content: 'Key list:',
      files: ['./list.txt'],
      ephemeral: true
    });
  }

  // REVOKE (ROLE ONLY)
  if (interaction.commandName === 'revokekey') {
    if (!isOwner)
      return interaction.reply({ content: 'Role only.', ephemeral: true });

    const user = interaction.options.getUser('user');
    const db = loadDB();

    delete db.users[user.id];
    saveDB(db);

    return interaction.reply({
      content: `Revoked key from ${user.tag}`,
      ephemeral: true
    });
  }

  // STOP
  if (interaction.commandName === 'stop') {
    return interaction.reply({ content: 'Stopped', ephemeral: true });
  }
});

client.login(BOT_TOKEN);
