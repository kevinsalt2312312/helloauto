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
const OWNER_ROLE_ID = "1517636202801529033";
// ─────────────────────────────────────

const DB_FILE = "./data.json";
const KEYS_FILE = "./keys.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({}, null, 2));
  }
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

function scheduleJob(uid, cfg) {
  stopJob(uid);

  const run = async () => {
    await sendSelfMsg(cfg.userToken, cfg.channelId, cfg.message);

    const base = cfg.intervalMin * 60000;
    const jitter = (Math.random() * 4 - 2) * 60000;

    activeJobs[uid].timer = setTimeout(run, Math.max(base + jitter, 60000));
  };

  activeJobs[uid] = { ...cfg, timer: null };
  run();
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim your license key')
    .addStringOption(o =>
      o.setName('key')
        .setDescription('Your key')
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName('panel').setDescription('Open panel'),
  new SlashCommandBuilder().setName('status').setDescription('Check status'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop auto-adv'),

  new SlashCommandBuilder()
    .setName('genkeys')
    .setDescription('[Owner] generate keys')
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('amount')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('listkeys')
    .setDescription('[Owner] list keys'),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('[Owner] revoke key')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('user')
        .setRequired(true)
    )
].map(c => c.toJSON());

// ─────────────────────────────────────

client.once('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });

  console.log('Slash commands registered');
});

// ─────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────
client.on('interactionCreate', async interaction => {

  const isOwner = interaction.member?.roles?.cache?.has(OWNER_ROLE_ID);

  try {

    // ───── CLAIM (FIXED SAFE)
    if (interaction.isChatInputCommand() && interaction.commandName === 'claim') {
      const keyInput = interaction.options.getString('key');

      if (!keyInput)
        return interaction.reply({ content: 'No key provided.', ephemeral: true });

      const key = keyInput.trim().toUpperCase();
      const keys = loadKeys();
      const db = loadDB();
      const uid = interaction.user.id;

      if (db.users[uid]?.key)
        return interaction.reply({ content: 'You already have a key.', ephemeral: true });

      const data = keys[key];

      if (!data)
        return interaction.reply({ content: 'Invalid key.', ephemeral: true });

      if (data.claimed)
        return interaction.reply({ content: 'Key already claimed.', ephemeral: true });

      const expiry = new Date(Date.now() + 10 * 86400000).toISOString();

      keys[key] = {
        claimed: true,
        claimedBy: uid,
        claimedAt: new Date().toISOString(),
        expiry
      };

      saveKeys(keys);

      db.users[uid] = { key, expiry, config: null };
      saveDB(db);

      return interaction.reply({
        content: '✅ Key claimed successfully!',
        ephemeral: true
      });
    }

    // ───── OWNER CHECK COMMANDS
    const ownerOnly = (msg) =>
      interaction.reply({ content: msg, ephemeral: true });

    if (interaction.isChatInputCommand() && interaction.commandName === 'genkeys') {
      if (!isOwner) return ownerOnly('Owner only.');

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

    if (interaction.isChatInputCommand() && interaction.commandName === 'listkeys') {
      if (!isOwner) return ownerOnly('Owner only.');

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

    if (interaction.isChatInputCommand() && interaction.commandName === 'revokekey') {
      if (!isOwner) return ownerOnly('Owner only.');

      const user = interaction.options.getUser('user');
      const db = loadDB();

      if (!db.users[user.id])
        return interaction.reply({ content: 'No key found.', ephemeral: true });

      delete db.users[user.id];
      saveDB(db);

      return interaction.reply({
        content: `Revoked key from ${user.tag}`,
        ephemeral: true
      });
    }

    // ───── STOP (SAFE)
    if (interaction.commandName === 'stop') {
      stopJob(interaction.user.id);
      return interaction.reply({ content: 'Stopped.', ephemeral: true });
    }

  } catch (err) {
    console.error(err);

    if (!interaction.replied) {
      return interaction.reply({
        content: 'Error occurred.',
        ephemeral: true
      });
    }
  }
});

client.login(BOT_TOKEN);
