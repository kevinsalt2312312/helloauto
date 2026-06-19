const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ─────────────────────────────────────
//  FILL THESE IN
// ─────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = "1517632985342541864";
const OWNER_ROLE_ID = "1517636202801529033"; // ROLE ID (not user ID)
// ─────────────────────────────────────

const DB_FILE   = "./data.json";
const KEYS_FILE = "./keys.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) fs.writeFileSync(KEYS_FILE, JSON.stringify({}, null, 2));
  return JSON.parse(fs.readFileSync(KEYS_FILE));
}
function saveKeys(k) { fs.writeFileSync(KEYS_FILE, JSON.stringify(k, null, 2)); }

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
  const fire = async () => {
    await sendSelfMsg(cfg.userToken, cfg.channelId, cfg.message);
    const base = cfg.intervalMin * 60000;
    const jitter = (Math.random() * 4 - 2) * 60000;
    activeJobs[uid].timer = setTimeout(fire, Math.max(base + jitter, 60000));
  };
  activeJobs[uid] = { ...cfg, timer: null };
  fire();
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('claim').setDescription('Claim your Auto-Adv license key')
    .addStringOption(o => o.setName('key').setDescription('Your license key').setRequired(true)),
  new SlashCommandBuilder()
    .setName('panel').setDescription('Open your Auto-Adv control panel'),
  new SlashCommandBuilder()
    .setName('status').setDescription('Check if your auto-adv is running'),
  new SlashCommandBuilder()
    .setName('stop').setDescription('Stop your auto-adv'),
  new SlashCommandBuilder()
    .setName('genkeys').setDescription('[Owner only] Generate license keys')
    .addIntegerOption(o => o.setName('amount').setDescription('How many keys (max 100)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('listkeys').setDescription('[Owner only] List all keys'),
  new SlashCommandBuilder()
    .setName('revokekey').setDescription('[Owner only] Revoke a users key')
    .addUserOption(o => o.setName('user').setDescription('User to revoke').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Bot ready: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Slash commands registered');
});

client.on('interactionCreate', async interaction => {

  // ───────── OWNER ROLE CHECK ─────────
  const isOwner = interaction.member?.roles?.cache?.has(OWNER_ROLE_ID);

  // GENKEYS
  if (interaction.isChatInputCommand() && interaction.commandName === 'genkeys') {
    if (!isOwner)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });

    const amount = Math.min(interaction.options.getInteger('amount'), 100);
    const keys = loadKeys();
    const generated = [];

    for (let i = 0; i < amount; i++) {
      const rand = () => Math.random().toString(36).substring(2, 6).toUpperCase();
      const key = `PIKE-${rand()}-${rand()}-${rand()}`;
      keys[key] = { claimed: false, claimedBy: null, claimedAt: null, expiry: null };
      generated.push(key);
    }

    saveKeys(keys);
    fs.writeFileSync('./generated_keys.txt', generated.join('\n'));

    return interaction.reply({
      content: `Generated **${amount}** keys.`,
      files: ['./generated_keys.txt'],
      ephemeral: true
    });
  }

  // LISTKEYS
  if (interaction.isChatInputCommand() && interaction.commandName === 'listkeys') {
    if (!isOwner)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });

    const keys = loadKeys();
    const total = Object.keys(keys).length;
    const claimed = Object.values(keys).filter(v => v.claimed).length;

    const lines = Object.entries(keys).map(([k, v]) => {
      const status = v.claimed ? 'CLAIMED' : 'AVAILABLE';
      const exp = v.expiry ? v.expiry.split('T')[0] : 'on claim';
      const by = v.claimedBy ? ` | user: ${v.claimedBy}` : '';
      return `[${status}] ${k} | expires: ${exp}${by}`;
    });

    const text =
      `Total: ${total} | Claimed: ${claimed}\n` +
      '─'.repeat(60) + '\n' +
      lines.join('\n');

    fs.writeFileSync('./keys_list.txt', text);

    return interaction.reply({
      content: `**${total}** keys loaded.`,
      files: ['./keys_list.txt'],
      ephemeral: true
    });
  }

  // REVOKE
  if (interaction.isChatInputCommand() && interaction.commandName === 'revokekey') {
    if (!isOwner)
      return interaction.reply({ content: 'Owner only.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const db = loadDB();
    const keys = loadKeys();

    if (!db.users[target.id])
      return interaction.reply({ content: `<@${target.id}> has no key.`, ephemeral: true });

    const userKey = db.users[target.id].key;
    stopJob(target.id);

    if (keys[userKey]) {
      keys[userKey].claimed = false;
      keys[userKey].claimedBy = null;
      saveKeys(keys);
    }

    delete db.users[target.id];
    saveDB(db);

    return interaction.reply({
      content: `Revoked key from <@${target.id}>.`,
      ephemeral: true
    });
  }

  // (UNCHANGED COMMANDS BELOW THIS LINE)
  // claim / panel / status / stop / buttons / modal stay exactly the same
  // --- I did NOT modify them to avoid breaking your system ---

});

client.login(BOT_TOKEN);
