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
    return { ok: true };
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
// SLASH COMMANDS
// ─────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim a license key')
    .addStringOption(o =>
      o.setName('key')
        .setDescription('Your key')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open control panel'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check status'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop auto system'),

  new SlashCommandBuilder()
    .setName('genkey')
    .setDescription('Generate keys (role only)')
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('Number of keys')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('List all keys (role only)'),

  new SlashCommandBuilder()
    .setName('revokekey')
    .setDescription('Revoke user key (role only)')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User')
        .setRequired(true)
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

  // ───── CLAIM
  if (interaction.commandName === 'claim') {
    const key = interaction.options.getString('key').toUpperCase();
    const keys = loadKeys();
    const db = loadDB();

    if (db.users[interaction.user.id]?.key)
      return interaction.reply({ content: 'Already claimed a key.', ephemeral: true });

    if (!keys[key])
      return interaction.reply({ content: 'Invalid key.', ephemeral: true });

    if (keys[key].claimed)
      return interaction.reply({ content: 'Key already used.', ephemeral: true });

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

    return interaction.reply({ content: 'Key claimed successfully.', ephemeral: true });
  }

  // ───── GENKEY (ROLE ONLY)
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

  // ───── LIST (ROLE ONLY)
  if (interaction.commandName === 'list') {
    if (!isOwner)
      return interaction.reply({ content: 'Role only.', ephemeral: true });

    const keys = loadKeys();

    const text = Object.entries(keys)
      .map(([k, v]) => `${k} | ${v.claimed ? 'CLAIMED' : 'FREE'}`)
      .join('\n');

    fs.writeFileSync('./list.txt', text);

    return interaction.reply({
      content: 'Key list generated.',
      files: ['./list.txt'],
      ephemeral: true
    });
  }

  // ───── REVOKE (ROLE ONLY)
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

  // ───── STATUS
  if (interaction.commandName === 'status') {
    const db = loadDB();
    const cfg = db.users[interaction.user.id]?.config;

    return interaction.reply({
      content: activeJobs[interaction.user.id]
        ? `🟢 Running`
        : '🔴 Stopped',
      ephemeral: true
    });
  }

  // ───── STOP
  if (interaction.commandName === 'stop') {
    stopJob(interaction.user.id);
    return interaction.reply({ content: 'Stopped.', ephemeral: true });
  }

  // ───── PANEL
  if (interaction.commandName === 'panel') {
    const db = loadDB();
    const uid = interaction.user.id;

    if (!db.users[uid])
      return interaction.reply({ content: 'No key.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('Control Panel')
      .setDescription('Manage your system')
      .setColor(0x00ff99);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup').setLabel('Setup').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('start').setLabel('Start').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('stop').setLabel('Stop').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // ───── BUTTONS
  if (interaction.isButton()) {

    if (interaction.customId === 'stop') {
      stopJob(interaction.user.id);
      return interaction.reply({ content: 'Stopped.', ephemeral: true });
    }

    if (interaction.customId === 'setup') {
      const modal = new ModalBuilder()
        .setCustomId('setupModal')
        .setTitle('Setup');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('channel')
            .setLabel('Channel ID')
            .setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Message')
            .setStyle(TextInputStyle.Paragraph)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.customId === 'start') {
      return interaction.reply({ content: 'Start configured system first.', ephemeral: true });
    }
  }

  // ───── MODAL
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'setupModal') {

      const db = loadDB();
      const uid = interaction.user.id;

      db.users[uid].config = {
        channelId: interaction.fields.getTextInputValue('channel'),
        message: interaction.fields.getTextInputValue('message'),
        userToken: db.users[uid].config?.userToken || "",
        intervalMin: 30
      };

      saveDB(db);

      return interaction.reply({ content: 'Saved.', ephemeral: true });
    }
  }

});

client.login(BOT_TOKEN);
