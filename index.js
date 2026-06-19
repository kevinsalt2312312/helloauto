const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

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

// ─────────────────────────────────────
// SAFE CLAIM FIX (NO MORE "did not respond")
// ─────────────────────────────────────
async function handleClaim(interaction) {
  try {
    const keyInput = interaction.options.getString('key');

    if (!keyInput) {
      return interaction.reply({
        content: '❌ No key provided.',
        ephemeral: true
      });
    }

    const key = keyInput.trim().toUpperCase();
    const keys = loadKeys();
    const db = loadDB();
    const uid = interaction.user.id;

    if (db.users[uid]?.key) {
      return interaction.reply({
        content: '❌ You already have a key.',
        ephemeral: true
      });
    }

    const keyData = keys[key];

    if (!keyData) {
      return interaction.reply({
        content: '❌ Invalid key.',
        ephemeral: true
      });
    }

    if (keyData.claimed) {
      return interaction.reply({
        content: '❌ Key already claimed.',
        ephemeral: true
      });
    }

    const expiry = new Date(Date.now() + 10 * 86400000).toISOString();

    keys[key] = {
      claimed: true,
      claimedBy: uid,
      claimedAt: new Date().toISOString(),
      expiry
    };

    saveKeys(keys);

    db.users[uid] = {
      key,
      expiry,
      config: null
    };

    saveDB(db);

    return interaction.reply({
      content: `✅ Key claimed successfully!`,
      ephemeral: true
    });

  } catch (err) {
    console.error("CLAIM ERROR:", err);

    if (!interaction.replied) {
      return interaction.reply({
        content: '❌ An error occurred while claiming your key.',
        ephemeral: true
      });
    }
  }
}

// ─────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim your Auto-Adv license key')
    .addStringOption(o =>
      o.setName('key')
        .setDescription('Your license key')
        .setRequired(true)
    )
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Slash commands registered');
});

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  // FIXED CLAIM HANDLER
  if (interaction.commandName === 'claim') {
    return handleClaim(interaction);
  }

});

client.login(BOT_TOKEN);
